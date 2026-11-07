import { describe, expect, test } from 'vitest';
import { HttpError } from '../src/lib/http.js';
import { decodeNextToken, encodeNextToken } from '../src/lib/pagination.js';
import { TODO_ID, USER_A, USER_B } from './helpers.js';

describe('nextToken', () => {
  test('round-trips for the owning user', () => {
    const token = encodeNextToken({ userId: USER_A, todoId: TODO_ID });
    expect(decodeNextToken(token, USER_A)).toEqual({ userId: USER_A, todoId: TODO_ID });
  });

  test('rejects a token that names another user partition', () => {
    const token = encodeNextToken({ userId: USER_B, todoId: TODO_ID });
    expect(() => decodeNextToken(token, USER_A)).toThrow(HttpError);
  });

  test.each([
    ['not base64 json', '%%%not-a-token%%%'],
    ['json array', Buffer.from('[]').toString('base64url')],
    [
      'extra keys',
      Buffer.from(JSON.stringify({ userId: USER_A, todoId: TODO_ID, x: 1 })).toString('base64url'),
    ],
    [
      'non-uuid todoId',
      Buffer.from(JSON.stringify({ userId: USER_A, todoId: 'nope' })).toString('base64url'),
    ],
  ])('rejects a tampered token: %s', (_label, token) => {
    expect(() => decodeNextToken(token, USER_A)).toThrow(HttpError);
  });
});
