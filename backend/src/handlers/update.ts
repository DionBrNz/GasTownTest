import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { callerUserId } from '../lib/auth.js';
import { docClient, isConditionalCheckFailed } from '../lib/dynamo.js';
import { env } from '../lib/env.js';
import { withErrors } from '../lib/handler.js';
import { HttpError, json, parseBody } from '../lib/http.js';
import { toTodo, todoIdSchema, updateTodoSchema } from '../lib/todos.js';
import type { TodoItem } from '../lib/todos.js';

/**
 * PATCH /todos/{id}. The key is (caller userId, id). The condition makes a
 * missing item, or another user's id, return 404 rather than create a row.
 */
async function updateTodo(event: APIGatewayProxyEvent) {
  const userId = callerUserId(event);
  const todoId = todoIdSchema.safeParse(event.pathParameters?.['id']);
  if (!todoId.success) {
    throw new HttpError(400, 'Invalid id');
  }
  const input = parseBody(updateTodoSchema, event);

  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };
  const setParts = ['#updatedAt = :updatedAt'];
  const removeParts: string[] = [];

  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    names[`#${field}`] = field;
    if (value === null) {
      removeParts.push(`#${field}`);
    } else {
      values[`:${field}`] = value;
      setParts.push(`#${field} = :${field}`);
    }
  }

  const updateExpression =
    `SET ${setParts.join(', ')}` + (removeParts.length ? ` REMOVE ${removeParts.join(', ')}` : '');

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: env.tableName(),
        Key: { userId, todoId: todoId.data },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(todoId)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return json(200, toTodo(result.Attributes as TodoItem));
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw new HttpError(404, 'Todo not found');
    }
    throw err;
  }
}

export const handler = withErrors('update', updateTodo);
