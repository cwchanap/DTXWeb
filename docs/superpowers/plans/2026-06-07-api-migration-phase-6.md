# API Migration Phase 6 — REST API Decommission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy REST API from `dtx-web` now that `PUBLIC_USE_GRAPHQL_API` is `"true"` in every deployed stanza — collapsing the dual-path `lib/api/` to GraphQL-only, deleting `routes/api/*`, stripping the `/api/` auth branch from `hooks.server.ts`, migrating the editor's `set.def` read to a new `dtx-api` sidecar, removing the D1/R2/KV bindings, moving `d1-migrations/` to `dtx-api`, and collapsing the e2e parity gate to a single GraphQL leg.

**Architecture:** `dtx-web` becomes a pure SvelteKit front end whose only backend is `dtx-api` (GraphQL + REST sidecars). All chart/user/auth/download/asset data flows through `lib/api/` → `dtx-api`. The editor's only server-side data read (set.def from R2) moves behind a new unauthenticated `dtx-api` endpoint, letting `dtx-web` drop every Cloudflare data binding.

**Tech Stack:** SvelteKit 2 + adapter-cloudflare, TypeScript, `graphql-request`, Cloudflare Workers (Miniflare D1/R2/KV), Wrangler 4, Vitest, Playwright, GitHub Actions, Bun.

**Spec:** `docs/superpowers/specs/2026-06-07-api-migration-phase-6-design.md`.

**Pre-conditions:** Branch `chore/api-migration-phase-6-rest-decommission` is checked out (the spec is already committed there). `dtx-api` is deployed and serves the full GraphQL surface + `/downloads/*` + `/upload`. The flag is `"true"` in all three `dtx-web` and `dtx-api` stanzas.

**Key facts established during design (do not re-derive):**

- Every flag-sensitive web data call is client-side. The only server-side data read in `dtx-web` is the editor `+page.server.ts` reading `${id}/set.def` from R2.
- `getDb` (`lib/server/db.ts`) and the KV `RATE_LIMIT` binding are used **only** by `routes/api/*`. The R2 `DTXFILE_BUCKET` binding is used by `routes/api/*` **and** the editor load.
- The chart detail page already receives `simfile.files {key,size,uploaded}` from `GetSimfile`, so the separate `/api/simFile/listFiles/:id` fetch (`@dtx/common` `assetFileService.loadAssetFiles`) is redundant.
- `@dtx/common`'s `createMockD1Database` is also imported by `dtx-api` tests — **do not delete it**; only delete `dtx-web`'s `lib/server/db.ts` consumer.
- `dtx-web` and `dtx-api` share the same D1 `database_name` (`dtx-web`/`dtx-web-preprod`). `dtx-api` currently has no `migrations_dir`.
- The editor load keeps its `dev` / no-API-base fallback (`metadata: null` → client fetches), so the e2e run (which uses `vite dev`, where `dev === true`) never calls the new `set.def` endpoint — no extra e2e R2 seeding is required.
- `DownloadDropdown.svelte` calls `downloadSimfile(String(simfileId))` with no `directDownloadFn`; `ChartList.helpers.ts` uses `bulkDownloadBaseUrl`/`bulkDownloadHeaders`. All survive the download.ts rewrite unchanged.

---

## Deploy ordering (record in the PR description)

The code changes are inert against the already-`true` flag and can merge as one PR, but the **deploy** must be ordered:

1. Deploy `dtx-api` first (adds `GET /simfiles/:id/set.def` + gains `migrations_dir`).
2. Then deploy `dtx-web` (now without R2/D1/KV bindings; editor fetches set.def from the live `dtx-api`).

---

## Task 1: Collapse `lib/api/chart.ts` to GraphQL-only

**Files:**

- Modify: `packages/dtx-web/src/lib/api/chart.ts`
- Modify: `packages/dtx-web/src/lib/api/chart.test.ts`

- [ ] **Step 1: Remove the REST branches in `chart.ts`**

In `packages/dtx-web/src/lib/api/chart.ts`:

1. Change the client import to drop `useGraphQL`:

```ts
import { getClient, type ClientCtx } from './client';
```

2. Delete the `fetchFn` helper line entirely:

```ts
const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;
```

3. In `listSimfiles`, delete the whole `if (!useGraphQL()) { ... }` block so the body starts directly at `const client = await getClient(ctx);`.
4. Do the same in `getSimfile`, `updateSimfile`, and `deleteSimfile` — delete each leading `if (!useGraphQL()) { ... }` block, keeping only the GraphQL implementation that follows.

The four functions keep their signatures, `adaptSimfile`, all exported types (`LegacySimfile`, `SimfileListResult`, `ScopeString`, `ListParams`, `DeleteResult`), and `scopeToEnum`.

- [ ] **Step 2: Strip the REST-path tests from `chart.test.ts`**

In `packages/dtx-web/src/lib/api/chart.test.ts`:

1. Delete the `describe('listSimfiles (REST path)', ...)` block.
2. In the remaining `describe` blocks (`listSimfiles (GraphQL path)`, `getSimfile`, `updateSimfile`, `deleteSimfile`), delete every test whose title starts with `REST:` (e.g. `it('REST: GET /api/chart/${id}', ...)`, `it('REST: PATCH ...')`, `it('REST: DELETE ...')`, `it('REST: returns no partialDeletion ...')`).
3. In each kept GraphQL test, delete the now-redundant `mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';` line and any nested `beforeEach` that only set it.
4. In the top-level `beforeEach`, delete `mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';` and the `restFetch` setup lines (`const restFetch = vi.fn();`, `restFetch.mockReset();`, and the `globalThis.fetch = restFetch` assignment). Set the hoisted `mockEnv` default to `'true'`:

```ts
const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'true', PUBLIC_DTX_API_URL: 'https://api.test' };
```

- [ ] **Step 3: Run the chart tests**

Run: `bun run --filter=dtx-web test -- chart.test.ts`
Expected: PASS, no remaining `REST:` tests, no reference errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-web/src/lib/api/chart.ts packages/dtx-web/src/lib/api/chart.test.ts
git commit -m "$(cat <<'EOF'
refactor(dtx-web): collapse lib/api/chart to GraphQL-only

Phase 6 — remove the REST dispatch branches now that the flag is true
everywhere. listSimfiles/getSimfile/updateSimfile/deleteSimfile go
straight to GraphQL; REST-path tests dropped.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Collapse `user.ts`, `auth.ts`, and `client.ts` to GraphQL-only

**Files:**

- Modify: `packages/dtx-web/src/lib/api/user.ts`
- Modify: `packages/dtx-web/src/lib/api/auth.ts`
- Modify: `packages/dtx-web/src/lib/api/client.ts`
- Modify: `packages/dtx-web/src/lib/api/user.test.ts`
- Modify: `packages/dtx-web/src/lib/api/auth.test.ts`
- Modify: `packages/dtx-web/src/lib/api/client.test.ts`

- [ ] **Step 1: Rewrite `user.ts`**

Replace the entire contents of `packages/dtx-web/src/lib/api/user.ts` with:

```ts
import {
	MeDocument,
	UpsertUserProfileDocument,
	type UpsertUserProfileInput
} from './generated/graphql';
import { getClient, type ClientCtx } from './client';

export type LegacyUserProfile = { user_id: string; username: string };

const adapt = (g: { userId: string; username: string }): LegacyUserProfile => ({
	user_id: g.userId,
	username: g.username
});

export const getMe = async (ctx?: ClientCtx): Promise<LegacyUserProfile> => {
	const client = await getClient(ctx);
	const result = await client.request(MeDocument, {});
	return adapt(result.me);
};

export const upsertUserProfile = async (
	input: UpsertUserProfileInput,
	ctx?: ClientCtx
): Promise<LegacyUserProfile> => {
	const client = await getClient(ctx);
	const result = await client.request(UpsertUserProfileDocument, { input });
	return adapt(result.upsertUserProfile);
};
```

(Removes `useGraphQL`, `fetchFn`, `readErrorBody`, and both REST branches.)

- [ ] **Step 2: Rewrite `auth.ts`**

Replace the entire contents of `packages/dtx-web/src/lib/api/auth.ts` with:

```ts
import { GenerateMagicLinkDocument } from './generated/graphql';
import { getClient, type ClientCtx } from './client';

export type MagicLinkResult = { magicLinkUrl: string };

export const generateMagicLink = async (ctx?: ClientCtx): Promise<MagicLinkResult> => {
	const client = await getClient(ctx);
	const result = await client.request(GenerateMagicLinkDocument, {});
	return { magicLinkUrl: result.generateMagicLink.magicLinkUrl };
};
```

- [ ] **Step 3: Rewrite `client.ts`**

Replace the entire contents of `packages/dtx-web/src/lib/api/client.ts` with:

```ts
import { browser } from '$app/environment';
import { getAccessTokenOrNull } from './token';
import { makeBrowserClient, makeServiceBindingClient, type GraphQLLikeClient } from './transport';

export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	accessToken?: string | null;
};

/** Returns a GraphQL client appropriate for the current context. */
export const getClient = async (ctx?: ClientCtx): Promise<GraphQLLikeClient> => {
	// SSR with the API service binding (pre-prod stanzas) uses the binding directly.
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken ?? null);
	}
	// Browser: resolve token from Supabase when not explicitly provided.
	const token = ctx?.accessToken !== undefined ? ctx.accessToken : await getAccessTokenOrNull();
	return makeBrowserClient(token);
};
```

(Removes the `env`/`$env/dynamic/public` import, the `useGraphQL` export, and the Phase 4 TODO.)

- [ ] **Step 4: Update `user.test.ts` and `auth.test.ts`**

In each file, delete the REST-path tests (titles containing `REST` or asserting on `/api/user/profile` / `/api/auth/generate-magic-link`), delete any `globalThis.fetch` / REST fetch-mock scaffolding, delete per-test `mockEnv.PUBLIC_USE_GRAPHQL_API = 'true'` lines, and set the hoisted `mockEnv.PUBLIC_USE_GRAPHQL_API` default to `'true'`. Keep all GraphQL-path tests.

- [ ] **Step 5: Update `client.test.ts`**

Delete the entire `describe('useGraphQL', ...)` block and the `useGraphQL` name from the `import { getClient, useGraphQL } from './client';` line (becomes `import { getClient } from './client';`). Keep all `getClient` tests.

- [ ] **Step 6: Run the tests**

Run: `bun run --filter=dtx-web test -- user.test.ts auth.test.ts client.test.ts`
Expected: PASS, no `useGraphQL` reference errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-web/src/lib/api/user.ts packages/dtx-web/src/lib/api/auth.ts packages/dtx-web/src/lib/api/client.ts packages/dtx-web/src/lib/api/user.test.ts packages/dtx-web/src/lib/api/auth.test.ts packages/dtx-web/src/lib/api/client.test.ts
git commit -m "$(cat <<'EOF'
refactor(dtx-web): collapse lib/api user/auth/client to GraphQL-only

Phase 6 — drop the useGraphQL flag and REST branches from getMe,
upsertUserProfile, generateMagicLink, and client.ts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Move + collapse `download.ts` and update the barrel

**Files:**

- Create: `packages/dtx-web/src/lib/api/download.ts`
- Create: `packages/dtx-web/src/lib/api/download.test.ts`
- Delete: `packages/dtx-web/src/lib/api/rest/download.ts`
- Delete: `packages/dtx-web/src/lib/api/rest/download.test.ts`
- Modify: `packages/dtx-web/src/lib/api/index.ts`

- [ ] **Step 1: Create `packages/dtx-web/src/lib/api/download.ts`**

```ts
import { env } from '$env/dynamic/public';
import { getAccessTokenOrNull } from './token';

const apiBase = () => {
	const base = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');
	if (!base) {
		throw new Error('PUBLIC_DTX_API_URL is not configured — set it in .env');
	}
	return base;
};

export const downloadBaseUrl = (simfileId: string) => `${apiBase()}/downloads/${simfileId}`;

export const bulkDownloadBaseUrl = () => `${apiBase()}/downloads/bulk`;

export const parseContentDispositionFilename = (header: string | null): string | null => {
	if (!header) return null;
	const isEncoded = /filename\*=/i.test(header);
	const match = /filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^;]+))/i.exec(header);
	if (!match) return null;
	const raw = (match[1] ?? match[2] ?? '').trim();
	if (!raw) return null;
	if (isEncoded) {
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	return raw;
};

const defaultTriggerBrowserDownload = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
};

export type DownloadOpts = {
	fetchFn?: typeof fetch;
	triggerBrowserDownload?: (blob: Blob, filename: string) => void;
};

export const downloadSimfile = async (simfileId: string, opts: DownloadOpts = {}) => {
	const fetchFn = opts.fetchFn ?? fetch;
	const trigger = opts.triggerBrowserDownload ?? defaultTriggerBrowserDownload;
	const headers: Record<string, string> = {};
	const token = await getAccessTokenOrNull();
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetchFn(downloadBaseUrl(simfileId), { headers });
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const filename =
		parseContentDispositionFilename(res.headers.get('content-disposition')) ??
		`chart-${simfileId}.zip`;
	trigger(blob, filename);
};

/** Build headers for bulk download requests against dtx-api (Content-Type + Bearer). */
export const bulkDownloadHeaders = async (): Promise<Record<string, string>> => {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const token = await getAccessTokenOrNull();
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
};
```

- [ ] **Step 2: Create `packages/dtx-web/src/lib/api/download.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'true', PUBLIC_DTX_API_URL: 'https://api.test' };
	return { mockEnv };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token')
}));

import {
	bulkDownloadBaseUrl,
	bulkDownloadHeaders,
	downloadBaseUrl,
	parseContentDispositionFilename,
	downloadSimfile
} from './download';

beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
	mockEnv.PUBLIC_DTX_API_URL = 'https://api.test';
});

describe('downloadBaseUrl', () => {
	it('returns the dtx-api URL', () => {
		expect(downloadBaseUrl('7')).toBe('https://api.test/downloads/7');
	});
	it('throws when PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => downloadBaseUrl('7')).toThrow('PUBLIC_DTX_API_URL is not configured');
	});
});

describe('bulkDownloadBaseUrl', () => {
	it('returns the dtx-api bulk URL', () => {
		expect(bulkDownloadBaseUrl()).toBe('https://api.test/downloads/bulk');
	});
	it('throws when PUBLIC_DTX_API_URL is empty', () => {
		mockEnv.PUBLIC_DTX_API_URL = '';
		expect(() => bulkDownloadBaseUrl()).toThrow('PUBLIC_DTX_API_URL is not configured');
	});
});

describe('parseContentDispositionFilename', () => {
	it('extracts quoted filename', () => {
		expect(parseContentDispositionFilename('attachment; filename="chart-7.zip"')).toBe(
			'chart-7.zip'
		);
	});
	it('extracts unquoted filename', () => {
		expect(parseContentDispositionFilename('attachment; filename=chart-7.zip')).toBe(
			'chart-7.zip'
		);
	});
	it('returns null for missing header', () => {
		expect(parseContentDispositionFilename(null)).toBeNull();
		expect(parseContentDispositionFilename('attachment')).toBeNull();
	});
	it('URL-decodes RFC5987 filename* values', () => {
		expect(
			parseContentDispositionFilename(
				"attachment; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.zip"
			)
		).toBe('テスト.zip');
	});
	it('falls back to raw value when RFC5987 decoding fails', () => {
		expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E0%A4%A.zip")).toBe(
			'%E0%A4%A.zip'
		);
	});
});

describe('downloadSimfile', () => {
	it('hits the dtx-api URL with a bearer header when token available', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).toHaveBeenCalledWith('https://api.test/downloads/3', expect.any(Object));
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
	});

	it('throws on non-ok response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('fail', { status: 500 }));
		await expect(downloadSimfile('3', { fetchFn: fetchMock })).rejects.toThrow(
			'Download failed: 500'
		);
	});

	it('omits Authorization header when token is null', async () => {
		const { getAccessTokenOrNull } = await import('./token');
		vi.mocked(getAccessTokenOrNull).mockResolvedValueOnce(null);
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
	});

	it('uses chart-{simfileId}.zip fallback when content-disposition is null', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('blob-data'));
		const triggerSpy = vi.fn();
		await downloadSimfile('42', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		const [, filename] = triggerSpy.mock.calls[0];
		expect(filename).toBe('chart-42.zip');
	});
});

describe('bulkDownloadHeaders', () => {
	it('returns Content-Type and Authorization when token available', async () => {
		const headers = await bulkDownloadHeaders();
		expect(headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: 'Bearer test-token'
		});
	});

	it('returns Content-Type only when no token', async () => {
		const { getAccessTokenOrNull } = await import('./token');
		vi.mocked(getAccessTokenOrNull).mockResolvedValueOnce(null);
		const headers = await bulkDownloadHeaders();
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
	});
});
```

- [ ] **Step 3: Delete the old `rest/` files and update the barrel**

```bash
git rm packages/dtx-web/src/lib/api/rest/download.ts packages/dtx-web/src/lib/api/rest/download.test.ts
```

In `packages/dtx-web/src/lib/api/index.ts`, change the last line from:

```ts
export { downloadSimfile, bulkDownloadBaseUrl, bulkDownloadHeaders } from './rest/download';
```

to:

```ts
export { downloadSimfile, bulkDownloadBaseUrl, bulkDownloadHeaders } from './download';
```

- [ ] **Step 4: Run the tests + confirm `rest/` is empty**

Run: `bun run --filter=dtx-web test -- download.test.ts`
Expected: PASS.

Run: `ls packages/dtx-web/src/lib/api/rest 2>/dev/null || echo "rest dir gone"`
Expected: directory is empty or removed. If it still exists empty, remove it: `rmdir packages/dtx-web/src/lib/api/rest 2>/dev/null || true`.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/download.ts packages/dtx-web/src/lib/api/download.test.ts packages/dtx-web/src/lib/api/index.ts
git commit -m "$(cat <<'EOF'
refactor(dtx-web): move download.ts to lib/api, dtx-api-only

Phase 6 — the download helpers now always fetch from dtx-api
(/downloads/*) with a bearer header. Drop the local-REST direct-link
branch and relocate out of the misnamed rest/ dir.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Re-point the asset-files call-site; delete `assetFileService`

**Files:**

- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`
- Delete: `packages/common/src/lib/services/assetFileService.ts`
- Delete: `packages/common/src/lib/services/assetFileService.test.ts`

- [ ] **Step 1: Replace the `loadAssetFiles` import with a local adapter on the chart detail page**

In `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`:

1. Delete the import:

```ts
import { loadAssetFiles } from '@dtx/common/services/assetFileService';
```

2. Add an adapter that derives the component's expected shape from `simfile.files`. Place it inside the `<script>` block, after `loadSimfileDetails` is defined:

```ts
// Phase 6: asset files come from the GraphQL getSimfile() result (simfile.files),
// not a separate REST fetch. Adapt {key,size,uploaded} -> the component shape.
const loadAssetFiles = async (simfileId: string) => {
	if (!simfileId) throw new Error('SimfileId is required');
	const files = simfile?.files ?? [];
	return files.map((f) => ({
		key: f.key,
		size: f.size,
		lastModified: f.uploaded,
		fileName: f.key.split('/').pop() ?? f.key
	}));
};
```

The `{loadAssetFiles}` prop passed to `<UploadedAssetFiles>` in the `asset_files` snippet is unchanged — it now references this local adapter.

- [ ] **Step 2: Delete the service and its test**

```bash
git rm packages/common/src/lib/services/assetFileService.ts packages/common/src/lib/services/assetFileService.test.ts
```

- [ ] **Step 3: Confirm no other importers remain**

Run: `grep -rn "assetFileService" packages --include="*.ts" --include="*.svelte" | grep -v node_modules | grep -v dist`
Expected: no results.

- [ ] **Step 4: Type-check `dtx-web`**

Run: `bun run --filter=dtx-web check`
Expected: no errors referencing `assetFileService` or `simfile.files`. (`LegacySimfile.files` is `{ key; size; uploaded }[] | undefined`, matching the adapter.)

- [ ] **Step 5: Commit**

```bash
git add "packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte"
git commit -m "$(cat <<'EOF'
refactor: render asset files from GraphQL getSimfile().files

Phase 6 — the chart detail page derives the uploaded-files list from the
simfile.files field already returned by GetSimfile, removing the redundant
/api/simFile/listFiles REST fetch. Delete @dtx/common assetFileService.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add the `dtx-api` `set.def` REST sidecar (TDD)

**Files:**

- Create: `packages/dtx-api/src/rest/setDef.ts`
- Create: `packages/dtx-api/src/rest/setDef.test.ts`
- Modify: `packages/dtx-api/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/rest/setDef.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { routeSetDef } from './setDef';
import type { Env } from '../env';
import type { R2Bucket } from '@cloudflare/workers-types';

const makeEnv = (get: ReturnType<typeof vi.fn>): Env =>
	({
		DB: {} as Env['DB'],
		DTXFILE_BUCKET: { get } as unknown as R2Bucket,
		RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
		SUPABASE_URL: '',
		SUPABASE_ANON_KEY: '',
		RATE_LIMIT_ENV: 'prod',
		GRAPHIQL: 'false',
		CORS_ALLOWED_ORIGINS: '',
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
		PUBLIC_SIMFILE_BUCKET_URL: '',
		SUPABASE_SERVICE_ROLE_KEY: ''
	}) as Env;

const req = () => new Request('https://api.test/simfiles/1002/set.def');

describe('routeSetDef', () => {
	it('rejects a non-numeric id with 400', async () => {
		const get = vi.fn();
		const res = await routeSetDef(req(), makeEnv(get), 'abc');
		expect(res.status).toBe(400);
		expect(get).not.toHaveBeenCalled();
	});

	it('returns 404 when the object is missing', async () => {
		const get = vi.fn().mockResolvedValue(null);
		const res = await routeSetDef(req(), makeEnv(get), '1002');
		expect(res.status).toBe(404);
		expect(get).toHaveBeenCalledWith('1002/set.def');
	});

	it('streams the object body when present', async () => {
		const body = new TextEncoder().encode('#TITLE Test\n');
		const get = vi.fn().mockResolvedValue({
			body: new Response(body).body
		});
		const res = await routeSetDef(req(), makeEnv(get), '1002');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('#TITLE Test');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter=dtx-api test -- setDef.test.ts`
Expected: FAIL with a module-not-found / `routeSetDef is not defined` error.

- [ ] **Step 3: Implement `setDef.ts`**

Create `packages/dtx-api/src/rest/setDef.ts`:

```ts
import type { Env } from '../env';

const textError = (status: number, message: string) => new Response(message, { status });

/**
 * Public passthrough for a simfile's set.def file, read from R2.
 * Unauthenticated by design — matches the editor's prior direct R2 read.
 */
export const routeSetDef = async (request: Request, env: Env, rawId: string): Promise<Response> => {
	if (!/^\d+$/.test(rawId)) {
		return textError(400, 'Invalid SimFile ID');
	}

	const object = await env.DTXFILE_BUCKET.get(`${rawId}/set.def`);
	if (!object) {
		return textError(404, `SimFile ${rawId} not found`);
	}

	return new Response(object.body, {
		headers: { 'content-type': 'application/octet-stream' }
	});
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter=dtx-api test -- setDef.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Register the route in `index.ts`**

In `packages/dtx-api/src/index.ts`:

1. Add the import next to the other rest imports:

```ts
import { routeSetDef } from './rest/setDef';
```

2. Add the pattern next to `downloadSimfilePattern`:

```ts
const setDefPattern = /^\/simfiles\/([^/]+)\/set\.def$/;
```

3. Add the route branch immediately before the final `return withCors(new Response('Not Found', { status: 404 }), request, env);`:

```ts
const setDefMatch = setDefPattern.exec(url.pathname);
if (setDefMatch) {
	if (request.method !== 'GET') return withCors(methodNotAllowed('GET'), request, env);
	return withCors(await safeRoute(() => routeSetDef(request, env, setDefMatch[1])), request, env);
}
```

- [ ] **Step 6: Run the full dtx-api suite**

Run: `bun run --filter=dtx-api test`
Expected: PASS, including `index.test.ts` (the new route does not break existing routing).

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-api/src/rest/setDef.ts packages/dtx-api/src/rest/setDef.test.ts packages/dtx-api/src/index.ts
git commit -m "$(cat <<'EOF'
feat(dtx-api): add GET /simfiles/:id/set.def R2 passthrough

Phase 6 — public sidecar that streams a simfile's set.def from R2, so the
dtx-web editor can stop reading R2 directly and dtx-web can drop its R2
binding. Unauthenticated, matching the editor's prior public read.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate the editor `set.def` read to `dtx-api`

**Files:**

- Modify: `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts`
- Modify: `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/page.server.test.ts`

- [ ] **Step 1: Rewrite the `load` function to fetch from `dtx-api`**

In `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts`:

1. Replace the imports at the top:

```ts
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';
```

2. Keep `parseDefFileContent` and the `SimFileMetadata` interface exactly as-is.
3. Replace the entire `export const load: PageServerLoad = async ({ params, platform }) => { ... }` function with:

```ts
export const load: PageServerLoad = async ({ params, fetch }) => {
	const { simfileID } = params;

	// If no simfileID, return empty metadata (local file mode)
	if (!simfileID) {
		return {
			simfileID: null,
			metadata: null
		};
	}

	const apiBase = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');

	// No API base configured, or local dev — defer to client-side fetching.
	if (!apiBase || dev) {
		return {
			simfileID,
			metadata: null
		};
	}

	try {
		// Fetch set.def from dtx-api (public passthrough to R2)
		const res = await fetch(`${apiBase}/simfiles/${simfileID}/set.def`);
		if (res.status === 404) {
			throw error(404, `SimFile ${simfileID} not found`);
		}
		if (!res.ok) {
			throw error(res.status, `Failed to load simfile metadata: ${res.status}`);
		}

		const arrayBuffer = await res.arrayBuffer();

		// Detect BOM and decode accordingly
		let textContent: string;
		const uint8 = new Uint8Array(arrayBuffer);
		if (uint8[0] === 0xff && uint8[1] === 0xfe) {
			// UTF-16LE BOM
			textContent = new TextDecoder('utf-16le').decode(arrayBuffer);
			if (textContent.charCodeAt(0) === 0xfeff) {
				textContent = textContent.slice(1);
			}
		} else if (uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
			// UTF-8 BOM
			textContent = new TextDecoder('utf-8').decode(arrayBuffer);
			if (textContent.charCodeAt(0) === 0xfeff) {
				textContent = textContent.slice(1);
			}
		} else {
			// Default to UTF-8
			textContent = new TextDecoder('utf-8').decode(arrayBuffer);
		}

		// Parse the def file content
		const metadata = await parseDefFileContent(textContent);

		return {
			simfileID,
			metadata
		};
	} catch (err) {
		console.error('Error loading simfile metadata:', err);

		// If this is already an HttpError from SvelteKit, re-throw it
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		// For other errors, create a proper error response
		const errorMessage = err instanceof Error ? err.message : 'Unknown error';
		throw error(500, `Failed to load simfile metadata: ${errorMessage}`);
	}
};
```

- [ ] **Step 2: Rewrite `page.server.test.ts` to drive the fetch path**

Replace the entire contents of `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/page.server.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock factories so the references are valid
const { envMock, publicEnvMock } = vi.hoisted(() => ({
	envMock: { dev: false },
	publicEnvMock: { env: { PUBLIC_DTX_API_URL: 'https://api.test' } }
}));

vi.mock('$app/environment', () => envMock);
vi.mock('$env/dynamic/public', () => publicEnvMock);

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, message: string) => {
		const err = new Error(message) as Error & { status: number; body: { message: string } };
		err.status = status;
		err.body = { message };
		throw err;
	})
}));

import { load } from './+page.server';

type EditorPageLoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

const requirePageLoadResult = (result: Awaited<ReturnType<typeof load>>): EditorPageLoadResult => {
	if (result === undefined) {
		throw new Error('Expected load() to return editor page data');
	}
	return result;
};

const callLoad = (simfileID: string, fetchImpl: typeof fetch): ReturnType<typeof load> =>
	load({ params: { simfileID }, fetch: fetchImpl } as unknown as Parameters<typeof load>[0]);

const arrayBufferResponse = (buffer: ArrayBuffer, status = 200) =>
	({
		status,
		ok: status >= 200 && status < 300,
		arrayBuffer: vi.fn().mockResolvedValue(buffer)
	}) as unknown as Response;

beforeEach(() => {
	envMock.dev = false;
	publicEnvMock.env.PUBLIC_DTX_API_URL = 'https://api.test';
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('editor/[[simfileID]]/+page.server load', () => {
	it('returns null metadata when no simfileID is provided', async () => {
		const result = requirePageLoadResult(
			await load({ params: { simfileID: '' } } as unknown as Parameters<typeof load>[0])
		);
		expect(result.simfileID).toBeNull();
		expect(result.metadata).toBeNull();
	});

	it('returns null metadata when PUBLIC_DTX_API_URL is not configured', async () => {
		publicEnvMock.env.PUBLIC_DTX_API_URL = '';
		const fetchSpy = vi.fn();
		const result = requirePageLoadResult(
			await callLoad('123', fetchSpy as unknown as typeof fetch)
		);
		expect(result.simfileID).toBe('123');
		expect(result.metadata).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns null metadata in dev mode without fetching', async () => {
		envMock.dev = true;
		const fetchSpy = vi.fn();
		const result = requirePageLoadResult(
			await callLoad('123', fetchSpy as unknown as typeof fetch)
		);
		expect(result.simfileID).toBe('123');
		expect(result.metadata).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('throws 404 when dtx-api returns 404', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response);
		await expect(callLoad('123', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 404
		});
		expect(fetchSpy).toHaveBeenCalledWith('https://api.test/simfiles/123/set.def');
	});

	it('parses def file content and returns metadata', async () => {
		const defContent = '#TITLE Test Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const buffer = new TextEncoder().encode(defContent).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(buffer));
		const result = requirePageLoadResult(
			await callLoad('123', fetchSpy as unknown as typeof fetch)
		);
		expect(result.simfileID).toBe('123');
		expect(result.metadata?.title).toBe('Test Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-16LE BOM encoded def file', async () => {
		const defText = '#TITLE BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const utf16Bytes = new Uint8Array(defText.length * 2);
		for (let i = 0; i < defText.length; i++) {
			const codePoint = defText.charCodeAt(i);
			utf16Bytes[i * 2] = codePoint & 0xff;
			utf16Bytes[i * 2 + 1] = (codePoint >> 8) & 0xff;
		}
		const bomBuffer = new Uint8Array([0xff, 0xfe, ...utf16Bytes]).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(bomBuffer));
		const result = requirePageLoadResult(
			await callLoad('bom', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-8 BOM encoded def file', async () => {
		const defText = '#TITLE UTF8 BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const textBytes = new TextEncoder().encode(defText);
		const bomBuffer = new Uint8Array([0xef, 0xbb, 0xbf, ...textBytes]).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(bomBuffer));
		const result = requirePageLoadResult(
			await callLoad('utf8bom', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('UTF8 BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('throws 500 when fetch rejects unexpectedly', async () => {
		const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
		await expect(callLoad('err', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 500
		});
	});

	it('parses title with colon separator', async () => {
		const defContent = '#TITLE:Colon Title\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const buffer = new TextEncoder().encode(defContent).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(buffer));
		const result = requirePageLoadResult(
			await callLoad('colon', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('Colon Title');
	});
});
```

- [ ] **Step 3: Run the editor server test**

Run: `bun run --filter=dtx-web test -- "page.server.test.ts"`
Expected: PASS. (The sibling `page.render.test.ts` / `page.test.ts` do not exercise the load's R2 path; if either fails referencing `platform`, fix the reference, but they should be unaffected.)

- [ ] **Step 4: Commit**

```bash
git add "packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts" "packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/page.server.test.ts"
git commit -m "$(cat <<'EOF'
refactor(dtx-web): editor loads set.def from dtx-api, not R2

Phase 6 — the editor server load fetches set.def from dtx-api's public
passthrough instead of reading platform.env.DTXFILE_BUCKET, removing
dtx-web's last R2 dependency. Dev/no-API-base still falls back to
client-side fetching.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Delete `routes/api/`, strip the `/api/` branch in `hooks.server.ts`, delete `db.ts`

**Files:**

- Delete: `packages/dtx-web/src/routes/api/` (entire tree)
- Delete: `packages/dtx-web/src/lib/server/db.ts`
- Delete: `packages/dtx-web/src/lib/server/db.test.ts`
- Modify: `packages/dtx-web/src/hooks.server.ts`
- Modify: `packages/dtx-web/src/hooks.server.test.ts`

- [ ] **Step 1: Delete the REST route tree and the D1 helper**

```bash
git rm -r packages/dtx-web/src/routes/api
git rm packages/dtx-web/src/lib/server/db.ts packages/dtx-web/src/lib/server/db.test.ts
```

- [ ] **Step 2: Strip the `/api/` block and dead helpers from `hooks.server.ts`**

In `packages/dtx-web/src/hooks.server.ts`:

1. Change the first import line from:

```ts
import { createClient } from '@supabase/supabase-js';
```

to (remove it entirely — `createClient` was only used in the bearer branch). Keep the `createServerClient` import on the next line.

2. Remove the now-unused dynamic env import:

```ts
import { env as dynamicEnv } from '$env/dynamic/public';
```

3. Keep `import { json, text } from '@sveltejs/kit';` — `json`/`text` are still used by the `csrf` handler.
4. Delete the entire `decodeJwtPayload` helper (the `const decodeJwtPayload = (token: string) => { ... };` block).
5. In `authGuard`, delete everything from the comment `// Handle unauthenticated API access for all /api/ routes` (the `const requestMethod = ...` block, all `isPublic*` consts, and the entire `if (!event.locals.session && event.url.pathname.startsWith('/api/')) { ... }` block) up to but **not** including the final `return resolve(event);`.

After the edit, `authGuard` ends:

```ts
	// Handle authenticated access to login page - preserve any redirect parameter
	if (event.locals.session && event.url.pathname === '/login') {
		// If there's a desktop redirect parameter, preserve it
		const redirectUrl = redirectParam === 'desktop' ? '/app?redirect=desktop' : '/app';
		redirect(303, redirectUrl);
	}

	return resolve(event);
};
```

- [ ] **Step 3: Remove the `/api/` tests from `hooks.server.test.ts`**

In `packages/dtx-web/src/hooks.server.test.ts`, delete every test and helper that exercises the `/api/` bearer-auth / public-route behavior (anything asserting on `Unauthorized`, bearer tokens, `decodeJwtPayload`, or `/api/...` paths within `authGuard`). Keep the `csrf`, `supabase`, and `authGuard` `/app` + `/login` redirect tests. If a `describe` block becomes empty, delete it.

- [ ] **Step 4: Confirm nothing else imports the deleted modules**

Run: `grep -rn "lib/server/db\|getDb\|routes/api" packages/dtx-web/src --include="*.ts" --include="*.svelte" | grep -v node_modules`
Expected: no results (the `.svelte-kit` generated types will refresh on the next `check`).

- [ ] **Step 5: Type-check + run the web test suite**

Run: `bun run --filter=dtx-web check`
Expected: no errors. (Generated route types under `.svelte-kit` regenerate without the `/api/*` entries.)

Run: `bun run --filter=dtx-web test -- hooks.server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-web/src/hooks.server.ts packages/dtx-web/src/hooks.server.test.ts
git commit -m "$(cat <<'EOF'
refactor(dtx-web): delete routes/api and the /api/ auth branch

Phase 6 — remove all legacy REST endpoints, the hooks.server.ts /api/
bearer-auth + public-route allowlist, and the now-unused getDb helper.
Supabase cookie sessions and the /app//login redirects are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Remove the D1/R2/KV bindings from `dtx-web`

**Files:**

- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/src/app.d.ts`

- [ ] **Step 1: Strip bindings from all three stanzas of `dtx-web/wrangler.jsonc`**

Edit `packages/dtx-web/wrangler.jsonc`:

1. **Top-level (prod):** delete the `r2_buckets` block (lines with `DTXFILE_BUCKET` / `simfile-dtx`), the `kv_namespaces` block (`RATE_LIMIT`), the `d1_databases` block (`DB` … `migrations_dir`), and the `"RATE_LIMIT_ENV": "prod",` entry inside `vars`. Keep `assets`, `vars.PUBLIC_USE_GRAPHQL_API`, `vars.PUBLIC_DTX_API_URL`, `keep_vars`, `observability`.
2. **`env.pre-prod`:** delete its `r2_buckets`, `kv_namespaces`, `d1_databases` blocks and the `"RATE_LIMIT_ENV": "pre-prod",` var. Keep `route`, `vars` (the two PUBLIC\_\* keys), and `services` (the `API` binding).
3. **`env.pre-prod-prod-data`:** delete its `r2_buckets`, `kv_namespaces`, `d1_databases` blocks and the `"RATE_LIMIT_ENV": "pre-prod-prod-data",` var. Keep `route`, `vars`, and `services`.

The resulting top-level object keeps: `name`, `main`, `compatibility_date`, `compatibility_flags`, `route`, `assets`, `vars` (2 PUBLIC keys), `keep_vars`, `observability`, `env`.

- [ ] **Step 2: Remove the binding types from `app.d.ts`**

In `packages/dtx-web/src/app.d.ts`:

1. Change the workers-types import (line 6) from:

```ts
import { Fetcher, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
```

to:

```ts
import { Fetcher } from '@cloudflare/workers-types';
```

2. Replace the `Platform` interface body so `env` only exposes the `API` service binding:

```ts
interface Platform {
	env?: {
		API: Fetcher;
	};
}
```

- [ ] **Step 3: Validate config + type-check**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/dtx-web/wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''))" && echo "JSON OK"`
Expected: `JSON OK` (no comments remain in this file, so plain JSON.parse works; the replace is a safety net).

Run: `bun run --filter=dtx-web check`
Expected: no errors referencing `DB`, `DTXFILE_BUCKET`, `RATE_LIMIT`, `R2Bucket`, or `KVNamespace`.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-web/wrangler.jsonc packages/dtx-web/src/app.d.ts
git commit -m "$(cat <<'EOF'
chore(dtx-web): remove D1/R2/KV bindings

Phase 6 — dtx-web no longer touches D1, R2, or KV (all data flows through
dtx-api). Drop the bindings from every wrangler stanza and from the
Platform.env types, keeping only the API service binding + ASSETS.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Move `d1-migrations/` to `dtx-api`

**Files:**

- Move: `packages/dtx-web/d1-migrations/` → `packages/dtx-api/d1-migrations/`
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `e2e/setup/prepare-stack.ts`

- [ ] **Step 1: Move the migrations directory**

```bash
git mv packages/dtx-web/d1-migrations packages/dtx-api/d1-migrations
```

Run: `ls packages/dtx-api/d1-migrations`
Expected: `0001_initial_schema.sql`.

- [ ] **Step 2: Add `migrations_dir` to `dtx-api`'s three stanzas**

In `packages/dtx-api/wrangler.jsonc`, add `"migrations_dir": "d1-migrations"` to each `d1_databases[0]` object:

1. Top-level (`database_name: "dtx-web"`, line ~26-32): after the `database_id` line add `,\n\t\t\t"migrations_dir": "d1-migrations"`.
2. `env.pre-prod` `d1_databases` (`dtx-web-preprod`): same addition.
3. `env.pre-prod-prod-data` `d1_databases` (`dtx-web`): same addition.

Each block becomes, e.g.:

```jsonc
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "dtx-web",
			"database_id": "19376000-d389-4e0e-a5a8-00d9e31a9ffb",
			"migrations_dir": "d1-migrations"
		}
	],
```

- [ ] **Step 3: Update the migration path in `prepare-stack.ts`**

In `e2e/setup/prepare-stack.ts`, change the `migration` constant from:

```ts
const migration = join(repoRoot, 'packages/dtx-web/d1-migrations/0001_initial_schema.sql');
```

to:

```ts
const migration = join(repoRoot, 'packages/dtx-api/d1-migrations/0001_initial_schema.sql');
```

- [ ] **Step 4: Confirm no stale references to the old path**

Run: `grep -rn "dtx-web/d1-migrations" packages e2e .github --include="*.ts" --include="*.jsonc" --include="*.yml" --include="*.json" 2>/dev/null | grep -v node_modules`
Expected: no results.

- [ ] **Step 5: Validate dtx-api config parses**

Run: `grep -c '"migrations_dir": "d1-migrations"' packages/dtx-api/wrangler.jsonc`
Expected: `3` (one per stanza).

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/wrangler.jsonc e2e/setup/prepare-stack.ts
git commit -m "$(cat <<'EOF'
chore: move d1-migrations from dtx-web to dtx-api

Phase 6 — dtx-api now owns the D1 schema. Move the migrations dir, add
migrations_dir to all three dtx-api wrangler stanzas, and repoint the e2e
prepare-stack migration path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Collapse the e2e parity gate to a single GraphQL leg

**Files:**

- Modify: `playwright.config.ts`
- Modify: `e2e/setup/prepare-stack.ts`
- Modify: `packages/dtx-web/svelte.config.js`
- Modify: `.github/workflows/e2e-test.yml`
- Delete: `e2e/next-display-id.spec.ts`

- [ ] **Step 1: Delete the spec that targets a deleted route**

```bash
git rm e2e/next-display-id.spec.ts
```

- [ ] **Step 2: Simplify `prepare-stack.ts` to always seed `dtx-api`**

In `e2e/setup/prepare-stack.ts`:

1. Delete the leg-selection lines:

```ts
const useGraphQL = process.env.E2E_USE_GRAPHQL === 'true';
const pkg = useGraphQL ? 'dtx-api' : 'dtx-web';
```

and replace with:

```ts
const pkg = 'dtx-api';
```

2. The rest of the file (which references `pkg`, `pkgDir`) is unchanged. The final `console.log` already interpolates `${pkg}`, so it now always reports `dtx-api`.

- [ ] **Step 3: Rewrite `playwright.config.ts` for a single GraphQL run**

Replace the entire contents of `playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';
import {
	TEST_SUPABASE_URL,
	TEST_SUPABASE_ANON_KEY,
	DTX_API_LOCAL_PORT,
	isAuthConfigured
} from './e2e/test-config';

// CI guard: fail loudly when auth secrets are not provisioned. Without this,
// Playwright exits 0 with zero auth-test coverage — the gate is then
// unenforced, invisibly.
if (process.env.CI && !isAuthConfigured) {
	throw new Error(
		'CI requires auth e2e secrets (E2E_USER_PASSWORD, E2E_USER_ID, ' +
			'E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_USER_EMAIL) ' +
			'to be set. The authenticated lifecycle test is the core of the gate.'
	);
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const apiURL = `http://localhost:${DTX_API_LOCAL_PORT}`;

// Shared Supabase env for the dtx-web dev server (cookie auth + client bearer).
const webSupabaseEnv = {
	PUBLIC_SUPABASE_URL: TEST_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' // render the blog Download button
};

// dtx-web serves with the GraphQL flag ON; dtx-api is seeded + booted as the
// single backend. No REST/platformProxy leg remains after Phase 6.
const webServers = [
	{
		command: 'bun run --filter=dtx-web dev',
		url: 'http://localhost:5173',
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			...process.env,
			VITE_E2E: 'true',
			PUBLIC_USE_GRAPHQL_API: 'true',
			PUBLIC_DTX_API_URL: apiURL,
			PUBLIC_SIMFILE_BUCKET_URL: process.env.PUBLIC_SIMFILE_BUCKET_URL ?? baseURL,
			VITE_DTX_SERVER_URL: process.env.VITE_DTX_SERVER_URL ?? baseURL,
			...webSupabaseEnv
		}
	},
	{
		command:
			'bun run e2e/setup/prepare-stack.ts && ' +
			'cd packages/dtx-api && bunx wrangler dev --port ' +
			DTX_API_LOCAL_PORT +
			' --persist-to .wrangler/state' +
			` --var SUPABASE_URL:"${TEST_SUPABASE_URL}"` +
			` --var SUPABASE_ANON_KEY:"${TEST_SUPABASE_ANON_KEY}"` +
			' --var CORS_ALLOWED_ORIGINS:"http://localhost:5173"' +
			' --var PUBLIC_ENABLE_BLOG_DOWNLOAD:"true"',
		url: `${apiURL}/graphql?query=%7B__typename%7D`,
		reuseExistingServer: false,
		timeout: 180_000,
		env: { ...process.env }
	}
];

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: { baseURL, trace: 'on-first-retry' },
	projects: [
		// Non-auth specs always run — they have no setup dependency.
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			testIgnore: [/global\.setup\.ts/, /auth-lifecycle\.spec\.ts/]
		},
		// Auth-dependent projects are included only when credentials are configured.
		...(isAuthConfigured
			? [
					{ name: 'setup', testMatch: /global\.setup\.ts/ },
					{
						name: 'chromium-auth',
						use: { ...devices['Desktop Chrome'] },
						testMatch: /auth-lifecycle\.spec\.ts/,
						dependencies: ['setup']
					}
				]
			: [])
	],
	webServer: webServers
});
```

- [ ] **Step 4: Remove the dead `platformProxy` gate from `svelte.config.js`**

In `packages/dtx-web/svelte.config.js`, replace the adapter block:

```js
		adapter: adapter({
			fallback: 'plaintext',
			// e2e-only: surface real local Miniflare bindings (DB/R2/KV) under `vite dev`.
			// Inert in normal dev and in production builds (env var unset) — keeps the
			// existing mock-D1 dev behavior for everyone else.
			...(process.env.E2E_PLATFORM_PROXY === '1' ? { platformProxy: {} } : {})
		}),
```

with:

```js
		adapter: adapter({
			fallback: 'plaintext'
		}),
```

- [ ] **Step 5: Collapse the CI matrix in `.github/workflows/e2e-test.yml`**

In `.github/workflows/e2e-test.yml`:

1. Delete the `strategy:` block (the `fail-fast` + `matrix: use_graphql: [false, true]` lines).
2. In `env:`, delete the `E2E_USE_GRAPHQL: ${{ matrix.use_graphql }}` line. Keep the `E2E_USER_*` lines.
3. Change the test step name from `Run Playwright tests (flag=${{ matrix.use_graphql }})` to `Run Playwright tests`.
4. Change the artifact `name:` from `playwright-report-graphql-${{ matrix.use_graphql }}` to `playwright-report`.

The `jobs.test` block keeps `timeout-minutes`, `runs-on`, the `env` block (now without `E2E_USE_GRAPHQL`), and all steps.

- [ ] **Step 6: Validate the workflow YAML + confirm no stale flag refs**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e-test.yml')); print('YAML OK')"`
Expected: `YAML OK`.

Run: `grep -rn "E2E_USE_GRAPHQL\|E2E_PLATFORM_PROXY\|use_graphql\|platformProxy" playwright.config.ts e2e .github packages/dtx-web/svelte.config.js | grep -v node_modules`
Expected: no results.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/setup/prepare-stack.ts packages/dtx-web/svelte.config.js .github/workflows/e2e-test.yml
git commit -m "$(cat <<'EOF'
test(e2e): collapse parity gate to a single GraphQL leg

Phase 6 — REST is gone, so the flag-OFF leg can't run. Drop the
use_graphql matrix, the E2E_PLATFORM_PROXY platformProxy gate, and the
dtx-web seeding branch; always seed+boot dtx-api with the flag ON. Delete
next-display-id.spec.ts (targeted a deleted route).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check + lint the whole repo**

Run: `bun run --filter=dtx-web check`
Expected: green.

Run: `bun run lint`
Expected: green (no unused imports left behind in `hooks.server.ts`, `client.ts`, `app.d.ts`).

- [ ] **Step 2: Run all unit suites**

Run: `bun run --filter=@dtx/common test`
Expected: green (no `assetFileService` test failures; it's deleted).

Run: `bun run --filter=dtx-web test`
Expected: green (no `routes/api/*` tests remain; lib/api + hooks + editor tests pass).

Run: `bun run --filter=dtx-api test`
Expected: green (new `setDef.test.ts` + existing routing tests pass).

- [ ] **Step 3: Confirm REST is fully gone from `dtx-web`**

Run: `grep -rn "useGraphQL\|/api/chart\|/api/simFile\|/api/user\|/api/auth\|routes/api\|DTXFILE_BUCKET\|RATE_LIMIT\b\|getDb" packages/dtx-web/src --include="*.ts" --include="*.svelte" | grep -v node_modules`
Expected: no results.

- [ ] **Step 4: Run the e2e gate locally (single leg)**

Run: `bunx playwright test`
Expected: the `chromium` non-auth specs pass; if auth creds are configured locally, `setup` + `chromium-auth` also pass. (If creds are not configured, the auth projects are skipped per `isAuthConfigured` — that is expected locally.)

- [ ] **Step 5: Confirm the change surface**

Run: `git diff --stat main -- . ':(exclude)docs'`
Expected: changes only under `packages/dtx-web` (lib/api, routes/api deletions, hooks, app.d.ts, wrangler.jsonc, svelte.config.js, editor), `packages/dtx-api` (setDef + index + wrangler + d1-migrations), `packages/common` (assetFileService deletion), `e2e/`, `playwright.config.ts`, `.github/workflows/e2e-test.yml`. No `PUBLIC_USE_GRAPHQL_API` value changed from `"true"`.

- [ ] **Step 6: Clean up local Miniflare state**

```bash
rm -rf packages/dtx-api/.wrangler/state packages/dtx-web/.wrangler/state e2e/.auth
```

---

## Self-review checklist (for the implementer before opening a PR)

- [ ] All three package unit suites + `bun run --filter=dtx-web check` + `bun run lint` pass (Task 11 §1–2).
- [ ] No `useGraphQL`, `routes/api`, `getDb`, or data-binding references remain in `dtx-web/src` (Task 11 §3).
- [ ] `d1-migrations/` lives only under `packages/dtx-api/`; both wrangler files are consistent (Task 9).
- [ ] e2e runs a single GraphQL leg; matrix + `E2E_PLATFORM_PROXY` gate removed; `next-display-id.spec.ts` deleted (Task 10).
- [ ] PR description records the deploy order: **dtx-api first (set.def + migrations), then dtx-web (no bindings).**
- [ ] No deployed `PUBLIC_USE_GRAPHQL_API` value changed.
