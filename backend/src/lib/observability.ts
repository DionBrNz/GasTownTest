import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

export const SERVICE_NAME = 'todo-api';

/**
 * Shared Powertools instances. Logs must never include PII or tokens: log route
 * names, status codes and error names only, never bodies, userIds or todo titles.
 */
export const logger = new Logger({ serviceName: SERVICE_NAME });
export const tracer = new Tracer({ serviceName: SERVICE_NAME });
