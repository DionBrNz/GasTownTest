import { CfnOutput } from 'aws-cdk-lib';
import {
  AttributeType,
  Billing,
  TableEncryptionV2,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';

export type DataStackProps = TodoStackProps;

/**
 * DynamoDB `todos` table (PK userId = Cognito sub, SK todoId), on-demand, PITR, SSE.
 *
 * Non-key attributes (title, completed, priority, dueDate, createdAt, updatedAt) are
 * schemaless and written by the API Lambdas. Every access is a key-scoped operation
 * on the caller's own partition, so there are no GSIs, and nothing consumes a stream.
 *
 * No IAM grants here: each Lambda gets its own narrowly scoped grant in the Api stack.
 */
export class DataStack extends TodoStack {
  readonly table: TableV2;

  constructor(scope: Construct, props: DataStackProps) {
    super(scope, 'Data', {
      description: 'Todo app: DynamoDB todos table',
      ...props,
    });

    this.table = new TableV2(this, 'TodosTable', {
      tableName: `${this.config.appName}-${this.config.stage}-todos`,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'todoId', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: TableEncryptionV2.awsManagedKey(),
      deletionProtection: this.config.isProd,
      removalPolicy: this.config.removalPolicy,
    });

    new CfnOutput(this, 'TableName', { value: this.table.tableName });
    new CfnOutput(this, 'TableArn', { value: this.table.tableArn });
  }
}
