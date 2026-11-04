# HPA-617 — API Infrastructure Ownership: Implementation Plan

**Linear:** https://linear.app/cwchanap/issue/HPA-617
**Design:** ../specs/2026-11-03-hpa-617-api-ownership-design.md
**Delivery:** one PR/branch, initial draft docs followed by implementation commits. No new ticket or second PR.
**Scope:** mechanical code movement, dependency cleanup, tests, and current architecture docs; no runtime features or schema changes.

## Global guardrails

- Start from the latest `main` before making implementation edits; re-check imports and test file layout. Prefer `git mv` to preserve history.
- Preserve all public GraphQL/REST contract and Worker binding behavior. The database migrations in `packages/dtx-api/d1-migrations` remain untouched.
- Keep `@dtx/common` focused on true client-neutral models, parsers, notation, game and UI; leave `SimfileModel` intact.
- No compatibility wrappers, new shared server package, generic persistence interface, global logger factory, new test harness, or version upgrades.
- Move tests alongside code rather than rewriting/reducing them; no new CI workflow for a file move.
- Each task below is a sequence of commits in **the same PR**, not a separate ticket or PR. Do not close the issue until verification succeeds.

## Task 1 — Confirm source ownership and establish a baseline

**Inspect:** `packages/common/src/lib/server.ts`; `packages/common/src/lib/server/**`; `packages/common/src/lib/types/d1.types*`; `packages/dtx-api/src/**`; `packages/dtx-web/src/**`; package manifests; `CLAUDE.md`.

1. Use `rg '@dtx/common/server|types/d1.types|createMockD1Database' packages` to enumerate real consumers, including test mocks, Vite aliases, and SvelteKit SSR routes.
2. Use `rg 'drizzle-orm|winston|jszip|@aws-sdk/client-s3' packages package.json scripts` to distinguish dead package declarations from actual imports; check generated files/lockfile and historical docs separately.
3. Confirm `dtx-web` editor's `decodeArrayBufferWithBomDetection` is the only remaining non-API `@dtx/common/server` consumer. If another genuine consumer exists, keep a pure shared entrypoint until it is migrated in this PR.
4. Record existing focused test results (do not change assertions yet):
   - `bun run --filter=@dtx/common test -- src/lib/server/db.integration.test.ts`
   - `bun run --filter=@dtx/common test -- src/lib/server/db.test.ts`
   - `bun run --filter=dtx-api test`
5. If this audit shows the same move has already landed on `main`, stop rather than recreating it.

**Exit:** exact moved-file list and all impacted imports/configs confirmed. No new infrastructure introduced.

## Task 2 — Move D1 persistence, API row types and their tests

**Move:**
- `packages/common/src/lib/server/db.ts` → `packages/dtx-api/src/db/queries.ts`
- `packages/common/src/lib/server/db/schema.ts` → `packages/dtx-api/src/db/schema.ts`
- `packages/common/src/lib/types/d1.types.ts` → `packages/dtx-api/src/db/types.ts`
- `packages/common/src/lib/server/db.test.ts` → `packages/dtx-api/src/db/queries.test.ts`
- `packages/common/src/lib/server/db.integration.test.ts` → `packages/dtx-api/src/db/queries.integration.test.ts`
- `packages/common/src/lib/types/d1.types.test.ts` → `packages/dtx-api/src/db/types.test.ts`

1. Update relative imports within the moved query/schema/type/test files. Keep query names, row types, SQL text, bindings, transaction ordering, and D1 migrations unchanged.
2. Retarget API GraphQL, REST, and service imports to `../db/queries` and `../db/types` (path adjusted per caller). Keep existing API auth schema separate in `src/auth/schema.ts`.
3. Move any D1 test-only dependency (especially `miniflare`) to `dtx-api`; use the existing `dtx-api` Vitest configuration and `src/**/*.test.ts` discovery rather than adding another harness.
4. Rebase the real-D1 test's migration directory lookup to `packages/dtx-api/d1-migrations`. The test must still apply numbered migrations including `0007_score_semantics.sql` and `0008_better_auth.sql`.
5. Run `bun run --filter=dtx-api test -- src/db/queries.integration.test.ts`, `bun run --filter=dtx-api test -- src/db/queries.test.ts`, `bun run --filter=dtx-api check`. Check insert/replace semantics, partial unique score indexes, Drive-binding guards and auth-schema coexistence.

**Exit:** all D1 queries and row types are API-local; no mock/test coverage was removed; real D1 remains exercised.

## Task 3 — Move R2, ZIP, rate limit and Worker logging

**Move with existing tests:**
- `common/src/lib/server/r2*` → `dtx-api/src/lib/r2*`
- `common/src/lib/server/rateLimiter*` → `dtx-api/src/lib/rateLimiter*`
- `common/src/lib/server/zipBuilder*` → `dtx-api/src/lib/zipBuilder*`
- `common/src/lib/server/workerLogger*` → `dtx-api/src/lib/workerLogger*`

1. Preserve existing `dtx-api/src/lib/r2Files.ts` and its purpose; use direct local imports instead of creating another R2 facade.
2. Update API service/REST/Workflow imports and their unit-test mock paths. Import the moved local Worker logger wherever API source currently imports `workerLogger`.
3. Replace the three moved modules' Winston `logger` usages with that already-existing `workerLogger`. Retain warnings, error metadata and meaningful diagnostics; update mock assertions accordingly. Delete `common/src/lib/server/logger.ts` and its test if the final consumer scan is empty.
4. Keep ZIP entry order, streaming, safety checks and CRC behavior; keep KV bandwidth-window calculations and R2 listing pagination logic identical. `zipBuilder.test.ts` uses `jszip` to inspect generated ZIPs: ensure API test dependencies include it explicitly.
5. Run focused `dtx-api` unit tests for R2, ZIP, rate limiting, Worker logging, download/score/upload routes, BGM workflows, and then the full API test suite.

**Exit:** Cloudflare infrastructure modules live only under `dtx-api`, with equivalent tests and no new logging package.

## Task 4 — Remove obsolete shared exports, aliases and dependencies

1. Export `decodeArrayBufferWithBomDetection` from `packages/common/src/lib/index.ts` (its pure encoding helper already exists); change the web editor `+page.server.ts` to import from `@dtx/common`.
2. Replace any remaining API use of pure DTX/chart classes from `@dtx/common/server` with already-supported exports from `@dtx/common`. After the complete import survey, remove `packages/common/src/lib/server.ts` and `"./server"` from `packages/common/package.json`.
3. Remove unused `@dtx/common/server` aliases from `packages/dtx-api/vitest.config.ts`, `packages/dtx-api/tsconfig.json`, common/desktop Vitest/Vite configs, and any other **current** config. Update stale explanatory code comments.
4. Remove `drizzle-orm`, `winston` and `miniflare` from common only if its remaining source/tests no longer use them. **Keep common `jszip`**, which `chart/simFile.ts` imports.
5. Remove `@aws-sdk/client-s3`, `drizzle-orm` and `winston` from web **only after confirming no real source/script imports**. Keep web `jszip` for `ExportWorkspaceModal.svelte`. Check root `jszip` is not required by root scripts before dropping the duplicate declaration. Regenerate `bun.lock` mechanically; avoid unrelated upgrade churn.
6. Run common build/check/tests before API build because API imports the built common package: `bun run --filter=@dtx/common build`; `bun run --filter=@dtx/common check`; `bun run --filter=@dtx/common test`; `bun run --filter=dtx-api check`.

**Exit:** no obsolete shared server entrypoint or aliases, dependency declarations reflect real imports, and shared decoder remains available to the web server.

## Task 5 — Update current guidance and validate as one PR

**Docs:** edit `CLAUDE.md` once (`AGENTS.md` is a symlink). Do not rewrite historical `docs/superpowers` plans or migration runbooks merely to conceal history.

1. Correct the workspace count to eight and list `packages/infrastructure`; explain ownership of D1/migrations/R2/KV and Worker-only helpers in `dtx-api`.
2. Replace any remaining current references to Supabase runtime auth with Better Auth sessions on D1; document web API-service binding and desktop Device Authorization/Bearer sessions accurately. Verify desktop cache clearing examples against current native persistence; do not present old localStorage auth keys as active instructions.
3. Update import examples and any package descriptions to avoid `@dtx/common/server`. Document only existing commands and operational surfaces.
4. Run after dependency reinstall/lockfile update:
   - `bun run --filter=@dtx/common build`
   - `bun run --filter=@dtx/common check` and `bun run --filter=@dtx/common test`
   - `bun run --filter=dtx-api check`, `bun run --filter=dtx-api test` and `bun run --filter=dtx-api build` (Worker dry run)
   - `bun run --filter=dtx-web check`, `bun run --filter=dtx-web test` and `bun run --filter=dtx-web build`
   - `bun run --filter=dtx-desktop typecheck` and `bun run --filter=dtx-desktop test`
   - `bun run lint` and `bun run check`
5. Run relevant web E2E for sign-in, chart listing/editor set.def, scores, and downloads; check desktop E2E/smoke for cloud chart/score/download paths where the existing CI matrix supports it. Do not run migrations/deployments; no schema or infrastructure should change.
6. Review `git diff` for mechanical scope: no SQL/schema/GraphQL/API response changes, no dependency version campaign, no new abstraction or duplicate exports. Ensure test file moves are discoverable and Codecov reflects moved paths.
7. Update this *same draft PR* with implementation commits, evidence, and exact test results. Mark ready for review when relevant CI passes. Update HPA-617 with the single PR link and close on merge.

**Exit:** one reviewable PR contains design, plan, mechanical refactor and verification proof.

## Stop conditions / corrections

- If a production consumer needs a pure shared server utility, retain it in common; **never** make web/desktop import API implementation solely to achieve deletion of a path.
- If moving the test requires a new generic testing platform, preserve the existing in-repo Miniflare test setup under `dtx-api`; do not expand scope.
- If `jszip` or another dependency is still truly used, keep it. Only remove dependencies verified unused.
- If a change alters public behavior or requires a schema migration, isolate the finding as an explicit review note rather than silently widening HPA-617.
