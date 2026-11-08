import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { z } from 'zod';
import { env } from './env.js';

/** Largest accepted request body, in bytes. */
export const MAX_BODY_BYTES = 10 * 1024;

/** An error with a status code and a generic, client-safe message. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = 'HttpError';
  }
}

function corsHeaders(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': env.allowedOrigin() };
}

/**
 * Every response carries user data (todos, or errors that may echo a request), so none of
 * them may be stored by a shared or browser cache. nosniff stops a browser from reinterpreting
 * the JSON body as markup.
 */
function securityHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...securityHeaders() },
    body: JSON.stringify(body),
  };
}

export function noContent(): APIGatewayProxyResult {
  return { statusCode: 204, headers: { ...corsHeaders(), ...securityHeaders() }, body: '' };
}

export function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return json(statusCode, { message });
}

function bodyText(event: APIGatewayProxyEvent): { text: string; bytes: number } {
  const raw = event.body ?? '';
  if (event.isBase64Encoded) {
    const decoded = Buffer.from(raw, 'base64');
    return { text: decoded.toString('utf8'), bytes: decoded.byteLength };
  }
  return { text: raw, bytes: Buffer.byteLength(raw, 'utf8') };
}

/** Parses and validates a JSON body. Errors are generic on purpose. */
export function parseBody<T>(schema: z.ZodType<T>, event: APIGatewayProxyEvent): T {
  const { text, bytes } = bodyText(event);
  if (bytes > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid request body');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(400, 'Invalid request body');
  }
  return result.data;
}

/** Validates query-string parameters against a schema. */
export function parseQuery<T>(schema: z.ZodType<T>, event: APIGatewayProxyEvent): T {
  const result = schema.safeParse(event.queryStringParameters ?? {});
  if (!result.success) {
    throw new HttpError(400, 'Invalid query parameters');
  }
  return result.data;
}
