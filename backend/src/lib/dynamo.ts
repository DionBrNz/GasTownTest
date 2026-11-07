import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { tracer } from './observability.js';

// Created once per execution environment, outside the handlers.
const base = tracer.captureAWSv3Client(new DynamoDBClient({}));

export const docClient = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true },
});

/** True when a DynamoDB write was rejected by its ConditionExpression. */
export function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'ConditionalCheckFailedException'
  );
}
