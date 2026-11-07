import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { buildTodoApp } from '../lib/app';

// Synthesizing bundles the four handlers with esbuild, so build the app once per context.
const BUNDLE_TIMEOUT_MS = 180_000;

function apiTemplate(context: Record<string, unknown> = { stage: 'dev' }) {
  const todo = buildTodoApp(new App({ context }));
  return Template.fromStack(todo.api);
}

/** Every IAM::Policy statement that grants a DynamoDB action, in template order. */
function dynamoStatements(template: Template) {
  const statements: { actions: unknown; resource: unknown }[] = [];
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
    const doc = (policy as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
      .PolicyDocument;
    for (const statement of doc.Statement as { Action: unknown; Resource: unknown }[]) {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      if (actions.some((a) => typeof a === 'string' && a.startsWith('dynamodb:'))) {
        statements.push({ actions: statement.Action, resource: statement.Resource });
      }
    }
  }
  return statements;
}

describe('API stack', () => {
  let template: Template;

  beforeAll(() => {
    template = apiTemplate();
  }, BUNDLE_TIMEOUT_MS);

  test('REST API is regional and exposes the four todo routes', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      EndpointConfiguration: { Types: ['REGIONAL'] },
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'todos' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: '{id}' });

    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'))
      .map((m) => (m as { Properties: { HttpMethod: string } }).Properties.HttpMethod)
      .sort();
    // OPTIONS is the CORS preflight on each resource (root, /todos, /todos/{id}). It is
    // unauthenticated by design, because browsers send preflights without credentials.
    expect(methods).toEqual(['DELETE', 'GET', 'OPTIONS', 'OPTIONS', 'OPTIONS', 'PATCH', 'POST']);
  });

  test('every non-preflight method uses the Cognito authorizer with the todo/api scope', () => {
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method')).map(
      (m) => (m as { Properties: Record<string, unknown> }).Properties,
    );
    const secured = methods.filter((m) => m['HttpMethod'] !== 'OPTIONS');
    expect(secured).toHaveLength(4);
    for (const method of secured) {
      expect(method).toMatchObject({
        AuthorizationType: 'COGNITO_USER_POOLS',
        AuthorizationScopes: ['todo/api'],
      });
      expect(JSON.stringify(method['AuthorizerId'])).toContain('CognitoAuthorizer');
    }
    for (const method of methods.filter((m) => m['HttpMethod'] === 'OPTIONS')) {
      expect(method['AuthorizationType']).toBe('NONE');
    }
  });

  test('POST and PATCH validate bodies against JSON schema models', () => {
    template.hasResourceProperties('AWS::ApiGateway::RequestValidator', {
      ValidateRequestBody: true,
      ValidateRequestParameters: true,
    });
    template.hasResourceProperties('AWS::ApiGateway::Model', {
      Name: 'CreateTodo',
      Schema: Match.objectLike({
        additionalProperties: false,
        required: ['title'],
        properties: Match.objectLike({
          title: { type: 'string', minLength: 1, maxLength: 200 },
        }),
      }),
    });
    template.hasResourceProperties('AWS::ApiGateway::Model', {
      Name: 'UpdateTodo',
      Schema: Match.objectLike({ additionalProperties: false, minProperties: 1 }),
    });
  });

  test('stage: throttling 20 rps / burst 40, JSON access logs, errors-only execution logs', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'dev',
      MethodSettings: [
        Match.objectLike({
          HttpMethod: '*',
          ResourcePath: '/*',
          ThrottlingRateLimit: 20,
          ThrottlingBurstLimit: 40,
          LoggingLevel: 'ERROR',
          DataTraceEnabled: false,
        }),
      ],
      AccessLogSetting: Match.objectLike({ DestinationArn: Match.anyValue() }),
    });
  });

  test('CORS on the gateway allows only the CloudFront origin and the expected methods', () => {
    const responses = Object.values(template.findResources('AWS::ApiGateway::GatewayResponse'));
    expect(responses).toHaveLength(2);
    for (const response of responses) {
      const headers = (response as { Properties: { ResponseParameters: Record<string, string> } })
        .Properties.ResponseParameters;
      expect(headers['gatewayresponse.header.Access-Control-Allow-Origin']).toBe(
        "'https://example.invalid'",
      );
      expect(headers['gatewayresponse.header.Access-Control-Allow-Methods']).toBe(
        "'GET,POST,PATCH,DELETE,OPTIONS'",
      );
    }
  });

  test('each route Lambda: Node 22, arm64, X-Ray active, 30-day logs, env limited to TABLE_NAME and ALLOWED_ORIGIN', () => {
    const functions = Object.values(template.findResources('AWS::Lambda::Function')).map(
      (f) => (f as { Properties: Record<string, unknown> }).Properties,
    );
    expect(functions).toHaveLength(4);
    for (const fn of functions) {
      expect(fn).toMatchObject({
        Runtime: 'nodejs22.x',
        Architectures: ['arm64'],
        Handler: 'index.handler',
        TracingConfig: { Mode: 'Active' },
      });
      const variables = (fn['Environment'] as { Variables: Record<string, unknown> }).Variables;
      expect(Object.keys(variables).sort()).toEqual(['ALLOWED_ORIGIN', 'TABLE_NAME']);
      expect(variables['ALLOWED_ORIGIN']).toBe('https://example.invalid');
      expect(fn).not.toHaveProperty('ReservedConcurrentExecutions');
    }

    const logGroups = template.findResources('AWS::Logs::LogGroup');
    const logicalIds = Object.keys(logGroups);
    for (const route of ['ListTodosLogs', 'CreateTodoLogs', 'UpdateTodoLogs', 'DeleteTodoLogs']) {
      expect(logicalIds.some((id) => id.startsWith(route))).toBe(true);
    }
    for (const group of Object.values(logGroups)) {
      expect(
        (group as { Properties: { RetentionInDays: number } }).Properties.RetentionInDays,
      ).toBe(30);
    }
  });

  test('each route role has exactly one DynamoDB action, scoped to the table (no wildcards)', () => {
    const statements = dynamoStatements(template);
    const actions = statements.map((s) => s.actions);
    expect(actions.sort()).toEqual(
      ['dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem'].sort(),
    );
    for (const statement of statements) {
      expect(statement.resource).not.toBe('*');
      expect(statement.resource).toEqual(expect.anything());
      expect(JSON.stringify(statement.resource)).not.toContain('"*"');
    }
  });

  test('no route grants a wildcard DynamoDB action or grantReadWriteData-style bundle', () => {
    const json = JSON.stringify(dynamoStatements(template));
    expect(json).not.toMatch(/dynamodb:\*/);
    expect(json).not.toMatch(/dynamodb:(Scan|BatchWriteItem|BatchGetItem|DescribeTable)/);
  });

  test('WAF: managed common and known-bad-input rule sets, per-IP rate limit, attached to the stage', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      DefaultAction: { Allow: {} },
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSManagedRulesCommonRuleSet',
          Statement: {
            ManagedRuleGroupStatement: { VendorName: 'AWS', Name: 'AWSManagedRulesCommonRuleSet' },
          },
        }),
        Match.objectLike({
          Name: 'AWSManagedRulesKnownBadInputsRuleSet',
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        }),
        Match.objectLike({
          Action: { Block: {} },
          Statement: { RateBasedStatement: { AggregateKeyType: 'IP', Limit: 2000 } },
        }),
      ]),
    });
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  test('exports the API URL', () => {
    template.hasOutput('ApiUrl', {});
  });

  test('deletion of the access log group follows the stage removal policy', () => {
    template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Delete' });
  });
});

describe('API stack: reserved concurrency', () => {
  test(
    'a numeric context value reserves concurrency on every route Lambda',
    () => {
      const template = apiTemplate({ stage: 'dev', reservedConcurrency: '5' });
      const functions = Object.values(template.findResources('AWS::Lambda::Function')).map(
        (f) => (f as { Properties: Record<string, unknown> }).Properties,
      );
      expect(functions).toHaveLength(4);
      for (const fn of functions) {
        expect(fn['ReservedConcurrentExecutions']).toBe(5);
      }
    },
    BUNDLE_TIMEOUT_MS,
  );

  test.each([['0'], ['-1'], ['abc'], [1.5]])('rejects invalid reservedConcurrency %p', (value) => {
    expect(() =>
      buildTodoApp(new App({ context: { stage: 'dev', reservedConcurrency: value } })),
    ).toThrow(/reservedConcurrency/);
  });
});
