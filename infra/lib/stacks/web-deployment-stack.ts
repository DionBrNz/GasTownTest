import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import type { ApiStack } from './api-stack';
import type { AuthStack } from './auth-stack';
import type { WebHostingStack } from './web-hosting-stack';

export interface WebDeploymentStackProps extends TodoStackProps {
  /** Target bucket + distribution (for invalidation). */
  readonly webHosting: WebHostingStack;
  /** Region / user pool / client / domain for the runtime config.json. */
  readonly auth: AuthStack;
  /** API URL for the runtime config.json. */
  readonly api: ApiStack;
}

/**
 * Uploads the built frontend and writes the runtime /config.json (region,
 * userPoolId, clientId, cognito domain, apiUrl). Deployed last. No secrets.
 *
 * STUB: resources land in bead to-oti.5.
 */
export class WebDeploymentStack extends TodoStack {
  constructor(scope: Construct, props: WebDeploymentStackProps) {
    const { webHosting, auth, api, ...rest } = props;
    super(scope, 'WebDeployment', {
      description: 'Todo app: frontend assets + runtime config.json',
      ...rest,
    });
    this.addStackDependency(webHosting);
    this.addStackDependency(auth);
    this.addStackDependency(api);
  }
}
