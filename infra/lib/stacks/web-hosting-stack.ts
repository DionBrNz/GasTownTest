import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';

export type WebHostingStackProps = TodoStackProps;

/**
 * Private S3 bucket + CloudFront distribution (Origin Access Control) for the SPA.
 * Deployed first: its distribution domain feeds Cognito callback URLs and API CORS.
 *
 * STUB: resources land in bead to-oti.5.
 */
export class WebHostingStack extends TodoStack {
  /**
   * Site origin, `https://<distribution domain>` with no trailing slash. Feeds the
   * Cognito callback/logout URLs and the API CORS origin.
   */
  readonly siteUrl: string;

  constructor(scope: Construct, props: WebHostingStackProps) {
    super(scope, 'WebHosting', {
      description: 'Todo app: private S3 site bucket + CloudFront (OAC)',
      ...props,
    });

    // STUB: to-oti.5 replaces this with `https://${distribution.distributionDomainName}`.
    this.siteUrl = 'https://example.invalid';
  }
}
