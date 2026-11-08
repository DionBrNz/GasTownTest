import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, test } from 'vitest';
import { handler as createHandler } from '../src/handlers/create.js';
import { handler as deleteHandler } from '../src/handlers/delete.js';
import { handler as listHandler } from '../src/handlers/list.js';
import { handler as updateHandler } from '../src/handlers/update.js';
import { docClient } from '../src/lib/dynamo.js';
import { encodeNextToken } from '../src/lib/pagination.js';
import { context, makeEvent, setEnv, TABLE_NAME, TODO_ID, USER_A, USER_B } from './helpers.js';

setEnv();

const ddbMock = mockClient(docClient);

/** The input of the Nth DynamoDB call, typed loosely for field assertions. */
function sentInput(index: number): Record<string, unknown> {
  return ddbMock.call(index).args[0].input as Record<string, unknown>;
}

function conditionFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });
}

const storedItem = {
  userId: USER_A,
  todoId: TODO_ID,
  title: 'Buy milk',
  completed: false,
  priority: 'low',
  dueDate: '2026-12-31',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};

beforeEach(() => {
  ddbMock.reset();
});

describe('authorization', () => {
  test('missing claims returns 401 and does not touch DynamoDB', async () => {
    const res = await listHandler(makeEvent({ claims: false }), context);
    expect(res.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('responses carry no CORS headers: the SPA is same-origin via CloudFront', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await listHandler(makeEvent(), context);
    expect(res.headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  test('responses are never cached and are not sniffed, including errors', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const ok = await listHandler(makeEvent(), context);
    const denied = await listHandler(makeEvent({ claims: false }), context);
    for (const res of [ok, denied]) {
      expect(res.headers?.['Cache-Control']).toBe('no-store');
      expect(res.headers?.['X-Content-Type-Options']).toBe('nosniff');
    }
  });
});

describe('GET /todos (list)', () => {
  test('queries only the caller partition and maps items to the Todo shape', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [storedItem] });

    const res = await listHandler(makeEvent({ queryStringParameters: { limit: '10' } }), context);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      items: [
        {
          id: TODO_ID,
          title: 'Buy milk',
          completed: false,
          priority: 'low',
          dueDate: '2026-12-31',
          createdAt: storedItem.createdAt,
          updatedAt: storedItem.updatedAt,
        },
      ],
    });
    const input = sentInput(0);
    expect(input).toMatchObject({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeValues: { ':userId': USER_A },
      Limit: 10,
    });
    expect(input).not.toHaveProperty('ExclusiveStartKey');
  });

  test('ignores a userId supplied by the client and uses the claim', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await listHandler(makeEvent({ queryStringParameters: { userId: USER_B } }), context);
    expect(sentInput(0).ExpressionAttributeValues).toEqual({ ':userId': USER_A });
  });

  test('defaults the limit to 50 and returns nextToken from LastEvaluatedKey', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [storedItem],
      LastEvaluatedKey: { userId: USER_A, todoId: TODO_ID },
    });

    const res = await listHandler(makeEvent(), context);
    const body = JSON.parse(res.body) as { nextToken?: string };

    expect(sentInput(0).Limit).toBe(50);
    expect(body.nextToken).toBe(encodeNextToken({ userId: USER_A, todoId: TODO_ID }));
  });

  test('resumes from a valid nextToken', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const token = encodeNextToken({ userId: USER_A, todoId: TODO_ID });

    const res = await listHandler(
      makeEvent({ queryStringParameters: { nextToken: token } }),
      context,
    );

    expect(res.statusCode).toBe(200);
    expect(sentInput(0).ExclusiveStartKey).toEqual({
      userId: USER_A,
      todoId: TODO_ID,
    });
  });

  test('rejects another user nextToken without querying', async () => {
    const token = encodeNextToken({ userId: USER_B, todoId: TODO_ID });
    const res = await listHandler(
      makeEvent({ queryStringParameters: { nextToken: token } }),
      context,
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ message: 'Invalid nextToken' });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test.each([{ limit: '0' }, { limit: '101' }, { limit: 'many' }])(
    'rejects invalid limit %o',
    async (query) => {
      const res = await listHandler(makeEvent({ queryStringParameters: query }), context);
      expect(res.statusCode).toBe(400);
      expect(ddbMock.calls()).toHaveLength(0);
    },
  );
});

describe('POST /todos (create)', () => {
  test('server generates id and timestamps; defaults priority to medium', async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await createHandler(
      makeEvent({ body: JSON.stringify({ title: 'Write tests' }) }),
      context,
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      title: 'Write tests',
      completed: false,
      priority: 'medium',
      dueDate: null,
    });

    const input = sentInput(0);
    expect(input.ConditionExpression).toBe('attribute_not_exists(todoId)');
    expect(input.Item).toMatchObject({ userId: USER_A, todoId: body['id'], title: 'Write tests' });
    expect(input.Item).not.toHaveProperty('dueDate');
  });

  test('stores the due date when provided', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await createHandler(
      makeEvent({ body: JSON.stringify({ title: 'x', dueDate: '2027-01-15', priority: 'high' }) }),
      context,
    );
    expect(JSON.parse(res.body)).toMatchObject({ dueDate: '2027-01-15', priority: 'high' });
  });

  test('a client-supplied userId is rejected, not used as the tenant key', async () => {
    const res = await createHandler(
      makeEvent({ body: JSON.stringify({ title: 'x', userId: USER_B }) }),
      context,
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('returns generic 400 for invalid JSON and schema violations', async () => {
    const bad = await createHandler(makeEvent({ body: '{not json' }), context);
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ message: 'Invalid request body' });

    const empty = await createHandler(makeEvent({ body: JSON.stringify({ title: '' }) }), context);
    expect(empty.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('rejects bodies over 10 KB with 413', async () => {
    const body = JSON.stringify({ title: 'x'.repeat(11 * 1024) });
    const res = await createHandler(makeEvent({ body }), context);
    expect(res.statusCode).toBe(413);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  test('counts base64 bodies by decoded size', async () => {
    const body = Buffer.from(JSON.stringify({ title: 'ok' })).toString('base64');
    ddbMock.on(PutCommand).resolves({});
    const res = await createHandler(makeEvent({ body, isBase64Encoded: true }), context);
    expect(res.statusCode).toBe(201);
  });

  test('id collision maps to 409', async () => {
    ddbMock.on(PutCommand).rejects(conditionFailed());
    const res = await createHandler(makeEvent({ body: JSON.stringify({ title: 'x' }) }), context);
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /todos/{id} (update)', () => {
  const path = { id: TODO_ID };

  test('sets the provided fields, keyed on the caller userId, and returns the new item', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { ...storedItem, completed: true } });

    const res = await updateHandler(
      makeEvent({ pathParameters: path, body: JSON.stringify({ completed: true }) }),
      context,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ id: TODO_ID, completed: true });
    const input = sentInput(0);
    expect(input.Key).toEqual({ userId: USER_A, todoId: TODO_ID });
    expect(input.ConditionExpression).toBe('attribute_exists(todoId)');
    expect(input.ReturnValues).toBe('ALL_NEW');
    expect(input.UpdateExpression).toMatch(
      /^SET #updatedAt = :updatedAt, #completed = :completed$/,
    );
    expect(input.UpdateExpression).not.toContain('REMOVE');
  });

  test('null dueDate removes the attribute', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { ...storedItem, dueDate: undefined } });

    const res = await updateHandler(
      makeEvent({ pathParameters: path, body: JSON.stringify({ dueDate: null }) }),
      context,
    );

    expect(JSON.parse(res.body)).toMatchObject({ dueDate: null });
    const input = sentInput(0);
    expect(input.UpdateExpression).toBe('SET #updatedAt = :updatedAt REMOVE #dueDate');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':dueDate');
  });

  test('a missing or other user item returns 404', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailed());
    const res = await updateHandler(
      makeEvent({ pathParameters: path, body: JSON.stringify({ title: 'x' }) }),
      context,
    );
    expect(res.statusCode).toBe(404);
  });

  test('rejects an empty patch and a malformed id without calling DynamoDB', async () => {
    const empty = await updateHandler(
      makeEvent({ pathParameters: path, body: JSON.stringify({}) }),
      context,
    );
    expect(empty.statusCode).toBe(400);

    const badId = await updateHandler(
      makeEvent({ pathParameters: { id: '../etc' }, body: JSON.stringify({ completed: true }) }),
      context,
    );
    expect(badId.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('DELETE /todos/{id}', () => {
  test('204 with no body on success, keyed on the caller userId', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const res = await deleteHandler(makeEvent({ pathParameters: { id: TODO_ID } }), context);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(sentInput(0)).toMatchObject({
      Key: { userId: USER_A, todoId: TODO_ID },
      ConditionExpression: 'attribute_exists(todoId)',
    });
  });

  test('missing or other user item returns 404', async () => {
    ddbMock.on(DeleteCommand).rejects(conditionFailed());
    const res = await deleteHandler(makeEvent({ pathParameters: { id: TODO_ID } }), context);
    expect(res.statusCode).toBe(404);
  });

  test('malformed id returns 400 without calling DynamoDB', async () => {
    const res = await deleteHandler(makeEvent({ pathParameters: { id: 'nope' } }), context);
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('unexpected failures', () => {
  test('return a generic 500 with no internal detail', async () => {
    ddbMock
      .on(QueryCommand)
      .rejects(new Error('ProvisionedThroughputExceeded for userId ' + USER_A));
    const res = await listHandler(makeEvent(), context);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ message: 'Internal server error' });
    expect(res.body).not.toContain(USER_A);
  });
});
