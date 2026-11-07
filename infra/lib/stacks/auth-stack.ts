import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import type { WebHostingStack } from './web-hosting-stack';

export interface AuthStackProps extends TodoStackProps {
  /** Source of the CloudFront domain used for OAuth callback/logout URLs. */
  readonly webHosting: WebHostingStack;
}

/**
 * Cognito user pool, hosted domain and public PKCE app client.
 *
 * STUB: resources land in bead to-oti.2.
 */
export class AuthStack extends TodoStack {
  constructor(scope: Construct, props: AuthStackProps) {
    const { webHosting, ...rest } = props;
    super(scope, 'Auth', { description: 'Todo app: Cognito user pool + PKCE client', ...rest });
    this.addStackDependency(webHosting);
  }
}
