import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { callerUserId } from '../lib/auth.js';
import { docClient } from '../lib/dynamo.js';
import { env } from '../lib/env.js';
import { withErrors } from '../lib/handler.js';
import { json, parseQuery } from '../lib/http.js';
import { decodeNextToken, encodeNextToken } from '../lib/pagination.js';
import { listQuerySchema, toTodo } from '../lib/todos.js';
import type { TodoItem } from '../lib/todos.js';

/** GET /todos: reads only the caller's own partition. Read-only IAM (dynamodb:Query). */
async function listTodos(event: APIGatewayProxyEvent) {
  const userId = callerUserId(event);
  const query = parseQuery(listQuerySchema, event);
  const startKey = query.nextToken ? decodeNextToken(query.nextToken, userId) : undefined;

  const result = await docClient.send(
    new QueryCommand({
      TableName: env.tableName(),
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      Limit: query.limit,
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }),
  );

  const items = ((result.Items ?? []) as TodoItem[]).map(toTodo);
  const last = result.LastEvaluatedKey;
  const nextToken =
    last && typeof last['todoId'] === 'string'
      ? encodeNextToken({ userId, todoId: last['todoId'] })
      : undefined;

  return json(200, { items, ...(nextToken ? { nextToken } : {}) });
}

export const handler = withErrors('list', listTodos);
