# API Migration Phase 3 — Client Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed GraphQL client layer to both `dtx-web` and `dtx-desktop`. dtx-web ships dual-path dispatch behind a `PUBLIC_USE_GRAPHQL_API` flag (default OFF). dtx-desktop hard-cuts its code to GraphQL but defers the production release to Phase 5; Phase 3 produces a pre-prod desktop build for validation.

**Architecture:** Both packages add `graphql-request` + `@graphql-codegen/*` and consume the committed schema artifact at `packages/dtx-api/dist/schema.graphql`. dtx-web exposes high-level typed functions in `src/lib/api/*` that dispatch between existing REST (`fetch('/api/...')`) and GraphQL based on the flag. dtx-desktop preserves its `ApiResult<T>` envelope at the boundary so downstream IPC consumers see no shape change.

**Tech Stack:** TypeScript 5.x, Svelte 5 + SvelteKit 2.x, Electron 35.x, GraphQL 16, graphql-request, @graphql-codegen/\*, Vitest, Wrangler 4.x, Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-05-25-api-migration-phase-3-design.md`.

**Pre-conditions:** Phase 0, 1, and 2 are merged to `main`. `dtx-api` is deployed at `api.pre-prod.dtx.hapadona.com` with the full GraphQL surface + REST sidecars (`/upload`, `/downloads/:id`, `/downloads/bulk`). The committed schema artifact lives at `packages/dtx-api/dist/schema.graphql`.

**Operations vocabulary used throughout this plan** (the GraphQL operations dtx-web and dtx-desktop will define and use; mapping to dtx-api schema):

| Operation name        | GraphQL field                                   | Used by                                                  |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `ListSimfiles`        | `Query.simfiles(scope, search, page, pageSize)` | dtx-web, dtx-desktop                                     |
| `GetSimfile`          | `Query.simfile(id)`                             | dtx-web, dtx-desktop                                     |
| `GetSimfileWithFiles` | `Query.simfile(id) { files { ... } }`           | dtx-desktop (listFiles replacement)                      |
| `CreateSimfile`       | `Mutation.createSimfile(input)`                 | dtx-desktop                                              |
| `UpdateSimfile`       | `Mutation.updateSimfile(id, input)`             | dtx-web, dtx-desktop                                     |
| `DeleteSimfile`       | `Mutation.deleteSimfile(id)`                    | dtx-web                                                  |
| `NextDisplayId`       | `Query.nextDisplayId`                           | dtx-desktop                                              |
| `SimfileSearch`       | `Query.simfileSearch(query, excludeIds, limit)` | dtx-desktop                                              |
| `Me`                  | `Query.me`                                      | (included for surface completeness; no current consumer) |
| `UpsertUserProfile`   | `Mutation.upsertUserProfile(input)`             | (included for surface completeness)                      |
| `GenerateMagicLink`   | `Mutation.generateMagicLink`                    | dtx-web                                                  |

---

## File Structure (end state, additions only)

```text
packages/dtx-web/
├── codegen.ts                                       NEW
├── package.json                                     MODIFIED (deps + scripts)
├── wrangler.jsonc                                   MODIFIED (env vars, service bindings)
└── src/
    ├── app.d.ts                                     MODIFIED (API: Fetcher)
    ├── lib/
    │   ├── api/
    │   │   ├── client.ts                            NEW
    │   │   ├── transport.ts                         NEW
    │   │   ├── transport.test.ts                    NEW
    │   │   ├── token.ts                             NEW
    │   │   ├── operations/
    │   │   │   ├── chart.graphql                    NEW
    │   │   │   ├── user.graphql                     NEW
    │   │   │   └── auth.graphql                     NEW
    │   │   ├── rest/
    │   │   │   ├── download.ts                      NEW
    │   │   │   └── download.test.ts                 NEW
    │   │   ├── generated/
    │   │   │   └── graphql.ts                       NEW (codegen output, committed)
    │   │   ├── chart.ts                             NEW
    │   │   ├── chart.test.ts                        NEW
    │   │   ├── user.ts                              NEW
    │   │   ├── user.test.ts                         NEW
    │   │   ├── auth.ts                              NEW
    │   │   ├── auth.test.ts                         NEW
    │   │   └── index.ts                             NEW
    │   └── components/
    │       ├── ChartList.svelte                     MODIFIED (3 call-sites)
    │       ├── ChartList.helpers.ts                 MODIFIED (bulk URL)
    │       └── DownloadDropdown.svelte              MODIFIED (anchor → button)
    └── routes/
        └── (app)/
            └── app/
                ├── +page.svelte                     MODIFIED (magic link)
                └── chart/[id]/+page.svelte          MODIFIED (2 call-sites)

packages/dtx-desktop/
├── codegen.ts                                       NEW
├── package.json                                     MODIFIED (deps + scripts)
└── src/
    └── main/
        ├── api-client.ts                            REWRITTEN
        ├── api-client.test.ts                       REWRITTEN
        ├── graphql/
        │   ├── client.ts                            NEW
        │   ├── operations/
        │   │   ├── chart.graphql                    NEW
        │   │   ├── user.graphql                     NEW
        │   │   └── auth.graphql                     NEW
        │   └── generated/
        │       └── graphql.ts                       NEW (codegen output, committed)
        ├── upload.ts                                NEW
        ├── upload.test.ts                           NEW
        ├── simfile-service.ts                       MODIFIED (4 call-sites)
        ├── simfile-service.test.ts                  MODIFIED
        ├── index.ts                                 MODIFIED (5 call-sites)
        └── index.test.ts                            MODIFIED
```

---

## Task 1: Add dependencies + codegen config to dtx-web

**Files:**

- Modify: `packages/dtx-web/package.json`
- Create: `packages/dtx-web/codegen.ts`

This task adds the runtime + dev dependencies and the codegen config. No behavior change yet.

- [ ] **Step 1: Add deps to `packages/dtx-web/package.json`**

In `"dependencies"`, after the existing entries, add:

```jsonc
"graphql": "^16.10.0",
"graphql-request": "^7.1.2"
```

In `"devDependencies"`, after existing entries, add:

```jsonc
"@graphql-codegen/cli": "^5.0.3",
"@graphql-codegen/typescript": "^4.1.2",
"@graphql-codegen/typescript-operations": "^4.4.0",
"@graphql-codegen/typed-document-node": "^5.0.12"
```

- [ ] **Step 2: Add scripts to `packages/dtx-web/package.json`**

In `"scripts"`, after `"check:watch"`, add:

```jsonc
"codegen": "graphql-codegen --config codegen.ts",
"lint:codegen": "bun run codegen && git diff --exit-code src/lib/api/generated/"
```

- [ ] **Step 3: Create `packages/dtx-web/codegen.ts`**

```ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: '../dtx-api/dist/schema.graphql',
	documents: ['src/lib/api/operations/**/*.graphql'],
	generates: {
		'src/lib/api/generated/graphql.ts': {
			plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
			config: {
				avoidOptionals: {
					field: true,
					inputValue: false,
					object: false,
					defaultValue: true
				},
				skipTypename: true,
				useTypeImports: true,
				enumsAsTypes: false,
				scalars: { ID: 'string' }
			}
		}
	}
};

export default config;
```

- [ ] **Step 4: Run install**

```bash
bun install
```

Expected: `bun.lock` updated; the four new devDeps + two new deps resolved.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/package.json packages/dtx-web/codegen.ts bun.lock
git commit -m "$(cat <<'EOF'
chore(dtx-web): add graphql-request and graphql-codegen deps

Phase 3 — adds the GraphQL client + codegen toolchain to dtx-web.
No behavior change yet; codegen runs in Task 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write dtx-web operation .graphql files

**Files:**

- Create: `packages/dtx-web/src/lib/api/operations/chart.graphql`
- Create: `packages/dtx-web/src/lib/api/operations/user.graphql`
- Create: `packages/dtx-web/src/lib/api/operations/auth.graphql`

These hold the operation documents. Codegen in Task 3 produces TypeScript types from them.

- [ ] **Step 1: Create `packages/dtx-web/src/lib/api/operations/chart.graphql`**

```graphql
fragment SimfileFull on Simfile {
	id
	displayId
	title
	artist
	bpm
	userId
	isPublished
	downloadUrl
	previewUrl
	videoPreviewUrl
	publishDate
	createdAt
	updatedAt
	dtxFiles {
		level
		label
	}
}

fragment SimfileWithFiles on Simfile {
	...SimfileFull
	files {
		key
		size
		uploaded
	}
	hasUploadedFiles
}

query ListSimfiles($scope: SimfileScope!, $search: String, $page: Int, $pageSize: Int) {
	simfiles(scope: $scope, search: $search, page: $page, pageSize: $pageSize) {
		count
		data {
			...SimfileFull
			hasUploadedFiles
		}
	}
}

query GetSimfile($id: ID!) {
	simfile(id: $id) {
		...SimfileWithFiles
	}
}

mutation UpdateSimfile($id: ID!, $input: UpdateSimfileInput!) {
	updateSimfile(id: $id, input: $input) {
		...SimfileFull
	}
}

mutation DeleteSimfile($id: ID!) {
	deleteSimfile(id: $id) {
		id
		deleted
	}
}
```

- [ ] **Step 2: Create `packages/dtx-web/src/lib/api/operations/user.graphql`**

```graphql
query Me {
	me {
		userId
		username
	}
}

mutation UpsertUserProfile($input: UpsertUserProfileInput!) {
	upsertUserProfile(input: $input) {
		userId
		username
	}
}
```

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/operations/auth.graphql`**

```graphql
mutation GenerateMagicLink {
	generateMagicLink {
		magicLinkUrl
		success
	}
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-web/src/lib/api/operations/
git commit -m "feat(dtx-web): add GraphQL operation documents

Phase 3 — defines the chart, user, and auth operations the web client
needs. Codegen runs in the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Run dtx-web codegen + commit generated types

**Files:**

- Create: `packages/dtx-web/src/lib/api/generated/graphql.ts` (codegen output, committed)

- [ ] **Step 1: Run codegen**

```bash
bun run --filter=dtx-web codegen
```

Expected: `packages/dtx-web/src/lib/api/generated/graphql.ts` created with typed document nodes for each operation defined in Task 2.

- [ ] **Step 2: Verify the file exists and has the expected exports**

```bash
grep -E "export (type|const) (ListSimfilesDocument|GetSimfileDocument|UpdateSimfileDocument|DeleteSimfileDocument|MeDocument|UpsertUserProfileDocument|GenerateMagicLinkDocument)" packages/dtx-web/src/lib/api/generated/graphql.ts
```

Expected: 7 lines listed, one per operation.

- [ ] **Step 3: Verify enum casing**

```bash
grep -A 3 "export enum SimfileScope" packages/dtx-web/src/lib/api/generated/graphql.ts
```

Expected: lists members like `Mine = 'MINE'` and `Published = 'PUBLISHED'` (PascalCase keys, UPPER values — the default `@graphql-codegen/typescript` v4 behavior). If the codegen produces UPPER keys (`MINE = 'MINE'`) instead, the casing of enum member references later (in `chart.ts`, `simfile-service.ts`) must match. The code samples in this plan use `SimfileScope.Mine` / `SimfileScope.Published` — adjust to `SimfileScope.MINE` / `SimfileScope.PUBLISHED` if your codegen output differs.

- [ ] **Step 4: Run type-check**

```bash
bun run --filter=dtx-web check
```

Expected: 0 errors. The generated file should type-check cleanly.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/generated/
git commit -m "feat(dtx-web): commit codegen output for GraphQL operations

Phase 3 — generated TypedDocumentNode for each operation defined in
operations/. CI gates against drift in Task 27.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Extend `app.d.ts` for the API service binding

**Files:**

- Modify: `packages/dtx-web/src/app.d.ts`

- [ ] **Step 1: Read the current shape**

```bash
cat packages/dtx-web/src/app.d.ts
```

- [ ] **Step 2: Add `API: Fetcher` to `App.Platform.env`**

Inside the `Platform` interface, after `DTXFILE_BUCKET: R2Bucket;` add:

```ts
API: Fetcher;
```

If `Fetcher` is not in scope, add at the top of the file:

```ts
/// <reference types="@cloudflare/workers-types" />
```

- [ ] **Step 3: Type-check**

```bash
bun run --filter=dtx-web check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-web/src/app.d.ts
git commit -m "feat(dtx-web): declare API service binding in app.d.ts

Phase 3 — wrangler service binding is wired in Task 5; type lands now
so the SSR transport path compiles.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Extend `wrangler.jsonc` with env vars + service binding

**Files:**

- Modify: `packages/dtx-web/wrangler.jsonc`

- [ ] **Step 1: Add env vars to all three stanzas + service binding to pre-prod stanzas**

Open `packages/dtx-web/wrangler.jsonc`.

In the top-level (prod) `"vars"` block, replace:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "prod"
},
```

with:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "prod",
    "PUBLIC_USE_GRAPHQL_API": "false",
    "PUBLIC_DTX_API_URL": "https://api.dtx.hapadona.com"
},
```

In `"env.pre-prod"`, replace:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "pre-prod"
},
```

with:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "pre-prod",
    "PUBLIC_USE_GRAPHQL_API": "false",
    "PUBLIC_DTX_API_URL": "https://api.pre-prod.dtx.hapadona.com"
},
"services": [
    { "binding": "API", "service": "dtx-api", "environment": "pre-prod" }
],
```

In `"env.pre-prod-prod-data"`, replace:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "pre-prod-prod-data"
},
```

with:

```jsonc
"vars": {
    "RATE_LIMIT_ENV": "pre-prod-prod-data",
    "PUBLIC_USE_GRAPHQL_API": "false",
    "PUBLIC_DTX_API_URL": "https://api.pre-prod.dtx.hapadona.com"
},
"services": [
    { "binding": "API", "service": "dtx-api", "environment": "pre-prod" }
],
```

Prod stanza intentionally has no `services` block — dtx-api prod doesn't exist until Phase 5.

- [ ] **Step 2: Dry-run deploy validation**

```bash
bun run --filter=dtx-web build
cd packages/dtx-web && bunx wrangler deploy --env pre-prod --dry-run 2>&1 | head -30
cd ../..
```

Expected: dry-run succeeds; service binding is logged in the output. If wrangler complains about the binding env name, double-check Phase 1 dtx-api was deployed with `--env pre-prod` (it was per the Phase 1 plan).

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-web/wrangler.jsonc
git commit -m "feat(dtx-web): add API service binding and Phase 3 env vars

PUBLIC_USE_GRAPHQL_API defaults to false on all envs.
Service binding declared on pre-prod and pre-prod-prod-data only;
prod stanza adds the binding in Phase 5 alongside dtx-api prod deploy.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Create `lib/api/token.ts`

**Files:**

- Create: `packages/dtx-web/src/lib/api/token.ts`

Reads the Supabase session in the browser; returns null when no session exists. Used by the GraphQL transport when the flag is ON.

- [ ] **Step 1: Create the file**

```ts
// packages/dtx-web/src/lib/api/token.ts
import type { Session } from '@supabase/supabase-js';
import { browser } from '$app/environment';
import { getSupabaseClient } from '$lib/supabase'; // existing module — verify import path matches your codebase

/** Returns the current Supabase access token, or null if no session is active. Browser-only. */
export const getAccessTokenOrNull = async (): Promise<string | null> => {
	if (!browser) return null;
	const supabase = getSupabaseClient();
	if (!supabase) return null;
	const { data } = await supabase.auth.getSession();
	return data.session?.access_token ?? null;
};

/** Same as above but throws when no token is available. */
export const getAccessToken = async (): Promise<string> => {
	const token = await getAccessTokenOrNull();
	if (!token) throw new Error('User not authenticated');
	return token;
};

/** Extracts token from a SSR-provided session, falling back to null. */
export const tokenFromSession = (session: Session | null | undefined): string | null =>
	session?.access_token ?? null;
```

If `$lib/supabase` doesn't exist, check `packages/dtx-web/src/lib/` and `packages/dtx-web/src/routes/+layout.svelte` for the actual Supabase client import path. Common alternatives: `$lib/supabaseClient`, `$lib/auth/supabase`, or it may be imported from `@supabase/ssr` directly inside `hooks.server.ts`. Use whatever the rest of dtx-web uses.

- [ ] **Step 2: Type-check**

```bash
bun run --filter=dtx-web check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-web/src/lib/api/token.ts
git commit -m "feat(dtx-web): add token helpers for GraphQL bearer auth

Reads Supabase session via existing client; used by transport.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Create `lib/api/transport.ts` + tests

**Files:**

- Create: `packages/dtx-web/src/lib/api/transport.ts`
- Create: `packages/dtx-web/src/lib/api/transport.test.ts`

Two transports: a browser `GraphQLClient` factory pointing at `PUBLIC_DTX_API_URL`, and an SSR service-binding wrapper that satisfies the same interface.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-web/src/lib/api/transport.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_DTX_API_URL: 'https://api.test/' }
}));

import { makeBrowserClient, makeServiceBindingClient } from './transport';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

describe('makeBrowserClient', () => {
	it('uses PUBLIC_DTX_API_URL + /graphql endpoint', () => {
		const client = makeBrowserClient();
		// graphql-request stores the URL internally; we assert on a public marker
		expect(client.url).toBe('https://api.test/graphql');
	});

	it('includes Authorization header when token provided', () => {
		const client = makeBrowserClient('my-token');
		const headers = client.requestConfig.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer my-token');
	});
});

describe('makeServiceBindingClient', () => {
	let binding: { fetch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		binding = { fetch: vi.fn() };
	});

	it('posts JSON-encoded query to the binding with bearer when token provided', async () => {
		binding.fetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { ok: true } }), {
				headers: { 'content-type': 'application/json' }
			})
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher, 'tok');
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			{ ok: boolean },
			{}
		>;
		const data = await client.request(doc, {});
		expect(data).toEqual({ ok: true });
		expect(binding.fetch).toHaveBeenCalledOnce();
		const req = binding.fetch.mock.calls[0][0] as Request;
		expect(req.method).toBe('POST');
		expect(req.headers.get('authorization')).toBe('Bearer tok');
		expect(req.headers.get('content-type')).toBe('application/json');
	});

	it('throws when the response contains errors', async () => {
		binding.fetch.mockResolvedValue(
			new Response(
				JSON.stringify({ errors: [{ message: 'boom', extensions: { code: 'INTERNAL' } }] })
			)
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			unknown,
			{}
		>;
		await expect(client.request(doc, {})).rejects.toThrow('boom');
	});
});
```

- [ ] **Step 2: Run the test (it should fail because the file doesn't exist)**

```bash
bun run --filter=dtx-web test -- transport.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/transport.ts`**

```ts
import { GraphQLClient } from 'graphql-request';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { print } from 'graphql';
import { env } from '$env/dynamic/public';

const graphqlEndpoint = () => {
	const base = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');
	return `${base}/graphql`;
};

export const makeBrowserClient = (token?: string | null) =>
	new GraphQLClient(graphqlEndpoint(), {
		headers: token ? { Authorization: `Bearer ${token}` } : {}
	});

export type GraphQLLikeClient = {
	request: <T, V extends object>(doc: TypedDocumentNode<T, V>, vars: V) => Promise<T>;
};

export const makeServiceBindingClient = (
	binding: Fetcher,
	token?: string | null
): GraphQLLikeClient => ({
	request: async <T, V extends object>(doc: TypedDocumentNode<T, V>, vars: V): Promise<T> => {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (token) headers.authorization = `Bearer ${token}`;
		const res = await binding.fetch(
			new Request('https://api.internal/graphql', {
				method: 'POST',
				headers,
				body: JSON.stringify({ query: print(doc), variables: vars })
			})
		);
		const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
		if (json.errors && json.errors.length > 0) {
			throw new Error(json.errors[0].message);
		}
		if (json.data === undefined) {
			throw new Error('GraphQL response missing data');
		}
		return json.data;
	}
});
```

- [ ] **Step 4: Run the test — should pass now**

```bash
bun run --filter=dtx-web test -- transport.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/transport.ts packages/dtx-web/src/lib/api/transport.test.ts
git commit -m "feat(dtx-web): add GraphQL transports (browser + service binding)

Browser uses graphql-request to PUBLIC_DTX_API_URL/graphql with bearer.
SSR uses platform.env.API.fetch via a service binding wrapper that
implements the same request() interface.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Create `lib/api/client.ts` (dispatch entry point)

**Files:**

- Create: `packages/dtx-web/src/lib/api/client.ts`

Hosts `useGraphQL()` and `getClient()`. No tests of its own — it's exercised through the per-module tests in Tasks 9-12.

- [ ] **Step 1: Create the file**

```ts
// packages/dtx-web/src/lib/api/client.ts
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { getAccessTokenOrNull } from './token';
import { makeBrowserClient, makeServiceBindingClient, type GraphQLLikeClient } from './transport';

export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	accessToken?: string | null;
};

/** Single source of truth for the flag. */
export const useGraphQL = (): boolean => env.PUBLIC_USE_GRAPHQL_API === 'true';

/** Returns a GraphQL client appropriate for the current context. */
export const getClient = async (ctx?: ClientCtx): Promise<GraphQLLikeClient> => {
	// SSR with service binding takes precedence
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken ?? null);
	}
	// Browser: resolve token from Supabase if not pre-supplied
	const token = ctx?.accessToken ?? (await getAccessTokenOrNull());
	return makeBrowserClient(token);
};
```

- [ ] **Step 2: Type-check**

```bash
bun run --filter=dtx-web check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-web/src/lib/api/client.ts
git commit -m "feat(dtx-web): add useGraphQL() flag check and getClient() dispatch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Create `lib/api/chart.ts` with dual-path dispatch + tests

**Files:**

- Create: `packages/dtx-web/src/lib/api/chart.ts`
- Create: `packages/dtx-web/src/lib/api/chart.test.ts`

This is the biggest of the API modules. It hosts `listSimfiles`, `getSimfile`, `updateSimfile`, `deleteSimfile`, plus the shape adapters that keep flag flips byte-identical at call-sites.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-web/src/lib/api/chart.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));

const requestMock = vi.fn();
vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { listSimfiles, getSimfile, updateSimfile, deleteSimfile } from './chart';

const restFetch = vi.fn();
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});

describe('listSimfiles (REST path)', () => {
	it('hits /api/chart with query params and returns { data, count }', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: 1, title: 't' }], count: 1 }))
		);
		const result = await listSimfiles({ scope: 'mine', search: 'foo', page: 2, pageSize: 10 });
		expect(restFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/chart?'),
			expect.any(Object)
		);
		const url = restFetch.mock.calls[0][0] as string;
		expect(url).toContain('scope=mine');
		expect(url).toContain('search=foo');
		expect(url).toContain('page=2');
		expect(url).toContain('pageSize=10');
		expect(result).toEqual({ data: [{ id: 1, title: 't' }], count: 1 });
	});
});

describe('listSimfiles (GraphQL path)', () => {
	beforeEach(() => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
	});

	it('calls ListSimfiles and adapts to { data, count }', async () => {
		requestMock.mockResolvedValue({
			simfiles: {
				count: 2,
				data: [
					{
						id: '1',
						title: 't1',
						artist: 'a',
						bpm: 120,
						isPublished: true,
						hasUploadedFiles: true
					},
					{
						id: '2',
						title: 't2',
						artist: 'b',
						bpm: 130,
						isPublished: false,
						hasUploadedFiles: false
					}
				]
			}
		});
		const result = await listSimfiles({ scope: 'mine' });
		expect(requestMock).toHaveBeenCalledOnce();
		expect(result.count).toBe(2);
		expect(result.data).toHaveLength(2);
		// Adapter converts has_uploaded_files snake_case for REST shape parity
		expect(result.data[0].has_uploaded_files).toBe(true);
	});

	it('maps scope string mine → MINE enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'mine' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('MINE');
	});

	it('maps scope string published → PUBLISHED enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'published' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('PUBLISHED');
	});
});

describe('getSimfile', () => {
	it('REST: GET /api/chart/${id}', async () => {
		restFetch.mockResolvedValue(new Response(JSON.stringify({ data: { id: 7, title: 't' } })));
		const result = await getSimfile('7');
		expect(restFetch).toHaveBeenCalledWith('/api/chart/7', expect.any(Object));
		expect(result.id).toBe(7);
	});

	it('GraphQL: calls GetSimfile and unwraps', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({
			simfile: { id: '7', title: 't', files: [], hasUploadedFiles: false }
		});
		const result = await getSimfile('7');
		expect(result.id).toBe(7);
	});
});

describe('updateSimfile', () => {
	it('REST: PATCH /api/chart/${id} with body', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { id: 9, title: 'new' } }))
		);
		const result = await updateSimfile('9', { title: 'new' });
		expect(restFetch).toHaveBeenCalledWith(
			'/api/chart/9',
			expect.objectContaining({ method: 'PATCH' })
		);
		expect(result.title).toBe('new');
	});

	it('GraphQL: calls UpdateSimfile mutation', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ updateSimfile: { id: '9', title: 'new' } });
		const result = await updateSimfile('9', { title: 'new' });
		expect(result.title).toBe('new');
	});
});

describe('deleteSimfile', () => {
	it('REST: DELETE /api/simFile/delete/${id}', async () => {
		restFetch.mockResolvedValue(new Response(null, { status: 204 }));
		const result = await deleteSimfile('3');
		expect(restFetch).toHaveBeenCalledWith(
			'/api/simFile/delete/3',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(result.deleted).toBe(true);
	});

	it('GraphQL: calls DeleteSimfile', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const result = await deleteSimfile('3');
		expect(result.deleted).toBe(true);
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-web test -- chart.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/chart.ts`**

```ts
import {
	ListSimfilesDocument,
	GetSimfileDocument,
	UpdateSimfileDocument,
	DeleteSimfileDocument,
	SimfileScope,
	type UpdateSimfileInput
} from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

/** Legacy REST scope string. */
export type ScopeString = 'mine' | 'published';

/** Snake-case shape that today's REST returns and call-sites consume. */
export type LegacySimfile = {
	id: number;
	display_id: number | null;
	title: string;
	artist: string;
	bpm: number;
	user_id: string | null;
	is_published: boolean;
	download_url: string | null;
	preview_url: string | null;
	video_preview_url: string | null;
	publish_date: string;
	created_at: string;
	updated_at: string;
	dtx_files: { level: number; label: string }[];
	files?: { key: string; size: number; uploaded: string }[];
	has_uploaded_files?: boolean;
};

export type SimfileListResult = { data: LegacySimfile[]; count: number };

const scopeToEnum = (scope: ScopeString): SimfileScope =>
	scope === 'mine' ? SimfileScope.Mine : SimfileScope.Published;

const adaptSimfile = (s: {
	id: string;
	displayId?: number | null;
	title: string;
	artist: string;
	bpm: number;
	userId?: string | null;
	isPublished: boolean;
	downloadUrl?: string | null;
	previewUrl?: string | null;
	videoPreviewUrl?: string | null;
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: { level: number; label: string }[];
	files?: { key: string; size: number; uploaded: string }[];
	hasUploadedFiles?: boolean;
}): LegacySimfile => ({
	id: Number(s.id),
	display_id: s.displayId ?? null,
	title: s.title,
	artist: s.artist,
	bpm: s.bpm,
	user_id: s.userId ?? null,
	is_published: s.isPublished,
	download_url: s.downloadUrl ?? null,
	preview_url: s.previewUrl ?? null,
	video_preview_url: s.videoPreviewUrl ?? null,
	publish_date: s.publishDate,
	created_at: s.createdAt,
	updated_at: s.updatedAt,
	dtx_files: s.dtxFiles,
	files: s.files,
	has_uploaded_files: s.hasUploadedFiles
});

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

export type ListParams = {
	scope: ScopeString;
	search?: string;
	page?: number;
	pageSize?: number;
};

export const listSimfiles = async (
	params: ListParams,
	ctx?: ClientCtx
): Promise<SimfileListResult> => {
	if (!useGraphQL()) {
		const qs = new URLSearchParams({ scope: params.scope });
		if (params.search) qs.set('search', params.search);
		if (params.page) qs.set('page', String(params.page));
		if (params.pageSize) qs.set('pageSize', String(params.pageSize));
		const res = await fetchFn(ctx)(`/api/chart?${qs}`, { method: 'GET' });
		if (!res.ok) throw new Error(`list failed: ${res.status}`);
		return (await res.json()) as SimfileListResult;
	}
	const client = await getClient(ctx);
	const result = await client.request(ListSimfilesDocument, {
		scope: scopeToEnum(params.scope),
		search: params.search ?? null,
		page: params.page ?? 1,
		pageSize: params.pageSize ?? 20
	});
	return {
		data: result.simfiles.data.map(adaptSimfile),
		count: result.simfiles.count
	};
};

export const getSimfile = async (id: string, ctx?: ClientCtx): Promise<LegacySimfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/chart/${id}`, { method: 'GET' });
		if (!res.ok) throw new Error(`get failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacySimfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(GetSimfileDocument, { id });
	if (!result.simfile) throw new Error('Simfile not found');
	return adaptSimfile(result.simfile);
};

export const updateSimfile = async (
	id: string,
	input: UpdateSimfileInput,
	ctx?: ClientCtx
): Promise<LegacySimfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/chart/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`update failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacySimfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(UpdateSimfileDocument, { id, input });
	return adaptSimfile(result.updateSimfile);
};

export const deleteSimfile = async (
	id: string,
	ctx?: ClientCtx
): Promise<{ id: number; deleted: boolean }> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/simFile/delete/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`delete failed: ${res.status}`);
		return { id: Number(id), deleted: true };
	}
	const client = await getClient(ctx);
	const result = await client.request(DeleteSimfileDocument, { id });
	return { id: Number(result.deleteSimfile.id), deleted: result.deleteSimfile.deleted };
};
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun run --filter=dtx-web test -- chart.test.ts
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/chart.ts packages/dtx-web/src/lib/api/chart.test.ts
git commit -m "feat(dtx-web): add chart API with dual-path dispatch

Exposes listSimfiles, getSimfile, updateSimfile, deleteSimfile that
dispatch on PUBLIC_USE_GRAPHQL_API. Each function adapts the GraphQL
response to the existing REST snake_case shape so flag flips are
byte-identical at consumers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Create `lib/api/user.ts` + tests

**Files:**

- Create: `packages/dtx-web/src/lib/api/user.ts`
- Create: `packages/dtx-web/src/lib/api/user.test.ts`

Same shape as `chart.ts`. Exposes `getMe` and `upsertUserProfile`. Currently unused by dtx-web call-sites but completes the surface; tests still required.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-web/src/lib/api/user.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));

const requestMock = vi.fn();
vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { getMe, upsertUserProfile } from './user';

const restFetch = vi.fn();
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});

describe('getMe', () => {
	it('REST: GET /api/user/profile', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { user_id: 'u1', username: 'alice' } }))
		);
		const r = await getMe();
		expect(restFetch).toHaveBeenCalledWith('/api/user/profile', expect.any(Object));
		expect(r).toEqual({ user_id: 'u1', username: 'alice' });
	});

	it('GraphQL: calls Me', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ me: { userId: 'u1', username: 'alice' } });
		const r = await getMe();
		expect(r).toEqual({ user_id: 'u1', username: 'alice' });
	});
});

describe('upsertUserProfile', () => {
	it('REST: PUT /api/user/profile', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { user_id: 'u1', username: 'bob' } }))
		);
		const r = await upsertUserProfile({ username: 'bob' });
		expect(restFetch).toHaveBeenCalledWith(
			'/api/user/profile',
			expect.objectContaining({ method: 'PUT' })
		);
		expect(r.username).toBe('bob');
	});

	it('GraphQL: calls UpsertUserProfile', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ upsertUserProfile: { userId: 'u1', username: 'bob' } });
		const r = await upsertUserProfile({ username: 'bob' });
		expect(r.username).toBe('bob');
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-web test -- user.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/user.ts`**

```ts
import {
	MeDocument,
	UpsertUserProfileDocument,
	type UpsertUserProfileInput
} from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

export type LegacyUserProfile = { user_id: string; username: string };

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

const adapt = (g: { userId: string; username: string }): LegacyUserProfile => ({
	user_id: g.userId,
	username: g.username
});

export const getMe = async (ctx?: ClientCtx): Promise<LegacyUserProfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/user/profile', { method: 'GET' });
		if (!res.ok) throw new Error(`me failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacyUserProfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(MeDocument, {});
	return adapt(result.me);
};

export const upsertUserProfile = async (
	input: UpsertUserProfileInput,
	ctx?: ClientCtx
): Promise<LegacyUserProfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/user/profile', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`upsert failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacyUserProfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(UpsertUserProfileDocument, { input });
	return adapt(result.upsertUserProfile);
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run --filter=dtx-web test -- user.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/user.ts packages/dtx-web/src/lib/api/user.test.ts
git commit -m "feat(dtx-web): add user API with dual-path dispatch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Create `lib/api/auth.ts` + tests

**Files:**

- Create: `packages/dtx-web/src/lib/api/auth.ts`
- Create: `packages/dtx-web/src/lib/api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-web/src/lib/api/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));
const requestMock = vi.fn();
vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { generateMagicLink } from './auth';

const restFetch = vi.fn();
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});

describe('generateMagicLink', () => {
	it('REST: POST /api/auth/generate-magic-link', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ magicLinkUrl: 'https://magic', success: true }))
		);
		const r = await generateMagicLink();
		expect(restFetch).toHaveBeenCalledWith(
			'/api/auth/generate-magic-link',
			expect.objectContaining({ method: 'POST' })
		);
		expect(r).toEqual({ magicLinkUrl: 'https://magic', success: true });
	});

	it('GraphQL: calls GenerateMagicLink', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({
			generateMagicLink: { magicLinkUrl: 'https://magic', success: true }
		});
		const r = await generateMagicLink();
		expect(r).toEqual({ magicLinkUrl: 'https://magic', success: true });
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-web test -- auth.test.ts
```

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/auth.ts`**

```ts
import { GenerateMagicLinkDocument } from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

export type MagicLinkResult = { magicLinkUrl: string; success: boolean };

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

export const generateMagicLink = async (ctx?: ClientCtx): Promise<MagicLinkResult> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/auth/generate-magic-link', { method: 'POST' });
		if (!res.ok) throw new Error(`magic-link failed: ${res.status}`);
		return (await res.json()) as MagicLinkResult;
	}
	const client = await getClient(ctx);
	const result = await client.request(GenerateMagicLinkDocument, {});
	return {
		magicLinkUrl: result.generateMagicLink.magicLinkUrl,
		success: result.generateMagicLink.success
	};
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run --filter=dtx-web test -- auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/auth.ts packages/dtx-web/src/lib/api/auth.test.ts
git commit -m "feat(dtx-web): add auth API with dual-path dispatch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Create `lib/api/rest/download.ts` + tests

**Files:**

- Create: `packages/dtx-web/src/lib/api/rest/download.ts`
- Create: `packages/dtx-web/src/lib/api/rest/download.test.ts`

Hosts `downloadSimfile` (anchor replacement), `bulkDownloadBaseUrl`, plus filename parsing + browser-download trigger helpers. The bulk download URL builder is exported and used by `ChartList.helpers.ts` in Task 17.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-web/src/lib/api/rest/download.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token')
}));

import { bulkDownloadBaseUrl, parseContentDispositionFilename, downloadSimfile } from './download';

beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
});

describe('bulkDownloadBaseUrl', () => {
	it('returns dtx-web local URL when flag OFF', () => {
		expect(bulkDownloadBaseUrl()).toBe('/api/simFile/download/bulk');
	});
	it('returns dtx-api URL when flag ON', () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		expect(bulkDownloadBaseUrl()).toBe('https://api.test/downloads/bulk');
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
});

describe('downloadSimfile (REST path)', () => {
	it('fetches /api/simFile/download/${id} and triggers browser download', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response('zip-bytes', {
				headers: { 'content-disposition': 'attachment; filename="chart-3.zip"' }
			})
		);
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).toHaveBeenCalledWith('/api/simFile/download/3', expect.any(Object));
		expect(triggerSpy).toHaveBeenCalledOnce();
		const [_blob, filename] = triggerSpy.mock.calls[0];
		expect(filename).toBe('chart-3.zip');
	});

	it('does not include Authorization header when flag OFF', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)?.Authorization).toBeUndefined();
	});
});

describe('downloadSimfile (GraphQL path)', () => {
	beforeEach(() => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
	});

	it('hits dtx-api URL with bearer header when token available', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('x'));
		const triggerSpy = vi.fn();
		await downloadSimfile('3', { fetchFn: fetchMock, triggerBrowserDownload: triggerSpy });
		expect(fetchMock).toHaveBeenCalledWith('https://api.test/downloads/3', expect.any(Object));
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-web test -- rest/download.test.ts
```

- [ ] **Step 3: Create `packages/dtx-web/src/lib/api/rest/download.ts`**

```ts
import { env } from '$env/dynamic/public';
import { useGraphQL } from '../client';
import { getAccessTokenOrNull } from '../token';

const apiBase = () => (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');

export const downloadBaseUrl = (simfileId: string) =>
	useGraphQL() ? `${apiBase()}/downloads/${simfileId}` : `/api/simFile/download/${simfileId}`;

export const bulkDownloadBaseUrl = () =>
	useGraphQL() ? `${apiBase()}/downloads/bulk` : '/api/simFile/download/bulk';

export const parseContentDispositionFilename = (header: string | null): string | null => {
	if (!header) return null;
	const match = /filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^;]+))/i.exec(header);
	if (!match) return null;
	return (match[1] ?? match[2] ?? '').trim() || null;
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
	if (useGraphQL()) {
		const token = await getAccessTokenOrNull();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetchFn(downloadBaseUrl(simfileId), { headers });
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const filename =
		parseContentDispositionFilename(res.headers.get('content-disposition')) ??
		`chart-${simfileId}.zip`;
	trigger(blob, filename);
};

/** Bearer header for bulk download — caller supplies fetchFn; we just return the headers. */
export const bulkDownloadHeaders = async (): Promise<Record<string, string>> => {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (useGraphQL()) {
		const token = await getAccessTokenOrNull();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	return headers;
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run --filter=dtx-web test -- rest/download.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/api/rest/
git commit -m "feat(dtx-web): add REST download helpers with dual-path dispatch

downloadSimfile replaces today's anchor href; bulkDownloadBaseUrl and
bulkDownloadHeaders give ChartList.helpers.ts the variant URL + auth
to use when the flag is ON.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Create `lib/api/index.ts` barrel

**Files:**

- Create: `packages/dtx-web/src/lib/api/index.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/dtx-web/src/lib/api/index.ts
export * from './chart';
export * from './user';
export * from './auth';
export * from './client';
export { downloadSimfile, bulkDownloadBaseUrl, bulkDownloadHeaders } from './rest/download';
```

- [ ] **Step 2: Type-check + run all lib/api tests**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test -- src/lib/api
```

Expected: 0 type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-web/src/lib/api/index.ts
git commit -m "feat(dtx-web): export lib/api/ barrel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Refactor `ChartList.svelte` call-sites

**Files:**

- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte`

Three fetch sites swap to typed `lib/api` calls.

- [ ] **Step 1: Read current state to anchor edits**

```bash
sed -n '55,75p;100,115p;150,170p' packages/dtx-web/src/lib/components/ChartList.svelte
```

- [ ] **Step 2: Add import at top of `<script lang="ts">` block**

```ts
import { listSimfiles, updateSimfile, deleteSimfile, type ScopeString } from '$lib/api';
```

- [ ] **Step 3: Replace the PATCH call (around line 61)**

Find:

```ts
const response = await fetch(`/api/chart/${id}`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(updates)
});
if (!response.ok) {
	throw new Error('Failed to update chart');
}
const result = await response.json();
// ... existing handling of result
```

Replace with:

```ts
const updated = await updateSimfile(String(id), updates);
// ... existing handling — adapt to use `updated` directly instead of `result.data`
```

Carefully audit any references to `result.data.*` inside this block and change them to `updated.*`. The shape is the same (`LegacySimfile` matches today's `data` field).

- [ ] **Step 4: Replace the list call (around line 103)**

Find:

```ts
const response = await fetch(`/api/chart?${params}`);
if (!response.ok) {
	throw new Error('Failed to fetch charts');
}
const result = await response.json();
// ... existing handling
```

Replace with:

```ts
const scopeStr: ScopeString = isBlog ? 'published' : 'mine';
const result = await listSimfiles({
	scope: scopeStr,
	search: searchTerm || undefined,
	page: currentPage,
	pageSize
});
// ... existing handling of result.data and result.count is unchanged
```

If the existing call also includes `check_uploaded=true` in the params, that's no longer needed — `hasUploadedFiles` is always returned by the GraphQL operation (and the REST adapter also includes it).

- [ ] **Step 5: Replace the DELETE call (around line 155)**

Find:

```ts
const response = await fetch(`/api/simFile/delete/${id}`, {
	method: 'DELETE'
});
if (!response.ok) {
	throw new Error('Failed to delete chart');
}
```

Replace with:

```ts
await deleteSimfile(String(id));
```

`deleteSimfile` throws on failure, matching the existing semantic.

- [ ] **Step 6: Run existing component test + type-check**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test -- ChartList
```

If the existing test mocks `global.fetch`, update its setup to also stub `$lib/api`:

```ts
vi.mock('$lib/api', () => ({
	listSimfiles: vi.fn().mockResolvedValue({ data: [], count: 0 }),
	updateSimfile: vi.fn().mockResolvedValue({ id: 1 }),
	deleteSimfile: vi.fn().mockResolvedValue({ id: 1, deleted: true })
}));
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-web/src/lib/components/ChartList.svelte packages/dtx-web/src/lib/components/*.test.ts
git commit -m "refactor(dtx-web): route ChartList.svelte through lib/api

Three call-sites (list, update, delete) now dispatch via the typed
lib/api helpers. Flag OFF preserves existing /api/* behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Refactor `routes/(app)/app/chart/[id]/+page.svelte`

**Files:**

- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`

Two call-sites (GET and PATCH) at lines 26 and 66.

- [ ] **Step 1: Add import inside `<script lang="ts">`**

```ts
import { getSimfile, updateSimfile } from '$lib/api';
```

- [ ] **Step 2: Replace the GET call (around line 26)**

Find:

```ts
const response = await fetch(`/api/chart/${id}`);
if (!response.ok) throw new Error('Failed to fetch chart');
const result = await response.json();
chart = result.data;
```

Replace with:

```ts
chart = await getSimfile(String(id));
```

- [ ] **Step 3: Replace the PATCH call (around line 66)**

Find:

```ts
const response = await fetch(`/api/chart/${id}`, {
	method: 'PATCH',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(updates)
});
if (!response.ok) throw new Error('Failed to update chart');
const result = await response.json();
chart = result.data;
```

Replace with:

```ts
chart = await updateSimfile(String(id), updates);
```

- [ ] **Step 4: Type-check + run existing tests**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test -- chart-id-page
```

(Adjust the test path filter to match the actual existing test file name if different.)

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/routes/\(app\)/app/chart/\[id\]/+page.svelte
git commit -m "refactor(dtx-web): route chart detail page through lib/api

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: Refactor `routes/(app)/app/+page.svelte` magic-link call

**Files:**

- Modify: `packages/dtx-web/src/routes/(app)/app/+page.svelte`

Single call-site at line 30.

- [ ] **Step 1: Add import**

```ts
import { generateMagicLink } from '$lib/api';
```

- [ ] **Step 2: Replace the call (around line 30)**

Find:

```ts
const response = await fetch('/api/auth/generate-magic-link', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' }
});
if (!response.ok) {
	const error = await response.json();
	throw new Error(error.error || 'Failed to generate magic link');
}
const result = await response.json();
magicLinkUrl = result.magicLinkUrl;
```

Replace with:

```ts
const result = await generateMagicLink();
magicLinkUrl = result.magicLinkUrl;
```

- [ ] **Step 3: Type-check + tests**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test
```

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-web/src/routes/\(app\)/app/+page.svelte
git commit -m "refactor(dtx-web): route magic-link generation through lib/api

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: Refactor `ChartList.helpers.ts` for dual-path bulk download

**Files:**

- Modify: `packages/dtx-web/src/lib/components/ChartList.helpers.ts`

- [ ] **Step 1: Add imports at the top**

```ts
import { bulkDownloadBaseUrl, bulkDownloadHeaders } from '$lib/api';
```

- [ ] **Step 2: Replace `createBulkDownloadRequestInit`**

Find:

```ts
const createBulkDownloadRequestInit = (ids: number[]): RequestInit => ({
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ ids })
});
```

Replace with:

```ts
const createBulkDownloadRequestInit = async (ids: number[]): Promise<RequestInit> => ({
	method: 'POST',
	headers: await bulkDownloadHeaders(),
	body: JSON.stringify({ ids })
});
```

Note the function is now async — call-sites must `await` it.

- [ ] **Step 3: Update `submitBulkDownload`**

Find:

```ts
export const submitBulkDownload = async (
	fetchFn: FetchLike,
	ids: number[],
	target: BulkDownloadTarget
) => {
	const response = await fetchFn(
		'/api/simFile/download/bulk',
		createBulkDownloadRequestInit(ids)
	);
	// ...
};
```

Replace with:

```ts
export const submitBulkDownload = async (
	fetchFn: FetchLike,
	ids: number[],
	target: BulkDownloadTarget
) => {
	const response = await fetchFn(bulkDownloadBaseUrl(), await createBulkDownloadRequestInit(ids));
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, 'Bulk download failed'));
	}
	await streamToFile(response, target);
};
```

- [ ] **Step 4: Update `startBulkDownload` validation call**

Find:

```ts
const validationResponse = await fetchFn(
	'/api/simFile/download/bulk?validate=1',
	createBulkDownloadRequestInit(ids)
);
```

Replace with:

```ts
const validationResponse = await fetchFn(
	`${bulkDownloadBaseUrl()}?validate=1`,
	await createBulkDownloadRequestInit(ids)
);
```

- [ ] **Step 5: Update existing tests if any reference the hard-coded URL**

```bash
grep -n "/api/simFile/download/bulk" packages/dtx-web/src/lib/components/ChartList.helpers.test.ts 2>/dev/null || echo "no test file"
```

If a test file exists, update its `expect(...).toHaveBeenCalledWith` assertions to use `bulkDownloadBaseUrl()` or string-match `'/api/simFile/download/bulk'` (flag OFF default).

- [ ] **Step 6: Type-check + run tests**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test -- ChartList.helpers
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-web/src/lib/components/ChartList.helpers.ts packages/dtx-web/src/lib/components/ChartList.helpers.test.ts 2>/dev/null
git commit -m "refactor(dtx-web): dual-path bulk download URL + bearer headers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: Refactor `DownloadDropdown.svelte` anchor → button

**Files:**

- Modify: `packages/dtx-web/src/lib/components/DownloadDropdown.svelte`

- [ ] **Step 1: Read the current anchor markup**

```bash
sed -n '30,55p' packages/dtx-web/src/lib/components/DownloadDropdown.svelte
```

- [ ] **Step 2: Add import + handler in `<script lang="ts">`**

```ts
import { downloadSimfile } from '$lib/api';
import { _ } from 'svelte-i18n';

let isDownloading = $state(false);
let downloadError = $state<string | null>(null);

const handleDownload = async (e: Event) => {
	e.preventDefault();
	if (isDownloading) return;
	isDownloading = true;
	downloadError = null;
	try {
		await downloadSimfile(String(simfileId));
	} catch (err) {
		downloadError = err instanceof Error ? err.message : 'Download failed';
	} finally {
		isDownloading = false;
	}
};
```

- [ ] **Step 3: Replace the anchor markup**

Find:

```svelte
<a href="/api/simFile/download/{simfileId}" ...existing attributes...>
	{$_('chart_actions.download')}
</a>
```

Replace with:

```svelte
<button
	type="button"
	onclick={handleDownload}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleDownload(e);
		}
	}}
	aria-label={$_('chart_actions.download')}
	tabindex="0"
	disabled={isDownloading}
	...preserve
	any
	existing
	class="attributes"
	from
	the
	anchor...
>
	{isDownloading ? $_('chart_actions.downloading') : $_('chart_actions.download')}
</button>
{#if downloadError}
	<p class="text-sm text-red-500" role="alert">{downloadError}</p>
{/if}
```

If `chart_actions.downloading` doesn't exist in the i18n catalogues yet, add it to `packages/dtx-web/src/lib/i18n/messages/en.json` and the Japanese equivalent as well (search for `chart_actions.download` to find the right file).

- [ ] **Step 4: Type-check + run existing component test**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-web test -- DownloadDropdown
```

If no test exists, create a minimal one at `packages/dtx-web/src/lib/components/DownloadDropdown.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DownloadDropdown from './DownloadDropdown.svelte';

vi.mock('$lib/api', () => ({
	downloadSimfile: vi.fn().mockResolvedValue(undefined)
}));

describe('DownloadDropdown', () => {
	it('renders a button with aria-label', () => {
		const { getByRole } = render(DownloadDropdown, { props: { simfileId: 7 } });
		const btn = getByRole('button', { name: /download/i });
		expect(btn).toBeTruthy();
	});

	it('calls downloadSimfile on click', async () => {
		const { downloadSimfile } = await import('$lib/api');
		const { getByRole } = render(DownloadDropdown, { props: { simfileId: 7 } });
		await fireEvent.click(getByRole('button', { name: /download/i }));
		expect(downloadSimfile).toHaveBeenCalledWith('7');
	});
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/components/DownloadDropdown.svelte packages/dtx-web/src/lib/components/DownloadDropdown.test.ts 2>/dev/null packages/dtx-web/src/lib/i18n
git commit -m "refactor(dtx-web): replace download anchor with JS-driven button

Anchor with /api href worked via session cookie; bearer auth requires
fetch with a header, so we use a button + fetch + blob trigger.
A11y attrs (aria-label, tabindex, keydown) match CLAUDE.md rules.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: Verify dtx-web ships green on flag OFF

**Files:** (verification only)

- [ ] **Step 1: Run codegen drift check**

```bash
bun run --filter=dtx-web lint:codegen
```

Expected: clean diff.

- [ ] **Step 2: Type-check**

```bash
bun run --filter=dtx-web check
```

Expected: 0 errors.

- [ ] **Step 3: Run all dtx-web tests**

```bash
bun run --filter=dtx-web test
```

Expected: all green.

- [ ] **Step 4: Build**

```bash
bun run --filter=dtx-web build
```

Expected: build succeeds. Check bundle size delta in the wrangler output — expected ~+80 KB. If significantly more, investigate before proceeding.

- [ ] **Step 5: Dry-run pre-prod deploy**

```bash
cd packages/dtx-web && bunx wrangler deploy --env pre-prod --dry-run 2>&1 | tail -30
cd ../..
```

Expected: dry-run succeeds; service binding `API → dtx-api (pre-prod)` is listed.

- [ ] **Step 6: Lint**

```bash
bun run lint
```

Expected: clean.

No commit — this task is a gate, not a code change.

---

## Task 20: Add dependencies + codegen config to dtx-desktop

**Files:**

- Modify: `packages/dtx-desktop/package.json`
- Create: `packages/dtx-desktop/codegen.ts`

- [ ] **Step 1: Add deps to `packages/dtx-desktop/package.json`**

In `"dependencies"`, add:

```jsonc
"graphql": "^16.10.0",
"graphql-request": "^7.1.2"
```

In `"devDependencies"`, add:

```jsonc
"@graphql-codegen/cli": "^5.0.3",
"@graphql-codegen/typescript": "^4.1.2",
"@graphql-codegen/typescript-operations": "^4.4.0",
"@graphql-codegen/typed-document-node": "^5.0.12"
```

In `"scripts"`, add:

```jsonc
"codegen": "graphql-codegen --config codegen.ts",
"lint:codegen": "bun run codegen && git diff --exit-code src/main/graphql/generated/"
```

- [ ] **Step 2: Create `packages/dtx-desktop/codegen.ts`**

```ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: '../dtx-api/dist/schema.graphql',
	documents: ['src/main/graphql/operations/**/*.graphql'],
	generates: {
		'src/main/graphql/generated/graphql.ts': {
			plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
			config: {
				avoidOptionals: {
					field: true,
					inputValue: false,
					object: false,
					defaultValue: true
				},
				skipTypename: true,
				useTypeImports: true,
				enumsAsTypes: false,
				scalars: { ID: 'string' }
			}
		}
	}
};

export default config;
```

- [ ] **Step 3: Install**

```bash
bun install
```

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/package.json packages/dtx-desktop/codegen.ts bun.lock
git commit -m "chore(dtx-desktop): add graphql-request and graphql-codegen deps

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 21: Write dtx-desktop operation .graphql files + run codegen

**Files:**

- Create: `packages/dtx-desktop/src/main/graphql/operations/chart.graphql`
- Create: `packages/dtx-desktop/src/main/graphql/operations/user.graphql`
- Create: `packages/dtx-desktop/src/main/graphql/operations/auth.graphql`
- Create: `packages/dtx-desktop/src/main/graphql/generated/graphql.ts` (codegen)

- [ ] **Step 1: Create `chart.graphql`**

```graphql
fragment SimfileFull on Simfile {
	id
	displayId
	title
	artist
	bpm
	userId
	isPublished
	downloadUrl
	previewUrl
	videoPreviewUrl
	publishDate
	createdAt
	updatedAt
	dtxFiles {
		level
		label
	}
}

query ListSimfiles($scope: SimfileScope!, $search: String, $page: Int, $pageSize: Int) {
	simfiles(scope: $scope, search: $search, page: $page, pageSize: $pageSize) {
		count
		data {
			...SimfileFull
		}
	}
}

query GetSimfile($id: ID!) {
	simfile(id: $id) {
		...SimfileFull
	}
}

query GetSimfileWithFiles($id: ID!) {
	simfile(id: $id) {
		...SimfileFull
		files {
			key
			size
			uploaded
		}
	}
}

query NextDisplayId {
	nextDisplayId
}

query SimfileSearch($query: String!, $excludeIds: [ID!], $limit: Int) {
	simfileSearch(query: $query, excludeIds: $excludeIds, limit: $limit) {
		id
		title
		artist
		bpm
		isPublished
	}
}

mutation CreateSimfile($input: CreateSimfileInput!) {
	createSimfile(input: $input) {
		...SimfileFull
	}
}

mutation UpdateSimfile($id: ID!, $input: UpdateSimfileInput!) {
	updateSimfile(id: $id, input: $input) {
		...SimfileFull
	}
}

mutation DeleteSimfile($id: ID!) {
	deleteSimfile(id: $id) {
		id
		deleted
	}
}
```

- [ ] **Step 2: Create `user.graphql`**

```graphql
query Me {
	me {
		userId
		username
	}
}

mutation UpsertUserProfile($input: UpsertUserProfileInput!) {
	upsertUserProfile(input: $input) {
		userId
		username
	}
}
```

- [ ] **Step 3: Create `auth.graphql`**

```graphql
mutation GenerateMagicLink {
	generateMagicLink {
		magicLinkUrl
		success
	}
}
```

- [ ] **Step 4: Run codegen**

```bash
bun run --filter=dtx-desktop codegen
```

- [ ] **Step 5: Type-check**

```bash
bun run --filter=dtx-desktop check
```

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src/main/graphql/
git commit -m "feat(dtx-desktop): add GraphQL operation documents + codegen output

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 22: Create dtx-desktop GraphQL client factory

**Files:**

- Create: `packages/dtx-desktop/src/main/graphql/client.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/dtx-desktop/src/main/graphql/client.ts
import { GraphQLClient } from 'graphql-request';
import { getSupabaseClient } from '../auth';

const API_REQUEST_TIMEOUT_MS = 30000;

const getApiBaseUrl = (): string => {
	const url = import.meta.env.VITE_DTX_SERVER_URL;
	if (!url) throw new Error('VITE_DTX_SERVER_URL environment variable is not set');
	return url.replace(/\/$/, '');
};

const getAccessToken = async (): Promise<string> => {
	const supabaseClient = getSupabaseClient();
	if (!supabaseClient) throw new Error('User not authenticated');
	const {
		data: { session },
		error
	} = await supabaseClient.auth.getSession();
	if (error || !session?.access_token) {
		throw new Error('Failed to get valid session');
	}
	return session.access_token;
};

/** Lazily build a GraphQLClient with current bearer + a fetch wrapped in a timeout. */
export const getGraphQLClient = async (): Promise<GraphQLClient> => {
	const token = await getAccessToken();
	return new GraphQLClient(`${getApiBaseUrl()}/graphql`, {
		headers: {
			Authorization: `Bearer ${token}`,
			'User-Agent': 'DTXDesktopApp',
			'X-Requested-With': 'DTXDesktopApp'
		},
		fetch: (input, init) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
			return fetch(input, { ...init, signal: controller.signal }).finally(() =>
				clearTimeout(timeoutId)
			);
		}
	});
};

export { getApiBaseUrl, getAccessToken };
```

- [ ] **Step 2: Type-check**

```bash
bun run --filter=dtx-desktop check
```

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-desktop/src/main/graphql/client.ts
git commit -m "feat(dtx-desktop): add GraphQL client factory

Wraps graphql-request with a 30s timeout and bearer headers.
Re-exports getApiBaseUrl + getAccessToken used by upload.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 23: Rewrite `api-client.ts` on top of GraphQL

**Files:**

- Modify: `packages/dtx-desktop/src/main/api-client.ts`
- Modify: `packages/dtx-desktop/src/main/api-client.test.ts`

Delete the generic `apiGet/apiPost/apiPatch` helpers; replace with operation-specific typed wrappers preserving the `ApiResult<T>` envelope.

- [ ] **Step 1: Write the failing test (rewrite)**

```ts
// packages/dtx-desktop/src/main/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientError } from 'graphql-request';

const requestMock = vi.fn();
vi.mock('./graphql/client', () => ({
	getGraphQLClient: vi.fn().mockResolvedValue({ request: requestMock })
}));

import {
	listSimfiles,
	getSimfile,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	nextDisplayId,
	simfileSearch,
	getSimfileWithFiles
} from './api-client';

beforeEach(() => {
	requestMock.mockReset();
});

describe('api-client', () => {
	it('listSimfiles returns { success: true, data } on happy path', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r).toEqual({ success: true, data: { count: 0, data: [] } });
	});

	it('listSimfiles returns { success: false, error } on GraphQL error', async () => {
		const err = new ClientError(
			{
				errors: [{ message: 'oops', extensions: { code: 'INTERNAL' } }],
				data: null,
				status: 200,
				headers: new Headers()
			} as unknown as Parameters<typeof ClientError>[0],
			{ query: '' } as Parameters<typeof ClientError>[1]
		);
		requestMock.mockRejectedValue(err);
		const r = await listSimfiles({ scope: 'MINE' });
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toContain('INTERNAL');
	});

	it('updateSimfile passes id + input as variables', async () => {
		requestMock.mockResolvedValue({ updateSimfile: { id: '7', title: 'x' } });
		await updateSimfile('7', { title: 'x' });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ id: '7', input: { title: 'x' } });
	});

	it('deleteSimfile returns shaped data', async () => {
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const r = await deleteSimfile('3');
		expect(r).toEqual({ success: true, data: { id: '3', deleted: true } });
	});

	it('nextDisplayId returns the integer', async () => {
		requestMock.mockResolvedValue({ nextDisplayId: 42 });
		const r = await nextDisplayId();
		expect(r).toEqual({ success: true, data: 42 });
	});

	it('simfileSearch passes args', async () => {
		requestMock.mockResolvedValue({ simfileSearch: [] });
		await simfileSearch({ query: 'q', limit: 5 });
		const [, vars] = requestMock.mock.calls[0];
		expect(vars).toEqual({ query: 'q', limit: 5, excludeIds: undefined });
	});

	it('getSimfileWithFiles selects files', async () => {
		requestMock.mockResolvedValue({
			simfile: { id: '1', files: [{ key: 'a', size: 1, uploaded: 't' }] }
		});
		const r = await getSimfileWithFiles('1');
		expect(r.success).toBe(true);
		if (r.success && r.data) expect(r.data.files).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-desktop test -- api-client.test.ts
```

- [ ] **Step 3: Rewrite `packages/dtx-desktop/src/main/api-client.ts`**

```ts
// packages/dtx-desktop/src/main/api-client.ts
import { ClientError } from 'graphql-request';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getGraphQLClient } from './graphql/client';
import {
	ListSimfilesDocument,
	GetSimfileDocument,
	GetSimfileWithFilesDocument,
	CreateSimfileDocument,
	UpdateSimfileDocument,
	DeleteSimfileDocument,
	NextDisplayIdDocument,
	SimfileSearchDocument,
	MeDocument,
	UpsertUserProfileDocument,
	GenerateMagicLinkDocument,
	type CreateSimfileInput,
	type UpdateSimfileInput,
	type UpsertUserProfileInput,
	type SimfileScope,
	type ListSimfilesQuery,
	type GetSimfileQuery,
	type GetSimfileWithFilesQuery,
	type CreateSimfileMutation,
	type UpdateSimfileMutation,
	type DeleteSimfileMutation,
	type NextDisplayIdQuery,
	type SimfileSearchQuery,
	type MeQuery,
	type UpsertUserProfileMutation,
	type GenerateMagicLinkMutation
} from './graphql/generated/graphql';

export type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

const extractError = (err: unknown): string => {
	if (err instanceof ClientError) {
		const first = err.response.errors?.[0];
		const code = first?.extensions?.code as string | undefined;
		const msg = first?.message ?? `HTTP ${err.response.status}`;
		return code ? `${code}: ${msg}` : msg;
	}
	if (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string }).name === 'AbortError'
	) {
		return 'Request timed out after 30000ms';
	}
	return err instanceof Error ? err.message : 'Unknown error';
};

const runGraphQL = async <T, V extends object>(
	doc: TypedDocumentNode<T, V>,
	vars: V
): Promise<ApiResult<T>> => {
	try {
		const client = await getGraphQLClient();
		const data = await client.request(doc, vars);
		return { success: true, data };
	} catch (err) {
		return { success: false, error: extractError(err) };
	}
};

// Chart operations
export const listSimfiles = (vars: {
	scope: SimfileScope;
	search?: string;
	page?: number;
	pageSize?: number;
}) => runGraphQL<ListSimfilesQuery, typeof vars>(ListSimfilesDocument, vars);

export const getSimfile = (id: string) =>
	runGraphQL<GetSimfileQuery, { id: string }>(GetSimfileDocument, { id });

export const getSimfileWithFiles = async (
	id: string
): Promise<ApiResult<GetSimfileWithFilesQuery['simfile']>> => {
	const r = await runGraphQL<GetSimfileWithFilesQuery, { id: string }>(
		GetSimfileWithFilesDocument,
		{ id }
	);
	if (!r.success) return r;
	return { success: true, data: r.data.simfile };
};

export const createSimfile = (input: CreateSimfileInput) =>
	runGraphQL<CreateSimfileMutation, { input: CreateSimfileInput }>(CreateSimfileDocument, {
		input
	});

export const updateSimfile = (id: string, input: UpdateSimfileInput) =>
	runGraphQL<UpdateSimfileMutation, { id: string; input: UpdateSimfileInput }>(
		UpdateSimfileDocument,
		{
			id,
			input
		}
	);

export const deleteSimfile = async (
	id: string
): Promise<ApiResult<{ id: string; deleted: boolean }>> => {
	const r = await runGraphQL<DeleteSimfileMutation, { id: string }>(DeleteSimfileDocument, {
		id
	});
	if (!r.success) return r;
	return { success: true, data: r.data.deleteSimfile };
};

export const nextDisplayId = async (): Promise<ApiResult<number>> => {
	const r = await runGraphQL<NextDisplayIdQuery, Record<string, never>>(
		NextDisplayIdDocument,
		{}
	);
	if (!r.success) return r;
	return { success: true, data: r.data.nextDisplayId };
};

export const simfileSearch = (vars: { query: string; excludeIds?: string[]; limit?: number }) =>
	runGraphQL<SimfileSearchQuery, typeof vars>(SimfileSearchDocument, vars);

// User operations
export const me = () => runGraphQL<MeQuery, Record<string, never>>(MeDocument, {});

export const upsertUserProfile = (input: UpsertUserProfileInput) =>
	runGraphQL<UpsertUserProfileMutation, { input: UpsertUserProfileInput }>(
		UpsertUserProfileDocument,
		{
			input
		}
	);

// Auth operations
export const generateMagicLink = () =>
	runGraphQL<GenerateMagicLinkMutation, Record<string, never>>(GenerateMagicLinkDocument, {});
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run --filter=dtx-desktop test -- api-client.test.ts
```

- [ ] **Step 5: Type-check**

```bash
bun run --filter=dtx-desktop check
```

Type-check will fail at the call-sites that still import `apiGet/apiPost/apiPatch`. That's expected and fixed in the next tasks. To unblock, temporarily re-export shims at the bottom of `api-client.ts`:

```ts
// TEMPORARY shims removed in Tasks 25-26
export const apiGet = <T = unknown>(_path: string): Promise<ApiResult<T>> => {
	throw new Error('apiGet is being migrated; see Task 25/26');
};
export const apiPost = <T = unknown>(_path: string, _body: unknown): Promise<ApiResult<T>> => {
	throw new Error('apiPost is being migrated; see Task 25/26');
};
export const apiPatch = <T = unknown>(_path: string, _body: unknown): Promise<ApiResult<T>> => {
	throw new Error('apiPatch is being migrated; see Task 25/26');
};
```

These shims compile but throw at runtime — preventing accidental use while keeping the build green during the migration. They are deleted in Task 26.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src/main/api-client.ts packages/dtx-desktop/src/main/api-client.test.ts
git commit -m "refactor(dtx-desktop): rewrite api-client on GraphQL with ApiResult envelope

Generic apiGet/apiPost/apiPatch are temporarily shimmed; they're
deleted after Tasks 25-26 finish migrating call-sites.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 24: Create `upload.ts` helper

**Files:**

- Create: `packages/dtx-desktop/src/main/upload.ts`
- Create: `packages/dtx-desktop/src/main/upload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dtx-desktop/src/main/upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./graphql/client', () => ({
	getApiBaseUrl: () => 'https://api.test',
	getAccessToken: vi.fn().mockResolvedValue('tok')
}));

import { uploadFile } from './upload';

const fetchSpy = vi.fn();
beforeEach(() => {
	fetchSpy.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

describe('uploadFile', () => {
	it('POSTs multipart to /upload with bearer + DTXDesktopApp header', async () => {
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify({
					message: 'ok',
					file: {
						fileName: 'a.dtx',
						key: '1/a.dtx',
						size: 100,
						contentType: 'application/octet-stream',
						status: 'Uploaded'
					}
				})
			)
		);
		const fd = new FormData();
		fd.append('simFileId', '1');
		const r = await uploadFile(fd);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.test/upload',
			expect.objectContaining({ method: 'POST', body: fd })
		);
		const init = fetchSpy.mock.calls[0][1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer tok');
		expect(headers['User-Agent']).toBe('DTXDesktopApp');
		expect(r.success).toBe(true);
	});

	it('returns shaped error on non-2xx', async () => {
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify({ error: 'boom' }), { status: 400 })
		);
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('boom');
	});
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun run --filter=dtx-desktop test -- upload.test.ts
```

- [ ] **Step 3: Create `packages/dtx-desktop/src/main/upload.ts`**

```ts
import { getApiBaseUrl, getAccessToken } from './graphql/client';
import type { ApiResult } from './api-client';

const API_REQUEST_TIMEOUT_MS = 30000;

export type UploadResponse = {
	message: string;
	file: {
		fileName: string;
		key: string;
		size: number;
		contentType: string;
		status: string;
	};
};

const fetchWithTimeout = async (input: string, init: RequestInit): Promise<Response> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
};

export const uploadFile = async (formData: FormData): Promise<ApiResult<UploadResponse>> => {
	try {
		const token = await getAccessToken();
		const res = await fetchWithTimeout(`${getApiBaseUrl()}/upload`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'User-Agent': 'DTXDesktopApp',
				'X-Requested-With': 'DTXDesktopApp'
			},
			body: formData
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
				error?: string;
			};
			return { success: false, error: err.error || `HTTP ${res.status}` };
		}
		const data = (await res.json()) as UploadResponse;
		return { success: true, data };
	} catch (err) {
		if (
			typeof err === 'object' &&
			err !== null &&
			'name' in err &&
			(err as { name: string }).name === 'AbortError'
		) {
			return { success: false, error: `Request timed out after ${API_REQUEST_TIMEOUT_MS}ms` };
		}
		return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
	}
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
bun run --filter=dtx-desktop test -- upload.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/main/upload.ts packages/dtx-desktop/src/main/upload.test.ts
git commit -m "feat(dtx-desktop): add upload.ts helper

Bearer-authenticated multipart POST to ${VITE_DTX_SERVER_URL}/upload.
Used by both simfile-service.ts and the index.ts upload-file IPC handler.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 25: Refactor `simfile-service.ts` call-sites

**Files:**

- Modify: `packages/dtx-desktop/src/main/simfile-service.ts`
- Modify: `packages/dtx-desktop/src/main/simfile-service.test.ts`

Four call-sites swap to the typed wrappers from Task 23, and the multipart upload swaps to `upload.ts` from Task 24.

- [ ] **Step 1: Update imports at the top of `simfile-service.ts`**

Find:

```ts
import { apiGet, apiPost } from './api-client';
```

Replace with:

```ts
import { listSimfiles, nextDisplayId, createSimfile } from './api-client';
import { uploadFile } from './upload';
import { SimfileScope, type CreateSimfileInput } from './graphql/generated/graphql';
```

- [ ] **Step 2: Update list call (around line 37, 53)**

Find the first `apiGet` for the simfile list:

```ts
const firstPageResult = await apiGet<{ data: SimfileWithDtx[]; count: number }>(
	`/api/chart?scope=mine&page=1&pageSize=...`
);
```

Replace with:

```ts
const firstPageResult = await listSimfiles({ scope: SimfileScope.Mine, page: 1, pageSize });
```

Note: `firstPageResult.data` previously was `{ data: SimfileWithDtx[]; count: number }`. After the refactor, `firstPageResult.data` is the `ListSimfilesQuery` shape `{ simfiles: { data: [...], count } }`. Adjust downstream code accordingly — e.g., `firstPageResult.data.simfiles.data` and `firstPageResult.data.simfiles.count`. To minimize churn, unwrap immediately:

```ts
if (!firstPageResult.success) throw new Error(firstPageResult.error);
const { data: page1, count } = firstPageResult.data.simfiles;
```

Apply the same transformation to the pagination loop iteration (line ~53):

```ts
const pageResult = await listSimfiles({ scope: SimfileScope.Mine, page, pageSize });
if (!pageResult.success) throw new Error(pageResult.error);
const pageData = pageResult.data.simfiles.data;
```

The `SimfileWithDtx[]` shape from the generated `ListSimfilesQuery['simfiles']['data']` has camelCase fields (`displayId`, `isPublished`, `dtxFiles`). If downstream code expects snake_case, write a small per-row adapter inline or extend `simfile-service.ts` with one and apply at the loop boundary.

- [ ] **Step 3: Update nextDisplayId call (around line 86)**

Find:

```ts
const result = await apiGet<{ nextDisplayId: number }>('/api/chart/next-display-id');
```

Replace with:

```ts
const result = await nextDisplayId();
```

Downstream code expects `result.data.nextDisplayId`. After the refactor, `result.data` is the integer directly. Update:

```ts
if (!result.success) throw new Error(result.error);
return result.data;
```

- [ ] **Step 4: Update upload call (around line 174)**

Find the multipart fetch block:

```ts
const response = await fetch(`${apiBaseUrl}/api/simFile/upload`, {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'DTXDesktopApp',
        ...
    },
    body: formData
});
// ... existing response parsing
```

Replace with:

```ts
const uploadResult = await uploadFile(formData);
if (!uploadResult.success) {
	throw new Error(uploadResult.error);
}
// downstream uses uploadResult.data.file
```

Update any code that referenced the inline-fetched response to use `uploadResult.data` instead.

- [ ] **Step 5: Update createSimfile call (around line 312)**

Find:

```ts
const apiResult = await apiPost<{...}>('/api/chart', {
    title: simfileData.title,
    artist: simfileData.artist,
    bpm: simfileData.bpm,
    displayId: simfileData.displayId,
    isPublished: simfileData.isPublished,
    publishDate: simfileData.publishDate,
    downloadUrl: simfileData.downloadUrl,
    videoPreviewUrl: simfileData.videoPreviewUrl,
    levels: simfileData.levels
});
```

The legacy REST endpoint accepts `levels` as a structured field with label/level pairs. The GraphQL `CreateSimfileInput` uses `dtxFiles: [{ label, level }]`. Adapt:

```ts
const input: CreateSimfileInput = {
	title: simfileData.title,
	artist: simfileData.artist,
	bpm: simfileData.bpm,
	displayId: simfileData.displayId,
	isPublished: simfileData.isPublished ?? null,
	publishDate: simfileData.publishDate,
	downloadUrl: simfileData.downloadUrl,
	videoPreviewUrl: simfileData.videoPreviewUrl,
	dtxFiles: simfileData.levels?.map((l) => ({ label: l.label, level: l.level })) ?? null
};
const apiResult = await createSimfile(input);
```

Update downstream `apiResult.data` references — `apiResult.data` is now the `CreateSimfileMutation` shape: `{ createSimfile: SimfileFull }`. Unwrap:

```ts
if (!apiResult.success) throw new Error(apiResult.error);
const simfile = apiResult.data.createSimfile;
// use simfile.id, simfile.title, etc.
```

- [ ] **Step 6: Update or write tests for affected paths**

Open `simfile-service.test.ts` and update any mocks that referenced the removed `apiGet/apiPost`. Replace with mocks of `listSimfiles`, `nextDisplayId`, `createSimfile`, `uploadFile`:

```ts
vi.mock('./api-client', () => ({
	listSimfiles: vi.fn(),
	nextDisplayId: vi.fn(),
	createSimfile: vi.fn(),
	updateSimfile: vi.fn(),
	deleteSimfile: vi.fn(),
	simfileSearch: vi.fn()
}));
vi.mock('./upload', () => ({
	uploadFile: vi.fn()
}));
```

For each affected test, return `{ success: true, data: ... }` from the appropriate mock and assert it was called with the right arguments.

- [ ] **Step 7: Type-check + tests**

```bash
bun run --filter=dtx-desktop check
bun run --filter=dtx-desktop test -- simfile-service.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-desktop/src/main/simfile-service.ts packages/dtx-desktop/src/main/simfile-service.test.ts
git commit -m "refactor(dtx-desktop): route simfile-service.ts through GraphQL api-client

Four call-sites (list, nextDisplayId, upload, create) migrate to the
typed wrappers from Task 23 + upload.ts from Task 24.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 26: Refactor `index.ts` IPC handlers (remove cookie hacks)

**Files:**

- Modify: `packages/dtx-desktop/src/main/index.ts`
- Modify: `packages/dtx-desktop/src/main/index.test.ts`

Five call-sites; the two cookie-session hacks (`load-asset-files` around line 352 and `upload-file` around line 615) collapse into bearer-authenticated equivalents.

- [ ] **Step 1: Update imports at the top of `index.ts`**

Find:

```ts
import { apiGet, apiPatch } from './api-client';
```

Replace with:

```ts
import {
	apiGet, // remove after this task
	apiPatch, // remove after this task
	getSimfile,
	getSimfileWithFiles,
	updateSimfile,
	simfileSearch
} from './api-client';
import { uploadFile } from './upload';
```

Once the call-sites are migrated, drop `apiGet` and `apiPatch` from the import list.

- [ ] **Step 2: Replace `load-asset-files` IPC handler (the cookie-session block, lines ~330-392)**

Find the whole block that builds session cookies and fetches `${apiBaseUrl}/api/simFile/listFiles/${simfileId}`. Replace the entire fetch + cookie-shaping logic with:

```ts
ipcMain.handle('load-asset-files', async (_event, simfileId: string) => {
	try {
		const result = await getSimfileWithFiles(String(simfileId));
		if (!result.success) {
			console.error('API Error:', result.error);
			// Treat NOT_FOUND like the old 404 path
			if (
				result.error.includes('NOT_FOUND') ||
				result.error.includes('Failed to list files')
			) {
				return [];
			}
			throw new Error(`Error fetching files: ${result.error}`);
		}
		return result.data?.files ?? [];
	} catch (error) {
		console.error('Error loading asset files:', error);
		return [];
	}
});
```

Remove the entire `sessionCookies` shaping block — bearer auth in `getGraphQLClient()` handles everything.

- [ ] **Step 3: Replace `search-cloud-songs` IPC handler (lines ~404-428)**

Find:

```ts
const params = new URLSearchParams({ q: query, limit: String(limit) });
if (excludeLinkedSongIds.length > 0) {
	params.set('exclude', excludeLinkedSongIds.join(','));
}
const result = await apiGet<{ data: unknown[] }>(`/api/chart/search?${params}`);
if (!result.success) {
	return { success: false, error: result.error };
}
return { success: true, data: result.data?.data || [] };
```

Replace with:

```ts
const result = await simfileSearch({
	query,
	limit,
	excludeIds: excludeLinkedSongIds.length > 0 ? excludeLinkedSongIds.map(String) : undefined
});
if (!result.success) {
	return { success: false, error: result.error };
}
return { success: true, data: result.data.simfileSearch };
```

- [ ] **Step 4: Replace `getSimfile` IPC handler (around line 433)**

Find:

```ts
const result = await apiGet<unknown>(`/api/chart/${cloudSongId}`);
```

Replace with:

```ts
const result = await getSimfile(String(cloudSongId));
```

Update downstream `result.data` references — the new shape is `{ simfile: SimfileFull }`. Unwrap appropriately based on what the IPC handler returns to the renderer.

- [ ] **Step 5: Replace `updateSimfile` IPC handler (around line 459)**

Find:

```ts
const result = await apiPatch<unknown>(`/api/chart/${simfileId}`, updateData);
```

Replace with:

```ts
const result = await updateSimfile(String(simfileId), updateData);
```

`result.data` is now `{ updateSimfile: SimfileFull }`. Unwrap to match the renderer's expectation.

- [ ] **Step 6: Replace `upload-file` IPC handler (lines ~561-660)**

Find the whole block that builds session cookies and fetches `${apiBaseUrl}/api/simFile/upload`. Replace the auth + fetch logic with `uploadFile()`:

```ts
ipcMain.handle(
	'upload-file',
	async (_event, fileName: string, songFolderPath: string, simfileId: string) => {
		try {
			const filePath = path.join(songFolderPath, fileName);
			try {
				await fs.promises.access(filePath);
			} catch {
				throw new Error(`File not found: ${filePath}`);
			}
			const fileBuffer = await fs.promises.readFile(filePath);
			let fileNameWithoutDir = fileName;
			if (fileName.includes('/')) {
				fileNameWithoutDir = fileName.split('/').slice(1).join('/');
			}
			const formData = new FormData();
			formData.append('file', new File([fileBuffer], fileNameWithoutDir));
			formData.append('simFileId', simfileId);
			const result = await uploadFile(formData);
			if (!result.success) {
				throw new Error(`Upload failed: ${result.error}`);
			}
			return { success: true, data: result.data };
		} catch (error) {
			console.error('Error uploading file:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}
);
```

Drop the ~100 lines of `sessionCookies` shaping plus the inline fetch and JSON parse.

- [ ] **Step 7: Remove the temporary apiGet/apiPost/apiPatch shims from `api-client.ts`**

Open `packages/dtx-desktop/src/main/api-client.ts` and delete the three throwing shims added at the end in Task 23 Step 5. Also remove the imports of `apiGet` and `apiPatch` from `index.ts`.

Verify no remaining call-sites:

```bash
grep -rn "apiGet\|apiPost\|apiPatch" packages/dtx-desktop/src --include="*.ts"
```

Expected: no results (or only the import-removal line itself).

- [ ] **Step 8: Type-check + tests**

```bash
bun run --filter=dtx-desktop check
bun run --filter=dtx-desktop typecheck:node
bun run --filter=dtx-desktop test
```

Update any test mocks referencing the removed generic helpers.

- [ ] **Step 9: Commit**

```bash
git add packages/dtx-desktop/src/main/index.ts packages/dtx-desktop/src/main/index.test.ts packages/dtx-desktop/src/main/api-client.ts
git commit -m "refactor(dtx-desktop): route index.ts IPC handlers through GraphQL

Five IPC handlers (load-asset-files, search-cloud-songs, getSimfile,
updateSimfile, upload-file) now use typed wrappers. The two
cookie-session hacks are gone — bearer auth in getGraphQLClient
covers both former paths.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 27: Repository-wide verification

**Files:** (verification only)

- [ ] **Step 1: Codegen drift check (both packages)**

```bash
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-desktop lint:codegen
```

Expected: clean diff in both.

- [ ] **Step 2: Type-check all packages**

```bash
bun run --filter=dtx-web check
bun run --filter=dtx-desktop check
bun run --filter=dtx-desktop typecheck:node
bun run --filter=@dtx/common check
bun run --filter=@dtx/ui-components test 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 3: Test all packages**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-desktop test
bun run --filter=@dtx/common test
```

Expected: all green.

- [ ] **Step 4: Lint**

```bash
bun run lint
```

Expected: clean.

- [ ] **Step 5: Build both client packages**

```bash
bun run --filter=dtx-web build
```

Note bundle size delta in `wrangler` output — expect ~+80 KB total.

- [ ] **Step 6: dtx-web pre-prod dry-run**

```bash
cd packages/dtx-web && bunx wrangler deploy --env pre-prod --dry-run 2>&1 | tail -20
cd ../..
```

Expected: dry-run succeeds; service binding listed.

No commit — this task is a gate.

---

## Task 28: Deploy dtx-web to pre-prod and smoke-test flag OFF → ON → OFF

**Files:** (deployment + manual verification)

- [ ] **Step 1: Deploy pre-prod (flag OFF)**

```bash
bun run deploy:web:preprod
```

- [ ] **Step 2: Smoke flag-OFF**

Visit `https://pre-prod.dtx.hapadona.com/`.

- Open DevTools Network tab.
- Login.
- Browse blog (`/blog`) — anonymous list loads.
- Open the app (`/app`) — chart list loads (own charts).
- Edit a chart title.
- Click bulk-download for ≥2 charts.
- Click single-download on a published chart.
- Click "generate magic link".

Verify in DevTools that **no requests** are made to `api.pre-prod.dtx.hapadona.com`. All hits go to `/api/...` on dtx-web.

- [ ] **Step 3: Flip flag to ON**

In the Cloudflare dashboard for the dtx-web pre-prod Worker, set `PUBLIC_USE_GRAPHQL_API=true` (Variables tab → edit → re-deploy). Alternative: run `bunx wrangler deploy --env pre-prod --var PUBLIC_USE_GRAPHQL_API:true` from `packages/dtx-web/`.

Wait ~30 seconds for propagation, then hard-refresh.

- [ ] **Step 4: Smoke flag-ON**

Repeat the same flows. Now verify in DevTools that requests **do** hit `api.pre-prod.dtx.hapadona.com/graphql`, `/downloads/${id}`, and `/downloads/bulk` with `Authorization: Bearer ...` headers. CORS works (no console errors).

Watch for response-shape deltas — anything that breaks the UI is a bug to file. Bring `wrangler tail --env pre-prod` up against both dtx-web and dtx-api in parallel to catch server-side errors.

- [ ] **Step 5: Flip flag back to OFF**

Reset `PUBLIC_USE_GRAPHQL_API=false` and re-deploy. Hard-refresh and confirm flows still work (now via REST again).

- [ ] **Step 6: Notes / follow-ups**

Write down any deltas found during smoke for Phase 4 to address. No code changes here unless something is broken — Phase 3's job is to ship the code with flag default OFF.

No commit on this task unless smoke turned up a fix.

---

## Task 29: Build pre-prod desktop and smoke

**Files:** (build + manual verification)

- [ ] **Step 1: Set env and build**

```bash
VITE_DTX_SERVER_URL=https://api.pre-prod.dtx.hapadona.com bun run --filter=dtx-desktop build
```

(Use whichever build target your platform supports — `electron-builder` defaults vary. The goal is a runnable local binary.)

- [ ] **Step 2: Launch the built binary locally**

```bash
# macOS example — adjust per your build output
open packages/dtx-desktop/dist/mac/*.app
```

- [ ] **Step 3: Smoke flows**

In the desktop app:

- Sign in (the auth flow is unchanged).
- Open the cloud chart list — paginated list loads via GraphQL.
- Open a chart's asset-files dialog (`load-asset-files` IPC) — files list loads (this was the former cookie-session hack).
- Search for a song in the song-link autocomplete (`search-cloud-songs` IPC).
- Upload a `.dtx` file (this exercises `upload-file` IPC, the second former cookie-session hack).
- Edit a cloud chart's metadata (`updateSimfile`).
- Create a new chart (`createSimfile`).

Each flow should complete without errors. Inspect `wrangler tail` against dtx-api pre-prod to confirm GraphQL queries are arriving with bearer auth.

- [ ] **Step 4: Notes**

Note any deltas or surprises. Phase 3 desktop build is for validation; production release ships in Phase 5.

No commit.

---

## Task 30: Deploy dtx-web to production (flag OFF)

**Files:** (deployment)

- [ ] **Step 1: Verify prod stanza in `wrangler.jsonc` has flag OFF and no service binding**

```bash
grep -A 12 '"name": "dtx-web"' packages/dtx-web/wrangler.jsonc | head -25
```

Confirm:

- `"PUBLIC_USE_GRAPHQL_API": "false"`
- No `"services": [...]` block in the prod stanza.

- [ ] **Step 2: Deploy prod**

```bash
bun run deploy:web
```

- [ ] **Step 3: Production smoke (flag-OFF)**

Visit `https://dtx.hapadona.com/`. Login. Browse blog. Open `/app`. Verify all existing flows work — they should be identical to pre-Phase-3 prod since the flag is OFF.

In DevTools, confirm no requests to `api.dtx.hapadona.com` (it doesn't exist yet, and we don't expect to see any).

- [ ] **Step 4: Tag the cutover-ready milestone**

```bash
git tag phase-3-shipped
git push --tags
```

No additional commit on this task.

---

## Done criteria checklist (from the spec)

Confirm each before declaring Phase 3 complete:

- [ ] `packages/dtx-web/src/lib/api/{client,transport,token,chart,user,auth,index}.ts` exist (Tasks 6-11, 13).
- [ ] `packages/dtx-web/src/lib/api/rest/download.ts` exists and is wired into `DownloadDropdown.svelte` and `ChartList.helpers.ts` (Tasks 12, 17, 18).
- [ ] All dtx-web fetch call-sites against `/api/*` go through `lib/api/` (Tasks 14, 15, 16, 17, 18).
- [ ] `packages/dtx-web/src/lib/api/generated/graphql.ts` committed; `lint:codegen` passes (Tasks 3, 27).
- [ ] `packages/dtx-web/wrangler.jsonc` declares service binding on `pre-prod` and `pre-prod-prod-data` only; `PUBLIC_USE_GRAPHQL_API=false` and `PUBLIC_DTX_API_URL` set per env (Task 5).
- [ ] `packages/dtx-web/src/app.d.ts` declares `API: Fetcher` on `App.Platform.env` (Task 4).
- [ ] `packages/dtx-desktop/src/main/api-client.ts` rewritten on GraphQL; `apiGet/apiPost/apiPatch` deleted (Tasks 23, 26).
- [ ] `packages/dtx-desktop/src/main/upload.ts` exists and is called from both `simfile-service.ts` and the `index.ts` `upload-file` IPC handler (Tasks 24, 25, 26).
- [ ] `packages/dtx-desktop/src/main/index.ts` updated: 5 IPC-handler call-sites swap to typed wrappers; the 2 cookie-session hacks removed (Task 26).
- [ ] `bun run --filter=dtx-web check` / `test` / `lint` pass (Tasks 19, 27).
- [ ] `bun run --filter=dtx-desktop check` / `test` / `typecheck:node` pass (Task 27).
- [ ] `bun run --filter=@dtx/common check` / `test` pass — no regression (Task 27).
- [ ] `bun run lint` (root) passes (Task 27).
- [ ] `wrangler deploy --env pre-prod --dry-run` on dtx-web succeeds with service binding declared (Task 27).
- [ ] Manual flag-ON pre-prod smoke validates all web call-sites work against dtx-api (Task 28).
- [ ] Pre-prod desktop build validates against pre-prod dtx-api (Task 29).
- [ ] Zero changes outside `packages/dtx-web/` and `packages/dtx-desktop/`.
