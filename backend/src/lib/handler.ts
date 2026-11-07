import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { errorResponse, HttpError } from './http.js';
import { logger } from './observability.js';

type Route = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Wraps a route: maps HttpError to its status and message, and turns anything
 * else into a generic 500. Only the error name is logged, never the message,
 * since SDK errors can echo item data.
 */
export function withErrors(name: string, route: Route) {
  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.addContext(context);
    try {
      return await route(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err.statusCode, err.publicMessage);
      }
      logger.error('Unhandled error', {
        route: name,
        errorName: err instanceof Error ? err.name : 'unknown',
      });
      return errorResponse(500, 'Internal server error');
    }
  };
}
