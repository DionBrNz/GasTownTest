import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

export const TABLE_NAME = 'todo-test-todos';
export const ALLOWED_ORIGIN = 'https://app.test.example';
export const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
export const TODO_ID = '6f1c2a3e-7b8d-4c9e-9f0a-1b2c3d4e5f60';

export function setEnv(): void {
  process.env['TABLE_NAME'] = TABLE_NAME;
  process.env['ALLOWED_ORIGIN'] = ALLOWED_ORIGIN;
}

interface EventOptions {
  sub?: string | undefined;
  claims?: boolean;
  body?: string | null;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
}

/** Builds an API Gateway REST proxy event with Cognito claims unless `claims: false`. */
export function makeEvent(options: EventOptions = {}): APIGatewayProxyEvent {
  const { sub = USER_A, claims = true } = options;
  return {
    body: options.body ?? null,
    isBase64Encoded: options.isBase64Encoded ?? false,
    pathParameters: options.pathParameters ?? null,
    queryStringParameters: options.queryStringParameters ?? null,
    requestContext: {
      authorizer: claims ? { claims: { sub } } : null,
    },
  } as unknown as APIGatewayProxyEvent;
}

export const context = {
  functionName: 'test',
  awsRequestId: 'test-request',
} as unknown as Context;
