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

1. `Auth`: Cognito user pool, managed login domain and the `todo/api` resource server
2. `Data`: DynamoDB table (no dependencies)
3. `Api`: REST API + Lambdas, authorized by the user pool (no CORS)
4. `WebHosting`: private S3 bucket + CloudFront. It serves the SPA, and it sends `/todos*`
   to the API stage, so the browser calls the API on the same origin.
5. `WebDeployment`: the Cognito app client (its callback URLs are the CloudFront site),
   the uploaded SPA, and a runtime `/config.json`

The SPA's security headers and CSP are set on the CloudFront distribution, and the API
keeps its WAF on the stage. The execute-api URL still works directly, and the authorizer
applies to it too.

### cdk-nag

cdk-nag v3 runs as a CDK policy-validation plugin, so any unacknowledged
`AwsSolutions` finding fails `cdk synth`. Fix the finding where you can. If you
can't, acknowledge it next to the resource and give a reason:

```ts
Validations.of(construct).acknowledge({ id: 'AwsSolutions-XX', reason: 'why this is OK' });
```

cdk-nag v3 matches exact IDs, so a finding on a cross-stack reference is acknowledged by its
full ID. The BucketDeployment handler's findings are the only ones acknowledged this way,
and each is scoped to that construct.

### TLS

The distribution uses the default CloudFront certificate, which enforces TLSv1 only, so
`minimumProtocolVersion` has no effect (`AwsSolutions-CFR4` is acknowledged for that
reason). TLS 1.2 is enforced only with a custom domain and an ACM certificate
(`minimumProtocolVersion: TLSv1.2_2021`). That is not part of this stack yet.

## Prerequisites

- Node.js 22 LTS (`nvm use` reads `.nvmrc`) and the npm that ships with it
- For deploying only: AWS credentials for the target account, and the account/region
  [bootstrapped](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) for CDK

## Develop

```bash
npm ci
npm run build       # type-check + build every workspace; writes frontend/dist
npm run lint        # eslint + tsc in every workspace
npm run format      # prettier --check (npm run format:fix to rewrite)
npm test            # infra (jest) + backend (vitest) + frontend tests
npm run synth       # cdk synth, all stacks (no AWS credentials needed)
```

`npm run build` must run before `npm run synth`, `npm test` and any deploy. The
WebDeployment stack uploads `frontend/dist`, so synth fails if that folder is missing.
The build has no per-stage settings. Stage-specific values go into `/config.json`, which
is written at deploy time.

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

Run these from the repo root with credentials for the target account:

```bash
npm ci
npm run build                             # builds frontend/dist, which is uploaded on deploy
cd infra
npx cdk bootstrap                         # once per account/region
npx cdk deploy --all -c stage=dev
```

`cdk deploy --all` creates these stacks, in order: `WebHosting`, `Auth`, `Data`, `Api`,
`WebDeployment`. The outputs you need are printed at the end of the deploy:

| Output                    | Stack         | Used for                                |
| ------------------------- | ------------- | --------------------------------------- |
| `SiteUrl`                 | WebHosting    | Open the app in a browser               |
| `UserPoolId`              | Auth          | Creating users, local dev `config.json` |
| `CognitoDomain`, `Issuer` | Auth          | Local dev `config.json`                 |
| `UserPoolClientId`        | WebDeployment | Local dev `config.json`                 |
| `ApiUrl`                  | Api           | Calling the API directly (not the SPA)  |

### Creating a first user

Self sign-up is enabled. Open `SiteUrl`, choose sign-up, and enter an email address and a
password of at least 12 characters with upper and lower case, a digit and a symbol. Cognito
emails a verification code. Enter it to finish sign-up. TOTP MFA is optional, and you can
enrol an authenticator app after signing in.

### Local dev against a deployed dev stack

The dev server reads its settings from `frontend/dev/config.json` (this folder is
gitignored and served only by `npm run dev`):

```bash
mkdir -p frontend/dev
cp frontend/config.example.json frontend/dev/config.json   # then fill in the dev stack outputs
npm run dev -w frontend                                    # http://localhost:5173
```

Fill in `region`, `userPoolId`, `clientId`, `cognitoDomain` and `apiUrl` from the dev stack
outputs (`aws cloudformation describe-stacks --stack-name Todo-dev-Auth`, and likewise for
`Todo-dev-WebDeployment` and `Todo-dev-WebHosting`). Set `apiUrl` to the `SiteUrl` output: the
SPA calls `/todos` on the CloudFront origin. The `localhost:5173` callback URL is registered
on the Cognito client in `dev` only.

> **Known gap:** the API has no CORS, because the SPA reaches it on the CloudFront origin.
> A browser on `localhost:5173` therefore cannot call the deployed API. Sign-in works from
> localhost, but API calls need the deployed site (`SiteUrl`). Open the deployed site to
> test the API end to end.

## Tear down

```bash
cd infra
npx cdk destroy --all -c stage=dev
```

`dev` resources are removed with their stacks. The site bucket and log buckets are
emptied first (`autoDeleteObjects`).

In `prod`, stateful resources are retained and the stacks are termination-protected:

- Retained: the Cognito user pool (deletion protection on), the DynamoDB `todos` table
  (deletion protection on), the site and log S3 buckets, and the CloudWatch log groups.
- To remove a prod stack, first turn off its termination protection:

  ```bash
  aws cloudformation update-termination-protection --no-enable-termination-protection \
    --stack-name Todo-prod-<Name>
  ```

- Then run `npx cdk destroy --all -c stage=prod`.
- Retained resources are not deleted by that. Remove them yourself, after confirming the
  data is no longer needed: turn off deletion protection on the user pool and table, empty
  and delete the buckets, and delete the log groups. Doing so permanently deletes user
  accounts and todos.

## License

No license has been chosen yet. See [LICENSE](LICENSE).
