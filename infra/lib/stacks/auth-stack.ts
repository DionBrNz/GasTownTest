import { CfnOutput, Duration, Validations } from 'aws-cdk-lib';
import {
  AccountRecovery,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  ResourceServerScope,
  UserPool,
  UserPoolResourceServer,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import type { UserPoolDomain } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { TodoStack } from './todo-stack';
import type { TodoStackProps } from './todo-stack';
import { cognitoDomainPrefix } from '../config';

/** Vite dev server origin. Allowed as an OAuth redirect only in the `dev` stage. */
export const LOCAL_DEV_URL = 'http://localhost:5173';

/** Resource-server identifier; with {@link API_SCOPE_NAME} forms the `todo/api` scope. */
export const RESOURCE_SERVER_ID = 'todo';
export const API_SCOPE_NAME = 'api';

/**
 * Cognito user pool, managed login domain and resource server (the `todo/api` scope).
 * The app client lives in WebDeployment: its callback URLs are the CloudFront site.
 */
export class AuthStack extends TodoStack {
  readonly userPool: UserPool;
  readonly userPoolDomain: UserPoolDomain;
  readonly resourceServer: UserPoolResourceServer;
  readonly apiScopeDefinition: ResourceServerScope;
  /** Full scope string the API requires on access tokens: `todo/api`. */
  readonly apiScope: string;
  /** Managed login hostname, e.g. `todo-dev-123456789012.auth.<region>.amazoncognito.com`. */
  readonly cognitoDomain: string;
  /** OIDC issuer: `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`. */
  readonly issuer: string;

  constructor(scope: Construct, props: TodoStackProps) {
    super(scope, 'Auth', { description: 'Todo app: Cognito user pool + managed login', ...props });

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
      cognitoDomain: { domainPrefix: cognitoDomainPrefix(config, this.account) },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.apiScopeDefinition = new ResourceServerScope({
      scopeName: API_SCOPE_NAME,
      scopeDescription: 'Read and write your own todos',
    });
    this.resourceServer = this.userPool.addResourceServer('ApiResourceServer', {
      identifier: RESOURCE_SERVER_ID,
      userPoolResourceServerName: `${config.appName}-${config.stage}-api`,
      scopes: [this.apiScopeDefinition],
    });
    this.apiScope = `${RESOURCE_SERVER_ID}/${API_SCOPE_NAME}`;

    this.cognitoDomain = `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
    this.issuer = this.userPool.userPoolProviderUrl;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'CognitoDomain', { value: this.cognitoDomain });
    new CfnOutput(this, 'Issuer', { value: this.issuer });
  }
}
