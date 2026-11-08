import * as path from 'node:path';
import { CfnOutput, Duration, Stack, Validations } from 'aws-cdk-lib';
import {
  CfnManagedLoginBranding,
  OAuthScope,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct, IConstruct } from 'constructs';
import { stackName } from '../config';
import type { StageConfig } from '../config';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import { LOCAL_DEV_URL } from './auth-stack';
import type { AuthStack } from './auth-stack';
import type { WebHostingStack } from './web-hosting-stack';

export interface WebDeploymentStackProps extends TodoStackProps {
  /** Target bucket, distribution (for invalidation) and the site URL (OAuth callbacks, apiUrl). */
  readonly webHosting: WebHostingStack;
  /** User pool, resource server and managed login domain. The app client is created here. */
  readonly auth: AuthStack;
}

/** Absolute path to the repository root, from infra/lib/stacks. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Built SPA output. Pre-step: `npm run build` (from the repo root) before synth/deploy.
 * The build is environment-free; per-stage settings only go into config.json.
 */
export const FRONTEND_DIST_DIR = path.join(REPO_ROOT, 'frontend', 'dist');

/** Hashed assets: safe to cache for a year. Vite names every file under assets/ by hash. */
const IMMUTABLE = CacheControl.fromString('public, max-age=31536000, immutable');
/** Entry points: revalidated on every request so a deploy is visible at once. */
const REVALIDATE = CacheControl.fromString('no-cache');

/** The region the CDK CLI falls back to when no region is configured. */
const CLI_FALLBACK_REGION = 'us-east-1';
/** Cross-stack output names CDK generates for the site bucket ARN, per synth mode. */
const CLI_SITE_BUCKET_OUTPUT = 'PublishOutputFnGetAttSiteBucket397A1860ArnB1669F62';
const IN_PROCESS_SITE_BUCKET_EXPORT = 'ExportsOutputFnGetAttSiteBucket397A1860ArnB404F589';

const BUCKET_DEPLOYMENT_RESOURCE_REASON =
  'BucketDeployment copies the built frontend into the site bucket: it reads the CDK asset ' +
  'bundle and writes the site bucket, which the WebHosting stack publishes as an output.';

/**
 * cdk-nag v3 matches finding IDs exactly, and the IDs for the cross-stack bucket references
 * differ by synth mode: the CLI (`cdk synth`, with or without credentials) and in-process
 * synth (`Template.fromStack` in tests). Both forms are listed. An ID that matches no finding
 * does nothing, and a CDK upgrade that changes the form fails synth with the new ID.
 */
function bucketDeploymentResourceFindings(config: StageConfig): string[] {
  const webHosting = stackName(config, 'WebHosting');
  // The CLI sets CDK_DEFAULT_REGION and CDK_DEFAULT_ACCOUNT itself (account only with
  // credentials), so these are the values `cdk synth` resolved for this stack.
  const cliRegion = config.env.region ?? CLI_FALLBACK_REGION;
  const accounts = [config.env.account ?? '<AWS::AccountId>', '<AWS::AccountId>'];
  const assetBucket = [
    ...new Set(
      accounts.map((account) => `arn:aws:s3:::cdk-hnb659fds-assets-${account}-${cliRegion}/*`),
    ),
    ...accounts.map(
      (account) => `arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${account}-<AWS::Region>/*`,
    ),
  ];
  const siteBucket = [
    `{"Fn::GetStackOutput":{"StackName":"${webHosting}","Region":"${cliRegion}","OutputName":"${CLI_SITE_BUCKET_OUTPUT}"}}/*`,
    `${webHosting}:${IN_PROCESS_SITE_BUCKET_EXPORT}/*`,
  ];
  return [...assetBucket, ...siteBucket].map(
    (resource) => `AwsSolutions-IAM5[Resource::${resource}]`,
  );
}

/** Prefix of the CDK singleton Lambda that runs every BucketDeployment in this stack. */
const BUCKET_DEPLOYMENT_HANDLER_PREFIX = 'Custom::CDKBucketDeployment';

/** Access token lifetime. Refresh tokens last one day. */
const ACCESS_TOKEN_MINUTES = 60;
const REFRESH_TOKEN_DAYS = 1;

/**
 * Uploads the built frontend, writes the runtime /config.json, and creates the Cognito app
 * client. The client's callback URLs are the CloudFront site, so it is deployed after
 * WebHosting. Config carries no secrets.
 *
 * Two deployments share the bucket, split by file so each gets the right Cache-Control:
 * the hashed assets, and the entry points (index.html and config.json), which are then
 * invalidated at CloudFront. Neither prunes the other's objects.
 */
export class WebDeploymentStack extends TodoStack {
  /** Public PKCE client for the SPA: no secret, authorization code grant only. */
  readonly userPoolClient: UserPoolClient;

  constructor(scope: Construct, props: WebDeploymentStackProps) {
    const { webHosting, auth, ...rest } = props;
    super(scope, 'WebDeployment', {
      description: 'Todo app: frontend assets, Cognito app client and runtime config.json',
      ...rest,
    });
    this.addStackDependency(webHosting);
    this.addStackDependency(auth);

    const { config } = this;
    const { siteBucket, distribution, siteUrl } = webHosting;

    // The SPA redirects back to its own root after sign-in and sign-out.
    const appUrls = [`${siteUrl}/`, ...(config.stage === 'dev' ? [`${LOCAL_DEV_URL}/`] : [])];

    // Created with `new` (not `userPool.addClient`) so the construct lands in this stack.
    this.userPoolClient = new UserPoolClient(this, 'WebClient', {
      userPool: auth.userPool,
      userPoolClientName: `${config.appName}-${config.stage}-web`,
      generateSecret: false,
      // A non-empty object makes CDK emit ExplicitAuthFlows = [ALLOW_REFRESH_TOKEN_AUTH]
      // only; an empty one would fall back to Cognito's defaults (SRP + custom auth).
      authFlows: { userSrp: false },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false, clientCredentials: false },
        scopes: [
          OAuthScope.OPENID,
          OAuthScope.EMAIL,
          OAuthScope.resourceServer(auth.resourceServer, auth.apiScopeDefinition),
        ],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(ACCESS_TOKEN_MINUTES),
      idTokenValidity: Duration.minutes(ACCESS_TOKEN_MINUTES),
      refreshTokenValidity: Duration.days(REFRESH_TOKEN_DAYS),
    });

    // Managed login v2 serves an error page for clients without a branding style.
    new CfnManagedLoginBranding(this, 'WebClientBranding', {
      userPoolId: auth.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new BucketDeployment(this, 'SiteAssets', {
      sources: [Source.asset(FRONTEND_DIST_DIR)],
      destinationBucket: siteBucket,
      exclude: ['index.html', 'config.json'],
      cacheControl: [IMMUTABLE],
    });

    new BucketDeployment(this, 'SiteEntryPoints', {
      sources: [
        Source.asset(FRONTEND_DIST_DIR),
        Source.jsonData('config.json', {
          region: this.region,
          userPoolId: auth.userPool.userPoolId,
          clientId: this.userPoolClient.userPoolClientId,
          cognitoDomain: auth.cognitoDomain,
          // Same origin: the SPA calls /todos through the CloudFront /todos* behavior. The
          // frontend requires an absolute https URL, so this is the site origin, not ''.
          apiUrl: siteUrl,
        }),
      ],
      destinationBucket: siteBucket,
      exclude: ['*'],
      include: ['index.html', 'config.json'],
      cacheControl: [REVALIDATE],
      distribution,
      distributionPaths: ['/index.html', '/config.json'],
    });

    acknowledgeBucketDeploymentHandler(this, config);

    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}

/**
 * The BucketDeployment custom resource runs on one singleton Lambda per stack. Its role
 * gets wildcard S3 and CloudFront actions from CDK (the copy and invalidation the deployment
 * needs), so cdk-nag flags it. Each finding is acknowledged by exact ID on that construct
 * only, so no other role in the stack is covered. cdk-nag v3 matches exact IDs, not regex.
 */
function acknowledgeBucketDeploymentHandler(stack: Stack, config: StageConfig): void {
  const handlers: IConstruct[] = stack.node.children.filter((child) =>
    child.node.id.startsWith(BUCKET_DEPLOYMENT_HANDLER_PREFIX),
  );
  if (handlers.length !== 1) {
    // Fail loudly if a CDK upgrade renames the singleton, rather than leaving findings open.
    throw new Error(
      `Expected one ${BUCKET_DEPLOYMENT_HANDLER_PREFIX}* handler in ${stack.stackName}, found ${String(handlers.length)}.`,
    );
  }
  const [handler] = handlers as [IConstruct];

  Validations.of(handler).acknowledge(
    ...bucketDeploymentResourceFindings(config).map((id) => ({
      id,
      reason: BUCKET_DEPLOYMENT_RESOURCE_REASON,
    })),
    // Policy and action findings do not depend on how the stack is synthesized.
    {
      id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
      reason:
        'The BucketDeployment handler writes its logs with the AWS managed Lambda logging role.',
    },
    {
      id: 'AwsSolutions-IAM5[Action::s3:GetBucket*]',
      reason:
        'BucketDeployment lists the site bucket and the CDK asset bucket to decide what to sync.',
    },
    {
      id: 'AwsSolutions-IAM5[Action::s3:GetObject*]',
      reason: 'BucketDeployment reads the CDK asset bundle and the existing site objects.',
    },
    {
      id: 'AwsSolutions-IAM5[Action::s3:List*]',
      reason: 'BucketDeployment lists objects in the site bucket to sync and prune.',
    },
    {
      id: 'AwsSolutions-IAM5[Action::s3:Abort*]',
      reason: 'BucketDeployment aborts failed multipart uploads of the site assets.',
    },
    {
      id: 'AwsSolutions-IAM5[Action::s3:DeleteObject*]',
      reason:
        'BucketDeployment deletes superseded objects in the site bucket (prune) during deploys.',
    },
    {
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'cloudfront:CreateInvalidation does not support resource-level permissions, so CDK grants it on "*".',
    },
    {
      id: 'AwsSolutions-L1',
      reason:
        'The BucketDeployment handler runs the runtime CDK pins. It is not app code, so the app cannot change it.',
    },
  );
}
