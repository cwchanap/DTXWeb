# API Migration Phase 4 — Dual-path e2e parity gate + cutover runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CI parity gate that runs the same web e2e journeys twice — flag OFF (REST via `dtx-web`) and flag ON (GraphQL via `dtx-api`) — against a hermetic local stack, plus a committed pre-prod cutover runbook.

**Architecture:** A CI matrix (`use_graphql: [false, true]`) runs two independent legs. Each leg migrates + seeds the one backend it exercises into local Miniflare **before** the dev server starts, then runs two Playwright journeys (authenticated lifecycle, anonymous single download). Auth uses a dedicated throwaway test Supabase project whose credentials are hardcoded in `e2e/test-config.ts`. `dtx-web` gets real local D1/R2/KV bindings via adapter-cloudflare `platformProxy` (gated behind an e2e-only env var); `dtx-api` runs via `wrangler dev`.

**Tech Stack:** Playwright, SvelteKit 2 + adapter-cloudflare v7, Wrangler 4 (Miniflare D1/R2/KV), Supabase (auth only), GitHub Actions, Bun.

**Spec:** `docs/superpowers/specs/2026-05-29-api-migration-phase-4-design.md`.

**Pre-conditions:** Phase 3 merged to `main`. `dtx-web` ships the dual-path `lib/api/` layer (flag default `false`). `dtx-api` deployed at `api.pre-prod.dtx.hapadona.com`. The repo has 8 unauthenticated e2e specs and a single-run `playwright.config.ts` + `.github/workflows/e2e-test.yml`.

**Key facts established during design (do not re-derive):**

- Plain `vite dev` returns a **mock D1** (`packages/dtx-web/src/lib/server/db.ts` `getDb` falls back to `createMockD1Database()` when `platform` is undefined). Adding `platformProxy` to the adapter in `svelte.config.js` makes `platform.env.DB/DTXFILE_BUCKET/RATE_LIMIT` **real local Miniflare** bindings persisted under `packages/dtx-web/.wrangler/state`. Miniflare caches the DB connection, so **migrate + seed must happen before the dev server starts**.
- Every flag-sensitive web data call is **client-side** (`ChartList` + `chart/[id]` fetch in `onMount`). No SSR `load()` reads D1 for these journeys. So each leg seeds exactly one backend; **no shared persist** is required.
- Web has **no create/upload UI** and **no bulk-download in headless Chromium** (`window.showSaveFilePicker` absent). Those stay on Phase 3 unit tests + the runbook. The gate covers two journeys.
- `dtx-api` validates bearer tokens by calling `supabase.auth.getUser` against its `SUPABASE_URL` (`packages/dtx-api/src/auth/verifyToken.ts`) — Phase 4 does not touch it; the test Supabase project issues/validates tokens.
- Login is an email/password form at `/login` (`?/login` action → `supabase.auth.signInWithPassword`), setting `@supabase/ssr` cookies. Driving that UI + `storageState` covers both the cookie (SSR) and bearer (`lib/api/token.ts`) paths.

---

## Operations vocabulary / fixed test data (used throughout)

| Name                | Value                                                                                                                            | Notes                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Chart A (lifecycle) | `id=1001`, `display_id=1001`, `title='E2E Lifecycle Chart'`, `artist='E2E'`, `bpm=120`, `user_id=TEST_USER_ID`, `is_published=0` | owned by test user; no R2 file → opened via Actions→Edit             |
| Chart B (download)  | `id=1002`, `display_id=1002`, `title='E2E Download Chart'`, `artist='E2E'`, `bpm=140`, `user_id=TEST_USER_ID`, `is_published=1`  | published; has R2 object `1002/song.dtx` → `has_uploaded_files=true` |
| R2 seed object      | key `1002/song.dtx` in bucket `simfile-dtx`, body = `e2e/fixtures/test-sample.dtx`                                               | non-preview key → `has_uploaded_files=true`; download zips it        |
| Local persist dir   | `packages/<pkg>/.wrangler/state` (default)                                                                                       | `<pkg>` = `dtx-web` (Leg A) or `dtx-api` (Leg B)                     |
| dtx-api local port  | `8787`                                                                                                                           | `PUBLIC_DTX_API_URL=http://localhost:8787`                           |

---

## File Structure (end state)

```text
e2e/
├── test-config.ts                NEW  (hardcoded test Supabase creds + TEST_USER_ID + chart ids)
├── setup/
│   ├── seed.sql                  NEW  (idempotent two-chart INSERTs)
│   └── prepare-stack.ts          NEW  (migrate + seed + r2 put into the leg's backend, pre-start)
├── global.setup.ts               NEW  (Playwright setup project: /login → storageState)
├── .auth/                        NEW  (gitignored storageState output dir)
├── auth-lifecycle.spec.ts        NEW  (journey 1)
└── blog-download.spec.ts         NEW  (journey 2)

playwright.config.ts              MODIFIED  (E2E_USE_GRAPHQL toggle, webServers, setup project, projects)
packages/dtx-web/svelte.config.js MODIFIED  (platformProxy gated behind E2E_PLATFORM_PROXY)
.github/workflows/e2e-test.yml    MODIFIED  (use_graphql matrix)
.gitignore                        MODIFIED  (e2e/.auth, .wrangler/state)
package.json (root)               MODIFIED  (e2e:offline / e2e:graphql convenience scripts)

docs/superpowers/runbooks/
└── 2026-05-29-phase-4-preprod-cutover.md   NEW
```

---

## Task 1: Lock the hermetic local-binding recipe (the de-risk spike)

Everything downstream depends on `dtx-web` serving **seeded, real** local data under `vite dev`. This task proves the exact migrate-then-start recipe and the persist path, end to end, before any journey is written.

**Files:**

- Modify: `packages/dtx-web/svelte.config.js`
- Modify: `.gitignore`

- [ ] **Step 1: Gate `platformProxy` behind an e2e-only env var in `packages/dtx-web/svelte.config.js`**

Replace the adapter block:

```js
		adapter: adapter({
			fallback: 'plaintext'
		}),
```

with:

```js
		adapter: adapter({
			fallback: 'plaintext',
			// e2e-only: surface real local Miniflare bindings (DB/R2/KV) under `vite dev`.
			// Inert in normal dev and in production builds (env var unset) — keeps the
			// existing mock-D1 dev behavior for everyone else.
			...(process.env.E2E_PLATFORM_PROXY === '1' ? { platformProxy: {} } : {})
		}),
```

- [ ] **Step 2: Ignore local Miniflare state + Playwright auth output**

In `.gitignore`, add (if not already present):

```gitignore
.wrangler/state
packages/*/.wrangler/state
e2e/.auth
```

- [ ] **Step 3: Manually prove the recipe (throwaway commands — not committed)**

Run, from repo root:

```bash
# 1. fresh local state for dtx-web
rm -rf packages/dtx-web/.wrangler/state

# 2. migrate BEFORE starting the server, into the default persist dir
cd packages/dtx-web
bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --file d1-migrations/0001_initial_schema.sql

# 3. seed one published row + confirm
bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --command "INSERT INTO simfiles (id,title,artist,bpm,user_id,is_published,display_id) VALUES (1002,'E2E Download Chart','E2E',140,'spike-user',1,1002);"
cd ../..

# 4. start the server WITH platformProxy, then probe
E2E_PLATFORM_PROXY=1 bun run --filter=dtx-web dev &
DEV_PID=$!
# wait until up
until curl -sf -o /dev/null http://localhost:5173/; do sleep 1; done
curl -s "http://localhost:5173/api/chart?scope=published&pageSize=5"
kill $DEV_PID
```

Expected: the final `curl` returns JSON `{"data":[{"id":1002,"title":"E2E Download Chart",...}],"count":1}` (real seeded row, **not** the mock `"Test Song"`, and **not** a `500`/`no such table`).

- [ ] **Step 4: If the probe shows mock data or an empty/`no such table` result, diagnose the persist path**

The dev server's getPlatformProxy persist file and `wrangler d1 execute --persist-to` must resolve to the same place. Inspect:

```bash
find packages/dtx-web/.wrangler -name '*.sqlite' -path '*d1*'
```

- If the running server wrote a different `.sqlite` than the one you migrated, re-run step 3 with `--persist-to .wrangler/state` matching the server's directory (the server uses `packages/dtx-web/.wrangler/state` by default).
- **Fallback (only if platformProxy persistence can't be aligned):** serve `dtx-web` via `wrangler dev` on the built worker instead. Record the decision here:
    - `bun run --filter=dtx-web build` then `cd packages/dtx-web && bunx wrangler dev --persist-to .wrangler/state --port 5173`. This makes `--persist-to` authoritative for both migrate and serve. If you take this path, Task 4's `dtx-web` webServer command uses `wrangler dev` instead of `vite dev`, and `svelte.config.js` does not need `platformProxy` (revert Step 1). Document which path won in the Task 9 runbook's "CI notes" section.

- [ ] **Step 5: Clean up the spike state**

```bash
rm -rf packages/dtx-web/.wrangler/state
```

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-web/svelte.config.js .gitignore
git commit -m "$(cat <<'EOF'
test(e2e): gate adapter platformProxy behind E2E_PLATFORM_PROXY

Phase 4 — lets the e2e harness surface real local Miniflare D1/R2/KV
bindings under vite dev. Inert in normal dev/prod. Verified end-to-end
that a pre-start migrate+seed is read back through /api/chart.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `e2e/test-config.ts` (hardcoded test credentials)

**Files:**

- Create: `e2e/test-config.ts`

The dedicated test Supabase project + user are provisioned out-of-band (Task 9 runbook). This file is the single source of those values. Placeholders are filled by the operator during the one-time setup; the committed file ships with the real throwaway values once the project exists.

- [ ] **Step 1: Create `e2e/test-config.ts`**

```ts
// e2e/test-config.ts
//
// Credentials for the DEDICATED, THROWAWAY e2e Supabase project only.
// Safe to commit: the anon key is public by design (it ships in client bundles),
// and the test user guards an isolated project with no real data.
// NEVER put prod/pre-prod credentials here.

export const TEST_SUPABASE_URL = 'https://REPLACE-ME.supabase.co';
export const TEST_SUPABASE_ANON_KEY = 'REPLACE_ME_ANON_KEY'; // public by design
export const TEST_USER_EMAIL = 'e2e@drumery.test';
export const TEST_USER_PASSWORD = 'REPLACE_ME_PASSWORD';

/** Supabase auth UUID of TEST_USER_EMAIL. Read once after provisioning (runbook). */
export const TEST_USER_ID = 'REPLACE_ME_UUID';

/** Fixed seed chart ids (see plan's test-data table). */
export const CHART_A_ID = 1001; // owned by test user, unpublished — lifecycle journey
export const CHART_B_ID = 1002; // published, has R2 file — download journey
export const CHART_A_TITLE = 'E2E Lifecycle Chart';
export const CHART_B_TITLE = 'E2E Download Chart';

/** dtx-api local port for the flag-ON leg. */
export const DTX_API_LOCAL_PORT = 8787;
```

- [ ] **Step 2: Verify the file imports and exposes the expected exports**

```bash
bun -e "import('./e2e/test-config.ts').then(m => console.log(Object.keys(m).sort().join(',')))"
```

Expected output includes: `CHART_A_ID,CHART_A_TITLE,CHART_B_ID,CHART_B_TITLE,DTX_API_LOCAL_PORT,TEST_SUPABASE_ANON_KEY,TEST_SUPABASE_URL,TEST_USER_EMAIL,TEST_USER_ID,TEST_USER_PASSWORD`.

- [ ] **Step 3: Commit**

```bash
git add e2e/test-config.ts
git commit -m "$(cat <<'EOF'
test(e2e): add hardcoded test Supabase config + fixed seed ids

Phase 4 — single source of the throwaway test project's URL/anon-key,
test-user creds + UUID, and the fixed seed chart ids. Operator fills the
REPLACE_ME values during one-time setup (runbook).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add the pre-start migrate + seed script

**Files:**

- Create: `e2e/setup/seed.sql`
- Create: `e2e/setup/prepare-stack.ts`

`prepare-stack.ts` runs before the dev server in each leg's webServer command. It migrates and seeds the leg's backend package (`dtx-web` for OFF, `dtx-api` for ON) into the default `.wrangler/state` persist dir, then puts the R2 object.

- [ ] **Step 1: Create `e2e/setup/seed.sql`**

```sql
-- e2e/setup/seed.sql — idempotent two-chart seed for the parity gate.
-- TEST_USER_ID is substituted by prepare-stack.ts before execution.
DELETE FROM dtx_files WHERE simfile_id IN (1001, 1002);
DELETE FROM simfiles WHERE id IN (1001, 1002);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1001, 'E2E Lifecycle Chart', 'E2E', 120, '__TEST_USER_ID__', 0, 1001);

INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, display_id)
VALUES (1002, 'E2E Download Chart', 'E2E', 140, '__TEST_USER_ID__', 1, 1002);

INSERT INTO dtx_files (label, level, simfile_id) VALUES ('BASIC', 50, 1002);
```

- [ ] **Step 2: Create `e2e/setup/prepare-stack.ts`**

```ts
// e2e/setup/prepare-stack.ts
// Migrate + seed the local Miniflare backend for the current leg, BEFORE the
// dev server starts. Run by the Playwright webServer command.
//
// Leg selection: E2E_USE_GRAPHQL === 'true' → seed dtx-api; else → seed dtx-web.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TEST_USER_ID, CHART_B_ID } from '../test-config';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..');

const useGraphQL = process.env.E2E_USE_GRAPHQL === 'true';
const pkg = useGraphQL ? 'dtx-api' : 'dtx-web';
const pkgDir = join(repoRoot, 'packages', pkg);
const persist = '.wrangler/state';
const migration = join(repoRoot, 'packages/dtx-web/d1-migrations/0001_initial_schema.sql');
const fixture = join(repoRoot, 'e2e/fixtures/test-sample.dtx');

const wrangler = (args: string[]) =>
	execFileSync('bunx', ['wrangler', ...args], { cwd: pkgDir, stdio: 'inherit' });

// 1. Apply schema (IF NOT EXISTS in the migration makes this safe to re-run).
wrangler(['d1', 'execute', 'dtx-web', '--local', '--persist-to', persist, '--file', migration]);

// 2. Seed rows (idempotent: the seed deletes ids 1001/1002 first).
const seedSql = readFileSync(join(here, 'seed.sql'), 'utf8').replaceAll(
	'__TEST_USER_ID__',
	TEST_USER_ID
);
const tmpSeed = join(mkdtempSync(join(tmpdir(), 'e2e-seed-')), 'seed.sql');
writeFileSync(tmpSeed, seedSql);
wrangler(['d1', 'execute', 'dtx-web', '--local', '--persist-to', persist, '--file', tmpSeed]);

// 3. Put the R2 object so chart B reports has_uploaded_files=true and download has content.
wrangler([
	'r2',
	'object',
	'put',
	`simfile-dtx/${CHART_B_ID}/song.dtx`,
	'--local',
	'--persist-to',
	persist,
	'--file',
	fixture
]);

console.log(
	`[prepare-stack] seeded ${pkg} local Miniflare (charts 1001/1002 + R2 ${CHART_B_ID}/song.dtx)`
);
```

- [ ] **Step 3: Verify the script runs for the OFF leg**

```bash
rm -rf packages/dtx-web/.wrangler/state
E2E_USE_GRAPHQL=false bun run e2e/setup/prepare-stack.ts
cd packages/dtx-web && bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --command "SELECT id,title,is_published FROM simfiles ORDER BY id;" ; cd ../..
```

Expected: the script prints `[prepare-stack] seeded dtx-web ...` and the query lists rows `1001` (is_published 0) and `1002` (is_published 1). (At this point `TEST_USER_ID` is still `REPLACE_ME_UUID`; that's fine for this structural check — the value only matters for the authenticated journey.)

- [ ] **Step 4: Verify the script runs for the ON leg**

```bash
rm -rf packages/dtx-api/.wrangler/state
E2E_USE_GRAPHQL=true bun run e2e/setup/prepare-stack.ts
cd packages/dtx-api && bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --command "SELECT count(*) AS n FROM simfiles;" ; cd ../..
```

Expected: prints `seeded dtx-api ...` and `n = 2`.

- [ ] **Step 5: Clean up**

```bash
rm -rf packages/dtx-web/.wrangler/state packages/dtx-api/.wrangler/state
```

- [ ] **Step 6: Commit**

```bash
git add e2e/setup/seed.sql e2e/setup/prepare-stack.ts
git commit -m "$(cat <<'EOF'
test(e2e): add pre-start migrate+seed script for the parity gate

Phase 4 — seeds two charts + an R2 object into the leg's local Miniflare
(dtx-web for flag-OFF, dtx-api for flag-ON) before the dev server starts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite `playwright.config.ts` for the dual-path harness

**Files:**

- Modify: `playwright.config.ts`

Adds the `E2E_USE_GRAPHQL` toggle, the migrate+seed-then-serve webServer command(s), a `setup` project that produces `storageState`, and authenticated/anonymous test projects.

- [ ] **Step 1: Replace `playwright.config.ts` with the dual-path config**

```ts
import { defineConfig, devices } from '@playwright/test';
import { TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, DTX_API_LOCAL_PORT } from './e2e/test-config';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const useGraphQL = process.env.E2E_USE_GRAPHQL === 'true';
const apiURL = `http://localhost:${DTX_API_LOCAL_PORT}`;

// Shared Supabase env for the dtx-web dev server (cookie auth + client bearer).
const webSupabaseEnv = {
	PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' // render the blog Download button
};

// dtx-web webServer: migrate+seed (OFF leg only) then start vite dev with platformProxy.
const webServers = [
	{
		command: useGraphQL
			? 'bun run --filter=dtx-web dev'
			: 'bun run e2e/setup/prepare-stack.ts && E2E_PLATFORM_PROXY=1 bun run --filter=dtx-web dev',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: {
			...process.env,
			VITE_E2E: 'true',
			E2E_PLATFORM_PROXY: useGraphQL ? '' : '1',
			PUBLIC_USE_GRAPHQL_API: useGraphQL ? 'true' : 'false',
			PUBLIC_DTX_API_URL: apiURL,
			PUBLIC_SIMFILE_BUCKET_URL: process.env.PUBLIC_SIMFILE_BUCKET_URL ?? baseURL,
			VITE_DTX_SERVER_URL: process.env.VITE_DTX_SERVER_URL ?? baseURL,
			...webSupabaseEnv
		}
	}
];

// flag-ON leg also boots dtx-api (seeded) via wrangler dev with test Supabase + local CORS.
if (useGraphQL) {
	webServers.push({
		command:
			'bun run e2e/setup/prepare-stack.ts && ' +
			'cd packages/dtx-api && bunx wrangler dev --port ' +
			DTX_API_LOCAL_PORT +
			' --persist-to .wrangler/state' +
			` --var SUPABASE_URL:${TEST_SUPABASE_URL}` +
			` --var SUPABASE_ANON_KEY:${TEST_SUPABASE_ANON_KEY}` +
			' --var CORS_ALLOWED_ORIGINS:http://localhost:5173' +
			' --var PUBLIC_ENABLE_BLOG_DOWNLOAD:true',
		url: `${apiURL}/graphql?query=%7B__typename%7D`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: { ...process.env, E2E_USE_GRAPHQL: 'true' }
	});
}

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: { baseURL, trace: 'on-first-retry' },
	projects: [
		{ name: 'setup', testMatch: /global\.setup\.ts/ },
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			dependencies: ['setup']
		}
	],
	webServer: webServers
});
```

- [ ] **Step 2: Verify the config loads (Playwright parses it + resolves the `test-config` import)**

```bash
bunx playwright test --list 2>&1 | tail -5
```

Expected: it lists the `setup` test (and the 8 existing specs) without a config-load error. (Journey specs are added in Tasks 6–7.) A `Cannot find module './e2e/test-config'` or syntax error here means the config or imports are wrong — fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "$(cat <<'EOF'
test(e2e): dual-path Playwright config (flag OFF/ON legs)

Phase 4 — E2E_USE_GRAPHQL selects the leg: OFF seeds+serves dtx-web with
platformProxy; ON serves dtx-web (flag on) + boots a seeded dtx-api via
wrangler dev with the test Supabase project and localhost CORS. Adds a
setup project that produces storageState.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add the `global.setup` login project

**Files:**

- Create: `e2e/global.setup.ts`

Drives the real `/login` form once, then saves `storageState` (the `@supabase/ssr` session cookies) to `e2e/.auth/user.json` for the authenticated journey.

- [ ] **Step 1: Create `e2e/global.setup.ts`**

```ts
import { test as setup, expect } from '@playwright/test';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './test-config';

const authFile = 'e2e/.auth/user.json';

setup('authenticate test user', async ({ page }) => {
	await page.goto('/login');
	await page.waitForSelector('html[data-e2e-hydrated="true"]');

	await page.locator('#email').fill(TEST_USER_EMAIL);
	await page.locator('#password').fill(TEST_USER_PASSWORD);
	await page.getByRole('button', { name: 'Login' }).click();

	// Successful login redirects to /app.
	await page.waitForURL('**/app');
	await expect(page).toHaveURL(/\/app(\?|$)/);

	await page.context().storageState({ path: authFile });
});
```

- [ ] **Step 2: Verify the setup project is discovered (does not need to pass yet — creds are placeholders)**

```bash
bunx playwright test --list 2>&1 | grep -i "global.setup" | head
```

Expected: lists the `authenticate test user` setup test. (Actually running it requires real creds + the test Supabase project, validated in Task 10 / by the operator.)

- [ ] **Step 3: Commit**

```bash
git add e2e/global.setup.ts
git commit -m "$(cat <<'EOF'
test(e2e): add login setup project producing storageState

Phase 4 — signs the test user in via the real /login form and saves the
Supabase session cookies for the authenticated journey (covers both the
SSR cookie path and the lib/api bearer path).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Journey 1 — authenticated chart lifecycle

**Files:**

- Create: `e2e/auth-lifecycle.spec.ts`

Exercises `listSimfiles(MINE)` → `getSimfile` → `updateSimfile` → `deleteSimfile`. Uses `storageState` from the setup project. Operates on seeded **chart A** only.

> e2e selector note: write the spec, run it against the local stack, and adjust selectors until green (the legitimate e2e TDD loop). The selectors below come from reading `ChartList.svelte` (card view default), `ChartListItem.svelte` (Actions popover → Edit / Delete), and `ChartDetail.svelte` (`#download_link`, save button labelled `Update`).
>
> Retry note: this test **deletes** chart A as its terminal action. Keep delete last and rely on Playwright's auto-retrying web-first assertions (`toBeVisible`/`toHaveCount`) so a transient at the final step doesn't fail. If cross-retry flakiness still appears (a passed delete followed by a flaked final assertion leaves no chart A for the retry), add `test.describe.configure({ retries: 0 })` to this spec — the seed runs once per leg, not per test, so a destructive test can't re-seed itself mid-run.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { CHART_A_ID, CHART_A_TITLE } from './test-config';

test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('authenticated chart lifecycle (dual-path)', () => {
	test('list → open detail → edit/save → delete', async ({ page }) => {
		// listSimfiles(MINE)
		await page.goto('/app/chart');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		const card = page.locator('.music-card', { hasText: CHART_A_TITLE });
		await expect(card).toBeVisible();

		// getSimfile — open the detail page via the card Actions → Edit menu
		await card.getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await expect(page).toHaveURL(new RegExp(`/app/chart/${CHART_A_ID}$`));
		await expect(page.getByRole('heading', { level: 1, name: CHART_A_TITLE })).toBeVisible();

		// updateSimfile — change a field and save (button text defaults to "Update")
		await page.locator('#download_link').fill('https://example.com/e2e-edit');
		await page.getByRole('button', { name: 'Update' }).click();
		// success toast proves the update round-tripped on whichever path is active
		await expect(page.getByText('Simfile updated successfully')).toBeVisible();

		// deleteSimfile — back to the list, delete chart A via Actions → Delete → confirm
		await page.goto('/app/chart');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		const cardAgain = page.locator('.music-card', { hasText: CHART_A_TITLE });
		await cardAgain.getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();
		// confirm in the modal dialog
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: /delete/i }).click();

		await expect(page.getByText('Chart deleted')).toBeVisible();
		await expect(page.locator('.music-card', { hasText: CHART_A_TITLE })).toHaveCount(0);
	});
});
```

- [ ] **Step 2: Run the OFF leg and iterate selectors to green**

```bash
E2E_USE_GRAPHQL=false bunx playwright test auth-lifecycle.spec.ts --project=chromium
```

Expected: PASS. If a selector misses, open `ChartListItem.svelte` (Delete is a `<Button>` inside the Actions popover; the confirm lives in a `Modal` from `@dtx/ui-components`) and adjust the `name`/role until green. Re-run until green.

- [ ] **Step 3: Run the ON leg and confirm identical assertions pass**

```bash
E2E_USE_GRAPHQL=true bunx playwright test auth-lifecycle.spec.ts --project=chromium
```

Expected: PASS with the same assertions — this is the parity proof for the authenticated CRUD call-sites.

- [ ] **Step 4: Commit**

```bash
git add e2e/auth-lifecycle.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): authenticated chart lifecycle journey (dual-path)

Phase 4 — list(MINE) → getSimfile → updateSimfile → deleteSimfile on a
seeded chart, asserted identically with the flag OFF and ON.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Journey 2 — anonymous browse + single download

**Files:**

- Create: `e2e/blog-download.spec.ts`

Exercises `listSimfiles(PUBLISHED)` + `downloadSimfile`. No `storageState` (anonymous). Operates on seeded **chart B** (published, has R2 file → Download button renders; `PUBLIC_ENABLE_BLOG_DOWNLOAD=true` set by the webServer).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { CHART_B_TITLE } from './test-config';

// anonymous — explicitly no stored auth
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('anonymous blog browse + single download (dual-path)', () => {
	test('published chart appears and downloads', async ({ page }) => {
		// listSimfiles(PUBLISHED)
		await page.goto('/blog');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		const card = page.locator('.music-card', { hasText: CHART_B_TITLE });
		await expect(card).toBeVisible();

		// downloadSimfile — click the Download button, capture the browser download
		const downloadPromise = page.waitForEvent('download');
		await card.getByRole('button', { name: /download/i }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.zip$/);
	});
});
```

- [ ] **Step 2: Run the OFF leg to green**

```bash
E2E_USE_GRAPHQL=false bunx playwright test blog-download.spec.ts --project=chromium
```

Expected: PASS. The download button comes from `DownloadDropdown.svelte` (`aria-label` = the i18n `chart_actions.download`); if `/download/i` doesn't match, target the button inside `card` by its `Download` icon / aria-label and adjust. The default download filename is `chart-<id>.zip` (set in `lib/api/rest/download.ts`).

- [ ] **Step 3: Run the ON leg and confirm parity**

```bash
E2E_USE_GRAPHQL=true bunx playwright test blog-download.spec.ts --project=chromium
```

Expected: PASS — same assertions, bytes now from `dtx-api` `/downloads/:id` (cross-origin; the webServer set `CORS_ALLOWED_ORIGINS` to `http://localhost:5173`).

- [ ] **Step 4: Commit**

```bash
git add e2e/blog-download.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): anonymous browse + single download journey (dual-path)

Phase 4 — list(PUBLISHED) + downloadSimfile on a seeded published chart,
asserted identically with the flag OFF and ON.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire the CI parity matrix

**Files:**

- Modify: `.github/workflows/e2e-test.yml`

- [ ] **Step 1: Replace the workflow with the dual-leg matrix**

```yaml
name: Playwright Tests
on:
    push:
        branches: [main, master]
    pull_request:
        branches: [main, master]

jobs:
    test:
        timeout-minutes: 60
        runs-on: ubuntu-latest
        strategy:
            fail-fast: false
            matrix:
                use_graphql: [false, true]
        env:
            E2E_USE_GRAPHQL: ${{ matrix.use_graphql }}
        steps:
            - uses: actions/checkout@v4
            - uses: oven-sh/setup-bun@v2
              with:
                  bun-version: '1.3.9'
            - name: Install dependencies
              run: bun install --frozen-lockfile && bun run --filter=@dtx/common build
            - name: Install Playwright Browsers
              run: bunx playwright install --with-deps
            - name: Run Playwright tests (flag=${{ matrix.use_graphql }})
              run: bunx playwright test
            - uses: actions/upload-artifact@v4
              if: ${{ !cancelled() }}
              with:
                  name: playwright-report-graphql-${{ matrix.use_graphql }}
                  path: playwright-report/
                  retention-days: 30
```

Notes baked into this design:

- No `Production` environment and no Supabase secrets — the test creds are hardcoded in `e2e/test-config.ts`, so the full matrix runs on forks too.
- Each leg's seed/serve is driven entirely by `playwright.config.ts` `webServer` commands (which call `prepare-stack.ts`), so no extra CI steps are needed.

- [ ] **Step 2: Validate the workflow YAML**

```bash
bunx --yes @action-validator/cli .github/workflows/e2e-test.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/e2e-test.yml')); print('YAML OK')"
```

Expected: `YAML OK` (or the validator passes).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-test.yml
git commit -m "$(cat <<'EOF'
ci(e2e): run the parity gate twice (flag OFF and ON)

Phase 4 — use_graphql:[false,true] matrix; both legs must be green.
No secrets required (test creds hardcoded), so forks run the full gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Write the pre-prod cutover runbook

**Files:**

- Create: `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`

- [ ] **Step 1: Create the runbook**

```markdown
# Phase 4 — Pre-prod Cutover Runbook (operator-executed)

Authored for Phase 4 of the API migration. Steps requiring the Cloudflare
dashboard, an interactive login, or human observation are run by a human, not
an agent.

## 0. CI notes (filled in by the implementer)

- `dtx-web` local-binding mechanism chosen in Task 1: **platformProxy** (default)
  or **wrangler dev** (fallback). [record which]
- Resolved persist path: `packages/<pkg>/.wrangler/state`.

## 1. One-time test-Supabase setup

1. Create a dedicated Supabase project (e.g. `drumery-e2e`). Disable email
   confirmation (Auth → Providers → Email → "Confirm email" off) or enable
   auto-confirm so the test user can sign in headlessly.
2. Create the test user (Auth → Users → Add user): email `e2e@drumery.test`,
   a throwaway password.
3. Copy the user's UUID, the project URL, and the anon key (Settings → API).
4. Paste all four into `e2e/test-config.ts` (`TEST_SUPABASE_URL`,
   `TEST_SUPABASE_ANON_KEY`, `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`,
   `TEST_USER_ID`) and commit. No GitHub secrets are needed.
5. Run both legs locally to confirm green:
    - `E2E_USE_GRAPHQL=false bunx playwright test`
    - `E2E_USE_GRAPHQL=true bunx playwright test`

## 2. Flag-ON validation on pre-prod

1. Deploy `dtx-web` to pre-prod with the flag overridden ON, without changing
   committed config:
   `cd packages/dtx-web && bun run build && bunx wrangler deploy --env pre-prod --var PUBLIC_USE_GRAPHQL_API:true`
2. In a browser at `https://pre-prod.dtx.hapadona.com`, with DevTools → Network
   open, smoke every web call-site and confirm requests hit
   `api.pre-prod.dtx.hapadona.com`:
    - Log in.
    - `/app/chart`: list loads (mine).
    - Open a chart → detail loads (getSimfile) → edit a field → Update (updateSimfile).
    - Delete a disposable chart (deleteSimfile).
    - `/blog`: list loads (published); click a chart's Download (single download).
    - `/blog`: Select two charts → bulk Download (the native save picker appears) — bulk download.
    - Trigger the desktop handoff (login with `?redirect=desktop`) → magic link generates.

## 3. Worker-log parity capture

1. In two terminals during the smoke:
    - `cd packages/dtx-web && bunx wrangler tail --env pre-prod`
    - `cd packages/dtx-api && bunx wrangler tail --env pre-prod`
2. Save both logs. Compare error rates / status codes against a flag-OFF
   baseline pass of the same smoke.

## 4. Delta triage

- Record any response/behavior delta between OFF and ON.
- Fixes land in `dtx-web` or `dtx-api` as a **follow-up PR** (allowed in Phase
  4), each with a regression assertion added to the relevant journey spec or a
  Phase 3 `lib/api/*.test.ts`.

## 5. Restore steady state

- Re-deploy pre-prod without the override so `PUBLIC_USE_GRAPHQL_API` returns to
  the committed `false`:
  `cd packages/dtx-web && bun run deploy:preprod`

## 6. Desktop pre-prod smoke

- `VITE_DTX_SERVER_URL=https://api.pre-prod.dtx.hapadona.com bun run --filter=dtx-desktop build`
- Launch the built app and smoke: chart list, upload a `.dtx`, edit, delete,
  magic-link sign-in. No GitHub release.

## 7. Phase 5 handoff checklist

- [ ] CI parity gate green on `main` (both legs).
- [ ] Zero unresolved deltas (all delta-fix PRs merged).
- [ ] Worker-log parity artifacts captured at least once on pre-prod.
- [ ] Desktop pre-prod smoke clean.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md
git commit -m "$(cat <<'EOF'
docs(superpowers): add Phase 4 pre-prod cutover runbook

Phase 4 — operator checklist: test-Supabase setup, flag-ON pre-prod
smoke, worker-log parity capture, delta triage, desktop pre-prod build,
and the Phase 5 handoff gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full local verification of both legs

**Files:** none (verification only).

- [ ] **Step 1: Ensure the test Supabase values are real**

The authenticated journey cannot pass with `REPLACE_ME_*` placeholders. Confirm `e2e/test-config.ts` holds the real throwaway project values (Task 9 §1). If they are not yet available, run only the anonymous journey (`blog-download.spec.ts`) here and defer the authenticated leg to the operator's §1 run.

- [ ] **Step 2: Run the full suite, flag OFF**

```bash
E2E_USE_GRAPHQL=false bunx playwright test
```

Expected: setup project logs in; `auth-lifecycle` + `blog-download` + the 8 existing unauthenticated specs all PASS.

- [ ] **Step 3: Run the full suite, flag ON**

```bash
E2E_USE_GRAPHQL=true bunx playwright test
```

Expected: all PASS — identical assertions, data now served by `dtx-api`.

- [ ] **Step 4: Confirm no regressions elsewhere**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test
bun run lint
```

Expected: all green. (`svelte.config.js`'s gated `platformProxy` is inert without `E2E_PLATFORM_PROXY`, so `check`/`test`/normal `dev` are unchanged.)

- [ ] **Step 5: Confirm the change surface is contained**

```bash
git diff --stat main -- . ':(exclude)docs'
```

Expected: changes only under `e2e/`, `playwright.config.ts`, `.github/workflows/e2e-test.yml`, `.gitignore`, and `packages/dtx-web/svelte.config.js` (the gated platformProxy edit). No `dtx-api`/`dtx-desktop`/`common` app changes; no deployed `PUBLIC_USE_GRAPHQL_API` change.

- [ ] **Step 6: Clean up local Miniflare state**

```bash
rm -rf packages/dtx-web/.wrangler/state packages/dtx-api/.wrangler/state e2e/.auth
```

---

## Self-review checklist (for the implementer before opening a PR)

- [ ] Both legs green locally (Task 10 §2–3).
- [ ] `e2e/test-config.ts` has no `REPLACE_ME_*` left (or the gap is explicitly handed to the operator).
- [ ] Runbook §0 records which dtx-web binding mechanism won (platformProxy vs wrangler dev).
- [ ] No app-code changes beyond the gated `svelte.config.js` edit; no deployed flag change.
- [ ] Existing unit/component suites + `bun run lint` pass.

```

```
