import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';

export type DataStackProps = TodoStackProps;

/**
 * DynamoDB `todos` table (PK userId = Cognito sub, SK todoId), on-demand, PITR, SSE.
 * Stateful: honour `config.removalPolicy` + deletion protection in prod.
 *
 * STUB: resources land in bead to-oti.2.
 */
export class DataStack extends TodoStack {
  constructor(scope: Construct, props: DataStackProps) {
    super(scope, 'Data', {
      description: 'Todo app: DynamoDB todos table',
      ...props,
    });
  }
}
