import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { buildTodoApp } from '../lib/app';

function templates(stage: string) {
  const todo = buildTodoApp(new App({ context: { stage } }));
  return {
    todo,
    hosting: Template.fromStack(todo.webHosting),
    deployment: Template.fromStack(todo.webDeployment),
  };
}

describe('WebHosting stack: site bucket', () => {
  test('private, encrypted, versioned, SSL-only, ownership enforced, no website hosting', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      LoggingConfiguration: Match.objectLike({ LogFilePrefix: 'site-bucket/' }),
    });
    hosting.allResourcesProperties('AWS::S3::Bucket', {
      WebsiteConfiguration: Match.absent(),
    });
  });

  test('bucket policy denies non-TLS access and allows reads only from this distribution', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 's3:GetObject',
            Condition: {
              StringEquals: {
                'AWS:SourceArn': Match.anyValue(),
              },
            },
          }),
        ]),
      },
    });
  });

  test('log bucket keeps ACLs enabled for CloudFront logging and blocks public access', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::S3::Bucket', {
      OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
    });
  });
});

describe('WebHosting stack: CloudFront distribution', () => {
  test('uses Origin Access Control, not OAI, with the SPA root object', () => {
    const { hosting } = templates('dev');
    hosting.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    hosting.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    hosting.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        PriceClass: 'PriceClass_100',
        IPV6Enabled: true,
        Logging: Match.objectLike({ Prefix: 'cloudfront/' }),
      }),
    });
  });

  test('redirects HTTP to HTTPS and serves GET/HEAD only', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: ['GET', 'HEAD'],
        }),
      }),
    });
  });

  test('SPA fallback is a viewer-request function on the default behavior, not error responses', () => {
    const { hosting } = templates('dev');
    // Distribution-wide 403/404 rewrites would also hit API errors, so there are none.
    hosting.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.absent(),
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: Match.anyValue() }],
        }),
      }),
    });
    const fn = Object.values(hosting.findResources('AWS::CloudFront::Function'))[0] as {
      Properties: { FunctionCode: string };
    };
    expect(fn.Properties.FunctionCode).toContain("request.uri = '/index.html'");
    expect(fn.Properties.FunctionCode).toContain('[^\\/]+$');
  });

  test('the /todos* behavior serves the API stage on the same origin, with no caching', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/todos*',
            AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
            ViewerProtocolPolicy: 'redirect-to-https',
          }),
        ]),
      }),
    });
    const distribution = Object.values(
      hosting.findResources('AWS::CloudFront::Distribution'),
    )[0] as {
      Properties: {
        DistributionConfig: {
          Origins: { Id: string; DomainName: unknown; OriginPath?: string }[];
          CacheBehaviors: { PathPattern: string; TargetOriginId: string }[];
        };
      };
    };
    const apiBehavior = distribution.Properties.DistributionConfig.CacheBehaviors.find(
      (b) => b.PathPattern === '/todos*',
    );
    const apiOrigin = distribution.Properties.DistributionConfig.Origins.find(
      (o) => o.Id === apiBehavior?.TargetOriginId,
    );
    expect(apiOrigin?.OriginPath).toBe('/dev');
    expect(JSON.stringify(apiOrigin?.DomainName)).toContain('.execute-api.');
    expect(JSON.stringify(apiOrigin?.DomainName)).not.toContain('S3');
  });

  test('the API cache policy has zero TTLs and carries Authorization; the origin request policy does not', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: 'todo-dev-api-no-store',
        DefaultTTL: 0,
        MaxTTL: 0,
        MinTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Authorization'] },
        }),
      }),
    });
    hosting.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        Name: 'todo-dev-api-origin',
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Content-Type'] },
        QueryStringsConfig: { QueryStringBehavior: 'all' },
      }),
    });
  });

  test('hashed assets are cached long-term; the default behavior (index.html, config.json) is not', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 365 * 24 * 60 * 60,
        MaxTTL: 365 * 24 * 60 * 60,
      }),
    });
    hosting.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/assets/*',
            CachePolicyId: Match.anyValue(),
          }),
        ]),
        // CACHING_DISABLED managed policy id.
        DefaultCacheBehavior: Match.objectLike({
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        }),
      }),
    });
  });

  test('response headers policy: CSP, HSTS, nosniff, DENY framing, referrer policy, Permissions-Policy', () => {
    const { hosting } = templates('dev');
    hosting.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: {
          ContentSecurityPolicy: { ContentSecurityPolicy: Match.anyValue(), Override: true },
          StrictTransportSecurity: Match.objectLike({
            AccessControlMaxAgeSec: 730 * 24 * 60 * 60,
            IncludeSubdomains: true,
            Preload: true,
            Override: true,
          }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: {
            ReferrerPolicy: 'strict-origin-when-cross-origin',
            Override: true,
          },
        },
        CustomHeadersConfig: {
          Items: [
            Match.objectLike({
              Header: 'Permissions-Policy',
              Override: true,
              Value: Match.stringLikeRegexp('camera=\\(\\)'),
            }),
          ],
        },
      }),
    });
  });

  test('the CSP directives match the bead, with the Cognito domain derived from the account', () => {
    const { hosting } = templates('dev');
    const policy = JSON.stringify(
      Object.values(hosting.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0],
    );
    for (const directive of [
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:",
      "connect-src 'self' https://",
      'todo-dev-',
      'amazoncognito.com',
      'cognito-idp.',
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://",
      "object-src 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });
});

describe('WebDeployment stack', () => {
  test('two BucketDeployments: immutable assets, and entry points invalidated on deploy', () => {
    const { deployment } = templates('dev');
    deployment.resourceCountIs('Custom::CDKBucketDeployment', 2);
    deployment.hasResourceProperties('Custom::CDKBucketDeployment', {
      SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' },
      Exclude: ['index.html', 'config.json'],
      DistributionPaths: Match.absent(),
    });
    deployment.hasResourceProperties('Custom::CDKBucketDeployment', {
      SystemMetadata: { 'cache-control': 'no-cache' },
      Exclude: ['*'],
      Include: ['index.html', 'config.json'],
      DistributionPaths: ['/index.html', '/config.json'],
    });
  });

  test('stage prod: the site bucket is retained and termination protected', () => {
    const { todo } = templates('prod');
    expect(todo.webHosting.terminationProtection).toBe(true);
    const hosting = Template.fromStack(todo.webHosting);
    hosting.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });
});
