import { CfnOutput, Duration, Validations } from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  ResourceServerScope,
  UserPool,
  UserPoolClientIdentityProvider,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import type { UserPoolClient, UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import type { WebHostingStack } from './web-hosting-stack';

/** Vite dev server origin. Allowed as an OAuth redirect only in the `dev` stage. */
export const LOCAL_DEV_URL = 'http://localhost:5173';

/** Resource-server identifier; with {@link API_SCOPE_NAME} forms the `todo/api` scope. */
export const RESOURCE_SERVER_ID = 'todo';
export const API_SCOPE_NAME = 'api';

export interface AuthStackProps extends TodoStackProps {
  /** Source of the CloudFront site URL used for OAuth callback/logout URLs. */
  readonly webHosting: WebHostingStack;
}

/**
 * Cognito user pool, managed login domain and public PKCE app client.
 */
export class AuthStack extends TodoStack {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly userPoolDomain: UserPoolDomain;
  /** Full scope string the API requires on access tokens: `todo/api`. */
  readonly apiScope: string;
  /** Managed login hostname, e.g. `todo-dev-123456789012.auth.<region>.amazoncognito.com`. */
  readonly cognitoDomain: string;
  /** OIDC issuer: `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`. */
  readonly issuer: string;

  constructor(scope: Construct, props: AuthStackProps) {
    const { webHosting, ...rest } = props;
    super(scope, 'Auth', { description: 'Todo app: Cognito user pool + PKCE client', ...rest });
    this.addStackDependency(webHosting);

    const { config } = this;

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${config.appName}-${config.stage}`,
      // Essentials is the lowest plan that supports managed login (v2).
      featurePlan: FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      userVerification: { emailStyle: VerificationEmailStyle.CODE },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      deletionProtection: config.isProd,
      removalPolicy: config.removalPolicy,
    });

    Validations.of(this.userPool).acknowledge(
      {
        id: 'AwsSolutions-COG2',
        reason:
          'MFA is OPTIONAL (TOTP only) by design: users can enrol an authenticator app, ' +
          'but a self-sign-up todo app does not force it.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'Threat protection needs the paid Plus feature plan, which is out of scope for ' +
          'this app. Brute force is limited by Cognito lockout, the strong password policy ' +
          'and preventUserExistenceErrors on the client.',
      },
    );

    // Managed login (v2) on a Cognito-hosted prefix domain. Prefixes are global per
    // region, so include the account to keep them unique.
    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `${config.appName}-${config.stage}-${this.account}` },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const apiScope = new ResourceServerScope({
      scopeName: API_SCOPE_NAME,
      scopeDescription: 'Read and write your own todos',
    });
    const resourceServer = this.userPool.addResourceServer('ApiResourceServer', {
      identifier: RESOURCE_SERVER_ID,
      userPoolResourceServerName: `${config.appName}-${config.stage}-api`,
      scopes: [apiScope],
    });
    this.apiScope = `${RESOURCE_SERVER_ID}/${API_SCOPE_NAME}`;

    // The SPA redirects back to its own root after sign-in and sign-out.
    const appUrls = [
      `${webHosting.siteUrl}/`,
      ...(config.stage === 'dev' ? [`${LOCAL_DEV_URL}/`] : []),
    ];

    // Public SPA client: no secret, authorization code grant only (the SPA uses PKCE),
    // and no direct username/password auth flows. Sign-in happens only on managed login.
    this.userPoolClient = this.userPool.addClient('WebClient', {
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
          OAuthScope.resourceServer(resourceServer, apiScope),
        ],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(1),
    });

    // Managed login v2 serves an error page for clients without a branding style.
    new CfnManagedLoginBranding(this, 'WebClientBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    this.cognitoDomain = `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
    this.issuer = this.userPool.userPoolProviderUrl;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: this.cognitoDomain });
    new CfnOutput(this, 'Issuer', { value: this.issuer });
  }
}
