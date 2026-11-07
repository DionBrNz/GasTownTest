import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import type { AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';
import type { WebHostingStack } from './web-hosting-stack';

export interface ApiStackProps extends TodoStackProps {
  /** Source of the CloudFront domain used as the only allowed CORS origin. */
  readonly webHosting: WebHostingStack;
  /** Source of the Cognito user pool for the REST API authorizer. */
  readonly auth: AuthStack;
  /** Source of the DynamoDB table the per-route Lambdas read/write. */
  readonly data: DataStack;
}

/**
 * API Gateway REST API (Cognito authorizer, WAF, validators, throttling, access
 * logs) and the per-route TypeScript Lambdas (NodejsFunction, Node 22, arm64).
 *
 * STUB: resources land in bead to-oti.3.
 */
export class ApiStack extends TodoStack {
  constructor(scope: Construct, props: ApiStackProps) {
    const { webHosting, auth, data, ...rest } = props;
    super(scope, 'Api', { description: 'Todo app: REST API + Lambdas + WAF', ...rest });
    this.addStackDependency(webHosting);
    this.addStackDependency(auth);
    this.addStackDependency(data);
  }
}
