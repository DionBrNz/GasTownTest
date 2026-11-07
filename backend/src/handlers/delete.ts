import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { callerUserId } from '../lib/auth.js';
import { docClient, isConditionalCheckFailed } from '../lib/dynamo.js';
import { env } from '../lib/env.js';
import { withErrors } from '../lib/handler.js';
import { HttpError, noContent } from '../lib/http.js';
import { todoIdSchema } from '../lib/todos.js';

/** DELETE /todos/{id}: 204 on success, 404 if missing or not owned. */
async function deleteTodo(event: APIGatewayProxyEvent) {
  const userId = callerUserId(event);
  const todoId = todoIdSchema.safeParse(event.pathParameters?.['id']);
  if (!todoId.success) {
    throw new HttpError(400, 'Invalid id');
  }

  try {
    await docClient.send(
      new DeleteCommand({
        TableName: env.tableName(),
        Key: { userId, todoId: todoId.data },
        ConditionExpression: 'attribute_exists(todoId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw new HttpError(404, 'Todo not found');
    }
    throw err;
  }

  return noContent();
}

export const handler = withErrors('delete', deleteTodo);
