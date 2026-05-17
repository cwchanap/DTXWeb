# API Migration Phase 0 — Extract Shared Server Code

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the D1/R2/KV server-side modules from `packages/dtx-web/src/lib/server/` into `@dtx/common/src/lib/server/` so the new `packages/dtx-api` Worker (built in later phases) can share them with `dtx-web`. No behavioural change — every existing test must still pass.

**Architecture:** Five files (`logger`, `rateLimiter`, `r2`, `zipBuilder`, `db` + its `db/schema` subfile) move one at a time, in dependency order. `getDb(platform)` — the only SvelteKit-coupled symbol — stays in `dtx-web` as a thin wrapper around the new shared `createMockD1Database()`. All other functions are pure D1/R2/KV consumers and move wholesale. Each move is one PR-sized commit: move file + test, fix internal imports, re-export from `@dtx/common/src/lib/server.ts`, find-and-replace consumer imports across `dtx-web`, run all tests, commit.

**Tech Stack:** TypeScript, Drizzle ORM, `@cloudflare/workers-types`, Winston, Vitest, Bun workspaces, SvelteKit. `@dtx/common` uses `svelte-package` for its build output.

**Spec:** `docs/superpowers/specs/2026-05-16-api-server-migration-design.md` (Phase 0 section).

---

## File Structure (end state)

```
packages/common/
├── package.json                                     ← add drizzle-orm + winston deps,
│                                                       add @cloudflare/workers-types devDep
└── src/lib/
    ├── server.ts                                    ← extend: re-export everything moved
    └── server/                                      ← NEW directory
        ├── logger.ts                                ← moved from dtx-web
        ├── logger.test.ts                           ← moved
        ├── rateLimiter.ts                           ← moved; internal import to './logger'
        ├── rateLimiter.test.ts                      ← moved
        ├── r2.ts                                    ← moved; internal import to './logger'
        ├── r2.test.ts                               ← moved
        ├── zipBuilder.ts                            ← moved; internal imports to './r2','./logger'
        ├── zipBuilder.test.ts                       ← moved
        ├── db.ts                                    ← moved (queries only; no getDb wrapper)
        ├── db.test.ts                               ← moved (queries tests only)
        └── db/
            └── schema.ts                            ← moved

packages/dtx-web/
└── src/lib/server/
    ├── db.ts                                        ← shrunk: only getDb(platform) wrapper
    └── db.test.ts                                   ← shrunk: only getDb tests
    (logger.ts, r2.ts, rateLimiter.ts, zipBuilder.ts, db/schema.ts are deleted)
```

Routes in `dtx-web/src/routes/api/**` keep `import { getDb } from '$lib/server/db'` (the wrapper) and switch every other server import to `from '@dtx/common/server'`.

---

## Task 1: Add runtime dependencies to `@dtx/common`

**Files:**

- Modify: `packages/common/package.json`

`@dtx/common` will host `db.ts` (uses `drizzle-orm`), `logger.ts` (uses `winston`), and various R2/D1 types (`@cloudflare/workers-types`). None of these are deps today.

- [ ] **Step 1: Inspect current deps**

Run: `cat packages/common/package.json | grep -A2 -E 'dependencies|devDependencies'`

Confirm `drizzle-orm`, `winston`, `@cloudflare/workers-types` are **not** listed.

- [ ] **Step 2: Add `drizzle-orm` and `winston` to `dependencies`**

Edit `packages/common/package.json` — inside the existing `"dependencies"` object (currently just `"jszip": "^3.10.1"`), add two entries to match `dtx-web`'s versions (verify with `cat packages/dtx-web/package.json | grep -E 'drizzle-orm|winston'`):

```json
"dependencies": {
    "drizzle-orm": "^0.44.5",
    "jszip": "^3.10.1",
    "winston": "^3.17.0"
}
```

- [ ] **Step 3: Add `@cloudflare/workers-types` to `devDependencies`**

In the same file, inside the existing `"devDependencies"` object, add:

```json
"@cloudflare/workers-types": "^4.20250620.0"
```

(Verify the version against `packages/dtx-web/package.json`.)

- [ ] **Step 4: Install**

Run: `bun install`

Expected: dependencies installed; no errors. `bun.lock` updated.

- [ ] **Step 5: Type-check passes**

Run: `bun run --filter=@dtx/common check`

Expected: 0 errors. (We haven't moved any files yet, so this only verifies the dependency additions don't break the current build.)

- [ ] **Step 6: Commit**

```bash
git add packages/common/package.json bun.lock
git commit -m "chore(common): add drizzle-orm, winston, workers-types deps

Prerequisite for Phase 0 of the API server migration — moves
shared D1/R2/KV utilities from dtx-web into @dtx/common/server."
```

---

## Task 2: Move `logger.ts`

**Files:**

- Create: `packages/common/src/lib/server/logger.ts` (via `git mv`)
- Create: `packages/common/src/lib/server/logger.test.ts` (via `git mv`)
- Delete: `packages/dtx-web/src/lib/server/logger.ts`
- Delete: `packages/dtx-web/src/lib/server/logger.test.ts`
- Modify: `packages/common/src/lib/server.ts`
- Modify (many): every dtx-web file that imports `$lib/server/logger`

`logger.ts` is a leaf — it depends only on `winston`. Move it first; everything else will eventually depend on it.

- [ ] **Step 1: Add an explicit SvelteKit alias for `@dtx/common/server` so dev/test resolves to source**

`packages/dtx-web/svelte.config.js` already aliases `@dtx/common` to `../common/src/lib`, but the project also has an explicit file alias for `@dtx/common/components` (suggesting prefix-only resolution doesn't auto-resolve to `.ts`). To avoid any resolution ambiguity, add the same explicit alias for the new `server` subpath.

Open `packages/dtx-web/svelte.config.js` and find:

```js
alias: {
    '@': './src',
    '@dtx/common/components': '../common/src/lib/components.ts',
    '@dtx/common': '../common/src/lib'
}
```

Replace with:

```js
alias: {
    '@': './src',
    '@dtx/common/components': '../common/src/lib/components.ts',
    '@dtx/common/server': '../common/src/lib/server.ts',
    '@dtx/common': '../common/src/lib'
}
```

This is a one-time change covering Tasks 2–6.

- [ ] **Step 2: Move logger + test with git mv**

```bash
mkdir -p packages/common/src/lib/server
git mv packages/dtx-web/src/lib/server/logger.ts packages/common/src/lib/server/logger.ts
git mv packages/dtx-web/src/lib/server/logger.test.ts packages/common/src/lib/server/logger.test.ts
```

- [ ] **Step 3: Add named re-export to `@dtx/common/src/lib/server.ts`**

Open `packages/common/src/lib/server.ts`. At the bottom of the file, append:

```ts
// Re-export server-side runtime utilities (D1, R2, KV)
export { default as logger } from './server/logger';
```

(The file already contains DTX/SimFile/D1-type exports; this is additive.)

- [ ] **Step 4: Verify common package still builds + tests pass**

Run: `bun run --filter=@dtx/common check`
Expected: 0 errors.

Run: `bun run --filter=@dtx/common test`
Expected: `logger.test.ts` passes (existing tests).

- [ ] **Step 5: Update every dtx-web import of `$lib/server/logger`**

Find all sites:

```bash
grep -rn "from '\$lib/server/logger'" packages/dtx-web/src
```

For each match, change:

```ts
import logger from '$lib/server/logger';
```

to:

```ts
import { logger } from '@dtx/common/server';
```

(One line per file. The known set of files at the time of writing:

- `packages/dtx-web/src/routes/api/chart/+server.ts`
- `packages/dtx-web/src/routes/api/chart/[id]/+server.ts`
- `packages/dtx-web/src/routes/api/chart/next-display-id/+server.ts`
- `packages/dtx-web/src/routes/api/chart/search/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/upload/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/delete/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/list/[simFileId]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/listFiles/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/user/profile/+server.ts`
- `packages/dtx-web/src/routes/api/chart/server.test.ts`
- `packages/dtx-web/src/routes/api/chart/[id]/server.test.ts`
- `packages/dtx-web/src/routes/api/chart/next-display-id/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/list/[simFileId]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/listFiles/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/upload/server.utils.test.ts`
- `packages/dtx-web/src/lib/server/db.ts` (when this file imports logger — currently it doesn't, but `r2.ts`, `rateLimiter.ts`, `zipBuilder.ts` do; those are next tasks)
- `packages/dtx-web/src/lib/server/r2.ts`
- `packages/dtx-web/src/lib/server/rateLimiter.ts`
- `packages/dtx-web/src/lib/server/zipBuilder.ts`

Re-run the grep after edits and confirm zero hits.)

- [ ] **Step 6: Type-check dtx-web**

Run: `bun run --filter=dtx-web check`
Expected: 0 errors.

- [ ] **Step 7: Run all tests**

Run: `bun run --filter=@dtx/common test`
Expected: pass.

Run: `bun run --filter=dtx-web test`
Expected: all server.test.ts files pass without changes.

- [ ] **Step 8: Verify no stale logger imports remain**

Run: `grep -rn "from '\$lib/server/logger'" packages/dtx-web/src`
Expected: no matches.

Run: `grep -rn "from '\$lib/server/logger'" packages/common/src`
Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add packages/common/src/lib/server.ts packages/common/src/lib/server/ packages/dtx-web/svelte.config.js packages/dtx-web/src
git commit -m "refactor: move logger to @dtx/common/server

First leaf module moved as part of Phase 0 of the API server
migration. The new dtx-api Worker will share this logger."
```

---

## Task 3: Move `rateLimiter.ts`

**Files:**

- Create: `packages/common/src/lib/server/rateLimiter.ts` (via `git mv`)
- Create: `packages/common/src/lib/server/rateLimiter.test.ts` (via `git mv`)
- Delete: `packages/dtx-web/src/lib/server/rateLimiter.ts`
- Delete: `packages/dtx-web/src/lib/server/rateLimiter.test.ts`
- Modify: `packages/common/src/lib/server/rateLimiter.ts` (internal import)
- Modify: `packages/common/src/lib/server.ts`
- Modify: `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- Modify: `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- Modify: `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`
- Modify: `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`

`rateLimiter.ts` depends on `logger.ts` (already moved). Two production callers and two test callers.

- [ ] **Step 1: Move files**

```bash
git mv packages/dtx-web/src/lib/server/rateLimiter.ts packages/common/src/lib/server/rateLimiter.ts
git mv packages/dtx-web/src/lib/server/rateLimiter.test.ts packages/common/src/lib/server/rateLimiter.test.ts
```

- [ ] **Step 2: Fix internal import in moved file**

Open `packages/common/src/lib/server/rateLimiter.ts`. Change line 2 from:

```ts
import logger from '$lib/server/logger';
```

to:

```ts
import logger from './logger';
```

- [ ] **Step 3: Fix internal import in moved test (if any)**

Open `packages/common/src/lib/server/rateLimiter.test.ts`. Replace any `$lib/server/...` paths with relative `./...` paths. Verify:

```bash
grep -n "\\\$lib/server" packages/common/src/lib/server/rateLimiter.test.ts
```

Expected: no matches.

- [ ] **Step 4: Extend `@dtx/common/src/lib/server.ts`**

Append:

```ts
export { getClientIp, tryConsumeRateLimit, type RateLimitResult } from './server/rateLimiter';
```

- [ ] **Step 5: Verify common still builds + tests pass**

Run: `bun run --filter=@dtx/common check && bun run --filter=@dtx/common test`
Expected: pass.

- [ ] **Step 6: Update dtx-web consumer imports**

Find all sites:

```bash
grep -rn "from '\$lib/server/rateLimiter'" packages/dtx-web/src
```

In each match, change:

```ts
import { getClientIp, tryConsumeRateLimit } from '$lib/server/rateLimiter';
```

to:

```ts
import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
```

Known files:

- `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`

- [ ] **Step 7: Type-check and test**

Run: `bun run --filter=dtx-web check`
Expected: 0 errors.

Run: `bun run --filter=dtx-web test`
Expected: pass.

Run: `grep -rn "from '\$lib/server/rateLimiter'" packages/dtx-web/src`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add packages/common/src/lib/server.ts packages/common/src/lib/server/ packages/dtx-web/src
git commit -m "refactor: move rateLimiter to @dtx/common/server

Phase 0 of the API server migration."
```

---

## Task 4: Move `r2.ts`

**Files:**

- Create: `packages/common/src/lib/server/r2.ts` (via `git mv`)
- Create: `packages/common/src/lib/server/r2.test.ts` (via `git mv`)
- Delete: `packages/dtx-web/src/lib/server/r2.ts`
- Delete: `packages/dtx-web/src/lib/server/r2.test.ts`
- Modify: `packages/common/src/lib/server/r2.ts` (internal import)
- Modify: `packages/common/src/lib/server.ts`
- Modify (consumers): `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`, `.../download/[simfileID]/+server.ts`, `.../chart/+server.ts`, and their `server.test.ts` siblings

`r2.ts` depends on `logger.ts` (already moved). Used by `zipBuilder.ts` (will be moved next) and by route handlers.

- [ ] **Step 1: Move files**

```bash
git mv packages/dtx-web/src/lib/server/r2.ts packages/common/src/lib/server/r2.ts
git mv packages/dtx-web/src/lib/server/r2.test.ts packages/common/src/lib/server/r2.test.ts
```

- [ ] **Step 2: Fix internal import in moved file**

Open `packages/common/src/lib/server/r2.ts`. Change line 2 from:

```ts
import logger from '$lib/server/logger';
```

to:

```ts
import logger from './logger';
```

- [ ] **Step 3: Fix imports in moved test**

```bash
grep -n "\\\$lib/server" packages/common/src/lib/server/r2.test.ts
```

Replace any matches with relative paths (e.g. `from '$lib/server/r2'` → `from './r2'`).

- [ ] **Step 4: Extend `@dtx/common/src/lib/server.ts`**

Append:

```ts
export { isPreviewKey, listAllR2Objects, type R2ObjectMeta } from './server/r2';
```

- [ ] **Step 5: Verify common builds + tests pass**

Run: `bun run --filter=@dtx/common check && bun run --filter=@dtx/common test`
Expected: pass.

- [ ] **Step 6: Update consumer imports**

Run:

```bash
grep -rn "from '\$lib/server/r2'" packages/dtx-web/src
```

In each match, change:

```ts
import { isPreviewKey, listAllR2Objects } from '$lib/server/r2';
import type { R2ObjectMeta } from '$lib/server/r2';
```

to:

```ts
import { isPreviewKey, listAllR2Objects, type R2ObjectMeta } from '@dtx/common/server';
```

(Some files import only `isPreviewKey` or only `listAllR2Objects` — keep their existing named-import lists, just swap the source path.)

Known files:

- `packages/dtx-web/src/lib/server/zipBuilder.ts` (will move in Task 5; still needs to compile now)
- `packages/dtx-web/src/routes/api/chart/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`

- [ ] **Step 7: Type-check and test**

Run: `bun run --filter=dtx-web check && bun run --filter=dtx-web test`
Expected: pass.

Run: `grep -rn "from '\$lib/server/r2'" packages/dtx-web/src packages/common/src`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add packages/common/src/lib/server.ts packages/common/src/lib/server/ packages/dtx-web/src
git commit -m "refactor: move r2 to @dtx/common/server

Phase 0 of the API server migration."
```

---

## Task 5: Move `zipBuilder.ts`

**Files:**

- Create: `packages/common/src/lib/server/zipBuilder.ts` (via `git mv`)
- Create: `packages/common/src/lib/server/zipBuilder.test.ts` (via `git mv`)
- Delete: `packages/dtx-web/src/lib/server/zipBuilder.ts`
- Delete: `packages/dtx-web/src/lib/server/zipBuilder.test.ts`
- Modify: `packages/common/src/lib/server/zipBuilder.ts` (internal imports)
- Modify: `packages/common/src/lib/server.ts`
- Modify (consumers): `.../download/[simfileID]/+server.ts`, `.../download/bulk/+server.ts`, and their `server.test.ts` siblings

`zipBuilder.ts` depends on `r2.ts` and `logger.ts` (both moved).

- [ ] **Step 1: Move files**

```bash
git mv packages/dtx-web/src/lib/server/zipBuilder.ts packages/common/src/lib/server/zipBuilder.ts
git mv packages/dtx-web/src/lib/server/zipBuilder.test.ts packages/common/src/lib/server/zipBuilder.test.ts
```

- [ ] **Step 2: Fix internal imports in moved source**

Open `packages/common/src/lib/server/zipBuilder.ts`. Change the top imports from:

```ts
import { isPreviewKey } from '$lib/server/r2';
import logger from '$lib/server/logger';
import type { R2ObjectMeta } from '$lib/server/r2';
```

to:

```ts
import { isPreviewKey } from './r2';
import logger from './logger';
import type { R2ObjectMeta } from './r2';
```

- [ ] **Step 3: Fix internal imports in moved test**

```bash
grep -n "\\\$lib/server" packages/common/src/lib/server/zipBuilder.test.ts
```

For each match, replace `$lib/server/<name>` with `./<name>` (e.g. `from '$lib/server/zipBuilder'` → `from './zipBuilder'`, `from '$lib/server/r2'` → `from './r2'`).

- [ ] **Step 4: Extend `@dtx/common/src/lib/server.ts`**

Append:

```ts
export {
	buildZipStream,
	createZipSources,
	validateZipSources,
	type ZipEntry,
	type ZipSource
} from './server/zipBuilder';
```

(Check the actual exported names by running `grep -E "^export" packages/common/src/lib/server/zipBuilder.ts` — adjust the list to match.)

- [ ] **Step 5: Verify common builds + tests pass**

Run: `bun run --filter=@dtx/common check && bun run --filter=@dtx/common test`
Expected: pass.

- [ ] **Step 6: Update consumer imports**

Run:

```bash
grep -rn "from '\$lib/server/zipBuilder'" packages/dtx-web/src
```

In each match, change e.g.:

```ts
import { buildZipStream, createZipSources, validateZipSources } from '$lib/server/zipBuilder';
```

to:

```ts
import { buildZipStream, createZipSources, validateZipSources } from '@dtx/common/server';
```

Known files:

- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`

- [ ] **Step 7: Type-check and test**

Run: `bun run --filter=dtx-web check && bun run --filter=dtx-web test`
Expected: pass.

Run: `grep -rn "from '\$lib/server/zipBuilder'" packages/dtx-web/src packages/common/src`
Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add packages/common/src/lib/server.ts packages/common/src/lib/server/ packages/dtx-web/src
git commit -m "refactor: move zipBuilder to @dtx/common/server

Phase 0 of the API server migration."
```

---

## Task 6: Move `db.ts` queries + `db/schema.ts`

**Files:**

- Create: `packages/common/src/lib/server/db.ts` (queries only)
- Create: `packages/common/src/lib/server/db.test.ts` (queries tests only)
- Create: `packages/common/src/lib/server/db/schema.ts` (via `git mv`)
- Modify: `packages/dtx-web/src/lib/server/db.ts` (shrink to `getDb` wrapper)
- Modify: `packages/dtx-web/src/lib/server/db.test.ts` (shrink to `getDb` tests)
- Modify: `packages/common/src/lib/server.ts`
- Modify (consumers): ~12 route handlers and their `server.test.ts` siblings

This is the largest move. The strategy:

1. Move `db/schema.ts` to common (no internal-import changes — it's leaf).
2. Move the **query functions and `createMockD1Database`** from `dtx-web`'s `db.ts` into `common`'s new `db.ts`.
3. Leave a slimmed-down `getDb(platform)` wrapper in `dtx-web/src/lib/server/db.ts` that delegates to `createMockD1Database` from common.
4. Split `db.test.ts` similarly — query tests move with the queries; `getDb` tests stay in `dtx-web`.

- [ ] **Step 1: Move `db/schema.ts`**

```bash
mkdir -p packages/common/src/lib/server/db
git mv packages/dtx-web/src/lib/server/db/schema.ts packages/common/src/lib/server/db/schema.ts
```

The schema file has no internal `$lib/` imports — it imports only from `drizzle-orm`. No changes needed inside.

- [ ] **Step 2: Move `db.ts` to common (full copy first, edit after)**

```bash
git mv packages/dtx-web/src/lib/server/db.ts packages/common/src/lib/server/db.ts
```

- [ ] **Step 3: Edit the moved file — fix imports + remove `getDb`**

Open `packages/common/src/lib/server/db.ts`. Apply these changes:

(a) Replace the `@dtx/common` import (currently at the top of the file) with a relative path to the in-package types file. Find:

```ts
import type {
	SimfileRow,
	SimfileInsert,
	SimfileUpdate,
	DtxFileRow,
	DtxFileInsert,
	UserProfileRow,
	UserProfileInsert,
	UserProfileUpdate,
	SimfileWithDtxFiles
} from '@dtx/common';
```

Replace with:

```ts
import type {
	SimfileRow,
	SimfileInsert,
	SimfileUpdate,
	DtxFileRow,
	DtxFileInsert,
	UserProfileRow,
	UserProfileInsert,
	UserProfileUpdate,
	SimfileWithDtxFiles
} from '../types/d1.types';
```

(b) Replace the `toSimfileWithDtx` import the same way. Find:

```ts
import { toSimfileWithDtx } from '@dtx/common';
```

Replace with:

```ts
import { toSimfileWithDtx } from '../types/d1.types';
```

(c) Replace the schema import. Find:

```ts
import { dtxFiles, simfiles, userProfiles } from '$lib/server/db/schema';
```

Replace with:

```ts
import { dtxFiles, simfiles, userProfiles } from './db/schema';
```

(d) Remove the SvelteKit-coupled `getDb` function. Find this block:

```ts
/** Get the D1 database binding from the platform env, providing a mock for local dev. */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	if (platform === undefined || platform.env === undefined) {
		return createMockD1Database();
	}
	const db = platform.env.DB;
	if (!db) {
		throw new Error(
			'D1 database binding (DB) is missing from the runtime environment. ' +
				'Verify the DB binding is configured in wrangler.jsonc and the deployment environment.'
		);
	}
	return db;
};
```

Delete it entirely (the `getDb` wrapper will live in dtx-web only).

(e) Make `createMockD1Database` exported (it is currently a non-exported `const` named `createMockD1Database`). Change:

```ts
const createMockD1Database = (): D1Database => {
```

to:

```ts
export const createMockD1Database = (): D1Database => {
```

(`createMockD1Database` is needed by the dtx-web `getDb` wrapper and by tests.)

- [ ] **Step 4: Re-create dtx-web's `db.ts` as a thin wrapper**

Create a new file at `packages/dtx-web/src/lib/server/db.ts` with this exact content:

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { createMockD1Database } from '@dtx/common/server';

/** Get the D1 database binding from the SvelteKit platform env. Falls back to a mock when no platform is present (local dev). */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	if (platform === undefined || platform.env === undefined) {
		return createMockD1Database();
	}
	const db = platform.env.DB;
	if (!db) {
		throw new Error(
			'D1 database binding (DB) is missing from the runtime environment. ' +
				'Verify the DB binding is configured in wrangler.jsonc and the deployment environment.'
		);
	}
	return db;
};
```

- [ ] **Step 5: Move `db.test.ts` to common**

```bash
git mv packages/dtx-web/src/lib/server/db.test.ts packages/common/src/lib/server/db.test.ts
```

- [ ] **Step 6: Edit the moved test — fix imports + remove `getDb` tests**

Open `packages/common/src/lib/server/db.test.ts`. Apply these changes:

(a) Replace the `@dtx/common` import. Find:

```ts
import { toSimfileWithDtx } from '@dtx/common';
```

Replace with:

```ts
import { toSimfileWithDtx } from '../types/d1.types';
```

(b) Replace the schema import. Find:

```ts
import { simfiles, dtxFiles, userProfiles } from '$lib/server/db/schema';
```

Replace with:

```ts
import { simfiles, dtxFiles, userProfiles } from './db/schema';
```

(c) Update the import list from `./db`. Find this block:

```ts
import {
	createDrizzleDb,
	escapeLikePattern,
	getDb,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile
} from './db';
```

Remove `getDb` from the list (it no longer lives here). Result:

```ts
import {
	createDrizzleDb,
	escapeLikePattern,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile
} from './db';
```

(d) Remove the entire `describe('getDb', ...)` block (in the file at the time of writing it spans roughly lines 163–207 — verify boundaries by searching for `describe('getDb'`, then locating the matching closing `});`). This block will be re-created in dtx-web's new test file.

- [ ] **Step 7: Create the new `getDb` test in dtx-web**

Create `packages/dtx-web/src/lib/server/db.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { getDb } from './db';
import type { D1Database } from '@cloudflare/workers-types';

describe('getDb', () => {
	it('returns a mock database when platform is undefined', () => {
		const db = getDb(undefined);
		expect(db).toBeDefined();
		expect(typeof db.prepare).toBe('function');
	});

	it('throws when platform.env exists but DB binding is missing', () => {
		expect(() => getDb({ env: {} } as App.Platform)).toThrow(
			'D1 database binding (DB) is missing from the runtime environment.'
		);
	});

	it('returns the DB binding when present', () => {
		const mockDb = {} as D1Database;
		const result = getDb({ env: { DB: mockDb } } as App.Platform);
		expect(result).toBe(mockDb);
	});

	it('mock database returns empty data for read operations', async () => {
		const db = getDb(undefined);
		const stmt = db.prepare('SELECT * FROM test');
		const firstResult = await stmt.first();
		const allResult = await stmt.all();

		expect(firstResult).toBeNull();
		expect(allResult.results).toEqual([]);
	});

	it('mock database handles batch operations', async () => {
		const db = getDb(undefined);
		const batchResult = await db.batch([
			db.prepare('INSERT INTO test VALUES (1)'),
			db.prepare('INSERT INTO test VALUES (2)')
		]);
		expect(batchResult).toHaveLength(2);
		expect(batchResult.every((r) => r.success)).toBe(true);
	});
});
```

(The fifth test's body comes from the original file — if the existing assertions differ, copy the exact original assertions from the section you removed in Step 6(d). The behavior must be identical to the pre-move test.)

- [ ] **Step 8: Extend `@dtx/common/src/lib/server.ts`**

Append:

```ts
// Drizzle schema
export { simfiles, dtxFiles, userProfiles } from './server/db/schema';

// D1 queries + mock factory
export {
	createDrizzleDb,
	createMockD1Database,
	escapeLikePattern,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile,
	type ListSimfilesOptions,
	type SearchSimfilesOptions,
	type SearchSimfileResult
} from './server/db';
```

(Cross-check by running `grep -E "^export" packages/common/src/lib/server/db.ts` and confirming every exported name is re-exported.)

Note: `SimfileWithDtxFiles` is already exported via the existing `./types/d1.types` re-exports at the top of `server.ts` — don't duplicate it.

- [ ] **Step 9: Verify common builds + tests pass**

Run: `bun run --filter=@dtx/common check`
Expected: 0 errors.

Run: `bun run --filter=@dtx/common test`
Expected: all moved query tests pass.

- [ ] **Step 10: Update dtx-web consumer imports**

Run:

```bash
grep -rn "from '\$lib/server/db'" packages/dtx-web/src
grep -rn "from '\$lib/server/db/schema'" packages/dtx-web/src
```

For each match in route handlers (`+server.ts`) and their `server.test.ts` siblings: split the imports so `getDb` stays on `$lib/server/db` and everything else moves to `@dtx/common/server`. Example transformation:

Before:

```ts
import { getDb, listSimfiles, createSimfile, createDtxFiles, deleteSimfile } from '$lib/server/db';
import type { SimfileWithDtxFiles } from '$lib/server/db';
```

After:

```ts
import { getDb } from '$lib/server/db';
import {
	listSimfiles,
	createSimfile,
	createDtxFiles,
	deleteSimfile,
	type SimfileWithDtxFiles
} from '@dtx/common/server';
```

Files (route handlers):

- `packages/dtx-web/src/routes/api/chart/+server.ts`
- `packages/dtx-web/src/routes/api/chart/[id]/+server.ts`
- `packages/dtx-web/src/routes/api/chart/next-display-id/+server.ts`
- `packages/dtx-web/src/routes/api/chart/search/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/upload/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/delete/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/list/[simFileId]/+server.ts`
- `packages/dtx-web/src/routes/api/simFile/listFiles/[simfileID]/+server.ts`
- `packages/dtx-web/src/routes/api/user/profile/+server.ts`

Files (server tests in routes):

- `packages/dtx-web/src/routes/api/chart/server.test.ts`
- `packages/dtx-web/src/routes/api/chart/[id]/server.test.ts`
- `packages/dtx-web/src/routes/api/chart/next-display-id/server.test.ts`
- `packages/dtx-web/src/routes/api/chart/search/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/upload/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/delete/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/download/bulk/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/list/[simFileId]/server.test.ts`
- `packages/dtx-web/src/routes/api/simFile/listFiles/[simfileID]/server.test.ts`
- `packages/dtx-web/src/routes/api/user/profile/server.test.ts`

After all edits:

```bash
grep -rn "from '\$lib/server/db/schema'" packages/dtx-web/src
```

Expected: no matches (the schema is now `@dtx/common/server`'s `{ simfiles, dtxFiles, userProfiles }`, but it isn't directly imported by route handlers — only by `db.test.ts`, which is in common now). If any consumer DID import the schema, change it to import from `@dtx/common/server`.

```bash
grep -rn "from '\$lib/server/db'" packages/dtx-web/src
```

Expected: each remaining match imports ONLY `getDb` (or its type) from `$lib/server/db`.

- [ ] **Step 11: Type-check dtx-web**

Run: `bun run --filter=dtx-web check`
Expected: 0 errors.

- [ ] **Step 12: Run all tests**

Run: `bun run --filter=@dtx/common test`
Expected: pass.

Run: `bun run --filter=dtx-web test`
Expected: pass.

- [ ] **Step 13: Commit**

```bash
git add packages/common/src packages/dtx-web/src
git commit -m "refactor: move db queries + drizzle schema to @dtx/common/server

Leaves only the SvelteKit-coupled getDb(platform) wrapper in
dtx-web/src/lib/server/db.ts. Phase 0 of the API server migration."
```

---

## Task 7: Final cleanup and verification

**Files:** none (verification + cleanup only)

- [ ] **Step 1: Verify no stale `$lib/server/<moved>` imports remain anywhere**

```bash
grep -rn "from '\$lib/server/logger'" packages/dtx-web/src packages/common/src
grep -rn "from '\$lib/server/r2'" packages/dtx-web/src packages/common/src
grep -rn "from '\$lib/server/rateLimiter'" packages/dtx-web/src packages/common/src
grep -rn "from '\$lib/server/zipBuilder'" packages/dtx-web/src packages/common/src
grep -rn "from '\$lib/server/db/schema'" packages/dtx-web/src packages/common/src
```

Expected: no matches in any.

```bash
grep -rn "from '\$lib/server/db'" packages/dtx-web/src
```

Expected: every match imports ONLY `getDb` (or `getDb` + a type). The query functions all come from `@dtx/common/server`.

- [ ] **Step 2: Verify the dtx-web server folder contains only the wrapper**

Run: `ls packages/dtx-web/src/lib/server/`

Expected output (exactly):

```
db.test.ts
db.ts
```

No `logger.ts`, `r2.ts`, `rateLimiter.ts`, `zipBuilder.ts`, or `db/` subdirectory.

- [ ] **Step 3: Verify common server folder is populated**

Run: `ls packages/common/src/lib/server/ && ls packages/common/src/lib/server/db/`

Expected:

```
db.test.ts
db.ts
db/
logger.test.ts
logger.ts
r2.test.ts
r2.ts
rateLimiter.test.ts
rateLimiter.ts
zipBuilder.test.ts
zipBuilder.ts
```

and

```
schema.ts
```

- [ ] **Step 4: Run formatter**

Run: `bun run format`

Expected: prettier rewrites formatting in moved files only. Inspect with `git diff --stat`.

- [ ] **Step 5: Run full test suites**

Run: `bun run --filter=@dtx/common test`
Expected: pass.

Run: `bun run --filter=dtx-web test`
Expected: pass.

Run: `bun run --filter=dtx-desktop test`
Expected: pass (desktop should be unaffected, but verify).

Run: `bun run --filter=@dtx/ui-components test`
Expected: pass.

- [ ] **Step 6: Type-check everything**

Run: `bun run --filter=@dtx/common check && bun run --filter=dtx-web check`
Expected: 0 errors in both.

- [ ] **Step 7: Lint**

Run: `bun run lint`
Expected: pass.

- [ ] **Step 8: Build `@dtx/common` to verify the published package shape**

Run: `bun run --filter=@dtx/common build`
Expected: build succeeds. `dist/server.js` and `dist/server.d.ts` exist and re-export the new symbols.

Verify: `grep -E "createMockD1Database|listSimfiles|logger|tryConsumeRateLimit|isPreviewKey|buildZipStream" packages/common/dist/server.d.ts`

Expected: all five symbols appear in the declaration file.

- [ ] **Step 9: Commit any formatter changes**

If `git status` shows lint/format changes:

```bash
git add -A
git commit -m "chore: format after Phase 0 migration"
```

If no changes: skip the commit.

- [ ] **Step 10: Final sanity check — exercise web dev server locally (manual smoke)**

(Optional, only if the engineer has time and a working local Supabase/D1 env.) Run: `bun run --filter=dtx-web wrangler:dev`, open the running URL, click through one chart list page, and verify that no console errors mention `$lib/server/*` resolution failures.

If the engineer is uncertain about the local env: skip this step. The unit tests already cover the contract.

---

## Done criteria

- All seven tasks complete.
- `git log --oneline -7` shows commits for: dep add, logger move, rateLimiter move, r2 move, zipBuilder move, db move, (optional) format.
- `packages/dtx-web/src/lib/server/` contains exactly `db.ts` + `db.test.ts`.
- `packages/common/src/lib/server/` contains all five modules + their tests + `db/schema.ts`.
- No `$lib/server/{logger,r2,rateLimiter,zipBuilder,db/schema}` imports anywhere in `dtx-web/src` or `common/src`.
- `bun run --filter=dtx-web test`, `bun run --filter=@dtx/common test`, `bun run --filter=dtx-web check`, `bun run --filter=@dtx/common check` all pass.
- `bun run --filter=@dtx/common build` produces a `dist/server.js`/`dist/server.d.ts` that re-exports every moved symbol.
- No behaviour change: every endpoint that worked before this phase still works.
