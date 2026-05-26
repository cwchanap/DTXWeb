# API Migration Phase 3 — Client Integration (web flag-OFF + desktop hard-cut prep)

**Date:** 2026-05-25
**Parent spec:** [docs/superpowers/specs/2026-05-16-api-server-migration-design.md](2026-05-16-api-server-migration-design.md)
**Phase 0 plan:** [docs/superpowers/plans/2026-05-16-api-migration-phase-0.md](../plans/2026-05-16-api-migration-phase-0.md) (complete)
**Phase 1 plan:** [docs/superpowers/plans/2026-05-18-api-migration-phase-1.md](../plans/2026-05-18-api-migration-phase-1.md) (complete)
**Phase 2 plan:** [docs/superpowers/plans/2026-05-19-api-migration-phase-2.md](../plans/2026-05-19-api-migration-phase-2.md) (complete)
**Packages:** modifies `packages/dtx-web` and `packages/dtx-desktop`; no changes to `packages/dtx-api` or `packages/common`.

## Goal

Add a typed GraphQL client layer (`lib/api/` on web, `src/main/api-client.ts` rewrite on desktop) to both `dtx-web` and `dtx-desktop` so that:

- **dtx-web** ships dual-path dispatch behind a `PUBLIC_USE_GRAPHQL_API` flag (default `false`). Every fetch call-site that today hits `/api/*` routes goes through a typed function in `src/lib/api/`. With the flag OFF the new code falls through to existing REST endpoints — no behavior change for users. With the flag ON (Phase 4) the same call-sites dispatch to `api.pre-prod.dtx.hapadona.com` / `api.dtx.hapadona.com`. A single env-var flip cuts web traffic over.
- **dtx-desktop** hard-cuts to GraphQL — no dual path, no build-time flag. All REST call-sites in `simfile-service.ts` swap to typed GraphQL helpers; the existing `ApiResult<T>` envelope is preserved at the boundary so downstream IPC code is unchanged. The `/api/simFile/upload` multipart POST becomes `/upload` against dtx-api.

Phase 3 ships the code; Phase 3 does **not** flip the web flag and does **not** ship a production desktop release. A pre-prod desktop build pointing at `api.pre-prod.dtx.hapadona.com` is produced manually for validation.

## Non-goals

- Flipping `PUBLIC_USE_GRAPHQL_API=true` on web (Phase 4 on pre-prod, Phase 5 on prod).
- Deploying `dtx-api` to production (Phase 5).
- Shipping a production desktop release / GitHub release (Phase 5).
- Deleting `packages/dtx-web/src/routes/api/*` REST routes (Phase 6).
- Removing dtx-web's `D1` / `DTXFILE_BUCKET` / `RATE_LIMIT` bindings (Phase 6).
- Migrating the editor's SSR `+page.server.ts` direct R2 read (`packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.server.ts`) — stays on `platform.env.DTXFILE_BUCKET` until Phase 6 when the binding moves.
- Changes to `packages/dtx-api/` or `packages/common/`.

## Current state

- Phase 2 is complete on `main`. `dtx-api` is deployed at `api.pre-prod.dtx.hapadona.com` with all five GraphQL queries, five mutations, and three REST sidecars (`/upload`, `/downloads/:id`, `/downloads/bulk`). The committed schema artifact lives at `packages/dtx-api/dist/schema.graphql`.
- dtx-web has six client fetch call-sites against `/api/*` (see [Call-site mapping](#call-site-mapping)), one `<a href="/api/simFile/download/...">` anchor in `DownloadDropdown.svelte`, and the bulk-download helper in `lib/components/ChartList.helpers.ts`. None of dtx-web's SSR `load()` functions call `/api/*` today — the only SSR data load that touches a platform binding is the editor reading R2 directly.
- dtx-desktop's `src/main/api-client.ts` exposes generic `apiGet/apiPost/apiPatch` returning `ApiResult<T> = { success, data } | { success, error }`. Call-sites split across `src/main/simfile-service.ts` (bearer-authenticated REST + multipart upload) and `src/main/index.ts` IPC handlers. Two call-sites in `index.ts` (`listFiles` and `upload-file`) use a **cookie-session hack** — they build SvelteKit-shaped session cookies manually and pass them in the `Cookie` header to dtx-web. That hack disappears after Phase 3 since dtx-api accepts bearer auth uniformly. The renderer process makes no direct API calls; all access goes through IPC.

## Design

### Architecture overview

```text
                         Phase 3 end state
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (dtx.hapadona.com / pre-prod.dtx.hapadona.com)              │
│   svelte components → lib/api/{chart,user,auth}.ts                  │
│     ├── PUBLIC_USE_GRAPHQL_API=false (default this phase)           │
│     │     → fetch('/api/...') — existing dtx-web routes              │
│     └── PUBLIC_USE_GRAPHQL_API=true (Phase 4+)                       │
│           → fetch('https://api.{env}.dtx.hapadona.com/graphql')      │
│                                                                      │
│ SSR (dtx-web Worker)                                                 │
│   no SSR call-sites today; service binding declared in wrangler     │
│   ready for Phase 4+ via platform.env.API.fetch(...)                 │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Desktop (Electron main process)                                      │
│   simfile-service.ts → api-client.ts (rewritten on top of GraphQL)   │
│     graphql-request client → ${VITE_DTX_SERVER_URL}/graphql         │
│   upload.ts → POST multipart to ${VITE_DTX_SERVER_URL}/upload       │
│   VITE_DTX_SERVER_URL = api.pre-prod.dtx.hapadona.com (pre-prod      │
│     build only; prod build deferred to Phase 5)                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Tooling & dependencies

| Package                 | Add                                                                                                                                     | Purpose                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `dtx-web` (deps)        | `graphql`, `graphql-request`                                                                                                            | GraphQL document parsing + transport |
| `dtx-web` (devDeps)     | `@graphql-codegen/cli`, `@graphql-codegen/typescript`, `@graphql-codegen/typescript-operations`, `@graphql-codegen/typed-document-node` | Codegen at build time                |
| `dtx-desktop` (deps)    | `graphql`, `graphql-request`                                                                                                            | Same                                 |
| `dtx-desktop` (devDeps) | Same codegen plugins as dtx-web                                                                                                         | Same                                 |

Pins are resolved at `bun install`; the implementation plan records the exact versions.

### dtx-web layout (additions only)

```text
packages/dtx-web/
├── wrangler.jsonc                       (+ services binding on pre-prod & pre-prod-prod-data stanzas;
│                                          + PUBLIC_USE_GRAPHQL_API & PUBLIC_DTX_API_URL per env)
├── codegen.ts                           NEW: graphql-codegen config (TS)
├── package.json                         (+ graphql, graphql-request, @graphql-codegen/*)
└── src/
    ├── app.d.ts                         (+ App.Platform.env.API: Fetcher)
    └── lib/
        └── api/
            ├── client.ts                NEW: dispatch — browser vs SSR; useGraphQL() flag check
            ├── transport.ts             NEW: GraphQLClient factory; service-binding fetch wrapper
            ├── transport.test.ts        NEW
            ├── token.ts                 NEW: getAccessToken() reads Supabase session (browser)
            ├── operations/
            │   ├── chart.graphql        NEW: listSimfiles, getSimfile, createSimfile, updateSimfile,
            │   │                              deleteSimfile, nextDisplayId, simfileSearch
            │   ├── user.graphql         NEW: me, upsertUserProfile
            │   └── auth.graphql         NEW: generateMagicLink
            ├── rest/
            │   ├── download.ts          NEW: dtx-api REST callers (/downloads/:id, /downloads/bulk)
            │   └── download.test.ts     NEW
            ├── generated/
            │   └── graphql.ts           NEW (committed): codegen output, TypedDocumentNode per op
            ├── chart.ts                 NEW: high-level functions used by call-sites
            ├── chart.test.ts            NEW
            ├── user.ts                  NEW
            ├── user.test.ts             NEW
            ├── auth.ts                  NEW
            ├── auth.test.ts             NEW
            └── index.ts                 NEW: barrel re-export
```

#### Dispatch model

```ts
// lib/api/client.ts
import { env } from '$env/dynamic/public';

export const useGraphQL = (): boolean => env.PUBLIC_USE_GRAPHQL_API === 'true';

export type ClientCtx = {
	fetch?: typeof fetch; // SSR injects event.fetch
	platform?: App.Platform; // SSR passes platform for service binding
	accessToken?: string; // SSR pre-resolves bearer from event.locals
};

export const getClient = (ctx?: ClientCtx) => {
	if (ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken);
	}
	return makeBrowserClient(env.PUBLIC_DTX_API_URL);
};
```

Each high-level function in `chart.ts` / `user.ts` / `auth.ts` has the shape:

```ts
export const listSimfiles = async (params: ListParams, ctx?: ClientCtx) => {
	if (!useGraphQL()) return restListSimfiles(params, ctx?.fetch);
	const data = await getClient(ctx).request(ListSimfilesDocument, params);
	return toLegacyShape(data.simfiles);
};
```

`toLegacyShape()` adapts GraphQL output to the existing REST response shape so flag flips are byte-identical at consumers. The REST response for `/api/chart` is already `{ data: [...], count: N }` — the GraphQL `SimfileConnection` matches almost 1:1, so the adapter is small.

#### Service binding

Declared in `wrangler.jsonc` on `pre-prod` and `pre-prod-prod-data` stanzas only. Prod stanza adds it in Phase 5 alongside the dtx-api prod deploy.

```jsonc
"services": [
    { "binding": "API", "service": "dtx-api", "environment": "pre-prod" }
]
```

SSR dispatch (unused this phase, ready for Phase 4+):

```ts
const makeServiceBindingClient = (binding: Fetcher, token?: string) => ({
	request: async (doc, vars) => {
		const res = await binding.fetch(
			new Request('https://api.internal/graphql', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(token ? { authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ query: print(doc), variables: vars })
			})
		);
		const json = await res.json();
		if (json.errors) throw new GraphQLError(json.errors);
		return json.data;
	}
});
```

#### Env vars (`wrangler.jsonc`)

```jsonc
// prod
"vars": {
    "RATE_LIMIT_ENV": "prod",
    "PUBLIC_USE_GRAPHQL_API": "false",
    "PUBLIC_DTX_API_URL": "https://api.dtx.hapadona.com"
}
// pre-prod & pre-prod-prod-data
"vars": {
    "RATE_LIMIT_ENV": "...",
    "PUBLIC_USE_GRAPHQL_API": "false",
    "PUBLIC_DTX_API_URL": "https://api.pre-prod.dtx.hapadona.com"
}
```

### Call-site mapping

| Location                                      | Today                                                          | After Phase 3                                                         |
| --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `lib/components/ChartList.svelte:103`         | `fetch('/api/chart?${params}')`                                | `await listSimfiles({ scope, search, page, pageSize })`               |
| `lib/components/ChartList.svelte:61`          | `fetch('/api/chart/${id}', PATCH)`                             | `await updateSimfile(id, input)`                                      |
| `lib/components/ChartList.svelte:155`         | `fetch('/api/simFile/delete/${id}', DELETE)`                   | `await deleteSimfile(id)`                                             |
| `routes/(app)/app/+page.svelte:30`            | `fetch('/api/auth/generate-magic-link', POST)`                 | `await generateMagicLink()`                                           |
| `routes/(app)/app/chart/[id]/+page.svelte:26` | `fetch('/api/chart/${id}')`                                    | `await getSimfile(id)` (selects all fields including `files`)         |
| `routes/(app)/app/chart/[id]/+page.svelte:66` | `fetch('/api/chart/${id}', PATCH)`                             | `await updateSimfile(id, input)`                                      |
| `lib/components/ChartList.helpers.ts:120,142` | `fetch('/api/simFile/download/bulk', ...)` (and `?validate=1`) | `await bulkDownload({ ids, validate })` in `lib/api/rest/download.ts` |
| `lib/components/DownloadDropdown.svelte:39`   | `<a href="/api/simFile/download/{simfileId}">`                 | `<button on:click={() => downloadSimfile(simfileId)}>`                |

Scope mapping for `listSimfiles`: REST string `'mine'|'published'` ↔ GraphQL enum `SimfileScope.MINE|PUBLISHED`. The adapter handles both directions.

### Anchor → button refactor

`DownloadDropdown.svelte` swaps the anchor for a button that calls `downloadSimfile(simfileId)`:

```ts
// lib/api/rest/download.ts
export const downloadSimfile = async (simfileId: string, opts?: { fetchFn?: typeof fetch }) => {
	const fetchFn = opts?.fetchFn ?? fetch;
	const url = useGraphQL()
		? `${env.PUBLIC_DTX_API_URL}/downloads/${simfileId}`
		: `/api/simFile/download/${simfileId}`;
	const headers: Record<string, string> = {};
	if (useGraphQL()) {
		const token = await getAccessTokenOrNull();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetchFn(url, { headers });
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const filename =
		parseContentDisposition(res.headers.get('content-disposition')) ?? `chart-${simfileId}.zip`;
	triggerBrowserDownload(blob, filename);
};
```

- Published files: anonymous fetch works (no token).
- Unpublished files: caller is authenticated (only the owner can reach the button).
- `triggerBrowserDownload` uses the standard `URL.createObjectURL` + programmatic `<a download>` click pattern.
- Accessibility: new button has `aria-label`, `tabindex="0"`, keyboard handler, focus state — matches the project's CLAUDE.md a11y rule.

### Bulk-download adapter

`ChartList.helpers.ts` keeps its `submitBulkDownload` / `validateBulkDownload` shape — only the URL builder + `Authorization` header (when flag ON and a session exists) change:

```ts
// lib/api/rest/download.ts
const bulkBaseUrl = () =>
	useGraphQL() ? `${env.PUBLIC_DTX_API_URL}/downloads/bulk` : '/api/simFile/download/bulk';

export const bulkDownload = async (args: {
	ids: number[];
	validate?: boolean;
	fetchFn?: typeof fetch;
}) => {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (useGraphQL()) {
		const token = await getAccessTokenOrNull();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const url = bulkBaseUrl() + (args.validate ? '?validate=1' : '');
	return (args.fetchFn ?? fetch)(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ ids: args.ids })
	});
};
```

Anonymous bulk download for the blog continues to work — dtx-api's `/downloads/bulk` already implements the `PUBLIC_ENABLE_BLOG_DOWNLOAD` gate from Phase 2.

### dtx-desktop layout

```text
packages/dtx-desktop/
├── package.json                         (+ graphql, graphql-request, @graphql-codegen/*)
├── codegen.ts                           NEW: codegen config; schema source = packages/dtx-api/dist/schema.graphql
└── src/
    └── main/
        ├── api-client.ts                REWRITE: same exports semantically, GraphQL transport
        ├── api-client.test.ts           REWRITE
        ├── graphql/
        │   ├── client.ts                NEW: GraphQLClient factory + bearer + timeout
        │   ├── operations/
        │   │   ├── chart.graphql        NEW
        │   │   ├── user.graphql         NEW
        │   │   └── auth.graphql         NEW
        │   └── generated/
        │       └── graphql.ts           NEW (committed): codegen output
        ├── upload.ts                    NEW (extracted): POST multipart to ${VITE_DTX_SERVER_URL}/upload
        ├── upload.test.ts               NEW
        ├── simfile-service.ts           MODIFIED: 4 call-sites swap to typed wrappers
        ├── simfile-service.test.ts      MODIFIED
        ├── index.ts                     MODIFIED: 5 IPC-handler call-sites swap; 2 cookie-session hacks removed
        └── index.test.ts                MODIFIED
```

#### Transport strategy

The current `api-client.ts` exposes generic `apiGet/apiPost/apiPatch`. After Phase 3 those are deleted and replaced with operation-specific functions that preserve the `ApiResult<T>` envelope:

```ts
// packages/dtx-desktop/src/main/api-client.ts (after)
import { GraphQLClient, ClientError } from 'graphql-request';
import { ListSimfilesDocument /* … */ } from './graphql/generated/graphql';

export type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

const runGraphQL = async <T, V>(doc: TypedDocumentNode<T, V>, vars: V): Promise<ApiResult<T>> => {
	try {
		const data = await getClient().request(doc, vars);
		return { success: true, data };
	} catch (err) {
		if (err instanceof ClientError) {
			const code = err.response.errors?.[0]?.extensions?.code;
			const msg = err.response.errors?.[0]?.message ?? `HTTP ${err.response.status}`;
			return { success: false, error: code ? `${code}: ${msg}` : msg };
		}
		return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
	}
};

export const listSimfiles = (params: ListArgs) => runGraphQL(ListSimfilesDocument, params);
export const getSimfile = (id: string) => runGraphQL(GetSimfileDocument, { id });
export const createSimfile = (input: CreateSimfileInput) =>
	runGraphQL(CreateSimfileDocument, { input });
export const updateSimfile = (id: string, input: UpdateSimfileInput) =>
	runGraphQL(UpdateSimfileDocument, { id, input });
export const deleteSimfile = (id: string) => runGraphQL(DeleteSimfileDocument, { id });
export const nextDisplayId = () => runGraphQL(NextDisplayIdDocument, {});
export const simfileSearch = (args: SearchArgs) => runGraphQL(SimfileSearchDocument, args);
export const me = () => runGraphQL(MeDocument, {});
export const upsertUserProfile = (input: UpsertUserProfileInput) =>
	runGraphQL(UpsertUserProfileDocument, { input });
export const generateMagicLink = () => runGraphQL(GenerateMagicLinkDocument, {});
```

`fetchWithTimeout` (today's helper) is preserved and reused by the `GraphQLClient` constructor and the upload helper.

#### Upload

Extracted to `upload.ts` because it's multipart and stays REST:

```ts
// packages/dtx-desktop/src/main/upload.ts
export const uploadFile = async (formData: FormData): Promise<ApiResult<UploadResponse>> => {
	try {
		const token = await getAccessToken();
		const res = await fetchWithTimeout(`${getApiBaseUrl()}/upload`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'DTXDesktopApp' },
			body: formData
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: res.statusText }));
			return { success: false, error: err.error || `HTTP ${res.status}` };
		}
		const data = await res.json();
		return { success: true, data };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
	}
};
```

#### Complete dtx-desktop call-site inventory

Nine call-sites across two files. The two cookie-session-based ones in `index.ts` collapse into the standard bearer path — Phase 3 removes ~100 lines of duplicated cookie-shaping code as a side benefit.

`src/main/simfile-service.ts`:

| Line     | Current call                                                              | After                                                        |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ~37, ~53 | `apiGet('/api/chart?scope=mine&page=...&pageSize=...')` (pagination loop) | `listSimfiles({ scope: SimfileScope.MINE, page, pageSize })` |
| ~86      | `apiGet('/api/chart/next-display-id')`                                    | `nextDisplayId()`                                            |
| ~174     | `fetch(\`${apiBaseUrl}/api/simFile/upload\`, multipart, bearer) `         | `uploadFile(formData)`                                       |
| ~312     | `apiPost('/api/chart', body)`                                             | `createSimfile(input)`                                       |

`src/main/index.ts` IPC handlers:

| Line | Current call                                                                                                       | After                                                          | Notes                          |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------ |
| ~366 | direct `fetch(\`${apiBaseUrl}/api/simFile/listFiles/${simfileId}\`)` with **session-cookie hack** (lines ~352–372) | `getSimfile(id) { files { key, size, uploaded } }` with bearer | Cookie-shaping code disappears |
| ~413 | `apiGet('/api/chart/search?...')`                                                                                  | `simfileSearch({ query, excludeIds, limit })`                  |                                |
| ~433 | `apiGet('/api/chart/${cloudSongId}')`                                                                              | `getSimfile(id)`                                               |                                |
| ~459 | `apiPatch('/api/chart/${simfileId}', body)`                                                                        | `updateSimfile(id, input)`                                     |                                |
| ~632 | direct `fetch(\`${apiBaseUrl}/api/simFile/upload\`, multipart) with **session-cookie hack** (lines ~615–640)       | `uploadFile(formData)` (same helper as line ~174)              | Cookie-shaping code disappears |

The renderer process (`src/renderer/`) makes no direct API calls; all access goes through IPC, so renderer files are untouched in Phase 3.

#### `getApiBaseUrl()` semantic shift

Today's helper returns `VITE_DTX_SERVER_URL`. Semantically that pointed at dtx-web's root and call-sites appended `/api/...`. After Phase 3 it points at dtx-api's root and call-sites append `/graphql` or `/upload` (no `/api` prefix). Validator (URL must exist, must start with `http`) is preserved.

#### Removed code

`apiGet`, `apiPost`, `apiPatch`, `apiRequest`, `hasJsonResponseBody`, the `path: string` argument convention. These are deleted, not deprecated. Production desktop release deferred to Phase 5 — no in-flight callers to worry about.

#### Auth flow

Unchanged. `getAccessToken()` continues to read the Supabase session via `getSupabaseClient()`; the same bearer works against dtx-api.

### Codegen

Both packages get a `codegen.ts` config consuming `packages/dtx-api/dist/schema.graphql`:

```ts
// packages/dtx-web/codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: '../dtx-api/dist/schema.graphql',
	documents: ['src/lib/api/operations/**/*.graphql'],
	generates: {
		'src/lib/api/generated/graphql.ts': {
			plugins: ['typescript', 'typescript-operations', 'typed-document-node']
		}
	}
};

export default config;
```

```ts
// packages/dtx-desktop/codegen.ts — same shape, paths adjusted to src/main/graphql/
```

`package.json` scripts in each package:

```jsonc
"codegen": "graphql-codegen --config codegen.ts",
"lint:codegen": "bun run codegen && git diff --exit-code"
```

`lint:codegen` runs in CI; a drift between the committed schema and the generated types fails the build. Generated files are committed to git.

### Testing strategy

| Layer                   | Files                                                                                                 | Coverage                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dtx-web client unit     | `lib/api/chart.test.ts`, `user.test.ts`, `auth.test.ts`, `transport.test.ts`, `rest/download.test.ts` | Mock `GraphQLClient.request` and global `fetch`. Each high-level function tested with `useGraphQL=true` and `useGraphQL=false`, asserting (a) correct underlying call, (b) byte-identical return shape across both paths, (c) bearer header included only when flag ON.                                                                              |
| dtx-desktop unit        | `api-client.test.ts` (rewrite), `upload.test.ts`                                                      | Mock `GraphQLClient.request`. Each exported function: happy path → `{ success: true, data }`; GraphQL error → `{ success: false, error: 'CODE: message' }`; network error → `{ success: false, error }`. Timeout path covered.                                                                                                                       |
| Component               | `ChartList.svelte` test (existing), chart page test (existing), `DownloadDropdown` test (extend)      | Update mocks to stub `lib/api/chart` functions in addition to `fetch`. Run dual-path where adapter shape differs. New a11y assertion on `DownloadDropdown` button (aria-label, keyboard handler).                                                                                                                                                    |
| Schema drift            | CI: `lint:codegen` in dtx-web + dtx-desktop                                                           | Regenerates types; `git diff --exit-code` fails if schema artifact has drifted from generated types.                                                                                                                                                                                                                                                 |
| Manual smoke (pre-prod) | n/a                                                                                                   | After deploy: (1) flag OFF — verify no requests hit `api.pre-prod`; existing REST works; (2) toggle flag ON via dashboard — verify all 6 web call-sites, bulk download, single download work against `api.pre-prod`; (3) toggle back to OFF. Then run desktop pre-prod build against pre-prod dtx-api and verify list/upload/edit/delete/magic-link. |

E2E tests (Playwright) stay scoped to the four critical journeys defined in the parent spec. They aren't expanded in Phase 3 — flag is OFF on prod, so existing e2e suite continues to pass against REST.

### Deployment & verification (pre-prod)

1. `bun install` (picks up graphql, graphql-request, codegen plugins).
2. `bun run --filter=dtx-web codegen && bun run --filter=dtx-desktop codegen` → commit generated files.
3. `bun run lint && bun run test` — all green.
4. `bun run --filter=dtx-web build && bun run deploy:web:preprod`. Flag stays `false`. Service binding declared (resolves because dtx-api pre-prod exists).
5. Smoke-verify `pre-prod.dtx.hapadona.com`:
    - DevTools Network: no requests to `api.pre-prod.dtx.hapadona.com`.
    - Login, list, edit, delete, download single + bulk, magic link — all work via existing `/api/*` routes.
    - `wrangler tail --env pre-prod` shows no service-binding errors.
6. Dashboard flip `PUBLIC_USE_GRAPHQL_API=true` (or `wrangler deploy --env pre-prod` with the var overridden):
    - Same flows again — verify each call now hits `api.pre-prod.dtx.hapadona.com`.
    - Single-download button + bulk download work; magic link works.
    - Flip back to `false` to leave pre-prod in steady state.
7. Production deploy: `bun run deploy:web`. Prod stanza has flag `false` and **no** service binding declared (prod dtx-api doesn't exist yet). Service binding added in Phase 5.
8. Desktop pre-prod build: `VITE_DTX_SERVER_URL=https://api.pre-prod.dtx.hapadona.com bun run --filter=dtx-desktop build`. Smoke locally (chart list, upload `.dtx`, edit, delete, magic link). No GitHub release.

### Error model & response shape adapters

GraphQL operations return errors as `{ errors: [{ message, extensions: { code } }] }`. The web `toLegacyShape()` adapter and the desktop `runGraphQL()` wrapper map these to the existing error shapes:

| GraphQL code     | HTTP analog | REST today                         | dtx-web adapter                | dtx-desktop envelope                               |
| ---------------- | ----------- | ---------------------------------- | ------------------------------ | -------------------------------------------------- |
| `UNAUTHORIZED`   | 401         | `{ error: 'Unauthorized' }` w/ 401 | throws `Error('Unauthorized')` | `{ success: false, error: 'UNAUTHORIZED: ...' }`   |
| `FORBIDDEN`      | 403         | `{ error }` w/ 403                 | throws `Error`                 | `{ success: false, error: 'FORBIDDEN: ...' }`      |
| `NOT_FOUND`      | 404         | 404                                | throws `Error`                 | `{ success: false, error: 'NOT_FOUND: ...' }`      |
| `BAD_USER_INPUT` | 400         | `{ error }` w/ 400                 | throws `Error`                 | `{ success: false, error: 'BAD_USER_INPUT: ...' }` |
| `RATE_LIMITED`   | 429         | 429                                | throws `Error`                 | `{ success: false, error: 'RATE_LIMITED: ...' }`   |
| `INTERNAL`       | 500         | 500                                | throws `Error`                 | `{ success: false, error: 'INTERNAL: ...' }`       |

REST sidecar errors (download/upload) come through as plain HTTP status + `{ error }` body — adapter logic unchanged from existing helpers.

### Risks & mitigations

| Risk                                                                                    | Mitigation                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod dtx-web declares a service binding to a prod dtx-api Worker that doesn't exist yet | **Decision:** declare service binding only on pre-prod stanzas in Phase 3. Prod stanza gets the binding in Phase 5 alongside dtx-api prod deploy. Documented in [Deployment](#deployment--verification-pre-prod) step 7.                                       |
| GraphQL response shape ≠ REST response shape at adapter boundary                        | `toLegacyShape()` is thin and per-operation. Each `lib/api/*.test.ts` asserts byte-equivalence between REST and GraphQL paths for the representative payloads each call-site uses. Drift fails CI at PR time.                                                  |
| Codegen output drifts from committed schema                                             | CI runs `lint:codegen` (regenerate + `git diff --exit-code`) in both packages. Schema changes must regenerate consumer types in the same PR.                                                                                                                   |
| Service-binding env-name mismatch (Cloudflare strict on env names)                      | Phase 1+2 deployed `dtx-api` with `--env pre-prod`. The stanza in `wrangler.jsonc` uses `"environment": "pre-prod"` exactly. `wrangler deploy --dry-run` is part of the implementation plan checklist.                                                         |
| Anchor → button accessibility regression on `DownloadDropdown`                          | New button gets `aria-label`, `tabindex="0"`, keyboard handler, focus state — matches the project's CLAUDE.md a11y rule. Component test gets an a11y assertion.                                                                                                |
| Desktop `User-Agent: DTXDesktopApp` semantics no longer matter                          | Today's dtx-web allow-list (`hooks.server.ts`) keys on this header for bearer auth. dtx-api's auth middleware accepts bearer from any caller — the user-agent is no longer load-bearing for auth. Header stays for analytics.                                  |
| Electron renderer-process CORS                                                          | All today's API calls happen in the main process (no `Origin` header → CORS doesn't apply). Confirmed by reading `simfile-service.ts`. If a renderer-process call is ever added, Phase 1 CORS would need to add the Electron origin. Not in scope for Phase 3. |
| dtx-web bundle size grows with graphql-request + codegen output                         | graphql-request is ~50 KB minified; codegen output is per-operation type stubs (~5–15 KB). Total expected delta: ~80 KB. Verified by `bun run build` size report in the implementation plan.                                                                   |
| Flag flip in Phase 4 surfaces a behavior delta this phase didn't catch                  | All call-sites are exercised in unit tests with both flag states. Pre-prod manual smoke step 6 exercises every call-site against the real `dtx-api`. Phase 4 effectively re-runs step 6 as the formal validation.                                              |
| Codegen depends on `packages/dtx-api/dist/schema.graphql` being committed               | Phase 2 committed this artifact and CI gates against drift. Phase 3 just consumes it. No coupling required between the two packages' build orders.                                                                                                             |

### Decisions log (pinned by this spec)

1. **dtx-web ships dual-path with flag default OFF.** Flag flip is Phase 4 (pre-prod) and Phase 5 (prod).
2. **dtx-desktop hard-cuts to GraphQL in code, no flag.** Production desktop release deferred to Phase 5.
3. **GraphQL stack: `graphql-request` + `@graphql-codegen/*`.** Mature, well-known; codegen output committed; CI gates drift.
4. **Single anchor `<a href="/api/simFile/download/...">` is replaced with a JS-driven button + fetch + blob download.** Same UX of saving a file, but works with bearer auth.
5. **Desktop upload stays multipart REST against dtx-api `/upload`.** Verbatim port; only the URL changes.
6. **Service binding added to pre-prod stanzas only in Phase 3.** Prod stanza adds it in Phase 5.
7. **dtx-web `app.d.ts` adds `API: Fetcher` to `App.Platform.env`.** Type lands now; binding usage in SSR is for later phases.
8. **dtx-desktop preserves the `ApiResult<T>` envelope.** Limits `simfile-service.ts` churn; downstream IPC handlers untouched.
9. **Both packages' codegen outputs are committed and CI-diff-gated.**
10. **No changes to `packages/dtx-api/` or `packages/common/`.** Phase 3 is fully contained in the two client packages.

### Open questions deferred to implementation

- Exact `graphql-request` minor / `@graphql-codegen/*` minors (pinned at `bun install`).
- Whether to use `typed-document-node` or fall back to a plain `typescript-operations` output — depends on `graphql-request`'s preferred input. Default: `typed-document-node`.
- Whether the SSR dispatch path needs a URL convention like `https://api.internal/graphql` (cosmetic; dtx-api ignores host).
- Whether `lib/api/index.ts` re-exports types alongside functions for downstream consumers — yes by default.
- How `parseContentDisposition` extracts the filename robustly (default: regex match on `filename="..."`; falls back to `chart-${id}.zip`).

### What Phase 4 will need (handoff)

- Run the smoke flow from [Deployment](#deployment--verification-pre-prod) step 6 with `PUBLIC_USE_GRAPHQL_API=true` on pre-prod as the formal cutover-readiness gate.
- Capture Worker logs from both `dtx-web` and `dtx-api` during the smoke for parity comparison.
- If any delta surfaces, fix in dtx-api or dtx-web in a follow-up PR; Phase 4 doesn't ship code beyond the flag flip.

## Done criteria

- `packages/dtx-web/src/lib/api/{client,transport,token,chart,user,auth}.ts` exist with both flag-OFF and flag-ON code paths.
- `packages/dtx-web/src/lib/api/rest/download.ts` exists and is wired into `DownloadDropdown.svelte` and `ChartList.helpers.ts`.
- Every dtx-web fetch call-site against `/api/*` (six total, plus the bulk helpers and the anchor refactor) goes through `lib/api/`.
- `packages/dtx-web/src/lib/api/generated/graphql.ts` committed; `lint:codegen` passes.
- `packages/dtx-web/wrangler.jsonc` declares service binding on `pre-prod` and `pre-prod-prod-data` stanzas only; `PUBLIC_USE_GRAPHQL_API=false` and `PUBLIC_DTX_API_URL` set per env.
- `packages/dtx-web/src/app.d.ts` declares `API: Fetcher` on `App.Platform.env`.
- `packages/dtx-desktop/src/main/api-client.ts` rewritten on top of GraphQL; `apiGet/apiPost/apiPatch` deleted.
- `packages/dtx-desktop/src/main/upload.ts` exists and is called from both `simfile-service.ts` and the `index.ts` `upload-file` IPC handler.
- `packages/dtx-desktop/src/main/index.ts` updated: 5 IPC-handler call-sites swap to typed wrappers; the 2 cookie-session hacks (`load-asset-files` and `upload-file`) are replaced with bearer-authenticated equivalents.
- `packages/dtx-desktop/src/main/graphql/generated/graphql.ts` committed; `lint:codegen` passes.
- `bun run --filter=dtx-web check` / `test` / `lint` pass.
- `bun run --filter=dtx-desktop check` / `test` / `typecheck:node` pass.
- `bun run --filter=@dtx/common check` / `test` pass (no regression).
- `bun run lint` (root) passes.
- `wrangler deploy --env pre-prod --dry-run` on dtx-web succeeds with service binding declared.
- Manual flag-ON pre-prod smoke validates all web call-sites work against dtx-api.
- Pre-prod desktop build validates against pre-prod dtx-api.
- Zero changes outside `packages/dtx-web/` and `packages/dtx-desktop/`.
