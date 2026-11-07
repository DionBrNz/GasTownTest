# backend

TypeScript (strict, ESM) Lambda handlers for the todo REST API.

- One handler module per route in `src/handlers/` (added in bead to-oti.3).
- Bundled by CDK `NodejsFunction` (esbuild) from `infra/`, for Node.js 22 on arm64.
- `@aws-sdk/*` are **devDependencies**: the Node.js 22 Lambda runtime provides
  SDK v3, so the bundle marks them external.

```bash
npm run lint -w backend   # eslint + tsc
npm test -w backend       # vitest
```
