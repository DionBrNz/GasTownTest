import * as path from 'node:path';
import { CfnOutput } from 'aws-cdk-lib';
import {
  AccessLogFormat,
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  EndpointType,
  JsonSchemaType,
  JsonSchemaVersion,
  LambdaIntegration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  ResponseType,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import type { MethodOptions } from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Duration, Validations } from 'aws-cdk-lib';
import type { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import type { AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';
import type { WebHostingStack } from './web-hosting-stack';

export interface ApiStackProps extends TodoStackProps {
  /** Source of the CloudFront domain used as the only allowed CORS origin. */
  readonly webHosting: WebHostingStack;
  /** Source of the Cognito user pool for the REST API authorizer. */
  readonly auth: AuthStack;
  /** Source of the DynamoDB table the per-route Lambdas read/write. */
  readonly data: DataStack;
}

/** Absolute path to the repository root, from infra/lib/stacks. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HANDLER_DIR = path.join(REPO_ROOT, 'backend', 'src', 'handlers');

/** One Lambda per route. Each gets only the DynamoDB action its route needs. */
const ROUTES = {
  list: { construct: 'ListTodos', actions: ['dynamodb:Query'] },
  create: { construct: 'CreateTodo', actions: ['dynamodb:PutItem'] },
  update: { construct: 'UpdateTodo', actions: ['dynamodb:UpdateItem'] },
  delete: { construct: 'DeleteTodo', actions: ['dynamodb:DeleteItem'] },
} as const;

/** Stage throttling, sized for a single-user todo app. */
const THROTTLE_RATE_LIMIT = 20;
const THROTTLE_BURST_LIMIT = 40;

/** WAF: requests per source IP in a 5-minute window before blocking. */
const WAF_RATE_LIMIT = 2000;

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Authorization', 'Content-Type'];

const DUE_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const PRIORITY_VALUES = ['low', 'medium', 'high'];

/**
 * API Gateway REST API (Cognito authorizer, WAF, validators, throttling, access
 * logs) and the per-route TypeScript Lambdas (NodejsFunction, Node 22, arm64).
 */
export class ApiStack extends TodoStack {
  readonly restApi: RestApi;
  private readonly dataTable: TableV2;
  private readonly allowedOrigin: string;
  /** Base URL of the API stage, e.g. `https://<id>.execute-api.<region>.amazonaws.com/dev/`. */
  readonly apiUrl: string;

  constructor(scope: Construct, props: ApiStackProps) {
    const { webHosting, auth, data, ...rest } = props;
    super(scope, 'Api', { description: 'Todo app: REST API + Lambdas + WAF', ...rest });
    this.addStackDependency(webHosting);
    this.addStackDependency(auth);
    this.addStackDependency(data);

    const { config } = this;
    const allowedOrigin = webHosting.siteUrl;
    this.dataTable = data.table;
    this.allowedOrigin = allowedOrigin;

    const accessLogs = new LogGroup(this, 'ApiAccessLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });

    this.restApi = new RestApi(this, 'TodosApi', {
      restApiName: `${config.appName}-${config.stage}-api`,
      description: 'Todo REST API, authorized by the Cognito user pool',
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      // Account-level role that lets the stage write execution logs.
      cloudWatchRole: true,
      deployOptions: {
        stageName: config.stage,
        throttlingRateLimit: THROTTLE_RATE_LIMIT,
        throttlingBurstLimit: THROTTLE_BURST_LIMIT,
        // Execution logs record errors only, never request or response bodies.
        loggingLevel: MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        metricsEnabled: true,
        accessLogDestination: new LogGroupLogDestination(accessLogs),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
      },
      // Browsers send preflight without credentials, so OPTIONS stays unauthenticated.
      // It returns only the CORS headers for the CloudFront origin.
      defaultCorsPreflightOptions: {
        allowOrigins: [allowedOrigin],
        allowMethods: ALLOWED_METHODS,
        allowHeaders: ALLOWED_HEADERS,
      },
    });

    // Gateway-generated 4XX/5XX (authorizer, validator, throttling) must still carry CORS
    // headers, or the browser hides the real status from the SPA.
    const corsGatewayHeaders = {
      'Access-Control-Allow-Origin': `'${allowedOrigin}'`,
      'Access-Control-Allow-Headers': `'${ALLOWED_HEADERS.join(',')}'`,
      'Access-Control-Allow-Methods': `'${ALLOWED_METHODS.join(',')}'`,
    };
    this.restApi.addGatewayResponse('Gateway4xx', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: corsGatewayHeaders,
    });
    this.restApi.addGatewayResponse('Gateway5xx', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: corsGatewayHeaders,
    });

    // The API Gateway account role is the AWS-managed service role for stage execution logs.
    Validations.of(this.restApi).acknowledge({
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs]',
      reason:
        'The account-level CloudWatch role for API Gateway execution logs uses the AWS-managed ' +
        'service role, which is the documented way to enable execution logging.',
    });

    const authorizer = new CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [auth.userPool],
      authorizerName: `${config.appName}-${config.stage}-cognito`,
    });

    // Every method requires a token with the todo/api scope.
    const secured: Pick<MethodOptions, 'authorizer' | 'authorizationType' | 'authorizationScopes'> =
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
        authorizationScopes: [auth.apiScope],
      };

    const bodyValidator = this.restApi.addRequestValidator('BodyValidator', {
      requestValidatorName: `${config.appName}-${config.stage}-body`,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    const createModel = this.restApi.addModel('CreateTodoModel', {
      modelName: 'CreateTodo',
      contentType: 'application/json',
      schema: {
        schema: JsonSchemaVersion.DRAFT4,
        title: 'CreateTodo',
        type: JsonSchemaType.OBJECT,
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: JsonSchemaType.STRING, minLength: 1, maxLength: 200 },
          priority: { type: JsonSchemaType.STRING, enum: PRIORITY_VALUES },
          dueDate: { type: JsonSchemaType.STRING, pattern: DUE_DATE_PATTERN },
        },
      },
    });

    const updateModel = this.restApi.addModel('UpdateTodoModel', {
      modelName: 'UpdateTodo',
      contentType: 'application/json',
      schema: {
        schema: JsonSchemaVersion.DRAFT4,
        title: 'UpdateTodo',
        type: JsonSchemaType.OBJECT,
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: JsonSchemaType.STRING, minLength: 1, maxLength: 200 },
          completed: { type: JsonSchemaType.BOOLEAN },
          priority: { type: JsonSchemaType.STRING, enum: PRIORITY_VALUES },
          // null clears the due date.
          dueDate: {
            type: [JsonSchemaType.STRING, JsonSchemaType.NULL],
            pattern: DUE_DATE_PATTERN,
          },
        },
      },
    });

    const fns = {
      list: this.todoFunction('list'),
      create: this.todoFunction('create'),
      update: this.todoFunction('update'),
      delete: this.todoFunction('delete'),
    };

    const todos = this.restApi.root.addResource('todos');
    const todo = todos.addResource('{id}');

    todos.addMethod('GET', new LambdaIntegration(fns.list), {
      ...secured,
      requestValidator: bodyValidator,
    });
    todos.addMethod('POST', new LambdaIntegration(fns.create), {
      ...secured,
      requestValidator: bodyValidator,
      requestModels: { 'application/json': createModel },
    });
    todo.addMethod('PATCH', new LambdaIntegration(fns.update), {
      ...secured,
      requestValidator: bodyValidator,
      requestModels: { 'application/json': updateModel },
    });
    todo.addMethod('DELETE', new LambdaIntegration(fns.delete), {
      ...secured,
      requestValidator: bodyValidator,
    });

    this.addWebAcl();

    this.apiUrl = this.restApi.url;
    new CfnOutput(this, 'ApiUrl', { value: this.apiUrl });
  }

  /**
   * One NodejsFunction per route: its own role (one DynamoDB action, one table ARN),
   * a 30-day log group, X-Ray tracing and no secrets in the environment.
   */
  private todoFunction(route: keyof typeof ROUTES): LambdaFunction {
    const { config } = this;
    const { construct, actions } = ROUTES[route];
    const table = this.dataTable;

    const logGroup = new LogGroup(this, `${construct}Logs`, {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });

    const role = new Role(this, `${construct}Role`, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: `Todo app: ${route} route`,
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [...actions],
        resources: [table.tableArn],
      }),
    );
    logGroup.grantWrite(role);

    const fn = new NodejsFunction(this, construct, {
      entry: path.join(HANDLER_DIR, `${route}.ts`),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      role,
      logGroup,
      tracing: Tracing.ACTIVE,
      memorySize: 256,
      timeout: Duration.seconds(10),
      ...(config.reservedConcurrency !== undefined
        ? { reservedConcurrentExecutions: config.reservedConcurrency }
        : {}),
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: this.allowedOrigin,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        // The Node 22 runtime ships AWS SDK v3, so it stays out of the bundle.
        externalModules: ['@aws-sdk/*'],
      },
    });

    // X-Ray write actions only accept '*' as the resource, so this is the one wildcard.
    Validations.of(role).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'xray:PutTraceSegments and xray:PutTelemetryRecords do not support resource-level ' +
        'permissions, so CDK grants them on "*". They are the only wildcard in this role.',
    });

    Validations.of(fn).acknowledge({
      id: 'AwsSolutions-L1',
      reason:
        'The spec requires Node.js 22 on arm64. Move to the newest Node runtime with a ' +
        'dedicated change, after the Node 22 end-of-life date.',
    });

    return fn;
  }

  /** WAFv2 Web ACL for the REST API stage: AWS managed rule sets and a per-IP rate limit. */
  private addWebAcl(): void {
    const { config } = this;
    const visibility = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      metricName: `${config.appName}-${config.stage}-${metricName}`,
      sampledRequestsEnabled: true,
    });
    const managedRule = (name: string, priority: number): CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
      visibilityConfig: visibility(name),
    });

    const webAcl = new CfnWebACL(this, 'ApiWebAcl', {
      name: `${config.appName}-${config.stage}-api`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('ApiWebAcl'),
      rules: [
        managedRule('AWSManagedRulesCommonRuleSet', 0),
        managedRule('AWSManagedRulesKnownBadInputsRuleSet', 1),
        {
          name: 'IpRateLimit',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: WAF_RATE_LIMIT, aggregateKeyType: 'IP' },
          },
          visibilityConfig: visibility('IpRateLimit'),
        },
      ],
    });

    new CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
      resourceArn: this.restApi.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });
  }
}
