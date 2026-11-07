import { App, RemovalPolicy, Stack, Validations } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AwsSolutionsChecks } from 'cdk-nag';
import { buildTodoApp } from '../lib/app';
import { resolveStageConfig } from '../lib/config';

function synthApp(context: Record<string, unknown> = {}) {
  const app = new App({ context });
  const todo = buildTodoApp(app);
  const assembly = app.synth();
  const stacks: Stack[] = [todo.webHosting, todo.auth, todo.data, todo.api, todo.webDeployment];
  return { app, todo, assembly, stacks };
}

describe('stage config', () => {
  test('defaults to dev with DESTROY removal policy', () => {
    const config = resolveStageConfig(new App().node, {});
    expect(config.stage).toBe('dev');
    expect(config.isProd).toBe(false);
    expect(config.removalPolicy).toBe(RemovalPolicy.DESTROY);
    expect(config.autoDeleteObjects).toBe(true);
  });

  test('prod retains resources', () => {
    const config = resolveStageConfig(new App({ context: { stage: 'prod' } }).node, {});
    expect(config.isProd).toBe(true);
    expect(config.removalPolicy).toBe(RemovalPolicy.RETAIN);
    expect(config.autoDeleteObjects).toBe(false);
  });

  test.each(['', 'Prod', '1dev', 'dev-1', 'a', 'waytoolongstage', 42])(
    'rejects invalid stage %p',
    (stage) => {
      expect(() => resolveStageConfig(new App({ context: { stage } }).node, {})).toThrow(
        /Invalid stage/,
      );
    },
  );

  test('env is agnostic without CDK_DEFAULT_* and pinned with them', () => {
    const node = new App().node;
    expect(resolveStageConfig(node, {}).env).toEqual({});
    expect(
      resolveStageConfig(node, {
        CDK_DEFAULT_ACCOUNT: '123456789012',
        CDK_DEFAULT_REGION: 'ap-southeast-2',
      }).env,
    ).toEqual({ account: '123456789012', region: 'ap-southeast-2' });
  });
});

describe('app wiring', () => {
  test('synthesizes all five stacks with stage-scoped names', () => {
    const { assembly } = synthApp({ stage: 'dev' });
    expect(assembly.stacks.map((s) => s.stackName).sort()).toEqual(
      [
        'Todo-dev-Api',
        'Todo-dev-Auth',
        'Todo-dev-Data',
        'Todo-dev-WebDeployment',
        'Todo-dev-WebHosting',
      ].sort(),
    );
  });

  test('deploy order: WebHosting -> Auth -> Api -> WebDeployment, Data before Api', () => {
    const { todo } = synthApp();
    expect(todo.webHosting.dependencies).toEqual([]);
    expect(todo.data.dependencies).toEqual([]);
    expect(todo.auth.dependencies).toEqual([todo.webHosting]);
    expect(todo.api.dependencies).toEqual(
      expect.arrayContaining([todo.webHosting, todo.auth, todo.data]),
    );
    expect(todo.webDeployment.dependencies).toEqual(
      expect.arrayContaining([todo.webHosting, todo.auth, todo.api]),
    );
  });

  test.each([
    ['dev', false],
    ['prod', true],
  ])('stage %s: tags every stack and sets termination protection=%p', (stage, prod) => {
    const { stacks } = synthApp({ stage });
    for (const stack of stacks) {
      expect(stack.tags.tagValues()).toEqual({ app: 'todo', env: stage });
      expect(stack.terminationProtection).toBe(prod);
    }
  });

  test('cdk-nag AwsSolutions is registered app-wide and fails synth on a finding', () => {
    const app = new App();
    const todo = buildTodoApp(app);
    // A bare bucket violates AwsSolutions-S1 (no access logs) and -S10 (no TLS-only policy).
    new Bucket(todo.data, 'NagProbe');
    expect(() => app.synth()).toThrow(/AwsSolutions-S1\b/);
  });

  test('acknowledged findings do not fail synth', () => {
    const app = new App();
    const todo = buildTodoApp(app);
    const bucket = new Bucket(todo.data, 'NagProbe');
    for (const id of ['AwsSolutions-S1', 'AwsSolutions-S10']) {
      Validations.of(bucket).acknowledge({ id, reason: 'test fixture' });
    }
    expect(() => app.synth()).not.toThrow();
  });

  test('cdk-nag AwsSolutions reports no violations on any stack', () => {
    const { stacks } = synthApp();
    for (const stack of stacks) {
      expect(new AwsSolutionsChecks().validateScope(stack).violations).toEqual([]);
    }
  });
});
