import { z } from 'zod';
import { HttpError } from './http.js';

export interface TodoKey {
  userId: string;
  todoId: string;
}

const keySchema = z.strictObject({
  userId: z.string().min(1).max(128),
  todoId: z.uuid(),
});

/** Opaque, base64url-encoded LastEvaluatedKey. */
export function encodeNextToken(key: TodoKey): string {
  return Buffer.from(JSON.stringify({ userId: key.userId, todoId: key.todoId })).toString(
    'base64url',
  );
}

/**
 * Decodes a token and checks that it belongs to the caller. A token that names
 * another user's partition is rejected, as is any malformed or tampered token.
 */
export function decodeNextToken(token: string, callerUserId: string): TodoKey {
  const invalid = () => new HttpError(400, 'Invalid nextToken');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success || parsed.data.userId !== callerUserId) {
    throw invalid();
  }
  return parsed.data;
}
