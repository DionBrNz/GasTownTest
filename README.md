# todo

A secure, least-privilege serverless todo app on AWS:

- **Frontend:** React 19 + TanStack Table, served from a **private** S3 bucket behind
  CloudFront (Origin Access Control).
- **Auth:** Amazon Cognito user pool, OAuth 2.0 authorization code + PKCE.
- **API:** Amazon API Gateway REST API with a Cognito authorizer, AWS WAF, request
  validation, throttling and access logs.
- **Compute:** one TypeScript Lambda per route (Node.js 22, arm64, bundled by esbuild).
- **Data:** Amazon DynamoDB `todos` table, partitioned by the caller's Cognito `sub`.
- **IaC:** AWS CDK v2 (TypeScript) deploys everything, including the frontend assets.
  [cdk-nag](https://github.com/cdklabs/cdk-nag) `AwsSolutions` checks run on every synth.

> **Status:** scaffold. The CDK stacks are wired but empty; resources arrive in
> follow-up work. Don't deploy until the stacks are filled in.

## Repository layout

| Path        | What                                                              |
| ----------- | ----------------------------------------------------------------- |
| `infra/`    | CDK app (`bin/app.ts`, stacks in `lib/stacks/`, tests in `test/`) |
| `backend/`  | Lambda handlers (strict ESM TypeScript, Vitest)                   |
| `frontend/` | Vite + React 19 SPA                                               |

All three are npm workspaces and share `tsconfig.base.json`.

### Stacks and deploy order

Stacks are named `Todo-<stage>-<Name>` and deploy in this order, so no stack
depends on a later one:

1. `WebHosting`: private S3 bucket + CloudFront distribution
2. `Auth`: Cognito (callback URLs use the CloudFront domain)
3. `Data`: DynamoDB table (no dependencies)
4. `Api`: REST API + Lambdas (CORS allows only the CloudFront domain)
5. `WebDeployment`: uploads the built SPA and writes a runtime `/config.json`

### cdk-nag

cdk-nag v3 runs as a CDK policy-validation plugin, so any unacknowledged
`AwsSolutions` finding fails `cdk synth`. Fix the finding where you can. If you
can't, acknowledge it next to the resource and give a reason:

```ts
Validations.of(construct).acknowledge({ id: 'AwsSolutions-XX', reason: 'why this is OK' });
```

Until the stub stacks get resources, synth also prints CloudFormation warnings that
the stacks are empty. These warnings don't fail synth.

## Prerequisites

- Node.js 22 LTS (`nvm use` reads `.nvmrc`) and the npm that ships with it
- For deploying only: AWS credentials for the target account, and the account/region
  [bootstrapped](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) for CDK

## Develop

```bash
npm ci
npm run lint        # eslint + tsc in every workspace
npm run format      # prettier --check (npm run format:fix to rewrite)
npm test            # infra (jest) + backend (vitest) + frontend tests
npm run build       # type-check / build every workspace
npm run synth       # cdk synth, all stacks (no AWS credentials needed)
```

## Stages

The stage is a CDK context parameter. It defaults to `dev`, and must be 2-12 lowercase
letters or digits, starting with a letter.

```bash
npm run synth -- -c stage=prod
```

| Setting                | `prod`   | any other stage |
| ---------------------- | -------- | --------------- |
| Stateful removal       | `RETAIN` | `DESTROY`       |
| S3 auto-delete objects | off      | on              |
| Termination protection | on       | off             |

Every resource is tagged `app=todo` and `env=<stage>`.

## Deploy

Run these from `infra/` with credentials for the target account:

```bash
cd infra
npx cdk bootstrap                         # once per account/region
npx cdk deploy --all -c stage=dev
```

## Tear down

```bash
cd infra
npx cdk destroy --all -c stage=dev
```

In `prod`, stateful resources are retained and stacks are termination-protected.
To remove them, turn off termination protection and delete the retained resources
yourself.

## License

No license has been chosen yet. See [LICENSE](LICENSE).
