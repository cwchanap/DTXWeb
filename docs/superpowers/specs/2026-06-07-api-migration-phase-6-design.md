# API Migration Phase 6 — REST API decommission

**Date:** 2026-06-07
**Parent spec:** [docs/superpowers/specs/2026-05-16-api-server-migration-design.md](2026-05-16-api-server-migration-design.md)
**Phase 3 spec:** [docs/superpowers/specs/2026-05-25-api-migration-phase-3-design.md](2026-05-25-api-migration-phase-3-design.md) (dual-path `lib/api/`)
**Phase 4 spec:** [docs/superpowers/specs/2026-05-29-api-migration-phase-4-design.md](2026-05-29-api-migration-phase-4-design.md) (dual-path e2e parity gate)
**Packages/areas:** modifies `packages/dtx-web` (app code + `wrangler.jsonc`), `packages/dtx-api` (one new REST sidecar), `packages/common` (removes `assetFileService`), `e2e/`, `playwright.config.ts`, `.github/workflows/e2e-test.yml`. Moves `d1-migrations/` from `dtx-web` to `dtx-api`.

## Goal

Decommission the legacy REST API now that GraphQL is live in production. The `PUBLIC_USE_GRAPHQL_API` flag is already `"true"` in all three `dtx-web/wrangler.jsonc` stanzas (prod, pre-prod, pre-prod-prod-data), so the REST path in the dual-path `lib/api/` layer and all of `dtx-web/src/routes/api/` are dead weight in prod. This is **Phase 6 — Decommission** from the parent spec, delivered as a single PR.

After this phase: `dtx-web` carries no `lib/api` flag, no `routes/api/` endpoints, no `/api/` auth branch in `hooks.server.ts`, and no D1/R2/KV bindings. All chart/user/auth/download/asset data flows through `dtx-api` (GraphQL + REST sidecars). The e2e parity gate collapses from a two-leg matrix to a single GraphQL leg.

## Current state (start of Phase 6)

- **Flag is ON everywhere.** `PUBLIC_USE_GRAPHQL_API: "true"` in the prod, pre-prod, and pre-prod-prod-data stanzas of `packages/dtx-web/wrangler.jsonc`. Phase 5 cutover is effectively complete.
- **`dtx-web/src/lib/api/`** is the dual-path dispatch layer: `chart.ts`, `user.ts`, `auth.ts`, `rest/download.ts` each branch on `useGraphQL()` (exported from `client.ts`). The REST branch issues same-origin fetches to `/api/*`; the GraphQL branch uses `getClient()` (browser `graphql-request` client, or an SSR service-binding client). All flag-sensitive data calls are client-side.
- **`dtx-web/src/routes/api/`** holds 12 endpoints. Three groups:
    1. **Migrated** (REST branch now unreachable in prod): `chart` (list), `chart/[id]` (get/update), `simFile/delete/[simfileID]`, `user/profile`, `auth/generate-magic-link`, `simFile/download/[simfileID]`, `simFile/download/bulk`. `dtx-api` has GraphQL/REST-sidecar equivalents for all.
    2. **Still-live, un-migrated:** `GET /api/simFile/listFiles/[simfileID]`, called by `@dtx/common`'s `assetFileService.loadAssetFiles` from the chart detail page `(app)/app/chart/[id]/+page.svelte`. The `GetSimfile` GraphQL query already returns `files {key,size,uploaded}` + `hasUploadedFiles`, so this call-site is redundant.
    3. **Orphaned** (no callers anywhere — web UI, `@dtx/common`, or `dtx-desktop`): `chart/search`, `chart/next-display-id`, `simFile/upload`, `simFile/list/[simFileId]`. Desktop uses `dtx-api` GraphQL + Electron IPC.
- **`hooks.server.ts`** has an `/api/`-specific block: a public-route allowlist (published chart list/detail, listFiles, single + bulk download) and bearer-token validation for unauthenticated `/api/*` requests. Supabase cookie-session handling and the `/login` redirect are separate and stay.
- **Bindings in `dtx-web/wrangler.jsonc`:** `ASSETS`, `DTXFILE_BUCKET` (R2), `RATE_LIMIT` (KV), `DB` (D1, with `migrations_dir: "d1-migrations"`), and the `API` service binding (pre-prod stanzas only; prod uses `PUBLIC_DTX_API_URL`). Usage outside `routes/api/`:
    - `DB`: only via `lib/server/db.ts` `getDb`, which is only called by `routes/api/*`.
    - `RATE_LIMIT`: only `routes/api/*` (download rate limiting).
    - `DTXFILE_BUCKET`: `routes/api/*` **and** the editor SSR load `(game)/editor/[[simfileID]]/+page.server.ts`, which reads `${simfileID}/set.def` from R2 to parse chart metadata server-side. This is the one binding the spec's "remove all three" step did not account for.
- **`d1-migrations/`** lives in `packages/dtx-web/` (`0001_initial_schema.sql`). `dtx-api`'s D1 binding points at the same `database_name` (`dtx-web`/`dtx-web-preprod`) but `dtx-api` has no `migrations_dir` and no migrations directory.
- **e2e parity gate (Phase 4, merged):** `playwright.config.ts` + `.github/workflows/e2e-test.yml` run a `use_graphql: [false, true]` matrix. The OFF leg seeds `dtx-web`'s local Miniflare via adapter `platformProxy` (gated by `E2E_PLATFORM_PROXY` in `svelte.config.js`) and serves REST; the ON leg boots a seeded `dtx-api` via `wrangler dev`. `e2e/setup/prepare-stack.ts` seeds whichever backend the leg exercises. `e2e/next-display-id.spec.ts` asserts a 401 on `GET /api/chart/next-display-id`.
- `dtx-api` REST sidecars (`packages/dtx-api/src/index.ts`) are pathname-routed: `/healthz`, `/graphql`, `/downloads/bulk`, `/downloads/:id`, `/upload`. Handlers live in `packages/dtx-api/src/rest/` and are wrapped with `withCors` + `safeRoute`.

## Non-goals

- Changing `dtx-api` GraphQL/business logic or `verifyToken.ts` beyond adding the one `set.def` REST sidecar.
- Changing any deployed `PUBLIC_USE_GRAPHQL_API` value (already `"true"`).
- Removing `@dtx/common`'s `createMockD1Database` unless verified fully orphaned during implementation (it is a shared test utility; default is to leave it).
- Touching `dtx-desktop` (already hard-cut to GraphQL).
- Broadening e2e coverage. The gate keeps the same two journeys + existing tool specs, just on one leg.

## Design

### 1. Collapse `lib/api/` to GraphQL-only

Remove the `useGraphQL()` flag and every `if (!useGraphQL())` REST branch.

- **`chart.ts`** — keep only the GraphQL paths for `listSimfiles`, `getSimfile`, `updateSimfile`, `deleteSimfile`. Delete the REST fetch branches and the `fetchFn` helper if it becomes unused. `LegacySimfile`/`adaptSimfile` and the return shapes stay (consumers depend on them).
- **`user.ts`, `auth.ts`** — GraphQL-only; delete the REST branches.
- **`rest/download.ts` → move to `lib/api/download.ts`** — the directory name `rest/` no longer reflects reality (it now talks to `dtx-api`'s REST sidecars, not local routes). `downloadSimfile` always does the fetch+blob path against `${PUBLIC_DTX_API_URL}/downloads/:id` with a bearer header; `bulkDownloadBaseUrl`/`bulkDownloadHeaders` always target `dtx-api` + bearer. Delete the local-REST direct-`<a>`-click branch. Update `lib/api/index.ts` re-export path.
- **`client.ts`** — drop the `useGraphQL` export and the Phase 4 TODO comment. Keep `getClient()`: its non-browser service-binding branch (used on pre-prod stanzas with the `API` binding) and its browser branch both remain valid.
- **Tests** — `chart.test.ts`, `user.test.ts`, `auth.test.ts`, `download.test.ts`, `client.test.ts`: drop the flag-OFF (REST) assertions and `useGraphQL` toggling; keep the GraphQL-path assertions. These are the Phase 3 dual-path tests; after this phase they become single-path tests.

### 2. Re-point the live `listFiles` call-site; delete `assetFileService`

The chart detail page (`(app)/app/chart/[id]/+page.svelte`) already receives `simfile.files` (from the `SimfileWithFiles` fragment on `GetSimfile`). Replace the `loadAssetFiles(simfileId)` call passed to the `asset_files` snippet with an adapter that maps `simfile.files` (`{key, size, uploaded}`) to the `AssetFile` shape the consuming component expects (`{fileName, size, lastModified, key}`):

- `fileName` = basename of `key`
- `lastModified` = `uploaded`
- `size`, `key` pass through

Then delete `packages/common/src/lib/services/assetFileService.ts`, its export from the `@dtx/common` services barrel, and its tests. The `AssetFile` type (and any component consuming it) moves to wherever the adapter lives or is inlined on the page — implementation chooses the smallest change that keeps the component's props stable.

### 3. Migrate the editor's `set.def` read to `dtx-api`

`dtx-web` must lose its R2 dependency, so the editor's server-side `set.def` read moves to `dtx-api`.

- **New REST sidecar `GET /simfiles/:id/set.def`** on `dtx-api`: `packages/dtx-api/src/rest/setDef.ts` streams the R2 object `${id}/set.def` (404 if absent), `withCors`-wrapped, registered in `index.ts` alongside the download routes via a pathname regex. **Unauthenticated**, matching the editor's current public R2 read (no behavior change). Add `setDef.test.ts` mirroring `downloadSimfile.test.ts`.
- **Editor `(game)/editor/[[simfileID]]/+page.server.ts`** — replace `const bucket = platform?.env?.DTXFILE_BUCKET; ... bucket.get(`${simfileID}/set.def`)` with a server-side `fetch(`${apiBase}/simfiles/${simfileID}/set.def`)` (using the load's `fetch`), where `apiBase` is `PUBLIC_DTX_API_URL`. Keep `parseDefFileContent` and the BOM/encoding handling in the load; keep the 404 → `error(404)` behavior. The `!simfileID` local-file early-return is unchanged. The old `dev`/missing-bucket fallback (`metadata: null`) is preserved for the case where the fetch fails or returns 404 in dev, so the client-side fetch path still works.

### 4. Delete REST routes + strip the `/api/` branch in `hooks.server.ts`

- Delete all of `packages/dtx-web/src/routes/api/` — every `+server.ts` and colocated `*.test.ts`, including the orphans (`chart/search`, `chart/next-display-id`, `simFile/upload`, `simFile/list/[simFileId]`).
- Remove the entire `/api/`-specific block in `hooks.server.ts`: the public-route allowlist (`isPublicChartListRoute` … `isPublicApiRoute`) and the `if (!event.locals.session && event.url.pathname.startsWith('/api/'))` bearer-validation branch, plus now-unused helpers (`decodeJwtPayload` if only used there). Supabase cookie-session creation, `event.locals.session`/`user` from cookies, and the `/login` redirect stay untouched.

### 5. Remove bindings + move migrations

- **`dtx-web/wrangler.jsonc`** (all three stanzas): remove `d1_databases`, `r2_buckets`, `kv_namespaces`, the `RATE_LIMIT_ENV` var, and the `migrations_dir` (which lived inside `d1_databases`). Keep `ASSETS`, the `API` service binding (pre-prod stanzas), and the `PUBLIC_*` vars.
- **`dtx-web/src/app.d.ts`** — remove `DB`, `DTXFILE_BUCKET`, `RATE_LIMIT`, `RATE_LIMIT_ENV` from `App.Platform.env`. Keep `API` (and `ASSETS` if typed).
- **Delete `dtx-web/src/lib/server/db.ts`** (`getDb`) and its test — no callers remain after `routes/api/` is gone. Verify `@dtx/common`'s `createMockD1Database` has no remaining consumers; leave it in place if it's still used (e.g. by `dtx-api` tests).
- **Move migrations:** `git mv packages/dtx-web/d1-migrations packages/dtx-api/d1-migrations`; add `"migrations_dir": "d1-migrations"` to `dtx-api`'s `d1_databases` in all three stanzas of its `wrangler.jsonc`. Update any docs/scripts that reference the old path.

### 6. Collapse the e2e parity gate to a single GraphQL leg

With REST and dtx-web bindings gone, the flag-OFF leg cannot run.

- **`.github/workflows/e2e-test.yml`** — remove the `use_graphql` matrix and `E2E_USE_GRAPHQL` env; single run with the flag ON.
- **`playwright.config.ts`** — remove the `useGraphQL` branching. Always: seed + boot `dtx-api` (`wrangler dev`), run `dtx-web` with `PUBLIC_USE_GRAPHQL_API=true` + `PUBLIC_DTX_API_URL` pointed at the local `dtx-api`. Drop the `E2E_PLATFORM_PROXY` env and the dtx-web-seeding webServer command branch.
- **`e2e/setup/prepare-stack.ts`** — seed only `dtx-api`'s local Miniflare (drop the `dtx-web`/OFF branch and the leg-selection logic). Continue seeding the R2 download object; additionally seed a `set.def` R2 object if `editor.spec.ts` exercises a remote simfile load.
- **`svelte.config.js`** — remove the now-dead `E2E_PLATFORM_PROXY` `platformProxy` gate (revert the adapter block to the plain `{ fallback: 'plaintext' }`).
- **Delete `e2e/next-display-id.spec.ts`** — it asserts a 401 on the deleted `GET /api/chart/next-display-id`. `dtx-file-upload.spec.ts` is a browser-tool test (uploads into the in-page tool, not the deleted upload route) and is unaffected.

### 7. Verification

- `bun run --filter=dtx-web check` (Svelte/TS) — the gated `platformProxy` removal and binding-type removal must not break types.
- `bun run --filter=dtx-web test`, `bun run --filter=@dtx/common test`, `bun run --filter=dtx-api test` — all green; deleted-route tests are gone, dual-path tests are now single-path.
- `bun run lint`.
- e2e single-path gate green (`bunx playwright test`), both journeys + tool specs.

### Sequencing / blast radius

`dtx-api`'s new `set.def` sidecar should be deployed before `dtx-web` is redeployed without its R2 binding, so the editor's remote `set.def` fetch has a live target. The migrations-directory move and binding removal are deployed-config changes; they take effect on the next `dtx-web` / `dtx-api` deploy (manual, per CLAUDE.md). The code changes (lib/api collapse, route deletion, hooks strip, e2e collapse) are inert with respect to the still-`true` flag and can merge independently of the deploy ordering, but the PR documents the deploy order: **(1) deploy `dtx-api` with `set.def`, (2) deploy `dtx-web` without bindings.**

## Risks & mitigations

| Risk                                                                                   | Mitigation                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor `set.def` fetch has no target if `dtx-web` ships before `dtx-api`'s new sidecar | Deploy order pinned: `dtx-api` first, then `dtx-web`. The editor also retains the `metadata: null` fallback (client-side fetch) if the server fetch fails.                                                |
| R2 binding removed but some other path still reads it                                  | Verified: only `routes/api/*` (deleted) and the editor load (migrated) use `DTXFILE_BUCKET`. Re-grep during implementation before removing the binding.                                                   |
| `createMockD1Database` or other shared util orphaned/over-deleted                      | Only delete `dtx-web/src/lib/server/db.ts`; leave `@dtx/common`'s mock unless a repo-wide grep proves it unused.                                                                                          |
| `listFiles` shape mismatch breaks the asset-files UI                                   | The adapter maps `{key,size,uploaded}` → `{fileName,size,lastModified,key}` so the consuming component's props are unchanged. Covered by the existing chart detail rendering + the e2e lifecycle journey. |
| e2e collapse hides a regression that the OFF leg used to catch                         | The OFF leg only ever proved the REST path, which is being deleted; the GraphQL leg is the production path. No coverage of shipped behavior is lost.                                                      |
| Migrations dir move breaks local/CI D1 setup                                           | `dtx-api` gains `migrations_dir`; both `wrangler.jsonc` files updated atomically in the same PR; `prepare-stack.ts` migration path updated to the new location.                                           |

## Done criteria

- `dtx-web/src/lib/api/` has no `useGraphQL` flag and no REST branches; `download.ts` lives at `lib/api/download.ts`; tests pass as single-path.
- `dtx-web/src/routes/api/` is deleted; `hooks.server.ts` has no `/api/` block; `lib/server/db.ts` is deleted.
- The chart detail page renders asset files from `simfile.files` (GraphQL); `@dtx/common`'s `assetFileService` is removed.
- `dtx-api` serves `GET /simfiles/:id/set.def`; the editor load reads `set.def` from `dtx-api`; `dtx-web` references no R2/D1/KV binding in code or `app.d.ts`.
- `dtx-web/wrangler.jsonc` has no `d1_databases`/`r2_buckets`/`kv_namespaces`/`migrations_dir` in any stanza; `d1-migrations/` lives under `packages/dtx-api/` with `migrations_dir` set in `dtx-api`'s three stanzas.
- e2e runs a single GraphQL leg; the `use_graphql` matrix and `E2E_PLATFORM_PROXY` gate are gone; `next-display-id.spec.ts` is deleted.
- `dtx-web` check + all package unit suites + `bun run lint` + the e2e gate pass.
- No `PUBLIC_USE_GRAPHQL_API` value changes (remains `"true"`).
