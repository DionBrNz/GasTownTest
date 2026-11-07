import { Tags, Validations } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { resolveStageConfig } from './config';
import type { StageConfig } from './config';
import { ApiStack } from './stacks/api-stack';
import { AuthStack } from './stacks/auth-stack';
import { DataStack } from './stacks/data-stack';
import { WebDeploymentStack } from './stacks/web-deployment-stack';
import { WebHostingStack } from './stacks/web-hosting-stack';

export interface TodoApp {
  readonly config: StageConfig;
  readonly webHosting: WebHostingStack;
  readonly auth: AuthStack;
  readonly data: DataStack;
  readonly api: ApiStack;
  readonly webDeployment: WebDeploymentStack;
}

/**
 * Wires all stacks onto `app` in dependency order:
 * WebHosting -> Auth -> (Data) -> Api -> WebDeployment.
 * Applies app-wide tags and cdk-nag AwsSolutions checks.
 */
export function buildTodoApp(app: App): TodoApp {
  const config = resolveStageConfig(app.node);

  const webHosting = new WebHostingStack(app, { config });
  const auth = new AuthStack(app, { config, webHosting });
  const data = new DataStack(app, { config });
  const api = new ApiStack(app, { config, webHosting, auth, data });
  const webDeployment = new WebDeploymentStack(app, { config, webHosting, auth, api });

  Tags.of(app).add('app', config.appName);
  Tags.of(app).add('env', config.stage);

  // cdk-nag v3 runs as a CDK policy-validation plugin: any unacknowledged finding
  // fails `cdk synth`. Fix it, or acknowledge it inline next to the resource:
  //   Validations.of(construct).acknowledge({ id: 'AwsSolutions-XX', reason: '...' })
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

  return { config, webHosting, auth, data, api, webDeployment };
}
