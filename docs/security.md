# Security and least-privilege review

Bead: `to-oti.6`. Reviewed on `main` at `6b3c382`, which includes `to-oti.5` (`0f66382`), plus the
changes on this branch. Every infrastructure finding comes from the synthesized templates for both
the `dev` and `prod` stages. The review is a pre-deployment check. Nothing has been deployed to AWS,
so the runtime checks listed under "Open" have not been run.

## Verification run

| Gate                                                    | Result                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cdk synth -c stage=dev`                                | Pass. No unacknowledged cdk-nag AwsSolutions findings.                                                                                 |
| `cdk synth -c stage=prod`                               | Pass. Stateful resources are `Retain`. Auto-delete is absent.                                                                          |
| `npm test`                                              | See the final run in the bead notes. The backend count is 43 (one test added here).                                                    |
| `npm run lint`, `npm run format`                        | See the final run in the bead notes.                                                                                                   |
| `npm run build -w frontend` (`tsc` + `vite build`)      | Pass.                                                                                                                                  |
| `npm audit`                                             | 30 findings: 0 critical, 0 high, 27 moderate, 3 low. All in build and dev tooling. The bead's "npm audit clean" criterion is **not met** (see Dependencies). |

## cdk-nag suppressions

Each suppression was reviewed. None were removed, because each reason still holds. The CloudFront
CreateInvalidation acknowledgement has a wrong reason, which is finding P2.

| Finding                                                                                    | Resource                                       | Decision                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AwsSolutions-IAM4` (`AmazonAPIGatewayPushToCloudWatchLogs`)                               | Account-level API Gateway CloudWatch role      | Keep. The managed policy is the documented way to enable execution logging.                                                                                    |
| `AwsSolutions-IAM5` (`Resource::*`)                                                        | Each route Lambda role                         | Keep. X-Ray write actions take no resource ARN, so `*` is the only valid resource.                                                                             |
| `AwsSolutions-L1`                                                                          | Route Lambdas (Node 22)                        | Keep. The spec requires Node 22. Upgrade before Node 22 reaches end of life.                                                                                  |
| `AwsSolutions-COG2`                                                                        | User pool                                      | Keep. MFA is OPTIONAL (TOTP) by design. Making it REQUIRED is an open decision.                                                                               |
| `AwsSolutions-COG8`                                                                        | User pool                                      | Keep. Advanced security needs the Plus feature plan. Compensating controls: 12-character password policy, Cognito lockout, `preventUserExistenceErrors`.     |
| `AwsSolutions-S1`                                                                          | Log bucket                                     | Keep. The bucket receives the access logs, so it cannot log itself.                                                                                            |
| `AwsSolutions-CFR1`                                                                        | CloudFront distribution                        | Keep. No geo restriction. Access is controlled by Cognito and the API authorizer.                                                                              |
| `AwsSolutions-CFR2`                                                                        | CloudFront distribution                        | Keep. The WAF is on the API stage that `/todos*` reaches. The static site is public.                                                                           |
| `AwsSolutions-CFR4`                                                                        | CloudFront distribution                        | Keep, with a known gap. The default certificate enforces TLSv1 only. See "Accepted risks".                                                                    |
| `AwsSolutions-IAM4` (`AWSLambdaBasicExecutionRole`)                                        | BucketDeployment handler                       | Keep. Writes the handler's logs.                                                                                                                               |
| `AwsSolutions-IAM5` (`s3:GetBucket*`, `s3:GetObject*`, `s3:List*`, `s3:Abort*`, `s3:DeleteObject*`) | BucketDeployment handler                | Keep. Each is limited to the site bucket or the CDK asset bucket.                                                                                              |
| `AwsSolutions-IAM5` (`cloudfront:CreateInvalidation`, `Resource::*`)                       | BucketDeployment handler                       | **Finding P2.** The stated reason is wrong, and the grant can be narrowed.                                                                                     |
| `AwsSolutions-L1`                                                                          | BucketDeployment handler                       | Keep. The runtime is pinned by CDK, not by the app.                                                                                                            |

## IAM inventory

Principal → actions → resources, from the synthesized templates. Each route Lambda has its own role.
Each role has one DynamoDB action on the table ARN, with no index ARNs.

| Principal                                                          | Actions                                                                                                                                                                           | Resource                                                    | Purpose                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apigateway.amazonaws.com` (account role `TodosApiCloudWatchRole`) | Managed `AmazonAPIGatewayPushToCloudWatchLogs`                                                                                                                                      | Account                                                     | Stage execution logs                                                                          |
| `ListTodosRole` (`lambda.amazonaws.com`)                           | `dynamodb:Query`                                                                                                                                                                    | `todos` table ARN                                           | `GET /todos`                                                                                  |
| `CreateTodoRole`                                                   | `dynamodb:PutItem`                                                                                                                                                                  | `todos` table ARN                                           | `POST /todos`                                                                                 |
| `UpdateTodoRole`                                                   | `dynamodb:UpdateItem`                                                                                                                                                               | `todos` table ARN                                           | `PATCH /todos/{id}`                                                                           |
| `DeleteTodoRole`                                                   | `dynamodb:DeleteItem`                                                                                                                                                               | `todos` table ARN                                           | `DELETE /todos/{id}`                                                                          |
| Each route role                                                    | `logs:CreateLogStream`, `logs:PutLogEvents`                                                                                                                                         | That route's log group                                      | Function logs                                                                                 |
| Each route role                                                    | `xray:PutTraceSegments`, `xray:PutTelemetryRecords`                                                                                                                                 | `*` (acknowledged)                                          | X-Ray tracing                                                                                 |
| `apigateway.amazonaws.com` (Lambda resource policy)                | `lambda:InvokeFunction`                                                                                                                                                             | Each method ARN (`…/<stage>/<METHOD>/todos[/*]`)            | Invokes the route. Eight statements, including the `test-invoke-stage` ones CDK adds.         |
| BucketDeployment handler (`WebDeployment`)                         | `s3:GetBucket*`, `s3:GetObject*`, `s3:List*`                                                                                                                                        | CDK asset bucket and its objects                            | Reads the built frontend bundle                                                               |
| BucketDeployment handler                                           | `s3:Abort*`, `s3:DeleteObject*`, `s3:GetBucket*`, `s3:GetObject*`, `s3:List*`, `s3:PutObject`, `s3:PutObjectLegalHold`, `s3:PutObjectRetention`, `s3:PutObjectTagging`, `s3:PutObjectVersionTagging` | Site bucket and its objects                                 | Writes the site                                                                               |
| BucketDeployment handler                                           | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation`                                                                                                                       | `*`                                                         | **P2.** Invalidation after deploy                                                             |
| Dev only: auto-delete provider role                                | `s3:DeleteObject*`, `s3:GetBucket*`, `s3:List*`, `s3:PutBucketPolicy`                                                                                                              | Log and site buckets                                        | Empties buckets on stack delete. Not in prod.                                                 |
| `cloudfront.amazonaws.com` (OAC)                                   | `s3:GetObject`                                                                                                                                                                      | Site bucket objects, `AWS:SourceArn` = this distribution    | Serves the site                                                                               |

Cognito: no IAM roles. No identity pool exists (no `IdentityPool` in any template), so no
unauthenticated AWS credentials are issued.

DynamoDB (`Todo-<stage>-Data`): no IAM grants. Access happens only through the route roles above.

## Authorization and tenant isolation

- Every `/todos` method (GET, POST, PATCH, DELETE) uses `COGNITO_USER_POOLS` with the `todo/api`
  scope. The API has no OPTIONS methods, so there are no unauthenticated methods at all. CORS was
  removed (see CORS below).
- The tenant key is `userId`, read only from `requestContext.authorizer.claims.sub`
  (`backend/src/lib/auth.ts`). No handler reads a user id from the path, query or body.
- The body schemas are `z.strictObject`, and the REST request models set
  `additionalProperties: false`. A client-supplied `userId` is rejected.
- Every read and write uses the key `(callerSub, todoId)`. Update and delete use
  `attribute_exists(todoId)`, so another user's id returns 404 and never creates a row.
- The pagination token carries `userId`. `decodeNextToken` rejects a token whose `userId` is not
  the caller's.
- The unit tests cover all of this (`backend/test/handlers.test.ts`, `pagination.test.ts`).

**Gap:** the tests mock DynamoDB. Nothing yet proves isolation between two real Cognito users on a
deployed stack. Bead `to-diy`.

## CORS

- The API sends no CORS headers, and the templates contain none (checked in dev and prod). The SPA
  calls `/todos*` on its own CloudFront origin, so the CSP `connect-src` needs no API wildcard.
- Every JSON and 204 response sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  Added on this branch, with a test.

## CloudFront, S3 and CSP (verified from synth)

- **Buckets:** the site and log buckets have `BlockPublicAccess` fully on, S3-managed encryption,
  versioning, and TLS-only bucket policies (`aws:SecureTransport` deny). The site bucket is
  `BucketOwnerEnforced` and has server access logging to the log bucket.
- **OAC:** S3 origin with Origin Access Control (`sigv4`, `always`). The site bucket policy grants
  `s3:GetObject` to the CloudFront service principal only when `AWS:SourceArn` is this
  distribution.
- **Behaviors:** the default is `CACHING_DISABLED` with the SPA fallback function (viewer-request,
  default behavior only). `/assets/*` has a one-year cache. `/todos*` goes to the API origin
  (`originPath` = stage) with a zero-TTL cache policy that forwards only `Authorization`, and an
  origin request policy that forwards `Content-Type` and the query string.
- **Viewer protocol:** redirect HTTP to HTTPS on every behavior.
- **Response headers** (`todo-<stage>-security-headers`):
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://<cognito domain> https://cognito-idp.<region>.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://<cognito domain>; object-src 'none'`. No `unsafe-*`, no wildcards.
  - HSTS: 730 days, `includeSubDomains`, `preload`.
  - `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy` disables every feature the SPA does not use.
- **Logging:** standard logging on, to the log bucket with prefix `cloudfront/`.
- **Price class:** 100.

## Frontend

- Tokens stay in memory. `frontend/src/auth.ts` sets the oidc-client-ts user store to
  `InMemoryWebStorage`. The PKCE state store uses sessionStorage, the library default. It holds no
  tokens.
- The source has no `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`, inline `style=`
  attributes, or token storage in `localStorage` or `sessionStorage`.
- **Static CSP check** of `frontend/dist` (`vite build`): `index.html` has one external module
  script and one external stylesheet. The bundle has no `eval`, `new Function`, inline style
  attributes, iframes, workers or `blob:` URLs. Its URL strings are SVG/XML namespaces, a React docs
  link in error messages, and a base URL for the URL parser, and none of them is a request. The
  bundle is compatible with the CSP above.
- Silent renew uses the refresh token when one exists (`signinSilent` in oidc-client-ts), so it
  loads no iframe. The CSP does not need `frame-src`.
- **Not done:** a browser run with the CSP header applied. The workspace has no headless browser.
  Bead `to-a0c`.

## Dependencies

`npm audit` reports 30 findings, all dev or build tooling:

- The underlying advisories are `minimatch` (GHSA-g3hv-75wg-m249, moderate), `glob`
  (GHSA-3g3m-2fjr-6pw4, moderate) and `deepmerge` (GHSA-gcqx-w48m-w2h4, low). They come in through
  jest, eslint, typescript-eslint and `aws-cdk-lib`.
- `aws-cdk-lib` bundles its own `minimatch`. `npm audit fix` cannot change that copy, so it needs an
  `aws-cdk-lib` release with the fix.
- The remaining fixes are semver-major upgrades to jest, eslint, cdk-nag and typescript-eslint.
  Running `npm audit fix` without `--force` changed nothing relevant, so the lockfile is unchanged.
- No runtime dependency is affected: react, react-dom, oidc-client-ts, react-oidc-context, TanStack,
  zod, Powertools and the AWS SDK are all clean.

Accepted for now. Bead `to-8e0` tracks the upgrade. The bead's "clean" criterion is not met.

## Threat model (STRIDE)

| Category               | Threat                                                              | Control                                                                                                                                                                                  | Residual risk                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Spoofing               | Forged or replayed bearer token                                     | The Cognito authorizer checks the JWT signature, issuer, expiry and the `todo/api` scope. The ID token lacks that scope.                                                                | Low                                                                                                                            |
| Spoofing               | Attacker signs up for a real account, then reads other users' data | Tenant key from `sub` only; conditional writes; 404 for other users' ids                                                                                                                 | Accepted. Self sign-up is enabled, so any attacker is an authenticated user. Isolation is the control that matters.           |
| Tampering              | Malformed or oversized input                                        | REST request models plus strict zod schemas; 10 KB body limit                                                                                                                            | Low                                                                                                                            |
| Tampering              | Stored XSS through a todo title                                     | React escapes text; no HTML rendering in the source; CSP `script-src 'self'`                                                                                                             | Low                                                                                                                            |
| Repudiation            | No audit trail                                                      | API access logs (JSON, standard fields); execution logs record errors only; CloudFront standard logging; Powertools logs carry route and error names only                                | Low. CloudTrail is not configured by the app.                                                                                  |
| Information disclosure | Tokens leak through storage                                         | Tokens are in memory only                                                                                                                                                                | Low. A page reload needs a new sign-in, which Cognito's session may complete silently.                                         |
| Information disclosure | Data leaks through logs or errors                                   | No bodies, user ids or titles in logs; generic 500s; `dataTraceEnabled: false`                                                                                                           | Low                                                                                                                            |
| Information disclosure | Cached private responses                                            | `Cache-Control: no-store` on every API response (this branch); zero-TTL API cache policy                                                                                                 | Low                                                                                                                            |
| Denial of service      | One user consumes the shared stage budget                           | Stage throttle 20 rps / 40 burst; WAF managed rules                                                                                                                                      | **Medium.** The stage throttle is shared, there are no per-user quotas, and reserved concurrency is unset.                     |
| Denial of service      | Rate limit bypassed by calling `execute-api` directly               | The authorizer still requires a token, and the stage throttle still applies                                                                                                              | **High (P1).** The per-IP rule keys on a client-set header, and the endpoint is directly reachable.                            |
| Elevation of privilege | A Lambda reads another table or action                              | One role per route, with one action on one ARN                                                                                                                                           | Low                                                                                                                            |
| Elevation of privilege | Unauthenticated AWS credentials                                     | No identity pool exists                                                                                                                                                                  | Low                                                                                                                            |

## Findings

**Fixed on this branch**

- API responses lacked `Cache-Control` and `nosniff`. Added to `backend/src/lib/http.ts`, with a
  test.

**Open, on main (beads)**

- **P1 (high, `to-d5f`).** The API WAF rate rule uses `aggregateKeyType: FORWARDED_IP` on
  `X-Forwarded-For` (`infra/lib/stacks/api-stack.ts`). The REST API has no resource policy, and the
  distribution's API origin is the `execute-api` endpoint itself, so the API is directly reachable.
  A caller that goes direct can set that header to any value and rotate keys past the
  2000-per-5-minute limit. The authorizer still requires a token, but any signed-up user can then
  use the shared stage budget. Fix: make CloudFront the only path to the API, for example with a
  CloudFront origin custom header that a WAF rule or a resource policy checks.
- **P2 (medium, `to-0im`).** The BucketDeployment handler role grants `cloudfront:CreateInvalidation`
  and `GetInvalidation` on `*`. The acknowledgement says CloudFront "does not support
  resource-level permissions". The AWS Service Authorization Reference lists a distribution as the
  resource type for `CreateInvalidation`
  (https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html). The
  default behavior is `CACHING_DISABLED`, so the invalidation is a no-op for `index.html` and
  `config.json`. Options are in the bead. The owner decides, because the test at
  `infra/test/web-hosting.test.ts:248` asserts the invalidation.
- **Cross-user isolation test against a deployed stack (`to-diy`).**
- **Browser CSP smoke test after deploy (`to-a0c`).**
- **`npm audit` clean-up (`to-8e0`).**

**Accepted risks**

- **TLS minimum (CFR4).** The default CloudFront certificate enforces TLSv1. TLS 1.2 needs a custom
  domain and an ACM certificate with `minimumProtocolVersion: TLSv1.2_2021`. The README says so.
  Accepted until a domain exists.
- **Dev callback.** The dev user pool allows `http://localhost:5173` as a callback. It is dev-stage
  only and does not reach prod.
- **Node 22 (L1).** Upgrade before Node 22 reaches end of life.
- **`/todos*` allows all methods** through CloudFront, including PUT and OPTIONS. The API has no such
  methods, and API Gateway rejects them. Tightening the list is cosmetic.

## Open decisions

- Should MFA be REQUIRED rather than OPTIONAL (COG2)?
- Should self sign-up stay enabled? If it is disabled, the threat model's spoofing row goes away.
- Should there be per-user quotas, and what reserved concurrency should each route have?
- Should the BucketDeployment invalidation stay (P2 option b), or go (P2 option a)?

## How to re-verify

```bash
cd infra && npx cdk synth -c stage=dev && npx cdk synth -c stage=prod
npm test && npm run lint && npm run format
npm run build -w frontend   # then inspect frontend/dist/index.html for inline scripts
npm audit
```

Walk the IAM table against `cdk.out` after each infrastructure change.
