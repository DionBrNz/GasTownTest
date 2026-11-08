# Security and least-privilege review

Bead: `to-oti.6`. Reviewed against `origin/main` (`c4c7989`) plus the changes on this branch.

## Status and scope

**Read this first.** `to-oti.5` (private S3 + CloudFront OAC, CSP, BucketDeployment, `config.json`)
is closed, but its code is **not on `main`**. Its commits (`0f66382`, on
`polecat/obsidian/to-oti.5+mw733ho7`) are in merge request `to-wisp-qdj`. On `main`,
`WebHostingStack.siteUrl` is the placeholder `https://example.invalid` and `WebDeploymentStack`
is empty, so the hosting and deployment controls cannot be verified on `main` yet.

- Sections marked **Verified on main** were checked against the synthesized templates and the code on `main`.
- Sections marked **Pending to-oti.5** were reviewed read-only from `0f66382`. They must be
  re-verified after `to-wisp-qdj` merges, since the synthesized output is the source of truth.

## Verification run

| Gate                                           | Result                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdk synth -c stage=dev`                       | Pass. No unacknowledged cdk-nag AwsSolutions findings.                                                                                                        |
| `cdk synth -c stage=prod`                      | Pass.                                                                                                                                                         |
| `npm test` (infra 46, backend 43, frontend 38) | Pass. The backend count includes one test added here.                                                                                                         |
| `npm run lint`, `npm run format`               | See the note at the end of this document.                                                                                                                     |
| `npm run build -w frontend`                    | Pass.                                                                                                                                                         |
| `npm audit`                                    | 30 findings: 0 critical, 0 high, 27 moderate, 3 low. All in build and dev tooling. See "Dependencies". The bead's "npm audit clean" criterion is **not met**. |

## cdk-nag suppressions

Each suppression was reviewed. None were removed, because each one has a documented reason
that still holds.

| Finding                                                      | Resource                                  | Decision                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AwsSolutions-IAM4` (`AmazonAPIGatewayPushToCloudWatchLogs`) | Account-level API Gateway CloudWatch role | Keep. The managed policy is the documented way to enable API Gateway execution logging.                                                                        |
| `AwsSolutions-IAM5` (`Resource::*`)                          | Each route Lambda role                    | Keep. `xray:PutTraceSegments` and `xray:PutTelemetryRecords` take no resource ARN, so `*` is the only valid resource. This is the only wildcard on `main`.     |
| `AwsSolutions-L1`                                            | Route Lambdas                             | Keep. The spec requires Node.js 22. Node 22 must be upgraded before its end-of-life date. The reason text says so.                                             |
| `AwsSolutions-COG2`                                          | User pool                                 | Keep. MFA is OPTIONAL (TOTP) by design. Making it REQUIRED is a product decision, listed under "Open decisions".                                               |
| `AwsSolutions-COG8`                                          | User pool                                 | Keep. Advanced security needs the Plus feature plan. Compensating controls: a 12-character password policy, Cognito lockout, and `preventUserExistenceErrors`. |

Pending to-oti.5 adds `AwsSolutions-CFR1`, `CFR2`, `CFR4` and a set of BucketDeployment
findings. See "Pending to-oti.5", finding P2, for the one that is wrong.

## IAM inventory

### Verified on main

Principals are listed as the synthesized template defines them. Each route Lambda has its own
role. A role grants only its route's DynamoDB action, on the table ARN, with no index ARNs.

| Principal                                                          | Actions                                             | Resource                                           | Purpose                                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apigateway.amazonaws.com` (account role `TodosApiCloudWatchRole`) | Managed `AmazonAPIGatewayPushToCloudWatchLogs`      | Account                                            | Stage execution logs                                                                                  |
| `ListTodosRole` (`lambda.amazonaws.com`)                           | `dynamodb:Query`                                    | `todos` table ARN                                  | `GET /todos`                                                                                          |
| `CreateTodoRole`                                                   | `dynamodb:PutItem`                                  | `todos` table ARN                                  | `POST /todos`                                                                                         |
| `UpdateTodoRole`                                                   | `dynamodb:UpdateItem`                               | `todos` table ARN                                  | `PATCH /todos/{id}`                                                                                   |
| `DeleteTodoRole`                                                   | `dynamodb:DeleteItem`                               | `todos` table ARN                                  | `DELETE /todos/{id}`                                                                                  |
| Each route role                                                    | `logs:CreateLogStream`, `logs:PutLogEvents`         | That route's log group only                        | Function logs                                                                                         |
| Each route role                                                    | `xray:PutTraceSegments`, `xray:PutTelemetryRecords` | `*` (acknowledged)                                 | X-Ray tracing                                                                                         |
| `apigateway.amazonaws.com` (Lambda resource policy)                | `lambda:InvokeFunction`                             | Each method ARN (`.../<STAGE>/<METHOD>/todos[/*]`) | Invokes the route. Eight statements, including the `test-invoke-stage` ones that CDK adds by default. |

Cognito: no IAM roles. No identity pool exists (verified: no `IdentityPool` in any template), so
no unauthenticated AWS credentials are issued.

DynamoDB (`Todo-<stage>-Data`): no IAM grants. Access happens only through the route roles above.

### Pending to-oti.5

From the acknowledgements in `0f66382`, these roles exist. They must be re-listed from
`cdk.out` after merge.

| Principal                              | Actions                                                                       | Resource                     | Status                         |
| -------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- | ------------------------------ |
| BucketDeployment singleton Lambda role | `s3:GetBucket*`, `s3:GetObject*`, `s3:List*`, `s3:Abort*`, `s3:DeleteObject*` | Asset bucket and site bucket | Wildcard actions, acknowledged |
| BucketDeployment singleton Lambda role | `cloudfront:GetInvalidation`, `cloudfront:CreateInvalidation`                 | `*`                          | **Finding P2**                 |

## Authorization and tenant isolation

**Verified on main**

- Every `/todos` method except OPTIONS uses `COGNITO_USER_POOLS` with the `todo/api` scope
  (`authorizationScopes`). The synthesized template shows 4 of 4 methods.
- The OPTIONS methods are `MOCK` integrations with `AuthorizationType: NONE`. CDK adds them for
  CORS preflight. They return CORS headers and do not touch data. That is safe, but see P1 for
  why the pending branch removes CORS and the OPTIONS methods entirely.
- The tenant key is `userId`, read only from `event.requestContext.authorizer.claims.sub`
  (`backend/src/lib/auth.ts`). No handler reads a user id from the path, query or body.
- The body schemas are `z.strictObject`, so a client-supplied `userId` field is rejected. The API
  request validator also sets `additionalProperties: false`.
- Every read and write uses the key `(callerSub, todoId)`. Update and delete use
  `ConditionExpression: attribute_exists(todoId)`, so another user's id returns 404 and never
  creates a row.
- The pagination token carries `userId`, and `decodeNextToken` rejects a token whose `userId`
  is not the caller's.
- Unit tests cover all of the above (`backend/test/handlers.test.ts`, `pagination.test.ts`).

**Gap:** the tests mock DynamoDB. Nothing proves isolation between two real Cognito users on a
deployed stack. Filed as follow-up bead `to-diy`.

## CORS

- **On main:** `ALLOWED_ORIGIN` is the placeholder origin. Once `to-oti.5` lands, CORS is removed
  entirely, and the SPA calls `/todos*` on its own CloudFront origin, so the pending CSP
  `connect-src` needs no `execute-api` wildcard. Verify after merge that no
  `Access-Control-Allow-Origin: *` appears anywhere.
- **Hardening on this branch:** every JSON and 204 response now sends `Cache-Control: no-store`
  and `X-Content-Type-Options: nosniff`. Covered by a new test.

## Frontend

**Verified on main**

- Tokens stay in memory. `auth.ts` sets the oidc-client-ts user store to `InMemoryWebStorage`.
  The PKCE state store uses sessionStorage, which is the library default and holds no tokens.
- The source has no `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`, inline
  `style=` attributes, or token storage in `localStorage` or `sessionStorage`.
- **Static CSP check** of `frontend/dist` (`vite build`): `index.html` has one external module
  script and one external stylesheet. The bundle has no `eval`, `new Function`, inline style
  attributes, iframes, workers or `blob:` URLs. Its URL strings are SVG/XML namespaces, a React
  docs link in error messages, and a base URL for the URL parser, and none of them is a request.
  The build is therefore compatible with the pending CSP (`script-src 'self'`,
  `style-src 'self'`, `connect-src 'self'` plus the Cognito hosts).
- Silent renew uses the refresh token when one exists (`signinSilent` in oidc-client-ts), so it
  loads no iframe. The pending CSP does not need `frame-src`.

**Not done:** a browser smoke test with the CSP header applied. The workspace has no headless
browser. Filed as follow-up bead `to-a0c`, to run after `to-oti.5` merges.

## Dependencies

`npm audit` reports 30 findings, all dev or build tooling:

- `minimatch` (GHSA-g3hv-75wg-m249, moderate), `glob` (GHSA-3g3m-2fjr-6pw4, moderate) and
  `deepmerge` (GHSA-gcqx-w48m-w2h4, low) are the underlying advisories. They come in through
  jest, eslint, typescript-eslint and `aws-cdk-lib`.
- `aws-cdk-lib` bundles its own `minimatch` copy. `npm audit fix` cannot change that copy, so it
  needs an `aws-cdk-lib` release that includes the fix.
- The remaining fixes are semver-major upgrades to jest, eslint, cdk-nag and typescript-eslint.
  `npm audit fix` without `--force` changed nothing relevant, so the lockfile is unchanged.
- No runtime dependency is affected. That covers react, react-dom, oidc-client-ts,
  react-oidc-context, TanStack, zod, Powertools and the AWS SDK.

Accepted for now, with a follow-up bead to upgrade the tooling. The bead's "clean" criterion is
not met.

## Threat model (STRIDE)

| Category               | Threat                                                             | Control                                                                                                                                                     | Residual risk                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spoofing               | Forged or replayed bearer token                                    | Cognito authorizer checks the JWT signature, issuer, expiry and the `todo/api` scope. The ID token lacks that scope.                                        | Low                                                                                                                                              |
| Spoofing               | Attacker signs up for a real account, then reads other users' data | Tenant key from `sub` only; conditional writes; 404 for other users' ids                                                                                    | Accepted. Self sign-up is enabled, so every attacker is an authenticated user. Isolation is the control that matters.                            |
| Tampering              | Malformed or oversized input                                       | REST request models plus strict zod schemas; 10 KB body limit                                                                                               | Low                                                                                                                                              |
| Tampering              | Stored XSS through a todo title                                    | React escapes text; no HTML rendering in the source; pending CSP `script-src 'self'`                                                                        | Low                                                                                                                                              |
| Repudiation            | Denied audit trail                                                 | Access logs on the API stage (JSON, standard fields); execution logs record errors only; Powertools logs carry route names and error names, never user data | Low. CloudTrail is not configured by the app.                                                                                                    |
| Information disclosure | Tokens leak through storage                                        | Tokens are in memory only                                                                                                                                   | Low. A page reload needs a new sign-in, which Cognito's session may complete silently.                                                           |
| Information disclosure | Data leaks through logs or errors                                  | No bodies, user ids or titles in logs; generic 500 messages; `dataTraceEnabled: false`                                                                      | Low                                                                                                                                              |
| Information disclosure | Cached private responses                                           | `Cache-Control: no-store` on every API response (this branch)                                                                                               | Low                                                                                                                                              |
| Denial of service      | One user floods the stage                                          | Stage throttle 20 rps / 40 burst; WAF managed rules; per-IP rate rule (see P1 for the pending change)                                                       | **Medium.** The stage throttle is shared, so one user can use the whole budget. There are no per-user quotas, and reserved concurrency is unset. |
| Denial of service      | Direct calls to `execute-api` bypass CloudFront                    | The authorizer still applies, and the stage throttle still applies                                                                                          | Medium (see P1)                                                                                                                                  |
| Elevation of privilege | A Lambda reads another table or action                             | One role per route, with one action on one ARN                                                                                                              | Low                                                                                                                                              |
| Elevation of privilege | Unauthenticated AWS credentials                                    | No identity pool exists                                                                                                                                     | Low                                                                                                                                              |

## Findings

**Fixed on this branch**

- Responses lacked `Cache-Control` and `nosniff`. Added to `backend/src/lib/http.ts`, with a test.

**Open on main**

- No cross-user test against a deployed stack (bead `to-diy`).
- `npm audit` is not clean (bead `to-8e0`). Accepted for now: dev tooling only.
- Node 22 suppression (L1). Upgrade before Node 22's end-of-life.
- The dev user pool allows `http://localhost:5173` as a callback. It is dev-stage only and does
  not reach prod, so it is accepted.

**Pending to-oti.5 (must be handled in that MR or a follow-up)**

- **P1 (high, bead `to-d5f`):** the WAF per-IP rule now keys on the `X-Forwarded-For` header, and the
  `execute-api` endpoint stays reachable directly. A client that calls the API directly can set
  that header to any value, so it can rotate client addresses and get past the 2000-per-5-minute
  limit. The authorizer still requires a valid token, but a signed-up user can then exhaust the
  shared stage budget. Mitigation: make CloudFront the only path to the API, for example with a
  CloudFront origin custom header that a WAF rule or a resource policy checks.
- **P2 (medium, bead `to-0im`):** the `cloudfront:CreateInvalidation` acknowledgement says CloudFront "does not
  support resource-level permissions". That is wrong. The AWS Service Authorization Reference
  lists a distribution as the resource type for `CreateInvalidation`
  (https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).
  Scope the grant to the distribution ARN, and drop the acknowledgement.
- **P3 (verify after merge):** CloudFront sends `X-Forwarded-For` as the rate rule expects. Run
  the tenant-isolation test and the browser CSP smoke test against the deployed dev stack.

## Open decisions

- Should MFA be REQUIRED rather than OPTIONAL (COG2)?
- Should self sign-up stay enabled? If it is disabled, the threat model's spoofing row goes away.
- Should there be per-user quotas, and what reserved concurrency should each route have?

## How to re-verify

```bash
cd infra && npx cdk synth -c stage=dev && npx cdk synth -c stage=prod
npm test && npm run lint && npm run format
npm run build -w frontend   # then inspect frontend/dist/index.html for inline scripts
npm audit
```

Walk the IAM table against `cdk.out` after `to-oti.5` merges.

## Note on lint

Infra lint (`eslint` with `strictTypeChecked`) and backend lint ran very slowly on this host.
Their results are recorded in the bead notes.
