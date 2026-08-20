# Task 1 report: Better Auth 1.6.x and D1 schema foundation

## Implementation summary

- Selected and pinned `better-auth@1.6.30` and the Better Auth CLI package `auth@1.6.30` to the same exact patch.
- Added the shared `createAuthOptions(config)` contract with the required trusted origin, disabled signup/implicit linking, cookie, IP, database rate-limit, Device Authorization, and Bearer settings.
- Added the CLI-only Better Auth config and generated `src/auth/schema.ts` with the pinned CLI.
- Added the Drizzle Kit config and exported the generated flat D1 SQL migration `0008_better_auth.sql`.
- Added Better Auth runtime environment fields and production/pre-production/local URL and cookie-prefix values while retaining all Supabase variables and authorization code.
- Added a schema contract test covering Better Auth core tables, Device Authorization, database rate limiting, text IDs, and core user foreign keys.

## Files changed

Task implementation files:

- `.env.example`
- `bun.lock`
- `packages/dtx-api/package.json`
- `packages/dtx-api/src/auth/auth.cli.ts`
- `packages/dtx-api/src/auth/options.ts`
- `packages/dtx-api/src/auth/schema.test.ts`
- `packages/dtx-api/src/auth/schema.ts` (CLI-generated)
- `packages/dtx-api/drizzle.auth.config.ts`
- `packages/dtx-api/d1-migrations/0008_better_auth.sql` (Drizzle-generated, with migration header)
- `packages/dtx-api/src/env.ts`
- `packages/dtx-api/wrangler.jsonc`

Existing dtx-api test fixtures also received inert Better Auth environment values because the new `Env` contract intentionally makes those runtime fields required. This keeps the pre-existing tests type-safe without changing their behavior:

- `packages/dtx-api/src/auth/verifyToken.test.ts`
- `packages/dtx-api/src/index.test.ts`
- `packages/dtx-api/src/lib/cors.test.ts`
- `packages/dtx-api/src/rest/downloadBulk.test.ts`
- `packages/dtx-api/src/rest/downloadSimfile.test.ts`
- `packages/dtx-api/src/rest/healthz.test.ts`
- `packages/dtx-api/src/rest/setDef.test.ts`
- `packages/dtx-api/src/rest/upload.test.ts`
- `packages/dtx-api/src/schema/auth.test.ts`
- `packages/dtx-api/src/schema/builder.test.ts`
- `packages/dtx-api/src/schema/schema.test.ts`
- `packages/dtx-api/src/schema/score.test.ts`
- `packages/dtx-api/src/schema/simfileTestHarness.ts`
- `packages/dtx-api/src/schema/user.test.ts`
- `packages/dtx-api/src/services/magicLink.test.ts`
- `packages/dtx-api/src/services/uploads.test.ts`

## Exact version evidence

- `npm view better-auth@1.6.30` returned version `1.6.30`, tarball integrity `sha512-+fmPXSZFE7MDmLcppkmzUGMtQxzZXsJbKi5rUunmIYtSQZIgNCZHNSQFwK/ywx10uczkzbtVkrHm75i4o7+gpQ==`, and the required Drizzle peers (`drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4`).
- `npm view auth@1.6.30` returned version `1.6.30`, tarball integrity `sha512-r3Edno6rLsgtF36Q6ZBM2tvcTrZbBUzCrmpIv6THo2o3njNM/6qVhrZBhLysXVYBTgbzPo2TqOJMQTSjG18Ejlw==`, and dependency `better-auth: 1.6.30`.
- The npm `1.6` version list ended at `1.6.30`; the current overall `latest` tag is `1.7.1`, so the highest stable patch on the task-constrained 1.6 line is `1.6.30`.
- Upstream [release v1.6.30](https://github.com/better-auth/better-auth/releases/tag/v1.6.30) was published on 2026-08-17, signed at commit `e84ec5e`, and reports the `v1.6.29...v1.6.30` patch delta. The release fix is unrelated to the requested schema/plugin contracts.
- Inspection of the 1.6.30 package exports/declarations confirmed `better-auth/plugins/device-authorization`, `better-auth/plugins/bearer`, `better-auth/adapters/drizzle`, `deviceAuthorization({ verificationUri, validateClient })`, `bearer()`, `cookiePrefix`, `trustedOrigins`, `rateLimit.customRules`, and the CLI `auth generate` flags `--config`, `--output`, `--adapter`, `--dialect`, and `--yes`.

## RED evidence

Command:

```text
bun run --filter=dtx-api test -- src/auth/schema.test.ts
```

Expected failure before implementation:

```text
FAIL src/auth/schema.test.ts
Error: Cannot find module './schema' imported from .../packages/dtx-api/src/auth/schema.test.ts
```

## GREEN evidence

- `bun run --filter=dtx-api auth:schema:generate` — generated the schema successfully with `auth@1.6.30`.
- `bun run --filter=dtx-api auth:schema:export` — exported the six generated tables and their indexes/foreign keys successfully.
- `bun run --filter=dtx-api auth:schema:check` — schema regeneration completed successfully.
- `bun run --filter=dtx-api test -- src/auth/schema.test.ts` — 1 file, 2 tests passed.
- `bun run --filter=dtx-api check` — passed.
- `bun run --filter=dtx-api test` — 22 files, 370 tests passed (the pre-task baseline was 368 tests; the two additions are the schema contract tests).
- `bun install --frozen-lockfile` — passed; only the pre-existing `@lucide/svelte` peer warning was reported.
- `bun run packages/e2e-web/setup/prepare-stack.ts` — after the sandbox-only Wrangler log/loopback restriction was retried with escalation, all 8 D1 migrations, seed SQL, and local R2 fixture upload passed.
- `git diff --check` — passed.

## Self-review

- Better Auth CSRF/origin defaults remain enabled; no `CORS_ALLOWED_ORIGINS` value is used in Better Auth options.
- The trusted origin is derived only from `DTX_WEB_URL`; production, pre-production, and local cookie prefixes are distinct as specified.
- The generated schema contains `user`, `session`, `account`, `verification`, `device_code`, and `rate_limit`; user/session/account IDs are text, and generated session/account foreign keys reference `user.id` with cascade delete.
- `device_code.user_id` remains nullable and without a hand-added foreign key because the pinned Better Auth generator emits that shape; the schema and migration were not hand-maintained.
- No GraphQL, REST, Supabase authorization, or existing `verifyToken()` implementation was changed or removed.
- No runtime Drizzle migration runner was added; Wrangler remains the D1 migration executor.

## Concerns

- Required Better Auth fields on `Env` required inert values in existing dtx-api test fixtures; those are contract-only changes but expand the working diff beyond the brief's primary file list.
- `GOOGLE_AUTH_CLIENT_ID` has a local `.env.example` placeholder and must be provisioned for deployed Better Auth use; no real credential was invented or committed.
- The exact `auth:schema:check` script from the task relies on `git diff`; it becomes a complete tracked-artifact check once `src/auth/schema.ts` is committed.

## Post-Task-1 pre-production config correction

- Added the public Google OAuth client ID `333977657035-u0r7jj85dv1fv9rqi32e7nl6qb2bn77i.apps.googleusercontent.com` as `GOOGLE_AUTH_CLIENT_ID` in the top-level production vars, `env.pre-prod.vars`, and `env.pre-prod-prod-data.vars` blocks in `packages/dtx-api/wrangler.jsonc`.
- Extended the existing `packages/dtx-desktop/src/devTopology.test.ts` Wrangler topology contract to assert the exact value in all three applicable API config blocks. No secret values or downloaded credential files were added.

### RED evidence

Command:

```text
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
```

Result before the Wrangler change: 1 failed, 1 passed. The new production-block assertion received `undefined` instead of the required public client ID.

### GREEN evidence

- `bun run --filter=dtx-desktop test -- src/devTopology.test.ts` — 1 file, 2 tests passed.
- `bun run --filter=dtx-api check` — passed.
- `bun run --filter=dtx-api cf-typegen` — passed with Wrangler 4.123.0; generated base, `PreProdEnv`, and `PreProdProdDataEnv` types all contain the configured public client ID. The generated untracked `worker-configuration.d.ts` was removed after validation.
- `bunx wrangler deploy --dry-run --outdir /private/tmp/dtx-api-wrangler-prod-check` — passed for the top-level production config and listed `GOOGLE_AUTH_CLIENT_ID`; no deployment occurred.
- `bunx wrangler deploy --dry-run --env pre-prod --outdir /private/tmp/dtx-api-wrangler-preprod-check` — passed and listed `GOOGLE_AUTH_CLIENT_ID`; no deployment occurred.
- `bunx wrangler deploy --dry-run --env pre-prod-prod-data --outdir /private/tmp/dtx-api-wrangler-preprod-prod-data-check` — passed and listed `GOOGLE_AUTH_CLIENT_ID`; no deployment occurred.
- `git diff --check` — passed.

The remaining pre-production prerequisite is unchanged: Better Auth and Google OAuth secret values still require operator provisioning before deployment; no secret was added or exposed here.
