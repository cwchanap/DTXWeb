# HPA-311 Latest-Main Revalidation

**Date:** 2026-08-26  
**Validated against:** `main@9ec68aac5db82e027432841938f92824e8687f80`  
**Implementation plan:** `docs/superpowers/plans/2026-08-25-cloudflare-workflow-m4a-generation.md`

## Verdict

The approved Workflow/Container/R2 architecture remains valid. No media architecture or task decomposition change is needed.

The implementation plan was originally written before PR #240 completed the Better Auth + D1 cutover. That merge changed authentication and environment/package scaffolding around `dtx-api`, but did not change the HPA-311 media seams. This note is the authoritative delta for executing the implementation plan against current `main`. Where an older code snippet in the plan conflicts with this note, follow this note and current `main`.

## Current seams that remain valid

- `packages/dtx-api/src/services/uploads.ts` still streams uploads directly to `{simfileId}/{sanitizedFilename}` in R2 and still returns a plain HTTP `Response` today.
- `packages/dtx-api/src/services/r2Enrichment.ts` still recognizes `['.ogg', '.mp3', '.wav', '.flac']`; Task 6 still inserts `.m4a` immediately after `.ogg`.
- `packages/dtx-api/src/services/downloads.ts` still passes each full per-simfile R2 listing through `createZipSources()`; Task 6 still owns the DTX-specific redundant-M4A pre-filter.
- `packages/common/src/lib/server/zipBuilder.ts` remains intentionally unchanged.
- `Simfile.files` still exposes R2 object keys, so no GraphQL schema/codegen change is needed.

## Required plan updates after PR #240

### 1. Task 2: keep Better Auth upload-route coverage

`routeUpload()` now authenticates through `resolveAuthSession(request, env)`, not the removed Supabase `verifyToken()` helper.

When updating `packages/dtx-api/src/rest/upload.test.ts`:

- keep the existing `vi.mock('../auth/session', ...)` setup;
- keep `mockedResolveAuthSession` and the existing `validAuthSession()` fixture;
- preserve the current tests proving a trusted-origin Better Auth cookie session works;
- preserve the current test proving a desktop Bearer session works without `Origin`;
- preserve the current missing/wrong-Origin rejection tests for unsafe cookie-authenticated POSTs;
- only change the `uploadSimfileFile()` mock/result shape and add the HPA-311 Workflow-trigger assertions.

Do **not** reintroduce `verifyToken`, Supabase session fixtures, `mockedVerify`, or Supabase dependencies.

### 2. Task 1/2 test fixtures: extend current `Env`

Current `Env` includes Better Auth configuration:

```ts
BETTER_AUTH_URL
BETTER_AUTH_SECRET
BETTER_AUTH_DEVICE_CODE_EXPIRES_IN?
DTX_WEB_URL
AUTH_COOKIE_DOMAIN?
AUTH_COOKIE_PREFIX
GOOGLE_AUTH_CLIENT_ID
GOOGLE_AUTH_CLIENT_SECRET
```

HPA-311 adds its generation fields to this current type. Touched `makeEnv()` fixtures must preserve the Better Auth fields already present and append:

```ts
BGM_M4A_GENERATION_ENABLED: 'true'
BGM_M4A_WORKFLOW: ...       // once Task 2 adds the binding
BGM_TRANSCODER: ...         // once Task 4/5 adds the binding
```

Do not reconstruct test environments from the pre-Better-Auth baseline shown in older plan snippets.

### 3. Task 5: merge Wrangler resources into the current auth configuration

`packages/dtx-api/wrangler.jsonc` now carries environment-specific Better Auth URLs, cookie prefixes/domains, Google client ID, and the existing D1/R2/KV topology.

Add Workflow/Container/Durable Object bindings and `BGM_M4A_GENERATION_ENABLED` **alongside** those current values.

Do not remove or overwrite:

- `BETTER_AUTH_URL`;
- `DTX_WEB_URL`;
- `AUTH_COOKIE_DOMAIN`;
- `AUTH_COOKIE_PREFIX`;
- `GOOGLE_AUTH_CLIENT_ID`;
- existing D1/R2/KV bindings;
- environment-specific auth differences.

`pre-prod-prod-data` still points at production D1/R2 and must keep `BGM_M4A_GENERATION_ENABLED=false`.

### 4. Task 3/5/7: append package changes to the current package file

`packages/dtx-api/package.json` now contains Better Auth/Drizzle dependencies, auth schema/migration scripts, and the `./auth-migration` export.

HPA-311 must append:

- `@cloudflare/containers`;
- Container smoke script;
- backfill script;
- environment dry-run/typegen scripts;

without deleting or rewriting the existing auth export/scripts/dependencies.

### 5. Task 5: preserve the Better Auth route in `src/index.ts`

The Worker entrypoint now mounts Better Auth at `/api/auth/*` before the existing GraphQL/REST routes.

Add only the named exports required by Wrangler:

```ts
export { BgmTranscoderContainer } from './containers/bgmTranscoder';
export { GenerateBgmM4aWorkflow } from './workflows/generateBgmM4a';
```

Do not restructure or remove the current default fetch handler or `/api/auth/*` dispatch.

### 6. Task 8: use a current authenticated upload smoke

For pre-production `/upload` smoke testing, use one of the current supported auth paths:

- **browser path:** valid Better Auth cookie **plus** `Origin` exactly matching that environment's `DTX_WEB_URL`; or
- **desktop path:** valid opaque Bearer session, no `Origin` required.

A cookie-authenticated unsafe POST without the trusted origin is intentionally rejected by `resolveAuthSession()` and must not be treated as an HPA-311 regression.

### 7. Backfill remains public-catalog driven

No auth change is needed for Task 7. `simfiles(scope: PUBLISHED, ...)` remains readable without an authenticated user; only private `MINE` scope requires authentication.

## Delivery shape

Keep the original eight-task sequence and one-implementation-PR constraint. The Better Auth merge changes scaffolding only; it does not justify a new HPA-311 task, a second implementation PR, or a media/auth abstraction.

## Revalidation checklist

- [x] Upload storage seam still matches the plan.
- [x] R2 audio discovery seam still matches the plan.
- [x] ZIP source-collection seam still matches the plan.
- [x] GraphQL file-list contract still matches the plan.
- [x] Better Auth upload/session behavior identified and incorporated as an execution delta.
- [x] Current Wrangler auth configuration identified as configuration to preserve.
- [x] Current `dtx-api` package exports/scripts identified as package state to preserve.
- [x] No new Workflow/Container infrastructure landed on `main` that supersedes HPA-311.
