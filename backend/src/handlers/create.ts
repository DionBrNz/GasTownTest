import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { callerUserId } from '../lib/auth.js';
import { docClient, isConditionalCheckFailed } from '../lib/dynamo.js';
import { env } from '../lib/env.js';
import { withErrors } from '../lib/handler.js';
import { HttpError, json, parseBody } from '../lib/http.js';
import { createTodoSchema, DEFAULT_PRIORITY, toTodo } from '../lib/todos.js';
import type { TodoItem } from '../lib/todos.js';

/** POST /todos: the server generates the id and timestamps. */
async function createTodo(event: APIGatewayProxyEvent) {
  const userId = callerUserId(event);
  const input = parseBody(createTodoSchema, event);
  const now = new Date().toISOString();

  const item: TodoItem = {
    userId,
    todoId: randomUUID(),
    title: input.title,
    completed: false,
    priority: input.priority ?? DEFAULT_PRIORITY,
    createdAt: now,
    updatedAt: now,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: env.tableName(),
        Item: item,
        ConditionExpression: 'attribute_not_exists(todoId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw new HttpError(409, 'Conflict');
    }
    throw err;
  }

  return json(201, toTodo(item));
}

export const handler = withErrors('create', createTodo);
