import { CfnOutput, Duration, Validations } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  CacheCookieBehavior,
  CacheQueryStringBehavior,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginProtocolPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { cognitoDomainPrefix } from '../config';
import type { ApiStack } from './api-stack';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';

export interface WebHostingStackProps extends TodoStackProps {
  /**
   * The REST API. Its stage is served on the same CloudFront origin under `/todos*`, so the
   * SPA calls the API without CORS and the CSP can stay `connect-src 'self'`.
   */
  readonly api: ApiStack;
}

/** Hashed build output (Vite writes everything under assets/). */
export const HASHED_ASSET_PATH = '/assets/*';

/** The REST API paths, served from the API stage through CloudFront. */
export const API_PATH = '/todos*';

/** The API needs the viewer's bearer token; CloudFront forwards it only through a cache policy. */
const API_AUTH_HEADER = 'Authorization';
/** The API picks the request-body model from the Content-Type header. */
const API_BODY_HEADER = 'Content-Type';

/**
 * SPA fallback: a request whose last path segment has no file extension is a client route,
 * so it gets the app shell. Attached to the default behavior only. CloudFront error responses
 * would apply to the API too and turn its 403/404 into HTML with a 200.
 */
const SPA_FALLBACK_JS = `function handler(event) {
  var request = event.request;
  if (!/\\.[^\\/]+$/.test(request.uri)) {
    request.uri = '/index.html';
  }
  return request;
}`;

/** Permissions-Policy: every browser feature the SPA does not use is switched off. */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

/**
 * Private S3 bucket + CloudFront distribution (Origin Access Control) for the SPA, and the
 * REST API on the same origin under `/todos*`. Deployed after Api and before WebDeployment:
 * the distribution domain feeds the Cognito callback URLs and the runtime config.
 */
export class WebHostingStack extends TodoStack {
  /** Private bucket holding the built SPA. Only this distribution may read it (OAC). */
  readonly siteBucket: IBucket;
  /** Access log bucket for the site bucket and the distribution. */
  readonly logBucket: IBucket;
  readonly distribution: Distribution;
  /**
   * Site origin, `https://<distribution domain>` with no trailing slash. Feeds the
   * Cognito callback/logout URLs and the runtime config.
   */
  readonly siteUrl: string;

  constructor(scope: Construct, props: WebHostingStackProps) {
    const { api, ...rest } = props;
    super(scope, 'WebHosting', {
      description: 'Todo app: private S3 site bucket + CloudFront (OAC) + same-origin API',
      ...rest,
    });
    this.addStackDependency(api);

    const { config } = this;

    // `Bucket` types `isWebsite` as a getter returning `boolean | undefined`, which
    // `exactOptionalPropertyTypes` rejects against `IBucket`. The runtime object is the same.
    const logBucket = new Bucket(this, 'LogBucket', {
      // CloudFront standard logging delivers through ACLs, so this bucket keeps ACLs on.
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      autoDeleteObjects: config.autoDeleteObjects,
      removalPolicy: config.removalPolicy,
    }) as IBucket;

    this.logBucket = logBucket;
    Validations.of(logBucket).acknowledge({
      id: 'AwsSolutions-S1',
      reason: 'This bucket receives the access logs, so it does not log itself.',
    });

    const siteBucket = new Bucket(this, 'SiteBucket', {
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'site-bucket/',
      autoDeleteObjects: config.autoDeleteObjects,
      removalPolicy: config.removalPolicy,
    }) as IBucket;

    // Account for the managed login prefix so the CSP matches the Auth stack's domain.
    const cognitoDomain = `${cognitoDomainPrefix(config, this.account)}.auth.${this.region}.amazoncognito.com`;
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      `connect-src 'self' https://${cognitoDomain} https://cognito-idp.${this.region}.amazonaws.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      `form-action 'self' https://${cognitoDomain}`,
      "object-src 'none'",
    ].join('; ');

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${config.appName}-${config.stage}-security-headers`,
      comment: 'Security headers for the todo SPA and API',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true },
        ],
      },
    });

    this.siteBucket = siteBucket;
    const origin = S3BucketOrigin.withOriginAccessControl(siteBucket);

    // Hashed assets never change, so they are cached for a year at the edge and in the
    // browser (S3 object metadata). Everything else (index.html, config.json, and any
    // SPA route) is served from the origin with caching disabled, so a deploy takes
    // effect at once.
    const immutableAssets = new CachePolicy(this, 'ImmutableAssetsCache', {
      cachePolicyName: `${config.appName}-${config.stage}-immutable-assets`,
      defaultTtl: Duration.days(365),
      maxTtl: Duration.days(365),
      minTtl: Duration.seconds(1),
    });

    // The API stage is the origin. Its path is `/<stage>`, and the contract paths are already
    // `/todos`, so the viewer path maps straight through. The viewer's Host header is not
    // forwarded: API Gateway needs its own execute-api host.
    const apiOrigin = new HttpOrigin(
      `${api.restApi.restApiId}.execute-api.${this.region}.amazonaws.com`,
      {
        originPath: `/${config.stage}`,
        protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
      },
    );
    // Responses are per-user, so the API is never cached. The cache policy exists only to
    // carry Authorization to the origin: CloudFront rejects that header in an origin request
    // policy. With every TTL at 0 nothing is stored, and the token is part of the cache key.
    const apiCachePolicy = new CachePolicy(this, 'ApiCache', {
      cachePolicyName: `${config.appName}-${config.stage}-api-no-store`,
      comment: 'API: no caching; forwards the bearer token',
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(0),
      headerBehavior: CacheHeaderBehavior.allowList(API_AUTH_HEADER),
      queryStringBehavior: CacheQueryStringBehavior.all(),
      cookieBehavior: CacheCookieBehavior.none(),
    });
    const apiOriginRequestPolicy = new OriginRequestPolicy(this, 'ApiOriginRequest', {
      originRequestPolicyName: `${config.appName}-${config.stage}-api-origin`,
      comment: 'API: forwards the query string and the JSON body type; no cookies, no Host',
      headerBehavior: OriginRequestHeaderBehavior.allowList(API_BODY_HEADER),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
      cookieBehavior: OriginRequestCookieBehavior.none(),
    });

    const spaFallback = new CloudFrontFunction(this, 'SpaFallback', {
      functionName: `${config.appName}-${config.stage}-spa-fallback`,
      comment: 'Serve index.html for client-side routes (paths with no file extension)',
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(SPA_FALLBACK_JS),
    });

    this.distribution = new Distribution(this, 'SiteDistribution', {
      comment: `${config.appName}-${config.stage} todo SPA and API`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          { function: spaFallback, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        [HASHED_ASSET_PATH]: {
          origin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: immutableAssets,
          responseHeadersPolicy: securityHeaders,
        },
        [API_PATH]: {
          origin: apiOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // Every method the REST API exposes.
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: apiOriginRequestPolicy,
          responseHeadersPolicy: securityHeaders,
        },
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logBucket,
      logFilePrefix: 'cloudfront/',
    });

    Validations.of(this.distribution).acknowledge(
      {
        id: 'AwsSolutions-CFR1',
        reason:
          'No geo restriction: the app is open to any user with a Cognito account, and ' +
          'access control is enforced by Cognito and the API authorizer.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'No custom domain or ACM certificate is in scope, so the distribution uses the ' +
          'default CloudFront certificate, which fixes the security policy at TLSv1. ' +
          'minimumProtocolVersion has no effect. TLS 1.2 minimum needs a custom domain and ' +
          'an ACM certificate (see the README).',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'The WAF Web ACL is attached to the API stage, which every /todos request reaches ' +
          'through this distribution. The static site serves public, non-sensitive assets, ' +
          'so no WAF is attached to the distribution itself.',
      },
    );

    this.siteUrl = `https://${this.distribution.distributionDomainName}`;

    new CfnOutput(this, 'SiteUrl', { value: this.siteUrl });
    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}
