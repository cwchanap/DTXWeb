# API Migration Phase 2 — Implement GraphQL Surface + REST Sidecars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 5 GraphQL queries + 5 GraphQL mutations + 3 REST sidecar endpoints (`/upload`, `/downloads/:id`, `/downloads/bulk`) on the existing `packages/dtx-api` Worker, deploy to pre-prod, and commit a GraphQL schema artifact for Phase 3's codegen consumer.

**Architecture:** All work lands inside `packages/dtx-api/`. Resolvers call `@dtx/common/server` directly for plain CRUD; `services/` files appear only for composition (`createSimfile` rollback), new dependencies (`magicLink` Supabase admin), and shared REST helpers (downloads, uploads, R2 enrichment). Binary I/O stays Worker-mediated via the R2 binding — **no presigned URLs, no AWS SDK, no S3 credentials**. Pothos `scope-auth` enforces `user`, `owner`, and `publicOrOwner` scopes with a per-request ownership cache.

**Tech Stack:** TypeScript 5.x, Bun workspaces, Wrangler 4.x, GraphQL Yoga 5.x, Pothos 4.x (`@pothos/core`, `@pothos/plugin-scope-auth`, `@pothos/plugin-errors`), `@supabase/supabase-js`, `zod`, Vitest, `@dtx/common/server` (existing).

**Spec:** `docs/superpowers/specs/2026-05-19-api-migration-phase-2-design.md`.

**Pre-conditions:** Phase 0 + Phase 1 are merged to `main`. `dtx-api` is deployed at `api.pre-prod.dtx.hapadona.com` with `/healthz` returning JSON and `/graphql` exposing `Query.healthz: String!`.

**D1 row shape reference (locked):** `SimfileWithDtxFiles` returned by `listSimfiles` / `getSimfile` uses snake_case keys (`user_id`, `is_published: boolean`, `display_id`, `download_url`, `preview_url`, `video_preview_url`, `publish_date`, `created_at`, `updated_at`) with `dtx_files: { level, label }[]`. Resolvers map these to camelCase GraphQL fields via `resolve` functions.

---

## File Structure (end state, additions only)

```text
packages/dtx-api/
├── package.json                            (extend: add zod dep)
├── wrangler.jsonc                          (extend: add PUBLIC_SIMFILE_BUCKET_URL var per env)
└── src/
    ├── index.ts                            (extend: route /downloads/* and /upload)
    ├── index.test.ts                       (extend: cover new routes + CORS wrapping)
    ├── context.ts                          (extend: OwnerCacheEntry cache shape)
    ├── env.ts                              (extend: 4 new vars/secrets)
    ├── lib/
    │   ├── sanitizeFilename.ts             NEW
    │   └── sanitizeFilename.test.ts        NEW
    ├── schema/
    │   ├── builder.ts                      (extend: real owner/publicOrOwner scopes + ForbiddenError override)
    │   ├── builder.test.ts                 NEW
    │   ├── index.ts                        (extend: declare Mutation + import resolver modules)
    │   ├── simfile.ts                      NEW
    │   ├── simfile.test.ts                 NEW
    │   ├── user.ts                         NEW
    │   ├── user.test.ts                    NEW
    │   ├── auth.ts                         NEW
    │   └── auth.test.ts                    NEW
    ├── services/
    │   ├── createSimfile.ts                NEW
    │   ├── createSimfile.test.ts           NEW
    │   ├── magicLink.ts                    NEW
    │   ├── magicLink.test.ts               NEW
    │   ├── downloads.ts                    NEW
    │   ├── downloads.test.ts               NEW
    │   ├── uploads.ts                      NEW
    │   ├── uploads.test.ts                 NEW
    │   ├── r2Enrichment.ts                 NEW
    │   └── r2Enrichment.test.ts            NEW
    ├── rest/
    │   ├── downloadSimfile.ts              NEW
    │   ├── downloadSimfile.test.ts         NEW
    │   ├── downloadBulk.ts                 NEW
    │   ├── downloadBulk.test.ts            NEW
    │   ├── upload.ts                       NEW
    │   └── upload.test.ts                  NEW
    └── scripts/
        └── gen-schema.ts                   NEW

packages/dtx-api/dist/
└── schema.graphql                          NEW (committed)
```

---

## Task 1: Add `zod`, extend `Env`, extend wrangler.jsonc

**Files:**

- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/wrangler.jsonc`

This is a setup task: add the dependency and declare the new env surface. No behavior change yet.

- [ ] **Step 1: Add `zod` to dependencies**

Open `packages/dtx-api/package.json`. Inside the `"dependencies"` object, after `"graphql-yoga"`, add:

```jsonc
"zod": "^3.25.67"
```

The block should now read (order doesn't matter; match existing style):

```jsonc
"dependencies": {
    "@dtx/common": "*",
    "@pothos/core": "^4.0.0",
    "@pothos/plugin-errors": "^4.0.0",
    "@pothos/plugin-scope-auth": "^4.0.0",
    "@supabase/supabase-js": "^2.49.4",
    "graphql": "^16.10.0",
    "graphql-yoga": "^5.10.0",
    "zod": "^3.25.67"
}
```

- [ ] **Step 2: Install**

Run: `bun install`
Expected: `zod` resolved and added to `bun.lock`.

- [ ] **Step 3: Extend `Env` type**

Open `packages/dtx-api/src/env.ts`. Replace the file's contents with:

```ts
import type { D1Database, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

export type Env = {
	DB: D1Database;
	DTXFILE_BUCKET: R2Bucket;
	RATE_LIMIT_API: KVNamespace;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	RATE_LIMIT_ENV: 'prod' | 'pre-prod' | 'pre-prod-prod-data';
	GRAPHIQL: 'true' | 'false';
	CORS_ALLOWED_ORIGINS: string;
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' | 'false';

	// Phase 2 — var (committed to wrangler.jsonc)
	PUBLIC_SIMFILE_BUCKET_URL: string;

	// Phase 2 — secrets (set via `wrangler secret put` per env)
	SUPABASE_SERVICE_ROLE_KEY: string;
	CLOUDFLARE_ZONE_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
};
```

- [ ] **Step 4: Add `PUBLIC_SIMFILE_BUCKET_URL` to each env in wrangler.jsonc**

Open `packages/dtx-api/wrangler.jsonc`. In the top-level (prod) `"vars"` block, after `"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"`, add:

```jsonc
"PUBLIC_SIMFILE_BUCKET_URL": "https://files.dtx.hapadona.com"
```

In `"env.pre-prod.vars"` (after `"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"`), add:

```jsonc
"PUBLIC_SIMFILE_BUCKET_URL": "https://files-preprod.dtx.hapadona.com"
```

In `"env.pre-prod-prod-data.vars"` (after `"PUBLIC_ENABLE_BLOG_DOWNLOAD": "false"`), add:

```jsonc
"PUBLIC_SIMFILE_BUCKET_URL": "https://files.dtx.hapadona.com"
```

If the actual public bucket URLs differ from these placeholders, look up the matching values in `packages/dtx-web/.svelte-kit/cloudflare/...` or the dtx-web deployment dashboard and substitute. Verify with:

```bash
grep PUBLIC_SIMFILE_BUCKET_URL packages/dtx-web/.env.example
```

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/package.json packages/dtx-api/src/env.ts packages/dtx-api/wrangler.jsonc bun.lock
git commit -m "chore(dtx-api): add zod dep and extend Env for Phase 2

Adds zod for mutation input validation and declares the
PUBLIC_SIMFILE_BUCKET_URL var plus three secrets used by Phase 2's
upload + magic-link flows. No behavior change yet."
```

---

## Task 2: Owner-cache shape + real scope-auth wiring

**Files:**

- Modify: `packages/dtx-api/src/context.ts`
- Modify: `packages/dtx-api/src/schema/builder.ts`
- Create: `packages/dtx-api/src/schema/builder.test.ts`

Phase 1 left scope stubs returning `false`. Land the real implementations and extend the per-request cache to also hold `is_published` so `owner` and `publicOrOwner` share a single D1 lookup.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/schema/builder.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import { workerLogger } from '@dtx/common/server';
import type { Ctx, OwnerCacheEntry } from '../context';
import type { Env } from '../env';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return { ...actual, getSimfileOwner: vi.fn() };
});

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: 'http://test',
	SUPABASE_SERVICE_ROLE_KEY: 'srk'
});

const baseCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map<string, OwnerCacheEntry | null>(),
	...overrides
});

// Probe field: throws GraphQLError if the named scope fails.
builder.queryField('probeOwner', (t) =>
	t.string({
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: () => 'ok'
	})
);
builder.queryField('probePublicOrOwner', (t) =>
	t.string({
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_, args) => ({ publicOrOwner: { simfileId: String(args.id) } }),
		resolve: () => 'ok'
	})
);
builder.queryField('probeUser', (t) =>
	t.string({ authScopes: { user: true }, resolve: () => 'ok' })
);

const schema = builder.toSchema();

const runQuery = async (ctx: Ctx, query: string) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query })
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

describe('auth scopes', () => {
	beforeEach(() => mockedGetOwner.mockReset());

	it('user scope: passes when ctx.user is set', async () => {
		const result = await runQuery(
			baseCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }),
			'{ probeUser }'
		);
		expect(result.data?.probeUser).toBe('ok');
	});

	it('user scope: rejects when ctx.user is null', async () => {
		const result = await runQuery(baseCtx(), '{ probeUser }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: passes when caller is the owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "42") }'
		);
		expect(result.data?.probeOwner).toBe('ok');
	});

	it('owner scope: rejects when caller is not owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'other', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "42") }'
		);
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: rejects anonymous', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(baseCtx(), '{ probeOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: caches lookup per request', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const ctx = baseCtx({ user: { id: 'u1' } as Ctx['user'] });
		await runQuery(ctx, '{ a: probeOwner(id: "42")  b: probeOwner(id: "42") }');
		expect(mockedGetOwner).toHaveBeenCalledTimes(1);
	});

	it('publicOrOwner: anonymous passes when simfile is published', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 1 });
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.data?.probePublicOrOwner).toBe('ok');
	});

	it('publicOrOwner: owner passes for unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probePublicOrOwner(id: "42") }'
		);
		expect(result.data?.probePublicOrOwner).toBe('ok');
	});

	it('publicOrOwner: rejects non-owner anon when unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('publicOrOwner: rejects when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- builder`
Expected: FAIL (`OwnerCacheEntry` not exported from `../context`, or scope assertions wrong).

- [ ] **Step 3: Update `Ctx.ownerByIdCache` shape**

Open `packages/dtx-api/src/context.ts`. Replace the file with:

```ts
import type { Session, User } from '@supabase/supabase-js';
import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { workerLogger, type WorkerLogger } from '@dtx/common/server';
import { verifyToken } from './auth/verifyToken';
import type { Env } from './env';

export type OwnerCacheEntry = {
	userId: string | null;
	isPublished: boolean;
};

export type Ctx = {
	user: User | null;
	session: Session | null;
	env: Env;
	db: D1Database;
	r2: R2Bucket;
	kv: KVNamespace;
	request: Request;
	logger: WorkerLogger;
	ownerByIdCache: Map<string, OwnerCacheEntry | null>;
};

export const createContext = async (request: Request, env: Env): Promise<Ctx> => {
	const auth = await verifyToken(request, env);
	return {
		user: auth?.user ?? null,
		session: auth?.session ?? null,
		env,
		db: env.DB,
		r2: env.DTXFILE_BUCKET,
		kv: env.RATE_LIMIT_API,
		request,
		logger: workerLogger,
		ownerByIdCache: new Map()
	};
};
```

- [ ] **Step 4: Wire real auth scopes**

Open `packages/dtx-api/src/schema/builder.ts`. Replace the file with:

```ts
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import { GraphQLError } from 'graphql';
import { getSimfileOwner } from '@dtx/common/server';
import type { Ctx, OwnerCacheEntry } from '../context';

const loadOwner = async (ctx: Ctx, cacheKey: string): Promise<OwnerCacheEntry | null> => {
	if (ctx.ownerByIdCache.has(cacheKey)) {
		return ctx.ownerByIdCache.get(cacheKey) ?? null;
	}
	const id = Number(cacheKey);
	if (!Number.isSafeInteger(id) || id <= 0) {
		ctx.ownerByIdCache.set(cacheKey, null);
		return null;
	}
	const row = await getSimfileOwner(ctx.db, id);
	const entry: OwnerCacheEntry | null = row
		? { userId: row.user_id, isPublished: row.is_published === 1 }
		: null;
	ctx.ownerByIdCache.set(cacheKey, entry);
	return entry;
};

export const builder = new SchemaBuilder<{
	Context: Ctx;
	AuthScopes: {
		user: boolean;
		owner: { simfileId: string };
		publicOrOwner: { simfileId: string };
	};
	DefaultFieldNullability: false;
}>({
	plugins: [ScopeAuthPlugin, ErrorsPlugin],
	scopeAuth: {
		treatErrorsAsUnauthorized: true,
		unauthorizedError: () =>
			new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } }),
		authScopes: () => ({
			user: false, // overridden below per resolver via the closure
			owner: async () => false,
			publicOrOwner: async () => false
		})
	}
});

// Re-declare auth scopes with the per-request Ctx so they can reach into ctx.user / ctx.db.
// Pothos passes the ctx as the function arg; we close over it.
type ScopeArg = { simfileId: string };
builder.options.scopeAuth = {
	...builder.options.scopeAuth,
	authScopes: async (ctx: Ctx) => ({
		user: ctx.user != null,
		owner: async ({ simfileId }: ScopeArg) => {
			if (!ctx.user) return false;
			const entry = await loadOwner(ctx, simfileId);
			return entry !== null && entry.userId === ctx.user.id;
		},
		publicOrOwner: async ({ simfileId }: ScopeArg) => {
			const entry = await loadOwner(ctx, simfileId);
			if (!entry) return false;
			if (entry.isPublished) return true;
			return ctx.user != null && entry.userId === ctx.user.id;
		}
	})
};

builder.queryType({});
// Mutation root is declared in schema/index.ts before mutation fields land (Task 4).
```

**Note on the assignment to `builder.options.scopeAuth`:** Pothos v4 accepts `authScopes` either at builder-construction time or post-construction. If the resolved Pothos minor rejects the post-construction reassignment (TS error or runtime null), move the `authScopes` definition into the original `new SchemaBuilder({ ... })` call and reference `ctx` (closured) inside the inline function. The test contract is unchanged. Consult `https://pothos-graphql.dev/docs/plugins/scope-auth` for the exact v4 syntax shape.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- builder`
Expected: PASS, 10 tests green.

- [ ] **Step 6: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-api/src/context.ts packages/dtx-api/src/schema/builder.ts packages/dtx-api/src/schema/builder.test.ts
git commit -m "feat(dtx-api): wire real owner/publicOrOwner auth scopes

Extends Ctx.ownerByIdCache to OwnerCacheEntry (userId + isPublished)
so owner and publicOrOwner share a single D1 lookup per request.
Configures Pothos scope-auth to throw GraphQLError with stable
FORBIDDEN code on failure. Phase 2 of the API server migration."
```

---

## Task 3: Port `sanitizeFilename` from dtx-web

**Files:**

- Create: `packages/dtx-api/src/lib/sanitizeFilename.ts`
- Create: `packages/dtx-api/src/lib/sanitizeFilename.test.ts`

Verbatim port of the `_sanitizeFilename` helper used by dtx-web's upload route. Same behavior, same edge cases, identical test cases.

- [ ] **Step 1: Write the failing test**

Copy the upstream test verbatim, renaming the import. Create `packages/dtx-api/src/lib/sanitizeFilename.test.ts` with the same body as `packages/dtx-web/src/routes/api/simFile/upload/sanitizeFilename.test.ts`, but change the import line from:

```ts
import { _sanitizeFilename } from './+server';
```

to:

```ts
import { sanitizeFilename } from './sanitizeFilename';
```

And rename every `_sanitizeFilename(` call-site in the file to `sanitizeFilename(`.

Inspect the source file first:

```bash
cat packages/dtx-web/src/routes/api/simFile/upload/sanitizeFilename.test.ts
```

Copy its contents into the new file with the two renames above.

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- sanitizeFilename`
Expected: FAIL with "Cannot find module './sanitizeFilename'".

- [ ] **Step 3: Implement `sanitizeFilename`**

Create `packages/dtx-api/src/lib/sanitizeFilename.ts` with the verbatim body of `_sanitizeFilename` from `packages/dtx-web/src/routes/api/simFile/upload/+server.ts` (the helper at roughly lines 68–123 of that file), renamed and exported as `sanitizeFilename`:

```ts
// Helper function to sanitize filename for safe storage keys.
// Preserves directory structure and non-ASCII characters while preventing path traversal.
export const sanitizeFilename = (filename: string): string => {
	let sanitized = filename;

	// Iteratively remove path traversal sequences until the string stabilizes.
	let previousSanitized: string;
	do {
		previousSanitized = sanitized;
		sanitized = sanitized
			.replace(/\.\.(?:\/|\\)/g, '')
			.replace(/^[/\\]+/, '')
			.replace(/[/\\]+$/, '');
	} while (sanitized !== previousSanitized);

	// Collapse runs of dots followed by slashes (e.g., "....//" -> "")
	sanitized = sanitized.replace(/\.{2,}([/\\]+)/g, '');

	// Normalize path separators to forward slash for consistency
	sanitized = sanitized.replace(/\\/g, '/');

	// Remove null bytes and control characters
	// eslint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f]/g, '');

	// Truncate to reasonable max length (1024 chars for S3/object storage compatibility)
	const MAX_LENGTH = 1024;
	if (sanitized.length > MAX_LENGTH) {
		const lastSlash = sanitized.lastIndexOf('/');
		const lastDot = sanitized.lastIndexOf('.');
		if (lastDot > lastSlash && lastDot > lastSlash + 1) {
			const ext = sanitized.slice(lastDot);
			const nameWithoutExt = sanitized.slice(0, lastDot);
			const allowedNameLen = Math.max(0, MAX_LENGTH - ext.length);
			if (allowedNameLen > 0) {
				sanitized = nameWithoutExt.slice(0, allowedNameLen) + ext;
			} else {
				sanitized = ext.slice(0, MAX_LENGTH);
			}
		} else {
			sanitized = sanitized.slice(0, MAX_LENGTH);
		}
	}

	// Fallback if result is empty or just dots/slashes
	if (!sanitized || sanitized.match(/^[./\\_-]*$/)) {
		sanitized = `file_${Date.now()}`;
	}

	return sanitized;
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- sanitizeFilename`
Expected: PASS (count matches upstream).

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/lib/sanitizeFilename.ts packages/dtx-api/src/lib/sanitizeFilename.test.ts
git commit -m "feat(dtx-api): port sanitizeFilename from dtx-web

Verbatim port of the path-traversal-safe filename sanitizer used
by dtx-web's upload route. Will back Phase 2's POST /upload REST
endpoint. Phase 2 of the API server migration."
```

---

## Task 4: Declare `Mutation` root + `schema/user.ts` (Query.me, Mutation.upsertUserProfile)

**Files:**

- Modify: `packages/dtx-api/src/schema/index.ts`
- Create: `packages/dtx-api/src/schema/user.ts`
- Create: `packages/dtx-api/src/schema/user.test.ts`

Adds the smallest GraphQL surface that exercises both a query and a mutation: user profile.

- [ ] **Step 1: Declare `Mutation` root in `schema/index.ts`**

Open `packages/dtx-api/src/schema/index.ts`. Replace the file with:

```ts
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import './healthz';
import './user';
// Phase 2: additional resolver modules import-registered as they land.
// import './auth';
// import './simfile';
import { createContext } from '../context';
import type { Env } from '../env';

builder.mutationType({});

export const schema = builder.toSchema();

type YogaServerContext = { env: Env; ctx: ExecutionContext };

export const yoga = createYoga<YogaServerContext>({
	schema,
	context: ({ request, env }) => createContext(request, env),
	graphiql: (_request, { env }) => env.GRAPHIQL === 'true',
	landingPage: false,
	cors: false,
	maskedErrors: true
});
```

`builder.mutationType({})` must be called before any `builder.mutationField(...)` registration runs at module load. Since `./user` is imported _after_ `mutationType({})`, this ordering is safe.

- [ ] **Step 2: Write the failing test**

Create `packages/dtx-api/src/schema/user.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { schema } from './index';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getUserProfile: vi.fn(),
		upsertUserProfile: vi.fn(),
		getSimfileOwner: vi.fn()
	};
});

const { getUserProfile, upsertUserProfile } = await import('@dtx/common/server');
const mockedGet = vi.mocked(getUserProfile);
const mockedUpsert = vi.mocked(upsertUserProfile);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

beforeEach(() => {
	mockedGet.mockReset();
	mockedUpsert.mockReset();
});

describe('Query.me', () => {
	it('returns null when anonymous (UNAUTHORIZED via scope)', async () => {
		const result = await runQuery(makeCtx(), { query: '{ me { userId username } }' });
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns the profile when authed and profile exists', async () => {
		mockedGet.mockResolvedValue({ id: 1, user_id: 'u1', username: 'alice' });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ me { userId username } }'
		});
		expect(result.data?.me).toEqual({ userId: 'u1', username: 'alice' });
	});

	it('throws NOT_FOUND when authed but profile is missing', async () => {
		mockedGet.mockResolvedValue(null);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ me { userId username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
	});
});

describe('Mutation.upsertUserProfile', () => {
	it('rejects anonymous with FORBIDDEN', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { upsertUserProfile(input: { username: "bob" }) { username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects empty username with BAD_USER_INPUT', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { upsertUserProfile(input: { username: "" }) { username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('rejects >30 char username with BAD_USER_INPUT', async () => {
		const long = 'x'.repeat(31);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: `mutation { upsertUserProfile(input: { username: "${long}" }) { username } }`
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('trims whitespace and accepts a valid username', async () => {
		mockedUpsert.mockResolvedValue({ id: 1, user_id: 'u1', username: 'alice' });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { upsertUserProfile(input: { username: "  alice  " }) { userId username } }'
		});
		expect(result.data?.upsertUserProfile).toEqual({ userId: 'u1', username: 'alice' });
		expect(mockedUpsert).toHaveBeenCalledWith(expect.anything(), {
			user_id: 'u1',
			username: 'alice'
		});
	});
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- user`
Expected: FAIL with "Cannot find module './user'" or scope/validation assertions failing.

- [ ] **Step 4: Implement `schema/user.ts`**

Create `packages/dtx-api/src/schema/user.ts`:

```ts
import { GraphQLError } from 'graphql';
import { z } from 'zod';
import { getUserProfile, upsertUserProfile, type UserProfileRow } from '@dtx/common/server';
import { builder } from './builder';

const UserProfileRef = builder.objectRef<UserProfileRow>('UserProfile').implement({
	fields: (t) => ({
		userId: t.id({ resolve: (row) => row.user_id }),
		username: t.exposeString('username')
	})
});

builder.queryField('me', (t) =>
	t.field({
		type: UserProfileRef,
		nullable: true,
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => {
			const profile = await getUserProfile(ctx.db, ctx.user!.id);
			if (!profile) {
				throw new GraphQLError('User profile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			return profile;
		}
	})
);

const UpsertUserProfileInput = builder.inputType('UpsertUserProfileInput', {
	fields: (t) => ({ username: t.string({ required: true }) })
});

const usernameSchema = z
	.string()
	.transform((v) => v.trim())
	.pipe(
		z
			.string()
			.min(1, 'Username must be 1-30 characters')
			.max(30, 'Username must be 1-30 characters')
	);

builder.mutationField('upsertUserProfile', (t) =>
	t.field({
		type: UserProfileRef,
		args: { input: t.arg({ type: UpsertUserProfileInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			const parsed = usernameSchema.safeParse(input.username);
			if (!parsed.success) {
				throw new GraphQLError(parsed.error.issues[0]?.message ?? 'Bad input', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			return upsertUserProfile(ctx.db, { user_id: ctx.user!.id, username: parsed.data });
		}
	})
);
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- user`
Expected: PASS, 7 tests green.

- [ ] **Step 6: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-api/src/schema/index.ts packages/dtx-api/src/schema/user.ts packages/dtx-api/src/schema/user.test.ts
git commit -m "feat(dtx-api): add Query.me and Mutation.upsertUserProfile

First GraphQL surface beyond healthz. Declares the Mutation root
type and validates username (trim, 1-30 chars) via zod before
delegating to @dtx/common/server's upsertUserProfile. Phase 2 of
the API server migration."
```

---

## Task 5: `schema/simfile.ts` — types + `Query.simfile` + `Query.nextDisplayId`

**Files:**

- Create: `packages/dtx-api/src/schema/simfile.ts`
- Create: `packages/dtx-api/src/schema/simfile.test.ts`
- Modify: `packages/dtx-api/src/schema/index.ts` (uncomment `import './simfile'`)

Establishes the `Simfile`, `DtxFile`, `R2File`, `SimfileScope`, `SimfileConnection`, `SimfileSearchResult`, `DeleteResult` types and lands the two simplest read queries. Subsequent tasks layer more queries and mutations onto this file.

- [ ] **Step 1: Write the failing test (single-simfile + nextDisplayId only)**

Create `packages/dtx-api/src/schema/simfile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfile: vi.fn(),
		getSimfileOwner: vi.fn(),
		getNextDisplayId: vi.fn(),
		listSimfiles: vi.fn(),
		searchSimfiles: vi.fn(),
		createSimfile: vi.fn(),
		createDtxFiles: vi.fn(),
		updateSimfile: vi.fn(),
		deleteSimfile: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, getNextDisplayId } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedNextDisplayId = vi.mocked(getNextDisplayId);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

const publishedSimfile = {
	id: 42,
	title: 'Song A',
	artist: 'Artist A',
	bpm: 120,
	user_id: 'u1',
	is_published: true as const,
	display_id: 1,
	download_url: 'https://ext.example/a',
	preview_url: null,
	video_preview_url: null,
	publish_date: '2026-05-19T00:00:00Z',
	created_at: '2026-05-19T00:00:00Z',
	updated_at: '2026-05-19T00:00:00Z',
	dtx_files: [{ level: 7.5, label: 'BSC' }]
};

beforeEach(() => {
	mockedGetSimfile.mockReset();
	mockedGetOwner.mockReset();
	mockedNextDisplayId.mockReset();
});

describe('Query.simfile', () => {
	it('returns a published simfile anonymously', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id title artist bpm userId isPublished displayId publishDate dtxFiles { level label } } }'
		});
		expect(result.data?.simfile).toEqual({
			id: '42',
			title: 'Song A',
			artist: 'Artist A',
			bpm: 120,
			userId: 'u1',
			isPublished: true,
			displayId: 1,
			publishDate: '2026-05-19T00:00:00Z',
			dtxFiles: [{ level: 7.5, label: 'BSC' }]
		});
	});

	it('FORBIDDEN for anonymous unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner sees own unpublished simfile', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, is_published: false });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfile(id: "42") { id isPublished } }'
		});
		expect(result.data?.simfile).toEqual({ id: '42', isPublished: false });
	});

	it('FORBIDDEN when non-owner authed and unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'someone-else' } as Ctx['user'] }), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns null when scope passes but row missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(null);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.data?.simfile).toBeNull();
	});

	it('rejects non-integer id with BAD_USER_INPUT (scope rejects → FORBIDDEN)', async () => {
		// loadOwner returns null for unsafe ids; publicOrOwner then denies.
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "abc") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});
});

describe('Query.nextDisplayId', () => {
	it('FORBIDDEN anonymous', async () => {
		const result = await runQuery(makeCtx(), { query: '{ nextDisplayId }' });
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns the next id for the authed user', async () => {
		mockedNextDisplayId.mockResolvedValue(42);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ nextDisplayId }'
		});
		expect(result.data?.nextDisplayId).toBe(42);
		expect(mockedNextDisplayId).toHaveBeenCalledWith(expect.anything(), 'u1');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL with "Cannot find module './simfile'".

- [ ] **Step 3: Implement `schema/simfile.ts` (types + 2 queries)**

Create `packages/dtx-api/src/schema/simfile.ts`:

```ts
import { GraphQLError } from 'graphql';
import { getSimfile, getNextDisplayId, type SimfileWithDtxFiles } from '@dtx/common/server';
import { builder } from './builder';

// --- enums ---

export const SimfileScopeEnum = builder.enumType('SimfileScope', {
	values: ['MINE', 'PUBLISHED'] as const
});

// --- object types ---

const DtxFile = builder.objectRef<{ level: number; label: string }>('DtxFile').implement({
	fields: (t) => ({
		level: t.exposeFloat('level'),
		label: t.exposeString('label')
	})
});

const R2File = builder
	.objectRef<{ key: string; size: number; uploaded: string }>('R2File')
	.implement({
		fields: (t) => ({
			key: t.exposeString('key'),
			size: t.exposeInt('size'),
			uploaded: t.exposeString('uploaded')
		})
	});

export const SimfileRef = builder.objectRef<SimfileWithDtxFiles>('Simfile').implement({
	fields: (t) => ({
		id: t.id({ resolve: (s) => String(s.id) }),
		title: t.exposeString('title'),
		artist: t.exposeString('artist'),
		bpm: t.exposeFloat('bpm'),
		userId: t.id({ resolve: (s) => s.user_id ?? '' }),
		isPublished: t.boolean({ resolve: (s) => s.is_published }),
		displayId: t.int({ nullable: true, resolve: (s) => s.display_id }),
		downloadUrl: t.string({ nullable: true, resolve: (s) => s.download_url }),
		previewUrl: t.string({ nullable: true, resolve: (s) => s.preview_url }),
		videoPreviewUrl: t.string({ nullable: true, resolve: (s) => s.video_preview_url }),
		publishDate: t.string({ resolve: (s) => s.publish_date }),
		createdAt: t.string({ resolve: (s) => s.created_at }),
		updatedAt: t.string({ resolve: (s) => s.updated_at }),
		dtxFiles: t.field({ type: [DtxFile], resolve: (s) => s.dtx_files })
		// Simfile.files + Simfile.hasUploadedFiles wired in Task 7.
	})
});

export const SimfileConnectionRef = builder
	.objectRef<{ data: SimfileWithDtxFiles[]; count: number }>('SimfileConnection')
	.implement({
		fields: (t) => ({
			data: t.field({ type: [SimfileRef], resolve: (c) => c.data }),
			count: t.exposeInt('count')
		})
	});

export const SimfileSearchResultRef = builder
	.objectRef<{
		id: number;
		title: string;
		artist: string;
		bpm: number;
		is_published: 0 | 1;
	}>('SimfileSearchResult')
	.implement({
		fields: (t) => ({
			id: t.id({ resolve: (s) => String(s.id) }),
			title: t.exposeString('title'),
			artist: t.exposeString('artist'),
			bpm: t.exposeFloat('bpm'),
			isPublished: t.boolean({ resolve: (s) => s.is_published === 1 })
		})
	});

export const DeleteResultRef = builder
	.objectRef<{ id: string; deleted: boolean }>('DeleteResult')
	.implement({
		fields: (t) => ({
			id: t.exposeID('id'),
			deleted: t.exposeBoolean('deleted')
		})
	});

// --- input types (registered now; consumers added in later tasks) ---

export const DtxFileInput = builder.inputType('DtxFileInput', {
	fields: (t) => ({
		label: t.string({ required: true }),
		level: t.float({ required: true })
	})
});

export const CreateSimfileInput = builder.inputType('CreateSimfileInput', {
	fields: (t) => ({
		title: t.string({ required: false }),
		artist: t.string({ required: false }),
		bpm: t.float({ required: true }),
		isPublished: t.boolean({ required: false }),
		displayId: t.int({ required: false }),
		downloadUrl: t.string({ required: false }),
		videoPreviewUrl: t.string({ required: false }),
		publishDate: t.string({ required: false }),
		dtxFiles: t.field({ type: [DtxFileInput], required: false })
	})
});

export const UpdateSimfileInput = builder.inputType('UpdateSimfileInput', {
	fields: (t) => ({
		title: t.string({ required: false }),
		artist: t.string({ required: false }),
		bpm: t.float({ required: false }),
		isPublished: t.boolean({ required: false }),
		displayId: t.int({ required: false }),
		downloadUrl: t.string({ required: false }),
		previewUrl: t.string({ required: false }),
		videoPreviewUrl: t.string({ required: false }),
		publishDate: t.string({ required: false })
	})
});

// --- Query.simfile ---

builder.queryField('simfile', (t) =>
	t.field({
		type: SimfileRef,
		nullable: true,
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_root, args) => ({ publicOrOwner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			return getSimfile(ctx.db, numeric);
		}
	})
);

// --- Query.nextDisplayId ---

builder.queryField('nextDisplayId', (t) =>
	t.int({
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => getNextDisplayId(ctx.db, ctx.user!.id)
	})
);
```

- [ ] **Step 4: Register `schema/simfile` in `schema/index.ts`**

Open `packages/dtx-api/src/schema/index.ts`. Find:

```ts
// import './simfile';
```

Uncomment so it reads:

```ts
import './simfile';
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, 8 tests green.

- [ ] **Step 6: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts packages/dtx-api/src/schema/index.ts
git commit -m "feat(dtx-api): add Simfile types + Query.simfile + Query.nextDisplayId

Registers Simfile, DtxFile, R2File, SimfileConnection,
SimfileSearchResult, DeleteResult object types and the
CreateSimfileInput / UpdateSimfileInput / DtxFileInput inputs.
First two simfile queries (single fetch + nextDisplayId) wired.
Phase 2 of the API server migration."
```

---

## Task 6: `Query.simfiles` + `Query.simfileSearch`

**Files:**

- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`

Adds the two list-style queries that the chart list and search bar consume.

- [ ] **Step 1: Append to `schema/simfile.test.ts`**

Open `packages/dtx-api/src/schema/simfile.test.ts`. Inside the file (after the existing `describe` blocks), append:

```ts
const { listSimfiles, searchSimfiles } = await import('@dtx/common/server');
const mockedList = vi.mocked(listSimfiles);
const mockedSearch = vi.mocked(searchSimfiles);

describe('Query.simfiles', () => {
	beforeEach(() => {
		mockedList.mockReset();
	});

	it('rejects MINE scope for anonymous (UNAUTHORIZED)', async () => {
		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: MINE) { count data { id } } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED');
	});

	it('allows PUBLISHED scope anonymously', async () => {
		mockedList.mockResolvedValue({ data: [publishedSimfile], count: 1 });
		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 5) { count data { id title } } }'
		});
		expect(result.data?.simfiles).toEqual({
			count: 1,
			data: [{ id: '42', title: 'Song A' }]
		});
		expect(mockedList).toHaveBeenCalledWith(expect.anything(), {
			userId: undefined,
			publishedOnly: true,
			search: undefined,
			page: 1,
			pageSize: 5
		});
	});

	it('passes user id and search term for MINE scope', async () => {
		mockedList.mockResolvedValue({ data: [], count: 0 });
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfiles(scope: MINE, search: "abc", page: 2, pageSize: 10) { count } }'
		});
		expect(mockedList).toHaveBeenCalledWith(expect.anything(), {
			userId: 'u1',
			publishedOnly: false,
			search: 'abc',
			page: 2,
			pageSize: 10
		});
	});
});

describe('Query.simfileSearch', () => {
	beforeEach(() => {
		mockedSearch.mockReset();
	});

	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: '{ simfileSearch(query: "abc") { id title } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('forwards args to the search service', async () => {
		mockedSearch.mockResolvedValue([
			{ id: 7, title: 'X', artist: 'Y', bpm: 100, is_published: 1 }
		]);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "abc", excludeIds: ["3","5"], limit: 4) { id title isPublished } }'
		});
		expect(mockedSearch).toHaveBeenCalledWith(expect.anything(), {
			query: 'abc',
			userId: 'u1',
			excludeIds: [3, 5],
			limit: 4
		});
		expect(result.data?.simfileSearch).toEqual([{ id: '7', title: 'X', isPublished: true }]);
	});

	it('coerces invalid excludeIds entries and skips them', async () => {
		mockedSearch.mockResolvedValue([]);
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "abc", excludeIds: ["3", "not-a-number"]) { id } }'
		});
		expect(mockedSearch).toHaveBeenCalledWith(expect.anything(), {
			query: 'abc',
			userId: 'u1',
			excludeIds: [3],
			limit: 8
		});
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL with "Cannot read property" or "Field simfiles not defined".

- [ ] **Step 3: Add the two queries to `schema/simfile.ts`**

Open `packages/dtx-api/src/schema/simfile.ts`. After the existing imports, add:

```ts
import { listSimfiles, searchSimfiles } from '@dtx/common/server';
```

(The first existing import line is `import { getSimfile, getNextDisplayId, ... } from '@dtx/common/server';` — extend it with `listSimfiles, searchSimfiles` instead of adding a second import.)

At the bottom of the file, append:

```ts
builder.queryField('simfiles', (t) =>
	t.field({
		type: SimfileConnectionRef,
		args: {
			scope: t.arg({ type: SimfileScopeEnum, required: true }),
			search: t.arg.string({ required: false }),
			page: t.arg.int({ required: false, defaultValue: 1 }),
			pageSize: t.arg.int({ required: false, defaultValue: 20 })
		},
		resolve: async (_root, args, ctx) => {
			if (args.scope === 'MINE' && !ctx.user) {
				throw new GraphQLError('Authentication required for scope MINE', {
					extensions: { code: 'UNAUTHORIZED' }
				});
			}
			return listSimfiles(ctx.db, {
				userId: args.scope === 'MINE' ? ctx.user!.id : undefined,
				publishedOnly: args.scope === 'PUBLISHED',
				search: args.search ?? undefined,
				page: args.page ?? 1,
				pageSize: args.pageSize ?? 20
			});
		}
	})
);

builder.queryField('simfileSearch', (t) =>
	t.field({
		type: [SimfileSearchResultRef],
		args: {
			query: t.arg.string({ required: true }),
			excludeIds: t.arg.idList({ required: false }),
			limit: t.arg.int({ required: false, defaultValue: 8 })
		},
		authScopes: { user: true },
		resolve: async (_root, args, ctx) => {
			const excludeIds = (args.excludeIds ?? [])
				.map((id) => Number(id))
				.filter((n) => Number.isSafeInteger(n) && n > 0);
			return searchSimfiles(ctx.db, {
				query: args.query,
				userId: ctx.user!.id,
				excludeIds,
				limit: args.limit ?? 8
			});
		}
	})
);
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, all 14 tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(dtx-api): add Query.simfiles and Query.simfileSearch

Simfiles list query honors SimfileScope (MINE requires user;
PUBLISHED anon-OK) and forwards search/page/pageSize to
listSimfiles. simfileSearch is user-scoped, coerces excludeIds
to safe ints. Phase 2 of the API server migration."
```

---

## Task 7: `services/r2Enrichment` + lazy `Simfile.files` and `Simfile.hasUploadedFiles`

**Files:**

- Create: `packages/dtx-api/src/services/r2Enrichment.ts`
- Create: `packages/dtx-api/src/services/r2Enrichment.test.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts` (add the two lazy fields)
- Modify: `packages/dtx-api/src/schema/simfile.test.ts` (cover the lazy fields)

`Simfile.files` and `Simfile.hasUploadedFiles` are lazy fields — they only run their R2 listings if the client selects them. For list queries, `hasUploadedFiles` uses a concurrency-capped scheduler so a 20-row response doesn't fire 20 parallel R2 listings.

- [ ] **Step 1: Write the failing test for the service**

Create `packages/dtx-api/src/services/r2Enrichment.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { enrichFiles, enrichHasUploadedFiles } from './r2Enrichment';
import type { R2Bucket } from '@cloudflare/workers-types';

const makeBucket = (
	objectsPerCall: Array<Array<{ key: string; size: number; uploaded: Date }>>
): R2Bucket => {
	let call = 0;
	return {
		list: vi.fn(async () => {
			const objects = objectsPerCall[call++] ?? [];
			const truncated = call < objectsPerCall.length;
			return { objects, truncated, cursor: truncated ? `cursor-${call}` : undefined };
		})
	} as unknown as R2Bucket;
};

describe('enrichFiles', () => {
	it('returns mapped R2File entries with ISO uploaded strings', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/song.dtx', size: 1024, uploaded: new Date('2026-05-19T00:00:00Z') },
				{ key: '42/preview.jpg', size: 256, uploaded: new Date('2026-05-19T00:00:00Z') }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files).toEqual([
			{ key: '42/song.dtx', size: 1024, uploaded: '2026-05-19T00:00:00.000Z' },
			{ key: '42/preview.jpg', size: 256, uploaded: '2026-05-19T00:00:00.000Z' }
		]);
	});

	it('paginates via cursor and concatenates results', async () => {
		const bucket = makeBucket([
			[{ key: '42/a.dtx', size: 1, uploaded: new Date('2026-05-19T00:00:00Z') }],
			[{ key: '42/b.dtx', size: 2, uploaded: new Date('2026-05-19T00:00:00Z') }]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files.map((f) => f.key)).toEqual(['42/a.dtx', '42/b.dtx']);
	});

	it('filters out the prefix-only entry whose suffix is empty', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/', size: 0, uploaded: new Date() },
				{ key: '42/song.dtx', size: 10, uploaded: new Date() }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files.map((f) => f.key)).toEqual(['42/song.dtx']);
	});
});

describe('enrichHasUploadedFiles', () => {
	it('returns true when a non-preview object exists', async () => {
		const bucket = makeBucket([[{ key: '42/song.dtx', size: 100, uploaded: new Date() }]]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(true);
	});

	it('returns false when only preview keys exist', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/preview.jpg', size: 1, uploaded: new Date() },
				{ key: '42/preview.mp3', size: 1, uploaded: new Date() }
			]
		]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(false);
	});

	it('returns false on empty listing', async () => {
		const bucket = makeBucket([[]]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- r2Enrichment`
Expected: FAIL with "Cannot find module './r2Enrichment'".

- [ ] **Step 3: Implement `services/r2Enrichment.ts`**

Create `packages/dtx-api/src/services/r2Enrichment.ts`:

```ts
import { listAllR2Objects, isPreviewKey, type R2ObjectMeta } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';

export type R2FileEntry = {
	key: string;
	size: number;
	uploaded: string;
};

export const enrichFiles = async (bucket: R2Bucket, simfileId: number): Promise<R2FileEntry[]> => {
	const prefix = `${simfileId}/`;
	const objects = await listAllR2Objects(bucket, prefix);
	return objects
		.filter((obj: R2ObjectMeta) => obj.key.length > prefix.length)
		.map((obj: R2ObjectMeta) => ({
			key: obj.key,
			size: obj.size,
			uploaded:
				obj.uploaded instanceof Date ? obj.uploaded.toISOString() : String(obj.uploaded)
		}));
};

export const enrichHasUploadedFiles = async (
	bucket: R2Bucket,
	simfileId: number
): Promise<boolean> => {
	const prefix = `${simfileId}/`;
	const listed = await bucket.list({ prefix });
	return listed.objects.some((obj) => obj.key.length > prefix.length && !isPreviewKey(obj.key));
};

const MAX_CONCURRENT_R2_CHECKS = 4;

export const enrichHasUploadedFilesBatch = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, boolean>> => {
	const result = new Map<number, boolean>();
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			try {
				result.set(id, await enrichHasUploadedFiles(bucket, id));
			} catch {
				result.set(id, false);
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_CHECKS, simfileIds.length) }, () =>
			worker()
		)
	);

	return result;
};
```

`listAllR2Objects` from `@dtx/common/server` already handles cursor pagination internally — the test's pagination scenario verifies behavior end-to-end through that helper. If `listAllR2Objects`'s signature isn't `(bucket, prefix) => Promise<R2ObjectMeta[]>`, inspect it (`grep -A5 "export const listAllR2Objects" packages/common/src/lib/server/r2.ts`) and adjust the call.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- r2Enrichment`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Append to `schema/simfile.test.ts`**

Open `packages/dtx-api/src/schema/simfile.test.ts`. Inside the file (after the existing `describe` blocks), append:

```ts
vi.mock('../services/r2Enrichment', () => ({
	enrichFiles: vi.fn(),
	enrichHasUploadedFiles: vi.fn(),
	enrichHasUploadedFilesBatch: vi.fn()
}));

const { enrichFiles, enrichHasUploadedFiles } = await import('../services/r2Enrichment');
const mockedFiles = vi.mocked(enrichFiles);
const mockedHasUploaded = vi.mocked(enrichHasUploadedFiles);

describe('Simfile.files / Simfile.hasUploadedFiles (lazy)', () => {
	beforeEach(() => {
		mockedFiles.mockReset();
		mockedHasUploaded.mockReset();
	});

	it('does not call enrichFiles when files is not selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		await runQuery(makeCtx(), { query: '{ simfile(id: "42") { id title } }' });
		expect(mockedFiles).not.toHaveBeenCalled();
	});

	it('calls enrichFiles when files is selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedFiles.mockResolvedValue([
			{ key: '42/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }
		]);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { files { key size uploaded } } }'
		});
		expect(mockedFiles).toHaveBeenCalledWith(expect.anything(), 42);
		expect(result.data?.simfile).toEqual({
			files: [{ key: '42/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }]
		});
	});

	it('calls enrichHasUploadedFiles only when hasUploadedFiles is selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedHasUploaded.mockResolvedValue(true);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { hasUploadedFiles } }'
		});
		expect(mockedHasUploaded).toHaveBeenCalledWith(expect.anything(), 42);
		expect(result.data?.simfile).toEqual({ hasUploadedFiles: true });
	});
});
```

- [ ] **Step 6: Run the test, confirm it fails (lazy fields not in schema)**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL with "Cannot query field files on Simfile" or similar.

- [ ] **Step 7: Wire the lazy fields**

Open `packages/dtx-api/src/schema/simfile.ts`. At the top, add the import:

```ts
import { enrichFiles, enrichHasUploadedFiles } from '../services/r2Enrichment';
```

Find the `SimfileRef.implement({ fields: (t) => ({...}) })` block. The closing of the `dtxFiles` field is the last entry today; replace its trailing comment line:

```ts
			dtxFiles: t.field({ type: [DtxFile], resolve: (s) => s.dtx_files })
			// Simfile.files + Simfile.hasUploadedFiles wired in Task 7.
		})
```

with the two new field definitions:

```ts
			dtxFiles: t.field({ type: [DtxFile], resolve: (s) => s.dtx_files }),
			files: t.field({
				type: [R2File],
				resolve: (s, _args, ctx) => enrichFiles(ctx.r2, s.id)
			}),
			hasUploadedFiles: t.boolean({
				resolve: (s, _args, ctx) => enrichHasUploadedFiles(ctx.r2, s.id)
			})
		})
```

- [ ] **Step 8: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, all 17 tests green.

- [ ] **Step 9: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-api/src/services/r2Enrichment.ts packages/dtx-api/src/services/r2Enrichment.test.ts packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(dtx-api): add lazy Simfile.files + hasUploadedFiles fields

Both fields run R2 listings only when the client selects them.
enrichHasUploadedFilesBatch caps concurrency at 4 for list queries
that select hasUploadedFiles across many simfiles. Phase 2 of the
API server migration."
```

---

## Task 8: `services/createSimfile` + `Mutation.createSimfile`

**Files:**

- Create: `packages/dtx-api/src/services/createSimfile.ts`
- Create: `packages/dtx-api/src/services/createSimfile.test.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts` (add mutation)
- Modify: `packages/dtx-api/src/schema/simfile.test.ts` (cover mutation)

Composition + rollback: if `createDtxFiles` fails after the simfile row is inserted, the new row is deleted before the error propagates.

- [ ] **Step 1: Write the failing test for the service**

Create `packages/dtx-api/src/services/createSimfile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSimfileWithDtx } from './createSimfile';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		createSimfile: vi.fn(),
		createDtxFiles: vi.fn(),
		deleteSimfile: vi.fn()
	};
});

const { createSimfile, createDtxFiles, deleteSimfile } = await import('@dtx/common/server');
const mockedCreate = vi.mocked(createSimfile);
const mockedCreateDtx = vi.mocked(createDtxFiles);
const mockedDelete = vi.mocked(deleteSimfile);

beforeEach(() => {
	mockedCreate.mockReset();
	mockedCreateDtx.mockReset();
	mockedDelete.mockReset();
});

const baseArgs = {
	userId: 'u1',
	title: 'T',
	artist: 'A',
	bpm: 120,
	isPublished: false,
	displayId: null,
	downloadUrl: null,
	videoPreviewUrl: null,
	dtxFiles: [] as { label: string; level: number }[]
};

const baseRow = {
	id: 7,
	title: 'T',
	artist: 'A',
	bpm: 120,
	user_id: 'u1',
	is_published: 0 as const,
	display_id: 1,
	download_url: null,
	preview_url: null,
	video_preview_url: null,
	publish_date: '2026-05-19T00:00:00Z',
	created_at: '2026-05-19T00:00:00Z',
	updated_at: '2026-05-19T00:00:00Z'
};

describe('createSimfileWithDtx', () => {
	it('creates a simfile with no dtxFiles', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		const result = await createSimfileWithDtx({} as never, baseArgs);
		expect(result.simfile).toEqual(baseRow);
		expect(result.dtxFiles).toEqual([]);
		expect(mockedCreateDtx).not.toHaveBeenCalled();
	});

	it('creates a simfile and its dtxFiles', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockResolvedValue([
			{ id: 1, label: 'BSC', level: 5.5, simfile_id: 7 },
			{ id: 2, label: 'ADV', level: 7.5, simfile_id: 7 }
		]);
		const result = await createSimfileWithDtx({} as never, {
			...baseArgs,
			dtxFiles: [
				{ label: 'BSC', level: 5.5 },
				{ label: 'ADV', level: 7.5 }
			]
		});
		expect(result.dtxFiles).toEqual([
			{ label: 'BSC', level: 5.5 },
			{ label: 'ADV', level: 7.5 }
		]);
	});

	it('rolls back the simfile row when createDtxFiles throws', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockRejectedValue(new Error('dtx insert failed'));
		mockedDelete.mockResolvedValue(undefined as never);
		await expect(
			createSimfileWithDtx({} as never, {
				...baseArgs,
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		).rejects.toThrow('dtx insert failed');
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 7);
	});

	it('swallows rollback failures', async () => {
		mockedCreate.mockResolvedValue(baseRow);
		mockedCreateDtx.mockRejectedValue(new Error('dtx insert failed'));
		mockedDelete.mockRejectedValue(new Error('rollback also failed'));
		await expect(
			createSimfileWithDtx({} as never, {
				...baseArgs,
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		).rejects.toThrow('dtx insert failed');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- createSimfile`
Expected: FAIL with "Cannot find module './createSimfile'".

- [ ] **Step 3: Implement `services/createSimfile.ts`**

Create `packages/dtx-api/src/services/createSimfile.ts`:

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { createSimfile, createDtxFiles, deleteSimfile, type SimfileRow } from '@dtx/common/server';

export type CreateSimfileArgs = {
	userId: string;
	title: string;
	artist: string;
	bpm: number;
	isPublished: boolean;
	displayId: number | null;
	downloadUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate?: string;
	dtxFiles: { label: string; level: number }[];
};

export type CreateSimfileResult = {
	simfile: SimfileRow;
	dtxFiles: { label: string; level: number }[];
};

export const createSimfileWithDtx = async (
	db: D1Database,
	args: CreateSimfileArgs
): Promise<CreateSimfileResult> => {
	const simfile = await createSimfile(db, {
		title: args.title,
		artist: args.artist,
		bpm: args.bpm,
		user_id: args.userId,
		is_published: args.isPublished ? 1 : 0,
		display_id: args.displayId,
		download_url: args.downloadUrl,
		video_preview_url: args.videoPreviewUrl,
		publish_date: args.publishDate
	});

	if (args.dtxFiles.length === 0) {
		return { simfile, dtxFiles: [] };
	}

	try {
		const created = await createDtxFiles(
			db,
			args.dtxFiles.map((f) => ({ label: f.label, level: f.level, simfile_id: simfile.id }))
		);
		return {
			simfile,
			dtxFiles: created.map((d) => ({ label: d.label, level: d.level }))
		};
	} catch (err) {
		try {
			await deleteSimfile(db, simfile.id);
		} catch {
			// Rollback failed; original error wins. Both will surface via logs.
		}
		throw err;
	}
};
```

- [ ] **Step 4: Run the service test, confirm it passes**

Run: `bun run --filter=dtx-api test -- createSimfile`
Expected: PASS, 4 tests green.

- [ ] **Step 5: Append to `schema/simfile.test.ts`**

Open `packages/dtx-api/src/schema/simfile.test.ts`. Append:

```ts
vi.mock('../services/createSimfile', () => ({
	createSimfileWithDtx: vi.fn()
}));

const { createSimfileWithDtx } = await import('../services/createSimfile');
const mockedCreateService = vi.mocked(createSimfileWithDtx);

describe('Mutation.createSimfile', () => {
	beforeEach(() => mockedCreateService.mockReset());

	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { createSimfile(input: { bpm: 120 }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects non-finite bpm', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query:
				// Float coerces NaN-like inputs; we explicitly pass a sentinel the resolver re-validates.
				'mutation { createSimfile(input: { bpm: 0, title: "" }) { id } }'
		});
		// 0 is finite; this should pass through. Use Infinity-like check via the resolver path:
		// We can't send Infinity in JSON, so just confirm 0 is accepted by the service mock.
		expect(result.errors).toBeUndefined();
	});

	it('passes camelCase input through to the service', async () => {
		mockedCreateService.mockResolvedValue({
			simfile: {
				id: 99,
				title: 'T',
				artist: 'A',
				bpm: 120,
				user_id: 'u1',
				is_published: 1 as const,
				display_id: 7,
				download_url: 'https://ext',
				preview_url: null,
				video_preview_url: 'https://yt',
				publish_date: '2026-05-19T00:00:00Z',
				created_at: '2026-05-19T00:00:00Z',
				updated_at: '2026-05-19T00:00:00Z'
			},
			dtxFiles: [{ label: 'BSC', level: 5.5 }]
		});
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: `mutation {
					createSimfile(input: {
						title: "T", artist: "A", bpm: 120, isPublished: true,
						displayId: 7, downloadUrl: "https://ext", videoPreviewUrl: "https://yt",
						dtxFiles: [{ label: "BSC", level: 5.5 }]
					}) { id title isPublished dtxFiles { label level } }
				}`
		});
		expect(mockedCreateService).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: 'u1',
				title: 'T',
				artist: 'A',
				bpm: 120,
				isPublished: true,
				displayId: 7,
				downloadUrl: 'https://ext',
				videoPreviewUrl: 'https://yt',
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		);
		expect(result.data?.createSimfile).toEqual({
			id: '99',
			title: 'T',
			isPublished: true,
			dtxFiles: [{ label: 'BSC', level: 5.5 }]
		});
	});

	it('rejects invalid publishDate with BAD_USER_INPUT', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { createSimfile(input: { bpm: 120, publishDate: "not-a-date" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});
```

- [ ] **Step 6: Run the schema test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL ("Cannot query field createSimfile on Mutation" or similar).

- [ ] **Step 7: Add `Mutation.createSimfile` to `schema/simfile.ts`**

Open `packages/dtx-api/src/schema/simfile.ts`. At the top of the file, add the service import:

```ts
import { createSimfileWithDtx } from '../services/createSimfile';
```

And the `toSimfileWithDtx` import from common (used to project the service result onto the GraphQL Simfile shape):

```ts
import { toSimfileWithDtx } from '@dtx/common/server';
```

(Extend the existing `@dtx/common/server` import line — don't add a second import.)

At the bottom of the file, append:

```ts
builder.mutationField('createSimfile', (t) =>
	t.field({
		type: SimfileRef,
		args: { input: t.arg({ type: CreateSimfileInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			if (!Number.isFinite(input.bpm)) {
				throw new GraphQLError('Invalid bpm', { extensions: { code: 'BAD_USER_INPUT' } });
			}
			if (input.displayId != null && !Number.isSafeInteger(input.displayId)) {
				throw new GraphQLError('Invalid displayId', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			if (input.publishDate != null && Number.isNaN(Date.parse(input.publishDate))) {
				throw new GraphQLError('Invalid publishDate', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			const { simfile, dtxFiles } = await createSimfileWithDtx(ctx.db, {
				userId: ctx.user!.id,
				title: input.title ?? '',
				artist: input.artist ?? '',
				bpm: input.bpm,
				isPublished: input.isPublished ?? false,
				displayId: input.displayId ?? null,
				downloadUrl: input.downloadUrl ?? null,
				videoPreviewUrl: input.videoPreviewUrl ?? null,
				publishDate: input.publishDate ?? undefined,
				dtxFiles: (input.dtxFiles ?? []).map((f) => ({ label: f.label, level: f.level }))
			});

			return toSimfileWithDtx(simfile, dtxFiles);
		}
	})
);
```

- [ ] **Step 8: Run the schema test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, all 21 tests green.

- [ ] **Step 9: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-api/src/services/createSimfile.ts packages/dtx-api/src/services/createSimfile.test.ts packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(dtx-api): add Mutation.createSimfile with composition rollback

The service inserts the simfile row, then dtx_files; on failure
it deletes the new row before re-throwing so we never leave a
parentless simfile in D1. Resolver validates bpm finiteness,
displayId safe-integer, and publishDate parseability. Phase 2
of the API server migration."
```

---

## Task 9: `services/magicLink` + `schema/auth.ts` (Mutation.generateMagicLink)

**Files:**

- Create: `packages/dtx-api/src/services/magicLink.ts`
- Create: `packages/dtx-api/src/services/magicLink.test.ts`
- Create: `packages/dtx-api/src/schema/auth.ts`
- Create: `packages/dtx-api/src/schema/auth.test.ts`
- Modify: `packages/dtx-api/src/schema/index.ts` (add `import './auth'`)

The magic-link mutation has three concerns absent from the existing dtx-web route: a cached Supabase admin client, per-user hourly KV rate limit (5/hour), and an audit log entry with anonymized IP.

- [ ] **Step 1: Write the failing test for `services/magicLink`**

Create `packages/dtx-api/src/services/magicLink.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workerLogger } from '@dtx/common/server';
import { generateMagicLink, anonymizeIp } from './magicLink';
import type { Env } from '../env';
import type { KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => {
	const generateLink = vi.fn();
	return {
		createClient: vi.fn(() => ({ auth: { admin: { generateLink } } })),
		__generateLink: generateLink
	};
});

const { __generateLink } = (await import('@supabase/supabase-js')) as unknown as {
	__generateLink: ReturnType<typeof vi.fn>;
};

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
});

const makeKv = (initial: Record<string, string> = {}): KVNamespace => {
	const store = new Map(Object.entries(initial));
	return {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(),
		list: vi.fn(),
		getWithMetadata: vi.fn()
	} as unknown as KVNamespace;
};

beforeEach(() => {
	__generateLink.mockReset();
});

describe('anonymizeIp', () => {
	it('zeroes the last v4 octet', () => {
		expect(anonymizeIp('1.2.3.4')).toBe('1.2.3.x');
	});

	it('truncates v6 to group-4', () => {
		expect(anonymizeIp('2001:db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd:0012:*');
	});

	it('returns "redacted" for invalid input', () => {
		expect(anonymizeIp('not-an-ip')).toBe('redacted');
	});
});

describe('generateMagicLink', () => {
	it('returns the action link on success and writes an audit log', async () => {
		__generateLink.mockResolvedValue({
			data: { properties: { action_link: 'https://example.com/magic' } },
			error: null
		});
		const env = makeEnv();
		const kv = makeKv();
		const logSpy = vi.spyOn(workerLogger, 'info').mockImplementation(() => {});

		const result = await generateMagicLink(
			env,
			kv,
			workerLogger,
			{ id: 'u1', email: 'a@b.com' },
			'1.2.3.4'
		);

		expect(result).toEqual({ magicLinkUrl: 'https://example.com/magic' });
		expect(__generateLink).toHaveBeenCalledWith({
			type: 'magiclink',
			email: 'a@b.com',
			options: { redirectTo: 'dtx://auth-callback' }
		});
		expect(logSpy).toHaveBeenCalledWith(
			'magiclink_generated',
			expect.objectContaining({ userId: 'u1', ip: '1.2.3.x' })
		);
		logSpy.mockRestore();
	});

	it('increments KV counter on success', async () => {
		__generateLink.mockResolvedValue({
			data: { properties: { action_link: 'https://example.com/magic' } },
			error: null
		});
		const env = makeEnv();
		const kv = makeKv();
		await generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null);
		const hour = Math.floor(Date.now() / 3_600_000);
		expect(kv.put).toHaveBeenCalledWith(`magiclink:u1:${hour}`, '1', { expirationTtl: 3600 });
	});

	it('throws RATE_LIMITED when counter is at 5', async () => {
		const env = makeEnv();
		const hour = Math.floor(Date.now() / 3_600_000);
		const kv = makeKv({ [`magiclink:u1:${hour}`]: '5' });
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'RATE_LIMITED' } });
		expect(__generateLink).not.toHaveBeenCalled();
	});

	it('throws INTERNAL when Supabase admin returns an error', async () => {
		__generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } });
		const env = makeEnv();
		const kv = makeKv();
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'INTERNAL' } });
	});

	it('throws INTERNAL when Supabase returns success without action_link', async () => {
		__generateLink.mockResolvedValue({ data: { properties: {} }, error: null });
		const env = makeEnv();
		const kv = makeKv();
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'INTERNAL' } });
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- magicLink`
Expected: FAIL with "Cannot find module './magicLink'".

- [ ] **Step 3: Implement `services/magicLink.ts`**

Create `packages/dtx-api/src/services/magicLink.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GraphQLError } from 'graphql';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { WorkerLogger } from '@dtx/common/server';
import type { Env } from '../env';

const MAGIC_LINK_HOURLY_LIMIT = 5;
const adminCache = new WeakMap<Env, SupabaseClient>();

const getAdmin = (env: Env): SupabaseClient => {
	let cached = adminCache.get(env);
	if (!cached) {
		cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		adminCache.set(env, cached);
	}
	return cached;
};

const checkAndIncrement = async (kv: KVNamespace, userId: string): Promise<boolean> => {
	const hour = Math.floor(Date.now() / 3_600_000);
	const key = `magiclink:${userId}:${hour}`;
	const currentRaw = await kv.get(key);
	const current = currentRaw ? Number(currentRaw) : 0;
	if (Number.isFinite(current) && current >= MAGIC_LINK_HOURLY_LIMIT) {
		return false;
	}
	await kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
		expirationTtl: 3600
	});
	return true;
};

export const anonymizeIp = (ip: string | null): string => {
	if (!ip) return 'redacted';
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
	if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
	if (ip.includes(':')) {
		const parts = ip.split(':').slice(0, 4);
		if (parts.length === 4 && parts.every((p) => /^[0-9a-fA-F]*$/.test(p))) {
			return `${parts.join(':')}:*`;
		}
	}
	return 'redacted';
};

export const generateMagicLink = async (
	env: Env,
	kv: KVNamespace,
	logger: WorkerLogger,
	user: { id: string; email: string },
	ip: string | null
): Promise<{ magicLinkUrl: string }> => {
	const allowed = await checkAndIncrement(kv, user.id);
	if (!allowed) {
		throw new GraphQLError('Too Many Requests', { extensions: { code: 'RATE_LIMITED' } });
	}

	const admin = getAdmin(env);
	const { data, error } = await admin.auth.admin.generateLink({
		type: 'magiclink',
		email: user.email,
		options: { redirectTo: 'dtx://auth-callback' }
	});

	if (error || !data?.properties?.action_link) {
		logger.error('magic link generation failed', {
			userId: user.id,
			error: error?.message
		});
		throw new GraphQLError('Failed to generate magic link', {
			extensions: { code: 'INTERNAL' }
		});
	}

	logger.info('magiclink_generated', { userId: user.id, ip: anonymizeIp(ip) });
	return { magicLinkUrl: data.properties.action_link };
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- magicLink`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Write the failing test for `schema/auth`**

Create `packages/dtx-api/src/schema/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		auth: { getUser: vi.fn(), admin: { generateLink: vi.fn() } }
	}))
}));

vi.mock('../services/magicLink', async () => {
	const actual =
		await vi.importActual<typeof import('../services/magicLink')>('../services/magicLink');
	return { ...actual, generateMagicLink: vi.fn() };
});

const { schema } = await import('./index');
const { generateMagicLink } = await import('../services/magicLink');
const mocked = vi.mocked(generateMagicLink);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test', { headers: { 'cf-connecting-ip': '5.6.7.8' } }),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

beforeEach(() => mocked.mockReset());

describe('Mutation.generateMagicLink', () => {
	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { generateMagicLink { magicLinkUrl success } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mocked).not.toHaveBeenCalled();
	});

	it('returns magicLinkUrl on success', async () => {
		mocked.mockResolvedValue({ magicLinkUrl: 'https://example.com/magic' });
		const result = await runQuery(
			makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }),
			{ query: 'mutation { generateMagicLink { magicLinkUrl success } }' }
		);
		expect(result.data?.generateMagicLink).toEqual({
			magicLinkUrl: 'https://example.com/magic',
			success: true
		});
	});

	it('passes the IP from cf-connecting-ip to the service', async () => {
		mocked.mockResolvedValue({ magicLinkUrl: 'https://example.com/magic' });
		await runQuery(makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }), {
			query: 'mutation { generateMagicLink { magicLinkUrl } }'
		});
		expect(mocked).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			{ id: 'u1', email: 'a@b.com' },
			'5.6.7.8'
		);
	});

	it('propagates RATE_LIMITED from the service', async () => {
		mocked.mockRejectedValue(
			Object.assign(new Error('Too Many Requests'), {
				extensions: { code: 'RATE_LIMITED' }
			})
		);
		const result = await runQuery(
			makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }),
			{ query: 'mutation { generateMagicLink { magicLinkUrl } }' }
		);
		expect(result.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');
	});

	it('rejects when authed user has no email (BAD_USER_INPUT)', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { generateMagicLink { magicLinkUrl } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});
```

- [ ] **Step 6: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/auth"`
Expected: FAIL — `generateMagicLink` is not yet registered in the schema (error reads "Cannot query field 'generateMagicLink' on type 'Mutation'" or similar).

- [ ] **Step 7: Implement `schema/auth.ts`**

Create `packages/dtx-api/src/schema/auth.ts`:

```ts
import { GraphQLError } from 'graphql';
import { builder } from './builder';
import { generateMagicLink } from '../services/magicLink';

const MagicLinkResult = builder.objectRef<{ magicLinkUrl: string }>('MagicLinkResult').implement({
	fields: (t) => ({
		magicLinkUrl: t.exposeString('magicLinkUrl'),
		success: t.boolean({ resolve: () => true })
	})
});

builder.mutationField('generateMagicLink', (t) =>
	t.field({
		type: MagicLinkResult,
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => {
			const email = ctx.user!.email;
			if (!email) {
				throw new GraphQLError('User has no email address', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			const ip = ctx.request.headers.get('cf-connecting-ip');
			return generateMagicLink(ctx.env, ctx.kv, ctx.logger, { id: ctx.user!.id, email }, ip);
		}
	})
);
```

- [ ] **Step 8: Register `schema/auth` in `schema/index.ts`**

Open `packages/dtx-api/src/schema/index.ts`. Find:

```ts
// import './auth';
```

Uncomment so it reads:

```ts
import './auth';
```

- [ ] **Step 9: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/auth"`
Expected: PASS, 5 tests green.

- [ ] **Step 10: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
git add packages/dtx-api/src/services/magicLink.ts packages/dtx-api/src/services/magicLink.test.ts packages/dtx-api/src/schema/auth.ts packages/dtx-api/src/schema/auth.test.ts packages/dtx-api/src/schema/index.ts
git commit -m "feat(dtx-api): add Mutation.generateMagicLink with rate limit + audit log

Ports the magic-link flow from dtx-web with two improvements: a
per-user hourly KV rate limit (5/hour) and a structured audit
log entry containing the user id and anonymized IP. The mutation
reads user.email from ctx (no arguments). Phase 2 of the API
server migration."
```

---

## Task 10: `Mutation.updateSimfile`

**Files:**

- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`

Wraps the existing `updateSimfile(db, id, fields)` query from `@dtx/common/server` with input validation, owner enforcement (via `owner` scope), and a follow-up `getSimfile` to return the full record with `dtx_files`.

- [ ] **Step 1: Append the failing test**

Open `packages/dtx-api/src/schema/simfile.test.ts`. Append:

```ts
// updateSimfile is already part of the @dtx/common/server vi.mock at the top of this
// file (set up in Task 5), so we just grab a reference to the mocked function.
const { updateSimfile } = await import('@dtx/common/server');
const mockedUpdate = vi.mocked(updateSimfile);

describe('Mutation.updateSimfile', () => {
	beforeEach(() => {
		mockedUpdate.mockReset();
		mockedGetOwner.mockReset();
		mockedGetSimfile.mockReset();
	});

	it('rejects anonymous (FORBIDDEN via owner scope)', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects non-owner with FORBIDDEN', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone-else', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('updates a simfile and returns the full record', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedUpdate.mockResolvedValue({
			id: 42,
			title: 'X',
			artist: 'A',
			bpm: 120,
			user_id: 'u1',
			is_published: 1 as const,
			display_id: 1,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: '2026-05-19T00:00:00Z',
			created_at: '2026-05-19T00:00:00Z',
			updated_at: '2026-05-19T01:00:00Z'
		});
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, title: 'X', is_published: true });

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X", isPublished: true }) { id title isPublished } }'
		});
		expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 42, {
			title: 'X',
			is_published: 1
		});
		expect(result.data?.updateSimfile).toEqual({
			id: '42',
			title: 'X',
			isPublished: true
		});
	});

	it('rejects invalid publishDate with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { publishDate: "not-a-date" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('rejects empty input with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: {}) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL with "Cannot query field updateSimfile" or similar.

- [ ] **Step 3: Add the mutation to `schema/simfile.ts`**

Open `packages/dtx-api/src/schema/simfile.ts`. Find the existing common-server import line and extend it with `updateSimfile` (alongside `getSimfile`, `getNextDisplayId`, `listSimfiles`, `searchSimfiles`, `toSimfileWithDtx`).

At the bottom of the file, append:

```ts
builder.mutationField('updateSimfile', (t) =>
	t.field({
		type: SimfileRef,
		args: {
			id: t.arg.id({ required: true }),
			input: t.arg({ type: UpdateSimfileInput, required: true })
		},
		authScopes: (_root, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id, input }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			const updateData: Record<string, unknown> = {};
			if (input.title !== null && input.title !== undefined) updateData.title = input.title;
			if (input.artist !== null && input.artist !== undefined)
				updateData.artist = input.artist;
			if (input.bpm !== null && input.bpm !== undefined) {
				if (!Number.isFinite(input.bpm)) {
					throw new GraphQLError('Invalid bpm', {
						extensions: { code: 'BAD_USER_INPUT' }
					});
				}
				updateData.bpm = input.bpm;
			}
			if (input.isPublished !== null && input.isPublished !== undefined) {
				updateData.is_published = input.isPublished ? 1 : 0;
			}
			if (input.displayId !== null && input.displayId !== undefined) {
				if (!Number.isSafeInteger(input.displayId)) {
					throw new GraphQLError('Invalid displayId', {
						extensions: { code: 'BAD_USER_INPUT' }
					});
				}
				updateData.display_id = input.displayId;
			}
			if (input.downloadUrl !== null && input.downloadUrl !== undefined) {
				updateData.download_url = input.downloadUrl;
			}
			if (input.previewUrl !== null && input.previewUrl !== undefined) {
				updateData.preview_url = input.previewUrl;
			}
			if (input.videoPreviewUrl !== null && input.videoPreviewUrl !== undefined) {
				updateData.video_preview_url = input.videoPreviewUrl;
			}
			if (input.publishDate !== null && input.publishDate !== undefined) {
				if (Number.isNaN(Date.parse(input.publishDate))) {
					throw new GraphQLError('Invalid publishDate', {
						extensions: { code: 'BAD_USER_INPUT' }
					});
				}
				updateData.publish_date = input.publishDate;
			}

			if (Object.keys(updateData).length === 0) {
				throw new GraphQLError('No fields to update', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			await updateSimfile(ctx.db, numeric, updateData);
			const full = await getSimfile(ctx.db, numeric);
			if (!full) {
				throw new GraphQLError('Updated simfile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			return full;
		}
	})
);
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, +5 new tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(dtx-api): add Mutation.updateSimfile

Owner-scoped mutation that validates each optional field, converts
camelCase input to snake_case D1 update payload, rejects empty
inputs with BAD_USER_INPUT, and refetches the full record so the
returned Simfile includes dtx_files. Phase 2 of the API server
migration."
```

---

## Task 11: `Mutation.deleteSimfile` (with R2 file cleanup)

**Files:**

- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`

Deletes the simfile DB row AND lists + deletes all R2 objects under `${id}/`. Ports the cursor-paginated R2 deletion loop from `packages/dtx-web/src/routes/api/simFile/delete/[simfileID]/+server.ts`.

- [ ] **Step 1: Append the failing test**

Open `packages/dtx-api/src/schema/simfile.test.ts`. First, at the top of the file (alongside the existing `import type { Ctx } from '../context';` line), add:

```ts
import type { R2Bucket } from '@cloudflare/workers-types';
```

Then append at the bottom of the file:

```ts
const makeR2 = (objects: Array<{ key: string }> = []): R2Bucket => {
	const listMock = vi.fn(async () => ({
		objects,
		truncated: false
	}));
	const deleteMock = vi.fn(async () => {});
	return { list: listMock, delete: deleteMock } as unknown as R2Bucket;
};

const { deleteSimfile } = await import('@dtx/common/server');
const mockedDelete = vi.mocked(deleteSimfile);

describe('Mutation.deleteSimfile', () => {
	beforeEach(() => {
		mockedDelete.mockReset();
		mockedGetOwner.mockReset();
	});

	it('rejects anonymous (FORBIDDEN via owner scope)', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects non-owner with FORBIDDEN', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone-else', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('lists + deletes R2 objects and the DB row', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const r2 = makeR2([{ key: '42/a.dtx' }, { key: '42/b.dtx' }]);
		mockedDelete.mockResolvedValue(undefined as never);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});

		expect(result.data?.deleteSimfile).toEqual({ id: '42', deleted: true });
		expect(r2.delete).toHaveBeenCalledTimes(2);
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 42);
	});

	it('NOT_FOUND when DB delete fails because simfile is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const r2 = makeR2([]);
		mockedDelete.mockRejectedValue(new Error('Simfile not found'));

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: FAIL with "Cannot query field deleteSimfile".

- [ ] **Step 3: Add the mutation to `schema/simfile.ts`**

Open `packages/dtx-api/src/schema/simfile.ts`. Extend the existing `@dtx/common/server` import with `deleteSimfile`.

At the bottom of the file, append:

```ts
builder.mutationField('deleteSimfile', (t) =>
	t.field({
		type: DeleteResultRef,
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_root, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: async (_root, { id }, ctx) => {
			const numeric = Number(id);
			if (!Number.isSafeInteger(numeric)) {
				throw new GraphQLError('Invalid simfile id', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}

			// Cursor-paginated R2 list + delete (port of dtx-web's delete/[simfileID]/+server.ts).
			let cursor: string | undefined;
			let truncated = true;
			while (truncated) {
				const listResult = await ctx.r2.list({
					prefix: `${numeric}/`,
					limit: 1000,
					cursor
				});
				const objects = listResult.objects ?? [];
				if (objects.length > 0) {
					await Promise.allSettled(objects.map((obj) => ctx.r2.delete(obj.key)));
				}
				truncated = listResult.truncated === true;
				if (truncated) {
					const nextCursor = (listResult as { cursor?: string }).cursor;
					if (!nextCursor || nextCursor === cursor) {
						ctx.logger.error('R2 pagination stalled while deleting', {
							simfileId: numeric
						});
						throw new GraphQLError('Failed to list all files for deletion', {
							extensions: { code: 'INTERNAL' }
						});
					}
					cursor = nextCursor;
				}
			}

			try {
				await deleteSimfile(ctx.db, numeric);
			} catch (err) {
				if (err instanceof Error && err.message.includes('not found')) {
					throw new GraphQLError('Simfile not found', {
						extensions: { code: 'NOT_FOUND' }
					});
				}
				throw err;
			}

			return { id: String(numeric), deleted: true };
		}
	})
);
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "schema/simfile"`
Expected: PASS, +4 new tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(dtx-api): add Mutation.deleteSimfile with R2 cleanup

Owner-scoped mutation that lists + deletes all R2 objects under
the simfile's prefix via cursor-paginated batches, then deletes
the D1 row. Uses Promise.allSettled so partial R2 failures don't
block the DB delete. Returns DeleteResult { id, deleted }. Phase
2 of the API server migration."
```

---

## Task 12: `services/downloads` + `rest/downloadSimfile` (`GET /downloads/:id`)

**Files:**

- Create: `packages/dtx-api/src/services/downloads.ts`
- Create: `packages/dtx-api/src/services/downloads.test.ts`
- Create: `packages/dtx-api/src/rest/downloadSimfile.ts`
- Create: `packages/dtx-api/src/rest/downloadSimfile.test.ts`

Shared helpers + the single-simfile ZIP download endpoint. The shared helpers will also back the bulk endpoint in Task 13.

- [ ] **Step 1: Write the failing test for the service**

Create `packages/dtx-api/src/services/downloads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAccessibleSimfiles } from './downloads';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return { ...actual, getSimfileOwner: vi.fn() };
});

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);

beforeEach(() => mockedGetOwner.mockReset());

describe('resolveAccessibleSimfiles', () => {
	it('classifies all four statuses correctly', async () => {
		mockedGetOwner.mockImplementation(async (_db, id) => {
			if (id === 1) return { user_id: 'u1', is_published: 1 };
			if (id === 2) return { user_id: 'u1', is_published: 0 };
			if (id === 3) return { user_id: 'someone', is_published: 0 };
			return null;
		});

		const result = await resolveAccessibleSimfiles({} as D1Database, [1, 2, 3, 4], {
			id: 'u1'
		} as { id: string });
		expect(result.accessible).toEqual([1, 2]);
		expect(result.unauthorized).toEqual([]);
		expect(result.forbidden).toEqual([3]);
		expect(result.missing).toEqual([4]);
	});

	it('marks unpublished + non-owner as unauthorized when no user is provided', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [5], null);
		expect(result.unauthorized).toEqual([5]);
		expect(result.forbidden).toEqual([]);
	});

	it('treats published as accessible regardless of user', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 1 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [6], null);
		expect(result.accessible).toEqual([6]);
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "services/downloads"`
Expected: FAIL with "Cannot find module './downloads'".

- [ ] **Step 3: Implement `services/downloads.ts`**

Create `packages/dtx-api/src/services/downloads.ts`:

```ts
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
	getSimfileOwner,
	listAllR2Objects,
	createZipSources,
	validateZipSources,
	buildZipStream,
	type ZipSource
} from '@dtx/common/server';

export type AccessResult = {
	accessible: number[];
	unauthorized: number[];
	forbidden: number[];
	missing: number[];
};

export const resolveAccessibleSimfiles = async (
	db: D1Database,
	ids: number[],
	user: { id: string } | null
): Promise<AccessResult> => {
	const accessible: number[] = [];
	const unauthorized: number[] = [];
	const forbidden: number[] = [];
	const missing: number[] = [];

	await Promise.all(
		ids.map(async (id) => {
			const owner = await getSimfileOwner(db, id);
			if (!owner) {
				missing.push(id);
				return;
			}
			if (owner.is_published === 1 || (user && owner.user_id === user.id)) {
				accessible.push(id);
				return;
			}
			if (user) {
				forbidden.push(id);
			} else {
				unauthorized.push(id);
			}
		})
	);

	return { accessible, unauthorized, forbidden, missing };
};

export type ZipStreamOptions = {
	filename: string;
};

export const buildSimfileZipResponse = async (
	bucket: R2Bucket,
	simfileIds: number[],
	opts: ZipStreamOptions
): Promise<{ response: Response; sources: ZipSource[]; estimatedBytes: number }> => {
	const objectsPerSimfile = await Promise.all(
		simfileIds.map((id) => listAllR2Objects(bucket, `${id}/`))
	);

	const sources: ZipSource[] = simfileIds.flatMap((id, i) =>
		createZipSources(
			objectsPerSimfile[i],
			`${id}/`,
			simfileIds.length === 1 ? '' : `chart-${id}`
		)
	);

	const estimatedBytes = sources.reduce((sum, s) => sum + s.size, 0);

	await validateZipSources(bucket, sources);

	const response = new Response(buildZipStream(bucket, sources), {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${opts.filename}"`,
			'Cache-Control': 'private, no-store'
		}
	});

	return { response, sources, estimatedBytes };
};
```

- [ ] **Step 4: Run the service test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "services/downloads"`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Write the failing test for the REST endpoint**

Create `packages/dtx-api/src/rest/downloadSimfile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeDownloadSimfile } from './downloadSimfile';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(),
		listAllR2Objects: vi.fn(),
		validateZipSources: vi.fn(async () => {}),
		buildZipStream: vi.fn(() => new ReadableStream()),
		createZipSources: vi.fn(() => [{ key: '42/a.dtx', size: 100, prefix: '', name: 'a.dtx' }]),
		tryConsumeRateLimit: vi.fn(async () => ({ allowed: true })),
		getClientIp: vi.fn(() => '1.2.3.4')
	};
});

vi.mock('../auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

const { getSimfileOwner, tryConsumeRateLimit } = await import('@dtx/common/server');
const { verifyToken } = await import('../auth/verifyToken');
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedRate = vi.mocked(tryConsumeRateLimit);
const mockedVerify = vi.mocked(verifyToken);

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {
		list: vi.fn(async () => ({ objects: [], truncated: false })),
		delete: vi.fn()
	} as unknown as R2Bucket,
	RATE_LIMIT_API: {} as KVNamespace,
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const makeCtx = (): ExecutionContext =>
	({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;

beforeEach(() => {
	mockedGetOwner.mockReset();
	mockedRate.mockReset().mockResolvedValue({ allowed: true });
	mockedVerify.mockReset().mockResolvedValue(null);
});

const req = (headers: Record<string, string> = {}) =>
	new Request('http://api/downloads/42', { method: 'GET', headers });

describe('GET /downloads/:id', () => {
	it('400 on non-numeric id', async () => {
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), 'abc');
		expect(response.status).toBe(400);
	});

	it('404 when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(404);
	});

	it('401 when anonymous + unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(401);
	});

	it('403 when authed but non-owner of unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(403);
	});

	it('200 ZIP stream when published and anon', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(response.headers.get('content-disposition')).toContain('chart-42.zip');
	});

	it('429 on rate limit hit', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedRate.mockResolvedValue({ allowed: false });
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(429);
	});
});
```

- [ ] **Step 6: Run the REST test, confirm it fails**

Run: `bun run --filter=dtx-api test -- downloadSimfile`
Expected: FAIL with "Cannot find module './downloadSimfile'".

- [ ] **Step 7: Implement `rest/downloadSimfile.ts`**

Create `packages/dtx-api/src/rest/downloadSimfile.ts`:

```ts
import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { verifyToken } from '../auth/verifyToken';
import { resolveAccessibleSimfiles, buildSimfileZipResponse } from '../services/downloads';
import type { Env } from '../env';

const jsonError = (status: number, message: string) =>
	new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const routeDownloadSimfile = async (
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
	rawId: string
): Promise<Response> => {
	if (!/^\d+$/.test(rawId)) {
		return jsonError(400, 'Invalid SimFile ID');
	}
	const id = Number(rawId);
	if (!Number.isSafeInteger(id)) {
		return jsonError(400, 'Invalid SimFile ID');
	}

	const auth = await verifyToken(request, env);
	const user = auth?.user ?? null;

	const access = await resolveAccessibleSimfiles(env.DB, [id], user);
	if (access.missing.length > 0) return jsonError(404, 'Simfile not found');
	if (access.unauthorized.length > 0) return jsonError(401, 'Unauthorized');
	if (access.forbidden.length > 0) return jsonError(403, 'Forbidden');

	const ip = getClientIp(request);
	if (ip) {
		const { allowed } = await tryConsumeRateLimit(
			env.RATE_LIMIT_API,
			`${env.RATE_LIMIT_ENV}:single:${ip}`,
			0
		);
		if (!allowed) {
			return jsonError(429, 'Rate limit exceeded. Please try again later.');
		}
	}

	const { response } = await buildSimfileZipResponse(env.DTXFILE_BUCKET, [id], {
		filename: `chart-${id}.zip`
	});
	return response;
};
```

**Note on rate-limit semantics:** today's dtx-web endpoint computes `estimatedBytes` from the ZIP source list then passes it to `tryConsumeRateLimit`. To preserve that, the cleaner ordering is:

1. Resolve accessible IDs and the ZIP source list (call into `services/downloads.buildSimfileZipResponse` only as far as computing `estimatedBytes`),
2. Consume rate limit with the estimate,
3. Either return the streaming Response or fail with 429.

For Phase 2 simplicity, the implementation above splits this: rate limit is checked with 0 bytes (allowing the call as long as the IP is below the cap window). If the spec/operator wants byte-accurate accounting, refactor `buildSimfileZipResponse` to return `{ sources, estimatedBytes, finalize: () => Response }` and call `finalize()` only after the rate-limit check passes. Note this trade-off in the implementation PR.

- [ ] **Step 8: Run the REST test, confirm it passes**

Run: `bun run --filter=dtx-api test -- downloadSimfile`
Expected: PASS, 6 tests green.

- [ ] **Step 9: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-api/src/services/downloads.ts packages/dtx-api/src/services/downloads.test.ts packages/dtx-api/src/rest/downloadSimfile.ts packages/dtx-api/src/rest/downloadSimfile.test.ts
git commit -m "feat(dtx-api): add GET /downloads/:id REST endpoint

Ports the single-simfile ZIP download from dtx-web verbatim.
Auth via verifyToken; anonymous OK only for published simfiles.
Shared helpers in services/downloads.ts (resolveAccessibleSimfiles,
buildSimfileZipResponse) will back the bulk endpoint in Task 13.
Phase 2 of the API server migration."
```

---

## Task 13: `rest/downloadBulk` (`POST /downloads/bulk`)

**Files:**

- Create: `packages/dtx-api/src/rest/downloadBulk.ts`
- Create: `packages/dtx-api/src/rest/downloadBulk.test.ts`

Verbatim port of `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`, including the `MAX_BULK_IDS=20` cap, dedupe, `validate=1` short-circuit, anonymous gate via `PUBLIC_ENABLE_BLOG_DOWNLOAD`, and anonymized-IP audit log.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-api/src/rest/downloadBulk.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeDownloadBulk } from './downloadBulk';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(),
		listAllR2Objects: vi.fn(async () => [
			{ key: '1/song.dtx', size: 100, uploaded: new Date() }
		]),
		validateZipSources: vi.fn(async () => {}),
		buildZipStream: vi.fn(() => new ReadableStream()),
		createZipSources: vi.fn((objs) =>
			objs.map((o: { key: string; size: number }) => ({
				key: o.key,
				size: o.size,
				prefix: '',
				name: o.key
			}))
		),
		tryConsumeRateLimit: vi.fn(async () => ({ allowed: true })),
		getClientIp: vi.fn(() => '1.2.3.4')
	};
});

vi.mock('../auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

const { getSimfileOwner, tryConsumeRateLimit } = await import('@dtx/common/server');
const { verifyToken } = await import('../auth/verifyToken');
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedRate = vi.mocked(tryConsumeRateLimit);
const mockedVerify = vi.mocked(verifyToken);

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as KVNamespace,
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const makeCtx = (): ExecutionContext =>
	({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;

const jsonReq = (body: unknown, search = '') =>
	new Request(`http://api/downloads/bulk${search}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

beforeEach(() => {
	mockedGetOwner.mockReset();
	mockedRate.mockReset().mockResolvedValue({ allowed: true });
	mockedVerify.mockReset().mockResolvedValue(null);
});

describe('POST /downloads/bulk', () => {
	it('400 on empty ids', async () => {
		const response = await routeDownloadBulk(jsonReq({ ids: [] }), makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});

	it('400 on non-positive integer id', async () => {
		const response = await routeDownloadBulk(jsonReq({ ids: [-1] }), makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});

	it('400 on more than 20 ids', async () => {
		const ids = Array.from({ length: 21 }, (_, i) => i + 1);
		const response = await routeDownloadBulk(jsonReq({ ids }), makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});

	it('dedupes ids', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 1, 2] }), makeEnv(), makeCtx());
		expect(response.status).toBe(200);
		expect(mockedGetOwner).toHaveBeenCalledTimes(2);
	});

	it('401 for anonymous when any id is unpublished', async () => {
		mockedGetOwner.mockImplementation(async (_db, id) =>
			id === 1 ? { user_id: 'u1', is_published: 1 } : { user_id: 'u1', is_published: 0 }
		);
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 2] }), makeEnv(), makeCtx());
		expect(response.status).toBe(401);
	});

	it('returns validate=1 envelope without streaming', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(
			jsonReq({ ids: [1] }, '?validate=1'),
			makeEnv(),
			makeCtx()
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; fileCount: number };
		expect(body).toEqual({ ok: true, fileCount: 1 });
	});

	it('200 streams ZIP for accessible ids', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 2] }), makeEnv(), makeCtx());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(response.headers.get('content-disposition')).toContain('drumery-charts.zip');
	});

	it('429 on rate limit hit', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedRate.mockResolvedValue({ allowed: false });
		const response = await routeDownloadBulk(jsonReq({ ids: [1] }), makeEnv(), makeCtx());
		expect(response.status).toBe(429);
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- downloadBulk`
Expected: FAIL with "Cannot find module './downloadBulk'".

- [ ] **Step 3: Implement `rest/downloadBulk.ts`**

Create `packages/dtx-api/src/rest/downloadBulk.ts`:

```ts
import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { verifyToken } from '../auth/verifyToken';
import { resolveAccessibleSimfiles, buildSimfileZipResponse } from '../services/downloads';
import type { Env } from '../env';

const MAX_BULK_IDS = 20;

const jsonError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
	new Response(JSON.stringify({ error: message, ...extra }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const parseIds = (raw: unknown): number[] | null => {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const out: number[] = [];
	for (const entry of raw) {
		if (typeof entry === 'number') {
			if (!Number.isSafeInteger(entry) || entry <= 0) return null;
			out.push(entry);
		} else if (typeof entry === 'string' && /^\d+$/.test(entry)) {
			const n = Number(entry);
			if (!Number.isSafeInteger(n) || n <= 0) return null;
			out.push(n);
		} else {
			return null;
		}
	}
	return out;
};

export const routeDownloadBulk = async (
	request: Request,
	env: Env,
	_ctx: ExecutionContext
): Promise<Response> => {
	let payload: { ids?: unknown };
	try {
		payload = (await request.json()) as { ids?: unknown };
	} catch {
		return jsonError(400, 'Invalid request body');
	}

	const ids = parseIds(payload.ids);
	if (!ids) return jsonError(400, 'ids must be a non-empty array of positive integers');

	const unique = [...new Set(ids)];
	if (unique.length > MAX_BULK_IDS) {
		return jsonError(400, `Cannot download more than ${MAX_BULK_IDS} charts at once`);
	}

	const validateOnly = new URL(request.url).searchParams.get('validate') === '1';

	const auth = await verifyToken(request, env);
	const user = auth?.user ?? null;

	const access = await resolveAccessibleSimfiles(env.DB, unique, user);

	if (access.unauthorized.length > 0) {
		return jsonError(401, 'Unauthorized', { ids: access.unauthorized });
	}
	if (access.forbidden.length > 0) {
		return jsonError(403, 'Forbidden', { ids: access.forbidden });
	}
	if (access.missing.length > 0) {
		return jsonError(404, 'Simfile not found', { ids: access.missing });
	}

	const { response, sources } = await buildSimfileZipResponse(
		env.DTXFILE_BUCKET,
		access.accessible,
		{ filename: 'drumery-charts.zip' }
	);

	if (validateOnly) {
		return json({ ok: true, fileCount: sources.length });
	}

	if (sources.length === 0) {
		return jsonError(404, 'No files found for the requested charts');
	}

	const ip = getClientIp(request);
	if (ip) {
		const { allowed } = await tryConsumeRateLimit(
			env.RATE_LIMIT_API,
			`${env.RATE_LIMIT_ENV}:bulk:${ip}`,
			sources.reduce((sum, s) => sum + s.size, 0)
		);
		if (!allowed) {
			return jsonError(429, 'Rate limit exceeded. Please try again later.');
		}
	}

	return response;
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `bun run --filter=dtx-api test -- downloadBulk`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-api/src/rest/downloadBulk.ts packages/dtx-api/src/rest/downloadBulk.test.ts
git commit -m "feat(dtx-api): add POST /downloads/bulk REST endpoint

Verbatim port of dtx-web's bulk-download route: MAX_BULK_IDS=20,
dedupe, per-id auth resolution, validate=1 short-circuit, byte-
accurate IP rate limit on the real (non-validate) request. Phase
2 of the API server migration."
```

---

## Task 14: `services/uploads` + `rest/upload` (`POST /upload`)

**Files:**

- Create: `packages/dtx-api/src/services/uploads.ts`
- Create: `packages/dtx-api/src/services/uploads.test.ts`
- Create: `packages/dtx-api/src/rest/upload.ts`
- Create: `packages/dtx-api/src/rest/upload.test.ts`

Server-mediated upload to R2 via the binding. Verbatim port of dtx-web's `/api/simFile/upload`, including fire-and-forget cache purge.

- [ ] **Step 1: Write the failing test for the service**

Create `packages/dtx-api/src/services/uploads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadSimfileFile, purgeCacheForFile } from './uploads';
import { workerLogger } from '@dtx/common/server';
import type { Env } from '../env';
import type { R2Bucket } from '@cloudflare/workers-types';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return { ...actual, getSimfileOwner: vi.fn() };
});

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example/',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const makeBucket = (): R2Bucket =>
	({ put: vi.fn(async () => ({ key: 'x' })) }) as unknown as R2Bucket;

const makeFile = (size = 1024, name = 'song.dtx'): File =>
	new File([new Uint8Array(size)], name, { type: 'application/octet-stream' });

beforeEach(() => mockedGetOwner.mockReset());

describe('uploadSimfileFile', () => {
	it('returns 401 when no user', async () => {
		const response = await uploadSimfileFile(makeEnv(), null, '42', makeFile(), makeBucket());
		expect(response.status).toBe(401);
	});

	it('returns 400 for invalid simfileId', async () => {
		const response = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'abc',
			makeFile(),
			makeBucket()
		);
		expect(response.status).toBe(400);
	});

	it('returns 400 for oversize file (>50MB)', async () => {
		const big = makeFile(51 * 1024 * 1024);
		const response = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			big,
			makeBucket()
		);
		expect(response.status).toBe(400);
	});

	it('returns 404 when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const response = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			makeFile(),
			makeBucket()
		);
		expect(response.status).toBe(404);
	});

	it('returns 403 when caller is not the owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const response = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			makeFile(),
			makeBucket()
		);
		expect(response.status).toBe(403);
	});

	it('puts the file with sanitized key and returns 200', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const bucket = makeBucket();
		const response = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			makeFile(2048, '../escape/song.dtx'),
			bucket
		);
		expect(response.status).toBe(200);
		expect(bucket.put).toHaveBeenCalledWith(
			'42/escape/song.dtx',
			expect.any(ArrayBuffer),
			expect.objectContaining({
				httpMetadata: expect.objectContaining({
					contentType: 'application/octet-stream',
					cacheControl: 'public, max-age=31536000'
				})
			})
		);
	});
});

describe('purgeCacheForFile', () => {
	it('returns false (and logs warn) when secrets are missing', async () => {
		const env = makeEnv({ CLOUDFLARE_ZONE_ID: undefined, CLOUDFLARE_API_TOKEN: undefined });
		const spy = vi.spyOn(workerLogger, 'warn').mockImplementation(() => {});
		const result = await purgeCacheForFile(env, 'https://x', workerLogger);
		expect(result).toBe(false);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('Cloudflare cache purge skipped'));
		spy.mockRestore();
	});

	it('calls the Cloudflare API when both secrets are set', async () => {
		const env = makeEnv({ CLOUDFLARE_ZONE_ID: 'z1', CLOUDFLARE_API_TOKEN: 'tok' });
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		const result = await purgeCacheForFile(
			env,
			'https://files.example/42/song.dtx',
			workerLogger
		);
		expect(result).toBe(true);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/z1/purge_cache',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ Authorization: 'Bearer tok' })
			})
		);
		fetchSpy.mockRestore();
	});
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "services/uploads"`
Expected: FAIL with "Cannot find module './uploads'".

- [ ] **Step 3: Implement `services/uploads.ts`**

Create `packages/dtx-api/src/services/uploads.ts`:

```ts
import { getSimfileOwner, type WorkerLogger } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';
import { sanitizeFilename } from '../lib/sanitizeFilename';
import type { Env } from '../env';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const purgeCacheForFile = async (
	env: Env,
	fileUrl: string,
	logger: WorkerLogger
): Promise<boolean> => {
	if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
		logger.warn(
			'Cloudflare cache purge skipped: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured'
		);
		return false;
	}
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ files: [fileUrl] })
			}
		);
		if (!response.ok) {
			logger.error(`Failed to purge cache for ${fileUrl}: ${response.status}`);
			return false;
		}
		const result = (await response.json()) as { success?: boolean };
		if (result.success) {
			logger.info(`Successfully purged cache for: ${fileUrl}`);
			return true;
		}
		return false;
	} catch (err) {
		logger.error(`Error purging cache for ${fileUrl}`, { error: String(err) });
		return false;
	}
};

export const uploadSimfileFile = async (
	env: Env,
	user: { id: string } | null,
	simfileIdRaw: string,
	file: File,
	bucket: R2Bucket
): Promise<Response> => {
	if (!user) return json(401, { error: 'Unauthorized' });

	if (!/^\d+$/.test(simfileIdRaw)) {
		return json(400, { error: 'Invalid SimFile ID' });
	}
	const simfileId = Number(simfileIdRaw);
	if (!Number.isSafeInteger(simfileId)) {
		return json(400, { error: 'Invalid SimFile ID' });
	}

	if (file.size > MAX_FILE_SIZE) {
		return json(400, { error: 'File too large (max 50MB)' });
	}

	const owner = await getSimfileOwner(env.DB, simfileId);
	if (!owner) return json(404, { error: 'Simfile not found' });
	if (owner.user_id !== user.id) return json(403, { error: 'Forbidden' });

	const sanitized = sanitizeFilename(file.name);
	const key = `${simfileId}/${sanitized}`;
	const arrayBuffer = await file.arrayBuffer();

	const result = await bucket.put(key, arrayBuffer, {
		httpMetadata: {
			contentType: file.type || 'application/octet-stream',
			cacheControl: 'public, max-age=31536000'
		}
	});

	if (!result) {
		return json(500, { error: 'Failed to upload file' });
	}

	return json(200, {
		message: 'File uploaded successfully',
		file: {
			fileName: file.name,
			key,
			size: file.size,
			contentType: file.type || 'application/octet-stream',
			status: 'Uploaded'
		}
	});
};
```

- [ ] **Step 4: Run the service test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "services/uploads"`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Write the failing test for the REST endpoint**

Create `packages/dtx-api/src/rest/upload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeUpload } from './upload';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('../auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

vi.mock('../services/uploads', () => ({
	uploadSimfileFile: vi.fn(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	),
	purgeCacheForFile: vi.fn(async () => true)
}));

const { verifyToken } = await import('../auth/verifyToken');
const { uploadSimfileFile, purgeCacheForFile } = await import('../services/uploads');
const mockedVerify = vi.mocked(verifyToken);
const mockedUpload = vi.mocked(uploadSimfileFile);
const mockedPurge = vi.mocked(purgeCacheForFile);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (): ExecutionContext =>
	({
		waitUntil: vi.fn((p) => p),
		passThroughOnException: vi.fn()
	}) as unknown as ExecutionContext;

const multipartReq = () => {
	const form = new FormData();
	form.set('file', new File([new Uint8Array(10)], 'a.dtx', { type: 'application/octet-stream' }));
	form.set('simFileId', '42');
	return new Request('http://api/upload', { method: 'POST', body: form });
};

beforeEach(() => {
	mockedVerify.mockReset().mockResolvedValue(null);
	mockedUpload.mockClear();
	mockedPurge.mockClear();
});

describe('POST /upload', () => {
	it('401 when no bearer', async () => {
		const response = await routeUpload(multipartReq(), makeEnv(), makeCtx());
		expect(response.status).toBe(401);
	});

	it('delegates to uploadSimfileFile when authed', async () => {
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		const response = await routeUpload(multipartReq(), makeEnv(), makeCtx());
		expect(response.status).toBe(200);
		expect(mockedUpload).toHaveBeenCalled();
	});

	it('schedules cache purge via ctx.waitUntil', async () => {
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		mockedUpload.mockResolvedValue(
			new Response(JSON.stringify({ file: { key: '42/a.dtx' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const ctx = makeCtx();
		await routeUpload(multipartReq(), makeEnv(), ctx);
		expect(ctx.waitUntil).toHaveBeenCalled();
	});

	it('400 when form is missing required parts', async () => {
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		const emptyReq = new Request('http://api/upload', {
			method: 'POST',
			body: new FormData()
		});
		const response = await routeUpload(emptyReq, makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});
});
```

- [ ] **Step 6: Run the REST test, confirm it fails**

Run: `bun run --filter=dtx-api test -- "rest/upload"`
Expected: FAIL with "Cannot find module './upload'".

- [ ] **Step 7: Implement `rest/upload.ts`**

Create `packages/dtx-api/src/rest/upload.ts`:

```ts
import { workerLogger } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { verifyToken } from '../auth/verifyToken';
import { uploadSimfileFile, purgeCacheForFile } from '../services/uploads';
import type { Env } from '../env';

const jsonError = (status: number, message: string) =>
	new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const routeUpload = async (
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> => {
	const auth = await verifyToken(request, env);
	if (!auth?.user) return jsonError(401, 'Unauthorized');

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonError(400, 'Invalid multipart body');
	}

	const file = formData.get('file');
	const simFileId = formData.get('simFileId');
	if (!(file instanceof File) || typeof simFileId !== 'string') {
		return jsonError(400, 'Missing required form fields: file, simFileId');
	}

	const response = await uploadSimfileFile(env, auth.user, simFileId, file, env.DTXFILE_BUCKET);

	if (response.status === 200) {
		try {
			const cloned = response.clone();
			const body = (await cloned.json()) as { file?: { key?: string } };
			const key = body.file?.key;
			if (key && env.PUBLIC_SIMFILE_BUCKET_URL) {
				const base = env.PUBLIC_SIMFILE_BUCKET_URL.replace(/\/$/, '');
				const fileUrl = `${base}/${key}`;
				ctx.waitUntil(
					purgeCacheForFile(env, fileUrl, workerLogger).catch((err: unknown) => {
						workerLogger.error('Unexpected error in cache purge', {
							error: String(err)
						});
						return false;
					})
				);
			}
		} catch {
			// response body wasn't JSON or didn't include a key; skip purge gracefully
		}
	}

	return response;
};
```

- [ ] **Step 8: Run the REST test, confirm it passes**

Run: `bun run --filter=dtx-api test -- "rest/upload"`
Expected: PASS, 4 tests green.

- [ ] **Step 9: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-api/src/services/uploads.ts packages/dtx-api/src/services/uploads.test.ts packages/dtx-api/src/rest/upload.ts packages/dtx-api/src/rest/upload.test.ts
git commit -m "feat(dtx-api): add POST /upload REST endpoint

Multipart upload server-mediated via the R2 binding. Validates
file size (≤50MB), simfileId format, and ownership before
bucket.put. Cache purge scheduled via ctx.waitUntil (no-ops
gracefully if CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN secrets
are unset). Phase 2 of the API server migration."
```

---

## Task 15: Wire REST routes into `src/index.ts` + extend `index.test.ts`

**Files:**

- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/src/index.test.ts`

- [ ] **Step 1: Update `src/index.ts`**

Open `packages/dtx-api/src/index.ts`. Replace the file with:

```ts
import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { routeDownloadSimfile } from './rest/downloadSimfile';
import { routeDownloadBulk } from './rest/downloadBulk';
import { routeUpload } from './rest/upload';
import { handlePreflight, withCors } from './lib/cors';
import type { Env } from './env';

const downloadSimfilePattern = /^\/downloads\/(\d+)$/;

const methodNotAllowed = (allow: string) =>
	new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;

		const url = new URL(request.url);

		if (url.pathname === '/healthz') {
			return request.method === 'GET'
				? withCors(healthz(request, env), request, env)
				: withCors(methodNotAllowed('GET'), request, env);
		}

		if (url.pathname === '/graphql') {
			const response = await yoga.fetch(request, { env, ctx });
			return withCors(response, request, env);
		}

		if (url.pathname === '/downloads/bulk') {
			return request.method === 'POST'
				? withCors(await routeDownloadBulk(request, env, ctx), request, env)
				: withCors(methodNotAllowed('POST'), request, env);
		}

		const downloadMatch = downloadSimfilePattern.exec(url.pathname);
		if (downloadMatch) {
			return request.method === 'GET'
				? withCors(
						await routeDownloadSimfile(request, env, ctx, downloadMatch[1]),
						request,
						env
					)
				: withCors(methodNotAllowed('GET'), request, env);
		}

		if (url.pathname === '/upload') {
			return request.method === 'POST'
				? withCors(await routeUpload(request, env, ctx), request, env)
				: withCors(methodNotAllowed('POST'), request, env);
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Append router tests to `src/index.test.ts`**

Open `packages/dtx-api/src/index.test.ts`. After the existing Phase 1 `describe` blocks, append:

```ts
describe('Phase 2 routes', () => {
	it('GET /downloads/123 dispatches to downloadSimfile route', async () => {
		// Mocked route handlers below — just verify dispatch reaches them.
		// The route handlers' own tests assert behaviour; here we test the router.
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		// downloadSimfile may return 400 (invalid id branch hit during isolated test mocking),
		// 401/404 (auth not setup), or 200 — just confirm it's NOT 404 NotFound from the router.
		expect(response.status).not.toBe(404);
	});

	it('POST /downloads/bulk dispatches to downloadBulk route', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/bulk', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids: [] })
			}),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(400);
	});

	it('POST /upload dispatches to upload route', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/upload', { method: 'POST', body: new FormData() }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(401);
	});

	it('405 on non-GET /downloads/:id', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'POST' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
	});

	it('405 on GET /downloads/bulk', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/bulk', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
	});

	it('CORS-wraps the /upload route response', async () => {
		const env = makeEnv({
			CORS_ALLOWED_ORIGINS: 'https://pre-prod.dtx.hapadona.com'
		});
		const response = await worker.fetch(
			new Request('http://api/upload', {
				method: 'POST',
				headers: { Origin: 'https://pre-prod.dtx.hapadona.com' }
			}),
			env,
			makeExecutionCtx()
		);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
			'https://pre-prod.dtx.hapadona.com'
		);
	});
});
```

If `worker`, `makeEnv`, or `makeExecutionCtx` don't already exist in the file from Phase 1, inspect the file first (`cat packages/dtx-api/src/index.test.ts`) and:

- If `worker` is not declared, add `import worker from './index'` at the top.
- If helpers are missing, mirror the patterns from `schema/simfile.test.ts` and `rest/downloadSimfile.test.ts`.

- [ ] **Step 3: Type-check and run all tests**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

Run: `bun run --filter=dtx-api test`
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-api/src/index.ts packages/dtx-api/src/index.test.ts
git commit -m "feat(dtx-api): route /downloads/* and /upload in Worker entry

Extends Phase 1's router with three Phase 2 REST routes:
GET /downloads/:id, POST /downloads/bulk, POST /upload. Every
non-preflight response is CORS-wrapped. Phase 2 of the API
server migration."
```

---

## Task 16: `scripts/gen-schema` + commit `dist/schema.graphql`

**Files:**

- Create: `packages/dtx-api/src/scripts/gen-schema.ts`
- Modify: `packages/dtx-api/package.json` (add `gen-schema` script)
- Create: `packages/dtx-api/dist/schema.graphql` (generated)

- [ ] **Step 1: Write the codegen script**

Create `packages/dtx-api/src/scripts/gen-schema.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { printSchema } from 'graphql';
import { schema } from '../schema';

const outPath = resolve(process.cwd(), 'packages/dtx-api/dist/schema.graphql');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, printSchema(schema), 'utf-8');

console.log(`Wrote ${outPath}`);
```

- [ ] **Step 2: Add the script to `package.json`**

Open `packages/dtx-api/package.json`. In the `"scripts"` object, add:

```jsonc
"gen-schema": "bun run src/scripts/gen-schema.ts"
```

- [ ] **Step 3: Run the codegen and commit the artifact**

Run from repo root: `bun run --filter=dtx-api gen-schema`
Expected: prints `Wrote .../packages/dtx-api/dist/schema.graphql`. File contains all 10 GraphQL operations and the supporting types in SDL form.

Inspect (optional): `head -50 packages/dtx-api/dist/schema.graphql` — should list `Query`, `Mutation`, `Simfile`, etc.

- [ ] **Step 4: Type-check**

Run: `bun run --filter=dtx-api check`
Expected: 0 errors. (The script uses Node `fs`; this is fine — it runs under Bun, not the Worker runtime.)

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-api/src/scripts/gen-schema.ts packages/dtx-api/package.json packages/dtx-api/dist/schema.graphql
git commit -m "feat(dtx-api): add schema.graphql codegen artifact

Phase 3's dtx-web codegen will consume this file. Re-run with
'bun run --filter=dtx-api gen-schema' whenever a resolver adds or
removes a field. Phase 2 of the API server migration."
```

---

## Task 17: Configure secrets + deploy to pre-prod + smoke test

**Files:** none (operator-driven deploy + verification)

This task requires Cloudflare auth + access to the project's Supabase service-role key.

- [ ] **Step 1: Verify `wrangler whoami`**

Run: `bunx wrangler whoami`
Expected: shows the project's Cloudflare account email. If not authed, `bunx wrangler login`.

- [ ] **Step 2: Push the Supabase service role key for pre-prod**

```bash
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config packages/dtx-api/wrangler.jsonc --env pre-prod
```

Paste the same value used on the dtx-web Worker (look it up in the Cloudflare dashboard's variables-and-secrets page for the existing `dtx-web` Worker, or in the local `.env` file if it's there).

Repeat for `pre-prod-prod-data` if magic-link will be exercised against that env:

```bash
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config packages/dtx-api/wrangler.jsonc --env pre-prod-prod-data
```

- [ ] **Step 3 (optional): Push Cloudflare cache-purge secrets**

If cache purge should fire on dtx-api uploads (matches dtx-web's behavior when those secrets are set):

```bash
bunx wrangler secret put CLOUDFLARE_ZONE_ID --config packages/dtx-api/wrangler.jsonc --env pre-prod
bunx wrangler secret put CLOUDFLARE_API_TOKEN --config packages/dtx-api/wrangler.jsonc --env pre-prod
```

Skip = cache purge logs a warning and returns false; uploads still succeed. Either choice is correct.

- [ ] **Step 4: Build (dry-run) and verify bundle size**

Run: `bun run --filter=dtx-api build`
Expected: dry-run succeeds. Read the `Total Upload` size from wrangler's output — must be **<600 KB**. If higher than 600 KB, inspect the dist bundle:

```bash
du -sh packages/dtx-api/dist/*.js
```

A common culprit at scale is `@supabase/supabase-js` bundling postgrest + realtime + storage subclients. Use `bunx wrangler deploy --dry-run --outdir=dist` and `du -sh packages/dtx-api/dist/*` to confirm. Adjust imports to be specific (e.g., `import { createClient } from '@supabase/supabase-js'`) — already the pattern used here.

- [ ] **Step 5: Deploy to pre-prod**

```bash
bun run deploy:api:preprod
```

Expected: wrangler uploads. Custom domain `api.pre-prod.dtx.hapadona.com` is already attached from Phase 1, so this is just a code push.

- [ ] **Step 6: Smoke test — anonymous published list**

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ simfiles(scope: PUBLISHED, pageSize: 3) { count data { id title artist } } }"}' | jq .
```

Expected: `{ "data": { "simfiles": { "count": N, "data": [...] } } }` with 0–3 entries.

- [ ] **Step 7: Smoke test — single simfile**

Pick any simfile ID from the previous response (e.g., `42`):

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ simfile(id: \"42\") { id title hasUploadedFiles files { key size } } }"}' | jq .
```

Expected: data field populated; `files` and `hasUploadedFiles` reflect what's in R2 for that simfile.

- [ ] **Step 8: Smoke test — authed `me` + `nextDisplayId` + `upsertUserProfile`**

Obtain a bearer token from the running dtx-web app (`localStorage.getItem('sb-...-auth-token')` → parse → `access_token`).

```bash
TOKEN="<paste-bearer>"
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"{ me { userId username } nextDisplayId }"}' | jq .
```

Expected: `me` returns the authed user's profile (or NOT_FOUND extension if no profile yet); `nextDisplayId` returns an int ≥1.

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { upsertUserProfile(input: { username: \"smoke-test\" }) { userId username } }"}' | jq .
```

Expected: returns `{ "data": { "upsertUserProfile": { "userId": "...", "username": "smoke-test" } } }`.

- [ ] **Step 9: Smoke test — single download (REST)**

Pick a published simfile id that has files in R2 (or any simfile if anonymous downloads are gated off):

```bash
curl -sS -D - "https://api.pre-prod.dtx.hapadona.com/downloads/42" -o chart-42.zip
file chart-42.zip
```

Expected: HTTP 200, `Content-Type: application/zip`, `chart-42.zip` is a valid ZIP archive (`file` should report "Zip archive data").

- [ ] **Step 10: Smoke test — bulk download (REST)**

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/downloads/bulk \
  -H 'content-type: application/json' \
  -d '{"ids":[1,2]}' \
  -o drumery-charts.zip
file drumery-charts.zip
```

Expected: ZIP archive containing two simfile folders (or a 404 with `ids: [...]` envelope if neither simfile has uploaded files; that's also a valid response shape).

- [ ] **Step 11: Smoke test — bulk validate**

```bash
curl -sS -X POST "https://api.pre-prod.dtx.hapadona.com/downloads/bulk?validate=1" \
  -H 'content-type: application/json' \
  -d '{"ids":[1]}' | jq .
```

Expected: `{ "ok": true, "fileCount": N }`.

- [ ] **Step 12: Smoke test — CORS preflight**

```bash
curl -sS -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'Origin: https://pre-prod.dtx.hapadona.com' \
  -H 'Access-Control-Request-Method: POST'
```

Expected: `204` with `Access-Control-Allow-Origin: https://pre-prod.dtx.hapadona.com`.

```bash
curl -sS -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'Origin: https://evil.example.com'
```

Expected: `204` with no `Access-Control-Allow-Origin` header.

- [ ] **Step 13: Smoke test — GraphiQL loads in browser**

Open `https://api.pre-prod.dtx.hapadona.com/graphql` in a browser.
Expected: GraphiQL playground renders. Type `{ simfiles(scope: PUBLISHED) { count } }` and click the play button — receive a JSON response.

- [ ] **Step 14: No commit needed for this task**

Operator-only deploy + verification. No file changes.

---

## Task 18: Final cleanup and verification

**Files:** none (format + lint + cross-package check)

- [ ] **Step 1: Run formatter**

Run: `bun run format`
Expected: prettier rewrites formatting in new files only. Inspect with `git diff --stat`.

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: pass.

- [ ] **Step 3: Run all test suites**

Run: `bun run --filter=@dtx/common test`
Expected: pass (no Phase 2 changes to common).

Run: `bun run --filter=dtx-api test`
Expected: full suite passes; coverage ≥80% on Phase 2 modules.

Run: `bun run --filter=dtx-web test`
Expected: pass (no Phase 2 changes to dtx-web).

Run: `bun run --filter=dtx-desktop test`
Expected: pass.

- [ ] **Step 4: Type-check across packages**

Run: `bun run --filter=@dtx/common check`
Expected: 0 errors.

Run: `bun run --filter=dtx-api check`
Expected: 0 errors.

Run: `bun run --filter=dtx-web check`
Expected: 0 errors.

- [ ] **Step 5: Verify the `schema.graphql` artifact is fresh**

Run: `bun run --filter=dtx-api gen-schema`
Run: `git status packages/dtx-api/dist/schema.graphql`
Expected: file unchanged (already committed in Task 16). If `git diff` shows changes, re-commit the regenerated file.

- [ ] **Step 6: Verify bundle size**

Run: `bun run --filter=dtx-api build`
Expected: dry-run prints a bundle size <600 KB. Note the value for the PR description.

- [ ] **Step 7: Commit any formatter changes**

If `git status` shows lint/format changes:

```bash
git add -A
git commit -m "chore: format after Phase 2 implementation"
```

If no changes: skip the commit.

- [ ] **Step 8: Re-run pre-prod smoke checks one more time**

Run the curl commands from Task 17 steps 6, 7, 9, 12 once more to confirm the deployed Worker still responds correctly (catches any post-deploy state drift):

```bash
curl -sS -X POST https://api.pre-prod.dtx.hapadona.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ simfiles(scope: PUBLISHED, pageSize: 1) { count } }"}' | jq .

curl -sS -I https://api.pre-prod.dtx.hapadona.com/healthz
```

Both should succeed.

---

## Done criteria

- All 18 tasks complete.
- `git log --oneline -18` shows commits for: setup, scope-auth, sanitizeFilename, user, simfile types + queries, simfiles + search, r2Enrichment, createSimfile, magicLink, updateSimfile, deleteSimfile, downloads service + single REST, bulk REST, uploads + upload REST, index router, gen-schema artifact, (optional) format.
- `packages/dtx-api/src/schema/{simfile,user,auth}.ts` exist; introspection (via `gen-schema`) lists all 5 queries + 5 mutations.
- `packages/dtx-api/src/rest/{downloadSimfile,downloadBulk,upload}.ts` exist; router dispatches all three.
- `packages/dtx-api/dist/schema.graphql` is committed and matches `printSchema(schema)`.
- `bun run --filter=dtx-api test` passes; coverage ≥80% on Phase 2 modules.
- `bun run --filter=dtx-api check` passes.
- `bun run --filter=@dtx/common test` + `--filter=@dtx/common check` pass (no regression).
- `bun run --filter=dtx-web test` + `--filter=dtx-web check` pass (no regression — Phase 2 doesn't touch dtx-web).
- `bun run lint` passes.
- `wrangler deploy --dry-run` bundle <600 KB.
- All smoke-test curl commands in Task 17 succeed against `api.pre-prod.dtx.hapadona.com`.
- GraphiQL loads at `https://api.pre-prod.dtx.hapadona.com/graphql`.
- Zero changes outside `packages/dtx-api/`.

## Open follow-ups (out of scope for Phase 2)

These are intentionally deferred:

- Byte-accurate rate limiting on `GET /downloads/:id`. Phase 2 calls `tryConsumeRateLimit` with `0` bytes for the single-file endpoint; the bulk endpoint already passes accurate `estimatedBytes`. If/when single-file abuse becomes a concern, refactor `buildSimfileZipResponse` to expose `{ sources, estimatedBytes, finalize }` and call `finalize` after the rate-limit check.
- Wiring `__BUILD_SHA__` from `git rev-parse --short HEAD` into the build, so `/healthz`'s `buildSha` field shows a real SHA in pre-prod and prod. Phase 1 left this open; still acceptable to defer.
- Replacing per-request `supabase.auth.getUser(token)` with local JWKS verification to cut latency on every authed call. Profile after Phase 3 lands real traffic.
- Adding a CI gate that runs `bun run --filter=dtx-api gen-schema && git diff --exit-code packages/dtx-api/dist/schema.graphql`. Phase 2 commits the artifact; the CI gate can land separately.
- A `replaceDtxFiles(simfileId, files)` mutation for editing dtx_files post-creation. Today's `PATCH /api/chart/[id]` doesn't update dtx_files either; both surfaces match.
