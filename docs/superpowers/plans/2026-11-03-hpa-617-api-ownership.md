# HPA-617 — API Infrastructure Ownership: Implementation Plan

**Linear:** https://linear.app/cwchanap/issue/HPA-617
**Design:** ../specs/2026-11-03-hpa-617-api-ownership-design.md
**Delivery:** one PR/branch, initial draft docs followed by implementation commits. No new ticket or second PR.
**Scope:** mechanical code movement, dependency cleanup, tests, and current architecture docs; no runtime features or schema changes.

## Global guardrails

- Start from the latest `main` before making implementation edits; re-check imports and test file layout. Prefer `git mv` to preserve history.
- Preserve all public GraphQL/REST contracts and Worker binding behavior. Leave D1 migration **SQL statements and filenames** unchanged; allow comment-only path corrections in `0002_scores.sql` and `0007_score_semantics.sql` when the Drizzle schema moves.
- Keep `@dtx/common` focused on true client-neutral models, parsers, notation, game and UI; leave `SimfileModel` intact.
- No compatibility wrappers, new shared server package, generic persistence interface, global logger factory, new test harness, or version upgrades.
- Move tests alongside code rather than rewriting/reducing them; no new CI workflow for a file move. Common uses Vitest 5 while API uses Vitest 4: first run of each moved test should establish compatibility, without upgrading either.
- Each task below is a sequence of commits in **the same PR**, not a separate ticket or PR. **Trim `common/src/lib/server.ts` as each group moves**, so every intermediate commit is typecheckable. Do not close the issue until verification succeeds.

## Task 1 — Confirm source ownership and establish a baseline

**Inspect:** `packages/common/src/lib/server.ts`; `packages/common/src/lib/server/**`; `packages/common/src/lib/types/d1.types*`; `packages/dtx-api/src/**`; `packages/dtx-web/src/**`; package manifests; `CLAUDE.md`.

1. Use `rg '@dtx/common/server|types/d1.types|createMockD1Database' packages` to enumerate real consumers, including test mocks, Vite aliases, and SvelteKit SSR routes.
2. Use `rg 'drizzle-orm|winston|jszip|@aws-sdk/client-s3' packages package.json scripts` to distinguish dead package declarations from actual imports; check generated files/lockfile and historical docs separately.
3. Confirm the **two** uses of the pure `decodeArrayBufferWithBomDetection` from `@dtx/common/server`: the web editor's `+page.server.ts` **and** `dtx-api/src/services/r2Enrichment.ts`. Both switch to `@dtx/common` in Task 4; keep the decoder pure and shared.
4. Inspect `dtx-api/{vitest.config.ts,tsconfig.json,wrangler.jsonc}`: today each aliases only `@dtx/common/server` to source, whereas `@dtx/common` main resolves through the built `dist` export. Confirm the current root Turbo `check` has no `^build` dependency and the git-connected Workers Builds status for this PR. Before moving files, add an **explicit source alias** `@dtx/common` → `../common/src/lib/index.ts` to all three resolvers. For intermediate commits retain the more specific `@dtx/common/server` alias until its consumers are all migrated; ensure alias ordering or exact matching prevents the main alias from intercepting the `/server` import. Do not introduce a dependency on `common/dist`.
5. Record existing focused test results (do not change assertions yet):
   - `bun run --filter=@dtx/common test -- src/lib/server/db.integration.test.ts`
   - `bun run --filter=@dtx/common test -- src/lib/server/db.test.ts`
   - `bun run --filter=dtx-api test`
6. If this audit shows the same move has already landed on `main`, stop rather than recreating it.

**Exit:** exact moved-file list and all impacted imports/configs confirmed. No new infrastructure introduced.

## Task 2 — Move D1 persistence, API row types and their tests

**Move:**
- `packages/common/src/lib/server/db.ts` → `packages/dtx-api/src/db/queries.ts`
- `packages/common/src/lib/server/db/schema.ts` → `packages/dtx-api/src/db/schema.ts`
- `packages/common/src/lib/types/d1.types.ts` → `packages/dtx-api/src/db/types.ts`
- `packages/common/src/lib/server/db.test.ts` → `packages/dtx-api/src/db/queries.test.ts`
- `packages/common/src/lib/server/db.integration.test.ts` → `packages/dtx-api/src/db/queries.integration.test.ts`
- `packages/common/src/lib/types/d1.types.test.ts` → `packages/dtx-api/src/db/types.test.ts`

1. Update relative imports within moved query/schema/type/test files; keep query names, SQL, bindings, transaction ordering, and D1 behavior unchanged. **`createMockD1Database` is used only by the database tests**: move this factory into `queries.test.ts`, not into the new production `queries.ts`.
2. Retarget API GraphQL, REST and service imports (including their direct-module mocks) to `../db/queries` / `../db/types` as appropriate. Trim D1 row/type/converter/schema/query re-exports from `packages/common/src/lib/server.ts` **in the same move commit** (the old barrel must not import moved files). Keep the Better Auth `src/auth/schema.ts` separate.
3. Move D1 test-only dependencies (notably `miniflare`) into `dtx-api`; use its existing Vitest `src/**/*.test.ts` discovery rather than another harness. Retarget mocks that previously intercepted query functions via `@dtx/common/server`, and run affected API test files **one at a time** as the module paths change.
4. Rebase the real-D1 test's migration directory lookup to `packages/dtx-api/d1-migrations`. The test must still apply numbered migrations including `0007_score_semantics.sql` and `0008_better_auth.sql`. Update the **comments only** in `0002_scores.sql` and `0007_score_semantics.sql` that point to the old Drizzle schema path; preserve both migration files' SQL statements and names.
5. Run `bun run --filter=dtx-api test -- src/db/queries.integration.test.ts`, `bun run --filter=dtx-api test -- src/db/queries.test.ts`, `bun run --filter=dtx-api check` **and** `bun run --filter=@dtx/common check` before moving on. Check insert/replace semantics, partial unique score indexes, Drive-binding guards and auth-schema coexistence; resolve any Vitest 5→4 test issues without an upgrade.

**Exit:** all D1 queries and row types are API-local; no mock/test coverage was removed; real D1 remains exercised.

## Task 3 — Move R2, ZIP, rate limit and Worker logging

**Move/merge with existing tests:**
- Merge `common/src/lib/server/r2.ts` into **existing** `dtx-api/src/lib/r2Files.ts`, and its tests into **existing** `r2Files.test.ts` (do not create a second R2 module)
- `common/src/lib/server/rateLimiter*` → `dtx-api/src/lib/rateLimiter*`
- `common/src/lib/server/zipBuilder*` → `dtx-api/src/lib/zipBuilder*`
- `common/src/lib/server/workerLogger*` → `dtx-api/src/lib/workerLogger*`

1. Append the moved R2 listing/preview-key logic and its tests to **`src/lib/r2Files.ts` / `r2Files.test.ts`**. Keep existing key/preview/full-track selection behavior untouched. Use direct local imports; no second `r2.ts`, R2 facade or follow-up consolidation task.
2. Split the existing `vi.mock('@dtx/common/server', ...)` in **11 API test files** into mocks of the real query/R2/ZIP/KV/logger modules; several tests mix 3–4 symbols (`services/downloads.test.ts`), and `index.test.ts` / `services/uploads.test.ts` use factory-only barrel mocks. Preserve `vi.importActual` spreads where currently used and intentionally handle those factory-only mocks. A full R2-module mock can also replace `isPreviewKey` used by `zipBuilder`; keep needed real exports. **Retarget and run one test file at a time** before continuing, then verify services, REST handlers and Workflows use their correct local imports.
3. Move `workerLogger` and its tests to API first. Its JSON formatter currently serializes raw `Error` to `{}`; add Winston's `Error` replacer (`{ message, stack }`) and an explicit logged-error regression assertion. Replace Winston `logger` calls in moved KV/R2/ZIP modules with this logger; for `zipBuilder.ts`'s two positional error calls, use `{ error }` so they typecheck and preserve diagnostics. Leave unrelated API manual error formatters unchanged. Delete common's Winston `logger.ts` and test only after the last import is removed.
4. Keep ZIP entry order, streaming, safety checks and CRC behavior; keep KV bandwidth-window calculations and R2 pagination identical. `zipBuilder.test.ts` uses `jszip` to inspect generated ZIPs: ensure the API test package declares it. **Remove the corresponding Winston, KV, R2, ZIP, and Worker logger re-exports from `common/src/lib/server.ts` in the same commits as each move**, leaving only pure chart/decoder/constants re-exports for Task 4.
5. Run focused `dtx-api` unit tests for R2, ZIP, KV rate limiting, Worker logging, download/score/upload routes, BGM workflows, then its full API test suite and `bun run --filter=@dtx/common check`. Each move checkpoint must leave both packages buildable.

**Exit:** Cloudflare infrastructure modules live only under `dtx-api`, with equivalent tests and no new logging package.

## Task 4 — Remove obsolete shared exports, aliases and dependencies

1. Export `decodeArrayBufferWithBomDetection` from `packages/common/src/lib/index.ts` (the pure helper already exists). Retarget **both** `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts` **and** `packages/dtx-api/src/services/r2Enrichment.ts` to import it from `@dtx/common`.
2. Confirm no other pure consumer remains after the decoder change, then delete the now-pure `packages/common/src/lib/server.ts` and `"./server"` from `packages/common/package.json`. Do not replace this export with compatibility forwarding; all former API infrastructure imports are local by this checkpoint.
3. Remove now-unused **`@dtx/common/server`** aliases from API Vitest/TS/Wrangler, common/desktop Vitest/Vite and other current config. **Keep the new source-backed `@dtx/common` aliases in all three API resolvers.** Check alias matching and imports with no `common/dist`; update stale source comments.
4. Remove `drizzle-orm`, `winston` and `miniflare` from common only if its remaining source/tests no longer use them. **Keep common `jszip`**, which `chart/simFile.ts` imports.
5. Remove `@aws-sdk/client-s3`, `drizzle-orm` and `winston` from web **only after confirming no real source/script imports**. Keep web `jszip` for `ExportWorkspaceModal.svelte`. Check root `jszip` is not required by root scripts before dropping the duplicate declaration. Regenerate `bun.lock` mechanically; avoid unrelated upgrade churn.
6. **Prove API independence from generated common output:** from a clean tree after dependency setup, run `rm -rf packages/common/dist && bun run --filter=dtx-api check && bun run --filter=dtx-api build` (API's Wrangler build is dry-run). This must work because Vitest, TS and Wrangler alias `@dtx/common` to **source**, not to `dist`. Fix any main-barrel `svelte/store` type issues directly; do not add `^build` to Turbo or fall back to built exports. Then build/check/test common normally for broader verification.

**Exit:** no obsolete shared server entrypoint or aliases, dependency declarations reflect real imports, and shared decoder remains available to the web server.

## Task 5 — Update current guidance and validate as one PR

**Docs:** edit `CLAUDE.md` once (`AGENTS.md` is a symlink). Do not rewrite historical `docs/superpowers` plans or migration runbooks merely to conceal history.

1. Correct the workspace count to eight and list `packages/infrastructure`; explain ownership of D1/migrations/R2/KV and Worker-only helpers in `dtx-api`.
2. The current `CLAUDE.md` **already correctly names Better Auth**; don't invent a Supabase cleanup. Focus on confirmed stale lines: workspace count (`:7`), `./server` export (`:137`), and old `localStorage.removeItem('auth_session')` cache guidance (`:205`). Describe web/API service binding and desktop Device Authorization/Bearer sessions only where guidance is incomplete.
3. Update import examples and package descriptions to avoid `@dtx/common/server`. Correct manual-only Worker deployment claims (`CLAUDE.md:90`, `:319`, `:336`): the Git-connected Cloudflare Workers Builds bot already reported success for both production-labeled web/API builds on this PR. **Verify actual build-vs-deploy/promotion behavior in the Cloudflare setup** before documenting automation; do not assert that deploys are manual-only or that every PR build publishes production.
4. Repeat the clean-output API check from Task 4.6 **before** building common, then run after dependency reinstall/lockfile update:
   - `bun run --filter=@dtx/common build`
   - `bun run --filter=@dtx/common check` and `bun run --filter=@dtx/common test`
   - `bun run --filter=dtx-api check`, `bun run --filter=dtx-api test` and `bun run --filter=dtx-api build` (Worker dry run)
   - `bun run --filter=dtx-web check`, `bun run --filter=dtx-web test` and `bun run --filter=dtx-web build`
   - `bun run --filter=dtx-desktop typecheck` and `bun run --filter=dtx-desktop test`
   - `bun run lint` and `bun run check`
5. Run relevant web E2E for sign-in, chart listing/editor set.def, scores, and downloads; check desktop E2E/smoke for cloud chart/score/download paths where the existing CI matrix supports it. Do not run migrations/deployments; no schema or infrastructure should change.
6. Review `git diff` for mechanical scope: **no D1 migration SQL statement/schema** or GraphQL/API response changes (comment-only migration references allowed), no dependency version campaign, no new abstraction, no duplicate R2 exports. Confirm the source aliases in API TS/Vitest/Wrangler and `rg '@dtx/common/server' packages` are clean, tests remain discoverable, and Codecov reflects moved paths.
7. Update this *same draft PR* with implementation commits, evidence, and exact test results. Mark ready for review when relevant CI passes. Update HPA-617 with the single PR link and close on merge.

**Exit:** one reviewable PR contains design, plan, mechanical refactor and verification proof.

## Stop conditions / corrections

- If a production consumer needs a pure shared server utility, retain it in common; **never** make web/desktop import API implementation solely to achieve deletion of a path.
- If moving the test requires a new generic testing platform, preserve the existing in-repo Miniflare test setup under `dtx-api`; do not expand scope.
- If `jszip` or another dependency is still truly used, keep it. Only remove dependencies verified unused.
- If a change alters public behavior or requires a schema migration, isolate the finding as a review note rather than silently widening HPA-617. **Comment-only** updates to existing D1 migration path references are permitted; no SQL changes.
