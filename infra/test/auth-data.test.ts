import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { buildTodoApp } from '../lib/app';

function templates(stage: string) {
  const todo = buildTodoApp(new App({ context: { stage } }));
  return {
    todo,
    auth: Template.fromStack(todo.auth),
    data: Template.fromStack(todo.data),
  };
}

describe('Auth stack', () => {
  test('user pool: email sign-in, verified self sign-up, strong passwords, optional TOTP', () => {
    const { auth } = templates('dev');
    auth.resourceCountIs('AWS::Cognito::UserPool', 1);
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      UsernameConfiguration: { CaseSensitive: false },
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
      },
      UserPoolTier: 'ESSENTIALS',
    });
  });

  test.each([
    ['dev', 'INACTIVE', 'Delete'],
    ['prod', 'ACTIVE', 'Retain'],
  ])('stage %s: deletion protection %s, removal %s', (stage, protection, policy) => {
    const { auth } = templates(stage);
    auth.hasResource('AWS::Cognito::UserPool', {
      Properties: Match.objectLike({ DeletionProtection: protection }),
      DeletionPolicy: policy,
      UpdateReplacePolicy: policy,
    });
  });

  test('managed login v2 domain with a branding style for the web client', () => {
    const { auth } = templates('dev');
    auth.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      ManagedLoginVersion: 2,
      Domain: { 'Fn::Join': ['', ['todo-dev-', { Ref: 'AWS::AccountId' }]] },
    });
    auth.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', {
      UseCognitoProvidedValues: true,
      ClientId: { Ref: Match.stringLikeRegexp('^UserPoolWebClient') },
    });
  });

  test('resource server exposes the todo/api scope', () => {
    const { todo, auth } = templates('dev');
    expect(todo.auth.apiScope).toBe('todo/api');
    auth.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
      Identifier: 'todo',
      Scopes: [{ ScopeName: 'api', ScopeDescription: Match.anyValue() }],
    });
  });

  test('public client: no secret, code grant only, refresh-only explicit flows', () => {
    const { auth } = templates('dev');
    auth.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: [
        'openid',
        'email',
        { 'Fn::Join': ['', [{ Ref: Match.anyValue() }, '/api']] },
      ],
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      SupportedIdentityProviders: ['COGNITO'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: 1440,
      TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
    });
  });

  test('dev allows the CloudFront site plus localhost:5173 as redirect targets', () => {
    const { todo, auth } = templates('dev');
    const urls = [`${todo.webHosting.siteUrl}/`, 'http://localhost:5173/'];
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: urls,
      LogoutURLs: urls,
    });
  });

  test('non-dev stages allow only the CloudFront site', () => {
    const { todo, auth } = templates('prod');
    const urls = [`${todo.webHosting.siteUrl}/`];
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: urls,
      LogoutURLs: urls,
    });
  });

  test('exports user pool id, client id, cognito domain and issuer', () => {
    const { auth } = templates('dev');
    for (const name of ['UserPoolId', 'UserPoolClientId', 'CognitoDomain', 'Issuer']) {
      auth.hasOutput(name, {});
    }
    auth.hasOutput('CognitoDomain', {
      Value: {
        'Fn::Join': [
          '',
          [{ Ref: Match.anyValue() }, '.auth.', { Ref: 'AWS::Region' }, '.amazoncognito.com'],
        ],
      },
    });
    auth.hasOutput('Issuer', {
      Value: { 'Fn::GetAtt': [Match.stringLikeRegexp('^UserPool'), 'ProviderURL'] },
    });
  });
});

describe('Data stack', () => {
  test('todos table: userId/todoId keys, on-demand, PITR, AWS-managed SSE, no GSIs/streams', () => {
    const { data } = templates('dev');
    data.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
    data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'todo-dev-todos',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'todoId', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'todoId', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      // AWS-managed KMS key (aws/dynamodb), not the AWS-owned default.
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
      GlobalSecondaryIndexes: Match.absent(),
      StreamSpecification: Match.absent(),
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    });
  });

  test.each([
    ['dev', false, 'Delete'],
    ['prod', true, 'Retain'],
  ])('stage %s: deletion protection %p, removal %s', (stage, protection, policy) => {
    const { data } = templates(stage);
    data.hasResource('AWS::DynamoDB::GlobalTable', {
      Properties: Match.objectLike({
        Replicas: [Match.objectLike({ DeletionProtectionEnabled: protection })],
      }),
      DeletionPolicy: policy,
      UpdateReplacePolicy: policy,
    });
  });

  test('exports table name and ARN and grants no IAM access', () => {
    const { data } = templates('dev');
    data.hasOutput('TableName', {});
    data.hasOutput('TableArn', {});
    data.resourceCountIs('AWS::IAM::Policy', 0);
    data.resourceCountIs('AWS::IAM::Role', 0);
  });
});
