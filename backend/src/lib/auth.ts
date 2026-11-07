import type { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { HttpError } from './http.js';

const subSchema = z.string().min(1).max(128);

/**
 * The caller's Cognito `sub`, taken ONLY from the authorizer claims. Never read
 * a user id from the path, query or body: it is the tenant key.
 */
export function callerUserId(event: APIGatewayProxyEvent): string {
  const claims: unknown = event.requestContext.authorizer?.claims;
  const sub = subSchema.safeParse(
    typeof claims === 'object' && claims !== null ? (claims as { sub?: unknown }).sub : undefined,
  );
  if (!sub.success) {
    throw new HttpError(401, 'Unauthorized');
  }
  return sub.data;
}
