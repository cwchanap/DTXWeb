# HPA-617 — API Infrastructure Ownership Cleanup: Design Spec

**Status:** Proposed; documentation-only draft, to be implemented in this *same* PR.
**Linear:** https://linear.app/cwchanap/issue/HPA-617
**Baseline:** `main` reviewed 2026-11-03. No runtime code is changed by this planning commit.

## Problem and evidence

DTXWeb has completed its application/API and Better Auth migrations (auth implementation merged in PR #240), but `@dtx/common/server` still exports D1/Drizzle repositories, D1 row/score types, a database mock, Cloudflare KV rate limiting, R2 discovery, Worker logging, and ZIP-streaming code. `dtx-api` is the actual consumer of that infrastructure, yet its imports point back into the shared UI/chart package.

This ownership inversion increases incidental dependencies and test coupling:

- `packages/common/src/lib/server/db.ts`, `server/db/schema.ts` and `types/d1.types.ts` own API database code, while D1 migrations and Better Auth already live in `packages/dtx-api`.
- The real-D1/Miniflare tests and mocked D1 query tests are housed in `packages/common`, despite validating API persistence.
- `server/r2.ts`, `server/rateLimiter.ts`, `server/zipBuilder.ts`, and `server/workerLogger.ts` implement Cloudflare/API concerns.
- `server/logger.ts` is Winston-backed and used only by the above server utilities; `dtx-api` already uses `workerLogger` elsewhere.
- The web editor (`packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts`) **and** the API's `src/services/r2Enrichment.ts` use the pure `decodeArrayBufferWithBomDetection` through `@dtx/common/server`. Both must use the shared source-backed `@dtx/common` export after cleanup; the web app must not depend on API internals.
- `dtx-api` currently aliases only `@dtx/common/server` to source in `vitest.config.ts`, `tsconfig.json`, and `wrangler.jsonc`. Importing the main `@dtx/common` export without a source alias would instead require prebuilt `packages/common/dist`, breaking independent API checks, local Wrangler and Git-connected Workers Builds.
- The monorepo now has **eight** Bun workspaces including `packages/infrastructure`, whereas `CLAUDE.md` says seven. Auth is already Better Auth on D1, not Supabase.
- `packages/dtx-web/package.json` still declares potentially unused `@aws-sdk/client-s3`, `drizzle-orm`, and `winston`; `jszip` is still used by the editor's export modal and the common DTX parser, so it must not be removed blindly.

## Decision

Perform one mechanical ownership refactor. **Move API-specific implementations and tests into the existing `dtx-api` package; keep pure DTX/chart/notation/UI code in `@dtx/common`.** Delete unused imports, exports, aliases, dependencies and outdated *current* guidance as consumers move. Introduce no new package or generic data-access interface.

### Target ownership

| Current path | Intended destination | Notes |
| --- | --- | --- |
| `common/src/lib/server/db.ts` | `dtx-api/src/db/queries.ts` | Preserve SQL, batch order and error behavior; move test-only `createMockD1Database` into `queries.test.ts`, not production code |
| `common/src/lib/server/db/schema.ts` | `dtx-api/src/db/schema.ts` | Existing D1/Drizzle table definitions, not a new migration |
| `common/src/lib/types/d1.types.ts` | `dtx-api/src/db/types.ts` | Server-only D1 rows and API-facing `SimfileWithDtxFiles`; **not** the neutral `SimfileModel` |
| `common/src/lib/server/db.test.ts`, `db.integration.test.ts`, `common/src/lib/types/d1.types.test.ts` | `dtx-api/src/db/*.test.ts` | Retarget local import/mocks and D1 migration path; retain real D1 behavior |
| `common/src/lib/server/r2.ts` + tests | Merge into existing `dtx-api/src/lib/r2Files.ts` + `r2Files.test.ts` | One R2-key helper module; preserve `isPreviewKey` and existing preview/full-track behavior |
| `common/src/lib/server/rateLimiter.ts` + tests | `dtx-api/src/lib/rateLimiter.ts` + tests | Keep KV semantics unchanged |
| `common/src/lib/server/zipBuilder.ts` + tests | `dtx-api/src/lib/zipBuilder.ts` + tests | Keep stream/CRC/ordering/security behavior and tests |
| `common/src/lib/server/workerLogger.ts` + tests | `dtx-api/src/lib/workerLogger.ts` + tests | Preserve Winston's `{ message, stack }` serialization for Error metadata and add a regression test |
| `common/src/lib/server/logger.ts` + tests | Delete after switching internal callers to the existing Worker logger | Remove Winston only after verifying no live consumer |
| `common/src/lib/server.ts` and `@dtx/common/server` export | Trim exports alongside each move, then delete | Expose pure buffer decoding from main `@dtx/common`, retarget web editor **and API** decoder imports; never leave intermediate broken re-exports |

The exact API paths may be adjusted during implementation to reuse an existing directory, **not** to add new layers. API source/test imports should use relative paths within `dtx-api`; ordinary cross-package chart/notation imports stay on `@dtx/common`.

### Invariants

1. Application behavior, GraphQL schema, REST routes, auth behavior, score replacement transactions, D1 migration **statements**, R2 key handling, ZIP byte content, KV limits, and error diagnostics remain unchanged. Comment-only migration reference corrections are permitted.
2. No `dtx-api` source imports D1/Drizzle, R2, KV, ZIP, or logger code through `@dtx/common/server` after the move.
3. `dtx-web` and desktop do not import `dtx-api` implementation modules. The editor keeps a pure, shared decoder.
4. The neutral `SimfileModel` and common chart/notation/UI modules remain application-facing and free of API-specific D1 row types.
5. The existing real-D1 test still executes the actual numbered migrations and tests score constraints; no new Miniflare harness or persistence abstraction.
6. No compatibility forwarding exports remain for removed internal paths; fix all consumers atomically in this single PR.

### Dependency and configuration treatment

- Move `miniflare` test dependency to `dtx-api` if tests require it; move `jszip` test dependency there if its ZIP tests require it. Keep `jszip` in `@dtx/common` (DTX parser) and `dtx-web` (workspace export).
- Remove `drizzle-orm` and `winston` from `@dtx/common` only after their remaining imports vanish. `dtx-api` already has `drizzle-orm`.
- Inspect `dtx-web`, root manifests, and scripts before removing any unused `@aws-sdk/client-s3`, `drizzle-orm`, `winston` or duplicate root `jszip` declarations. Do **not** combine unrelated dependency upgrades.
- Establish a source-backed `@dtx/common` alias in **all three** API resolvers (`vitest.config.ts`, `tsconfig.json`, `wrangler.jsonc`) before consumers switch. During intermediate commits, retain the existing, more specific `@dtx/common/server` alias until all its imports are removed; then delete it. Never introduce a `common/dist` prerequisite for API check, Wrangler dev, or Workers Builds. Verify API check and dry-run build with `common/dist` absent.
- Trim `common/src/lib/server.ts` re-exports in the **same commit** that moves their implementations, so each task leaves imports and typechecks viable. The final deletion happens only after the two decoder consumers have switched.
- Update stale Drizzle schema path references in `0002_scores.sql` and `0007_score_semantics.sql` **comments only**; leave SQL statements and migration filenames untouched.
- Update `CLAUDE.md`, which is the target of the `AGENTS.md` symlink, once. Describe eight workspaces, `dtx-api` ownership of D1/R2/KV/Worker operations, `dtx-web` via API/service binding, current Better Auth identity/session flows, and correct cache/deployment guidance. Preserve historical specs/plans as history; do not bulk-rewrite them.

## Alternatives rejected

**Leave code in `@dtx/common/server`:** zero short-term work but maintains false ownership and unnecessary Drizzle/Worker/Winston dependency surface. Rejected because this is precisely the maintenance debt tracked in HPA-617.

**Create `@dtx/server` or a general repository abstraction:** introduces another package and more indirection with no second consumer. Rejected under KISS/YAGNI.

**Change databases, auth, GraphQL, caching, or runtime deployment:** no evidence this cleanup requires a behavioral redesign. Out of scope.

## Risks and mitigations

- **Test relocation:** moving Miniflare tests changes their relative path to `dtx-api/d1-migrations` and the Vitest test discovery boundary. Retarget the fixture path explicitly; run focused real-D1 tests before broader suites.
- **Mock identity:** Eleven API test files mock the old `@dtx/common/server` barrel, including mixed D1/R2/ZIP mocks. Split mocks by actual module incrementally, preserving `vi.importActual` spreads where present; retarget and run one test file at a time. Beware that whole-module R2 mocks can replace `isPreviewKey` used internally by ZIP. Existing `index.test.ts` and `services/uploads.test.ts` use factory-only mocks; do not assume partial mocks there.
- **Log formatting:** current Worker JSON serialization turns raw `Error` values into `{}`. On move, preserve Winston-style `{ message, stack }` serialization in `workerLogger` and adapt two positional ZIP logger calls to `{ error }`; test the emitted payload. Keep unrelated manual error-formatting workarounds untouched.
- **Shared parser/SSR and CI:** verify `decodeArrayBufferWithBomDetection` from the main `@dtx/common` entrypoint with web SSR and API typecheck/build; if the main barrel's Svelte imports create type errors, resolve them without falling back to built `dist`. The two packages currently use different Vitest major versions (common 5, API 4); run the moved tests without an unrelated upgrade.
- **Lockfile/CI:** mechanically regenerate the Bun lockfile; verify no unexpected build dependency on `common/dist` using a clean-output API check/dry-run build. GitHub's Cloudflare Workers Builds bot reported successful **production-labeled builds** for both workers on this PR; confirm the actual Git integration/deployment configuration before rewriting `CLAUDE.md`'s manual-only deployment claims. Never deploy as part of this cleanup.

## Acceptance criteria

- API-only source, test helpers, D1 row types and infrastructure dependencies reside in `dtx-api`, with passing API unit/integration tests.
- `@dtx/common` retains chart/notation/game/UI code and its genuinely needed parser dependencies; its `./server` export is absent only after all live consumers have moved.
- No runtime references to removed `@dtx/common/server` APIs, dead aliases or stale package dependencies remain.
- Current architecture and operational instructions reflect Better Auth, eight workspaces, and API ownership.
- API, common, web and desktop checks/builds plus relevant web/Desktop E2E or smoke cases pass. No deployment/database migration is required.

## Delivery

Use **one draft PR for HPA-617**: review this spec and the adjacent plan, commit all implementation and test changes onto this same branch, then mark the PR ready for review. Do not merge a planning-only PR and open a second implementation PR.
