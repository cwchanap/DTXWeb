# API Migration Phase 2 — Implement GraphQL surface + REST sidecars

**Date:** 2026-05-19
**Parent spec:** [docs/superpowers/specs/2026-05-16-api-server-migration-design.md](2026-05-16-api-server-migration-design.md)
**Phase 0 plan:** [docs/superpowers/plans/2026-05-16-api-migration-phase-0.md](../plans/2026-05-16-api-migration-phase-0.md) (complete)
**Phase 1 plan:** [docs/superpowers/plans/2026-05-18-api-migration-phase-1.md](../plans/2026-05-18-api-migration-phase-1.md) (complete)
**Packages:** modifies `packages/dtx-api`; no changes to other packages

## Goal

Land the complete user-facing GraphQL surface and REST sidecars on the `dtx-api` Worker that Phase 1 scaffolded. After Phase 2, every operation the existing dtx-web and dtx-desktop clients perform against `packages/dtx-web/src/routes/api/` has a working equivalent on `dtx-api` at `api.pre-prod.dtx.hapadona.com`. dtx-web and dtx-desktop are unchanged — they continue to call their existing REST routes; Phase 3 wires them over to dtx-api.

## Non-goals

- Any change to `packages/dtx-web/`, `packages/dtx-desktop/`, or `packages/common/`. Phase 2 is fully contained inside `packages/dtx-api/`.
- Client migration (dtx-web's `lib/api/` GraphQL client + feature flag) — Phase 3.
- Service binding between `dtx-web` and `dtx-api` — Phase 3.
- Prod deploy of `dtx-api` — Phase 5.
- Presigned URL upload/download flow — replaced by porting REST endpoints verbatim against the R2 Worker binding (see Architecture).
- `dtx_files` editing on update (today's `PATCH /api/chart/[id]` doesn't update dtx_files; Phase 2 preserves that).
- Removing the existing REST routes from `dtx-web/src/routes/api/` — Phase 6.

## Current state

Phase 1 is complete on `main`:

- `packages/dtx-api/` is deployed at `api.pre-prod.dtx.hapadona.com` with `/healthz` REST + `/graphql` Yoga + Pothos pipeline.
- Pothos `scope-auth` plugin is registered with three declared scopes (`user`, `owner`, `publicOrOwner`); `owner` and `publicOrOwner` are currently stubs returning `false`.
- `Query.healthz: String!` is the only GraphQL field.
- `Mutation` root type is not declared yet (Pothos requires at least one field per declared root type).
- `Ctx` includes `ownerByIdCache: Map<string, string | null>` ready for Phase 2 to populate.
- `verifyToken(request, env)` handles Supabase bearer auth; CORS handles the allow-list per env.

No changes to `dtx-web/src/routes/api/` happen in this phase.

## Design

### Architecture

`dtx-api` ends Phase 2 hosting these routes:

```text
api.pre-prod.dtx.hapadona.com  (Phase 2 deploy target)

  GET  /healthz             liveness JSON                       (Phase 1)
  POST /graphql             Yoga + Pothos                       (Phase 1 + Phase 2 resolvers)
  GET  /graphql             GraphiQL                            (Phase 1, env-gated)
  GET  /downloads/:id       single-simfile ZIP stream           (Phase 2, REST sidecar)
  POST /downloads/bulk      multi-simfile ZIP stream            (Phase 2, REST sidecar)
  POST /upload              multipart upload via R2 binding     (Phase 2, REST sidecar)
  OPTIONS *                 CORS preflight                      (Phase 1)
  *                         404                                 (Phase 1)

  bindings: DB (D1), DTXFILE_BUCKET (R2), RATE_LIMIT_API (KV)
```

**Key architectural decisions** (resolved during brainstorming, replacing the parent spec's defaults):

1. **No presigned URLs.** The parent spec assumed `requestSimfileUploadUrl` / `requestSimfileDownloadUrl` GraphQL mutations issuing AWS-SDK-signed URLs against R2's S3 endpoint. We reject this. Binary I/O stays Worker-mediated via the R2 binding (`bucket.put`, `bucket.list`, `bucket.get`). The `requestSimfileUploadUrl` and `requestSimfileDownloadUrl` mutations are dropped. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are not added as deps. Three S3-credential secrets (`R2_ACCOUNT_ID`, `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`) are not added.
2. **All binary I/O is REST.** `/downloads/:id`, `/downloads/bulk`, and `/upload` are REST endpoints on the same Worker, sharing the same `verifyToken` + CORS middleware as `/graphql`. GraphQL handles JSON data only.
3. **Existing dtx-web behavior is preserved verbatim.** Cache purge after upload, filename sanitization, IP-based rate limiting on bulk downloads, anonymous gate via `PUBLIC_ENABLE_BLOG_DOWNLOAD`, max-20-IDs cap — all carry over unchanged.

### Repo layout (end state)

```text
packages/dtx-api/
├── package.json                            (extend: add zod dep)
├── wrangler.jsonc                          (extend: add PUBLIC_SIMFILE_BUCKET_URL var; document optional secrets)
└── src/
    ├── index.ts                            (extend: route /downloads/* and /upload)
    ├── index.test.ts                       (extend: cover new routes + CORS wrapping)
    ├── context.ts                          (unchanged from Phase 1)
    ├── env.ts                              (extend: add new vars/secrets)
    ├── auth/
    │   ├── verifyToken.ts                  (unchanged)
    │   └── verifyToken.test.ts             (unchanged)
    ├── lib/
    │   ├── cors.ts                         (unchanged)
    │   ├── cors.test.ts                    (unchanged)
    │   ├── sanitizeFilename.ts             NEW: ported from dtx-web upload route
    │   └── sanitizeFilename.test.ts        NEW
    ├── schema/
    │   ├── builder.ts                      (extend: real owner/publicOrOwner scopes)
    │   ├── index.ts                        (extend: import simfile/user/auth modules)
    │   ├── healthz.ts                      (unchanged)
    │   ├── healthz.test.ts                 (unchanged)
    │   ├── simfile.ts                      NEW: Simfile/DtxFile/R2File types + queries + mutations
    │   ├── simfile.test.ts                 NEW
    │   ├── user.ts                         NEW: UserProfile + me + upsertUserProfile
    │   ├── user.test.ts                    NEW
    │   ├── auth.ts                         NEW: generateMagicLink mutation
    │   └── auth.test.ts                    NEW
    ├── services/                           NEW directory (hybrid: composition + new deps only)
    │   ├── createSimfile.ts                NEW: compose createSimfile + createDtxFiles + rollback
    │   ├── createSimfile.test.ts           NEW
    │   ├── magicLink.ts                    NEW: Supabase admin + per-user KV rate limit + audit log
    │   ├── magicLink.test.ts               NEW
    │   ├── downloads.ts                    NEW: shared REST helpers for /downloads/*
    │   ├── downloads.test.ts               NEW
    │   ├── uploads.ts                      NEW: shared helpers for /upload (sanitize, owner, put, purge)
    │   ├── uploads.test.ts                 NEW
    │   ├── r2Enrichment.ts                 NEW: hasUploadedFiles + files resolvers (concurrent R2 list)
    │   └── r2Enrichment.test.ts            NEW
    ├── rest/
    │   ├── healthz.ts                      (unchanged)
    │   ├── healthz.test.ts                 (unchanged)
    │   ├── downloadSimfile.ts              NEW: GET /downloads/:id
    │   ├── downloadSimfile.test.ts         NEW
    │   ├── downloadBulk.ts                 NEW: POST /downloads/bulk
    │   ├── downloadBulk.test.ts            NEW
    │   ├── upload.ts                       NEW: POST /upload
    │   └── upload.test.ts                  NEW
    └── scripts/
        └── gen-schema.ts                   NEW: prints SDL to dist/schema.graphql

packages/dtx-api/dist/
└── schema.graphql                          NEW (committed): introspection artifact for Phase 3 codegen
```

### Tooling

- **Validation:** `zod` for mutation input validation. Matches the pattern in `dtx-web/src/routes/api/simFile/upload/+server.ts`.
- **Tests:** plain Vitest with per-test scripted D1/R2/KV mocks. No `@cloudflare/vitest-pool-workers`.
- **TypeScript / Pothos / Yoga:** unchanged from Phase 1.

### GraphQL schema (SDL projection)

```graphql
# ---------- Object types ----------

type Simfile {
	id: ID!
	displayId: Int
	title: String!
	artist: String!
	bpm: Float!
	userId: ID!
	isPublished: Boolean!
	downloadUrl: String
	previewUrl: String
	videoPreviewUrl: String
	publishDate: String!
	createdAt: String!
	updatedAt: String!
	dtxFiles: [DtxFile!]! # eager via parent (already loaded by listSimfiles)
	files: [R2File!]! # lazy: R2 list only when selected
	hasUploadedFiles: Boolean! # lazy: R2 list only when selected
}

type DtxFile {
	level: Float!
	label: String!
}

type R2File {
	key: String!
	size: Int!
	uploaded: String!
}

type UserProfile {
	userId: ID!
	username: String!
}

type SimfileSearchResult {
	id: ID!
	title: String!
	artist: String!
	bpm: Float!
	isPublished: Boolean!
}

type SimfileConnection {
	data: [Simfile!]!
	count: Int!
}

type DeleteResult {
	id: ID!
	deleted: Boolean!
}

type MagicLinkResult {
	magicLinkUrl: String!
	success: Boolean!
}

# ---------- Enums ----------

enum SimfileScope {
	MINE
	PUBLISHED
}

# ---------- Input types ----------

input DtxFileInput {
	label: String!
	level: Float!
}

input CreateSimfileInput {
	title: String
	artist: String
	bpm: Float!
	isPublished: Boolean
	displayId: Int
	downloadUrl: String
	videoPreviewUrl: String
	publishDate: String
	dtxFiles: [DtxFileInput!]
}

input UpdateSimfileInput {
	title: String
	artist: String
	bpm: Float
	isPublished: Boolean
	displayId: Int
	downloadUrl: String
	previewUrl: String
	videoPreviewUrl: String
	publishDate: String
}

input UpsertUserProfileInput {
	username: String!
}

# ---------- Operations ----------

type Query {
	healthz: String! # Phase 1
	simfiles(
		scope: SimfileScope!
		search: String
		page: Int = 1
		pageSize: Int = 20
	): SimfileConnection! # anonymous OK if scope=PUBLISHED
	simfile(id: ID!): Simfile # @auth(publicOrOwner)
	simfileSearch(query: String!, excludeIds: [ID!], limit: Int = 8): [SimfileSearchResult!]! # @auth(user)
	nextDisplayId: Int! # @auth(user)
	me: UserProfile # @auth(user)
}

type Mutation {
	createSimfile(input: CreateSimfileInput!): Simfile! # @auth(user)
	updateSimfile(id: ID!, input: UpdateSimfileInput!): Simfile! # @auth(owner)
	deleteSimfile(id: ID!): DeleteResult! # @auth(owner)
	upsertUserProfile(input: UpsertUserProfileInput!): UserProfile! # @auth(user)
	generateMagicLink: MagicLinkResult! # @auth(user) + per-user KV rate limit
}
```

**Mapping to existing REST endpoints** (compared against the parent spec):

| Today's REST                             | Phase 2 replacement                             | Notes                                                      |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/chart` (scope=mine\|published) | `Query.simfiles(scope, search, page, pageSize)` | `check_uploaded=true` becomes selecting `hasUploadedFiles` |
| `GET /api/chart/[id]`                    | `Query.simfile(id)`                             |                                                            |
| `GET /api/chart/next-display-id`         | `Query.nextDisplayId`                           |                                                            |
| `GET /api/chart/search`                  | `Query.simfileSearch`                           |                                                            |
| `POST /api/chart`                        | `Mutation.createSimfile`                        |                                                            |
| `PATCH /api/chart/[id]`                  | `Mutation.updateSimfile`                        |                                                            |
| `DELETE /api/simFile/delete/[id]`        | `Mutation.deleteSimfile`                        | Also lists + deletes R2 files (preserved)                  |
| `GET /api/simFile/list/[id]`             | `Query.simfile(id) { files { ... } }`           | `Simfile.files` lazy field                                 |
| `GET /api/simFile/listFiles/[id]`        | `Query.simfile(id) { files { ... } }`           | Same lazy field                                            |
| `GET /api/user/profile`                  | `Query.me`                                      |                                                            |
| `PUT /api/user/profile`                  | `Mutation.upsertUserProfile`                    | Validates `username` 1–30 chars                            |
| `POST /api/auth/generate-magic-link`     | `Mutation.generateMagicLink`                    | + per-user KV rate limit + audit log                       |
| `POST /api/simFile/upload`               | **REST: `POST /upload`**                        | Multipart, server-mediated via R2 binding                  |
| `GET /api/simFile/download/[id]`         | **REST: `GET /downloads/:id`**                  | Single-simfile ZIP stream                                  |
| `POST /api/simFile/download/bulk`        | **REST: `POST /downloads/bulk`**                | Multi-simfile ZIP stream                                   |

### Authorization scopes

Pothos `scope-auth` plugin with three real implementations (replacing Phase 1 stubs):

```ts
// schema/builder.ts (Phase 2)
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import { getSimfileOwner } from '@dtx/common/server';
import type { Ctx } from '../context';

export type OwnerCacheEntry = {
	userId: string | null;
	isPublished: boolean;
};

export const builder = new SchemaBuilder<{
	Context: Ctx;
	AuthScopes: {
		user: boolean;
		owner: { simfileId: string };
		publicOrOwner: { simfileId: string };
	};
}>({
	plugins: [ScopeAuthPlugin, ErrorsPlugin],
	scopeAuth: {
		authScopes: async (ctx) => ({
			user: ctx.user != null,
			owner: async ({ simfileId }) => {
				const id = Number(simfileId);
				if (!Number.isSafeInteger(id) || !ctx.user) return false;
				const entry = await loadOwner(ctx, id, simfileId);
				return entry !== null && entry.userId === ctx.user.id;
			},
			publicOrOwner: async ({ simfileId }) => {
				const id = Number(simfileId);
				if (!Number.isSafeInteger(id)) return false;
				const entry = await loadOwner(ctx, id, simfileId);
				if (!entry) return false;
				if (entry.isPublished) return true;
				return ctx.user != null && entry.userId === ctx.user.id;
			}
		})
	}
});
```

`loadOwner(ctx, idNum, cacheKey)` is a small helper in `schema/builder.ts` that:

1. Reads `ctx.ownerByIdCache.get(cacheKey)` (extended from the Phase 1 `Map<string, string | null>` to `Map<string, OwnerCacheEntry | null>`).
2. On miss, calls `getSimfileOwner(ctx.db, idNum)` once and caches the result (including the `is_published` flag).
3. Returns `OwnerCacheEntry | null` (null = simfile doesn't exist).

The cache shape change is a small `context.ts` edit:

```ts
// Phase 1
ownerByIdCache: Map<string, string | null>;

// Phase 2
ownerByIdCache: Map<string, { userId: string | null; isPublished: boolean } | null>;
```

This avoids the second D1 lookup when both `owner` and `publicOrOwner` scopes touch the same simfile in one operation, and gives field resolvers a fast path to `isPublished` if they need it.

### Resolver organization

**`schema/simfile.ts`** — registers `Simfile`, `DtxFile`, `R2File`, `SimfileConnection`, `SimfileSearchResult`, `DeleteResult` types, plus all simfile queries and mutations. Resolvers are thin:

```ts
// Query.simfiles
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
				throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHORIZED' } });
			}
			return listSimfiles(ctx.db, {
				userId: args.scope === 'MINE' ? ctx.user!.id : undefined,
				publishedOnly: args.scope === 'PUBLISHED',
				search: args.search ?? undefined,
				page: args.page,
				pageSize: args.pageSize
			});
		}
	})
);
```

`Simfile.dtxFiles` is resolved from the parent row (already loaded by `listSimfiles` / `getSimfile`). `Simfile.files` and `Simfile.hasUploadedFiles` are lazy — they call `services/r2Enrichment.ts`. For list queries that select `hasUploadedFiles`, the field resolver uses the concurrent-R2-list pattern (`MAX_CONCURRENT_R2_CHECKS = 4`) from today's dtx-web chart route.

**`schema/user.ts`** — `UserProfile` type + `Query.me` + `Mutation.upsertUserProfile`. Username validation (1–30 chars after trim) is enforced via zod inside the resolver, throwing `BAD_USER_INPUT` on violation.

**`schema/auth.ts`** — `MagicLinkResult` type + `Mutation.generateMagicLink`. Calls `services/magicLink.ts`. No mutation arguments; reads `ctx.user.email`.

`Mutation` root type is declared once in `schema/index.ts` via `builder.mutationType({})` before any module-side `builder.mutationField(...)` call.

### Service layer

**`services/createSimfile.ts`** — wraps `createSimfile` + `createDtxFiles` from `@dtx/common/server` with the rollback semantics of today's `POST /api/chart` route. Pure function: takes a `D1Database` and a typed args object. Returns `{ simfile: SimfileRow, dtxFiles: { label, level }[] }`. On `createDtxFiles` failure, deletes the new simfile row and re-throws.

**`services/magicLink.ts`** — three concerns the existing dtx-web route doesn't have:

1. Lazy-cached `SupabaseClient` admin (via `WeakMap<Env, SupabaseClient>` so per-isolate caching keys on the env shape).
2. Per-user hourly KV rate limit: key `magiclink:{userId}:{floor(now/3_600_000)}`, ceiling 5/hour, `expirationTtl: 3600`.
3. Structured audit log: `logger.info('magiclink_generated', { userId, ip })`. IP is read from `cf-connecting-ip` and anonymized (last octet `.x` for v4, group-4 truncation for v6) before logging.

On rate-limit hit → throws `GraphQLError('Too Many Requests', { extensions: { code: 'RATE_LIMITED' } })`. On Supabase admin error → throws `GraphQLError('Failed to generate magic link', { extensions: { code: 'INTERNAL' } })` after logging.

**`services/downloads.ts`** — two helpers reused by both `rest/downloadSimfile.ts` and `rest/downloadBulk.ts`:

- `resolveAccessibleSimfiles(db, ids, user) → { accessible, unauthorized, forbidden, missing }` — per-id ownership lookup, returns split lists. Same semantics as today's `Promise.all` map in the bulk endpoint.
- `streamSimfileZip(bucket, accessibleIds, opts) → Response` — calls `listAllR2Objects` per id, `createZipSources`, optional `validateZipSources`, returns a `buildZipStream` Response with proper headers. `opts.filename` lets the single endpoint produce `chart-{id}.zip` and the bulk endpoint produce `drumery-charts.zip`.

**`services/uploads.ts`** — single helper `uploadSimfileFile(env, ctx, user, formData) → Response` that:

1. Validates form data (zod schema: file ≤50MB, simFileId digit-only string).
2. Calls `getSimfileOwner(db, id)` and rejects on missing/forbidden.
3. Calls `lib/sanitizeFilename.ts` to derive the key.
4. Calls `bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType, cacheControl } })`.
5. Schedules cache purge via `ctx.waitUntil(purgeCacheForFile(env, fileUrl))`.
6. Returns `{ message, file: { fileName, key, size, contentType, status: 'Uploaded' } }`.

**`services/r2Enrichment.ts`** — two functions backing the lazy `Simfile.files` and `Simfile.hasUploadedFiles` fields:

- `enrichFiles(bucket, simfileId) → R2File[]` — lists all R2 objects with `${simfileId}/` prefix (cursor pagination, max 1000/batch), filters out path-only entries, returns `{ key, size, uploaded }` shape.
- `enrichHasUploadedFiles(bucket, simfileId) → boolean` — `bucket.list({ prefix, limit: 1 })`, returns `true` if any non-preview key exists. For list queries that select this field across multiple simfiles, the resolver runs concurrent listings capped at `MAX_CONCURRENT_R2_CHECKS = 4` (matches today's `enrichWithUploadedFiles` in dtx-web).

### REST sidecar — endpoints

**`rest/downloadSimfile.ts`** — `GET /downloads/:id`:

- Verbatim port of `packages/dtx-web/src/routes/api/simFile/download/[simfileID]/+server.ts`.
- Auth: `verifyToken(request, env)`; anonymous allowed only if simfile is published.
- ID validation: digits-only, `Number.isSafeInteger`.
- Ownership: `getSimfileOwner(db, id)` → 401 (anon + unpublished) / 403 (other user + unpublished) / 404 (missing).
- Rate limit: `tryConsumeRateLimit(env.RATE_LIMIT_API, '${env.RATE_LIMIT_ENV}:${ip}', estimatedBytes)`.
- ZIP stream via shared `services/downloads.ts` helper.

**`rest/downloadBulk.ts`** — `POST /downloads/bulk`:

- Verbatim port of `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`.
- Body parsing: handles both `application/json` and form-data (mirrors today).
- ID validation + dedupe + `MAX_BULK_IDS = 20`.
- Per-id auth resolution via `services/downloads.ts:resolveAccessibleSimfiles`. Single-fail semantics match today (any unauthorized → 401 with ID list; any forbidden → 403; any missing → 404).
- `validate=1` query param → returns `{ ok: true, fileCount }` without streaming (used by today's UX to gate the download button).
- Rate limit consumes only on the real (non-validate) request, matching today.
- Anonymized IP audit log (`anonymizeIp`).

**`rest/upload.ts`** — `POST /upload`:

- Verbatim port of `packages/dtx-web/src/routes/api/simFile/upload/+server.ts` minus the SvelteKit-specific glue.
- Multipart form parsing via `request.formData()`.
- Auth: bearer required (401 if absent or invalid).
- Validation via `services/uploads.ts:uploadSimfileFile`.
- Cache purge: fire-and-forget via `ctx.waitUntil`, graceful skip if `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_API_TOKEN` are unset (warning logged).

### Router (`src/index.ts`)

Phase 1 routes `/healthz` and `/graphql`. Phase 2 extends:

```ts
import { yoga } from './schema';
import { routeHealthz } from './rest/healthz';
import { routeDownloadSimfile } from './rest/downloadSimfile';
import { routeDownloadBulk } from './rest/downloadBulk';
import { routeUpload } from './rest/upload';
import { handlePreflight, withCors } from './lib/cors';
import type { Env } from './env';

const downloadSimfilePattern = /^\/downloads\/(\d+)$/;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;
		const url = new URL(request.url);

		if (url.pathname === '/healthz') {
			return request.method === 'GET'
				? withCors(routeHealthz(request, env), request, env)
				: withCors(
						new Response('Method Not Allowed', {
							status: 405,
							headers: { Allow: 'GET' }
						}),
						request,
						env
					);
		}

		if (url.pathname === '/graphql') {
			return withCors(await yoga.fetch(request, { env, ctx }), request, env);
		}

		if (url.pathname === '/downloads/bulk' && request.method === 'POST') {
			return withCors(await routeDownloadBulk(request, env, ctx), request, env);
		}

		const downloadMatch = downloadSimfilePattern.exec(url.pathname);
		if (downloadMatch) {
			return request.method === 'GET'
				? withCors(
						await routeDownloadSimfile(request, env, ctx, downloadMatch[1]),
						request,
						env
					)
				: withCors(
						new Response('Method Not Allowed', {
							status: 405,
							headers: { Allow: 'GET' }
						}),
						request,
						env
					);
		}

		if (url.pathname === '/upload' && request.method === 'POST') {
			return withCors(await routeUpload(request, env, ctx), request, env);
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
```

REST routes receive `ctx` so they can use `ctx.waitUntil` (cache purge). GraphQL receives `ctx` via the existing Yoga server-context wiring.

### Env vars & secrets

`packages/dtx-api/src/env.ts` gains four declarations:

```ts
export type Env = {
	// Phase 1
	DB: D1Database;
	DTXFILE_BUCKET: R2Bucket;
	RATE_LIMIT_API: KVNamespace;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	RATE_LIMIT_ENV: 'prod' | 'pre-prod' | 'pre-prod-prod-data';
	GRAPHIQL: 'true' | 'false';
	CORS_ALLOWED_ORIGINS: string;
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' | 'false';

	// Phase 2 — vars (committed to wrangler.jsonc)
	PUBLIC_SIMFILE_BUCKET_URL: string; // for cache-purge URL construction; mirrors dtx-web

	// Phase 2 — secrets (set via `wrangler secret put`)
	SUPABASE_SERVICE_ROLE_KEY: string; // for generateMagicLink admin call
	CLOUDFLARE_ZONE_ID?: string; // optional; cache purge
	CLOUDFLARE_API_TOKEN?: string; // optional; cache purge
};
```

**`packages/dtx-api/wrangler.jsonc`** gains `PUBLIC_SIMFILE_BUCKET_URL` per env (committed). Three secrets are documented in the implementation plan as one-time `wrangler secret put` steps per env (matching how dtx-web carries them today via `wrangler secret put`, not in source).

**No new dependencies on `@dtx/common`** — every server primitive Phase 2 uses already lives in `@dtx/common/server` from Phase 0.

### Error model

Resolvers throw `GraphQLError` with a stable `extensions.code` discriminator. Yoga's `maskedErrors: true` (already configured in Phase 1) preserves errors that carry the `extensions` shape and masks unexpected exceptions as `INTERNAL_SERVER_ERROR`. Codes used:

| Code             | Meaning                                                                                      | HTTP analog |
| ---------------- | -------------------------------------------------------------------------------------------- | ----------- |
| `UNAUTHORIZED`   | Caller is anonymous and operation requires auth                                              | 401         |
| `FORBIDDEN`      | Caller is authed but not authorized (auto from scope-auth's `ForbiddenError` + manual throw) | 403         |
| `NOT_FOUND`      | Resource doesn't exist                                                                       | 404         |
| `BAD_USER_INPUT` | Input failed validation                                                                      | 400         |
| `RATE_LIMITED`   | Rate limit exceeded                                                                          | 429         |
| `INTERNAL`       | Operation failed unexpectedly (logged with details)                                          | 500         |

Scope-auth raises its own error class on scope failure; the schema/builder configuration overrides it to throw `new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } })` so the masked-error pass keeps the discriminator intact. The exact override hook depends on the resolved Pothos v4 minor — see the implementation plan.

REST endpoints return JSON `{ error: string, ... }` with the matching status code, identical to today's dtx-web behavior.

### Cache purge behavior

`services/uploads.ts` ports the `_purgeCacheForFile` helper from dtx-web verbatim:

```ts
const purgeCacheForFile = async (
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
};
```

Invoked via `ctx.waitUntil(purgeCacheForFile(...))` from the upload route, exactly matching dtx-web's fire-and-forget pattern.

### Codegen artifact

`packages/dtx-api/src/scripts/gen-schema.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { printSchema } from 'graphql';
import { schema } from '../schema';

writeFileSync('dist/schema.graphql', printSchema(schema));
```

Run via `bun run --filter=dtx-api gen-schema`. The output `packages/dtx-api/dist/schema.graphql` is committed to git. A CI check (defined in the implementation plan) compares `printSchema(schema)` to the committed artifact and fails if they diverge — prevents accidental schema drift.

Phase 3's dtx-web codegen reads this committed artifact as its schema input. Phase 2 itself doesn't consume it.

## Testing strategy

Mirrors the patterns already in `packages/dtx-api/src/auth/verifyToken.test.ts` and the existing dtx-web `server.test.ts` files. Plain Vitest, mocked D1/R2/KV bindings, scripted return values per test.

| Test file                        | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/simfile.test.ts`         | Each query/mutation: anonymous, authed, owner, non-owner, validation, not-found, introspection lists the field. `simfiles(PUBLISHED)` anon-OK; `simfiles(MINE)` requires user. `simfile(id)` returns published anonymously; returns own unpublished; 403 for non-owner unpublished; 404 for missing. `Simfile.dtxFiles` resolves from parent. `Simfile.files` resolves via R2 mock. `Simfile.hasUploadedFiles` resolves via R2 mock; list with 5 selected runs at most 4 concurrent R2 lists. `createSimfile` happy path; rollback when `createDtxFiles` throws; validation rejects invalid bpm/displayId/publishDate. `updateSimfile` happy path; 403 non-owner; "No fields to update" → BAD_USER_INPUT. `deleteSimfile` happy path; 403 non-owner; 404 missing; partial R2 failure preserves DB-record-delete behavior. |
| `schema/user.test.ts`            | `Query.me`: returns profile when authed; 404 when no profile; UNAUTHORIZED when anon. `Mutation.upsertUserProfile`: happy path; rejects empty username; rejects >30 chars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `schema/auth.test.ts`            | `Mutation.generateMagicLink`: happy path returns URL; reads `user.email` (no arg); rate-limit hit returns RATE_LIMITED; Supabase admin error returns INTERNAL with audit log entry; anonymous returns FORBIDDEN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `services/createSimfile.test.ts` | Happy path with dtxFiles; happy path without; rollback on `createDtxFiles` throw deletes the simfile row; rollback failure logged but does not mask original error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `services/magicLink.test.ts`     | Rate limit increments KV; ceiling enforced at 5; expiration TTL set to 3600; audit log anonymizes IP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `services/downloads.test.ts`     | `resolveAccessibleSimfiles` splits ids correctly per status; `streamSimfileZip` builds correct Response headers + Content-Disposition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `services/uploads.test.ts`       | Validation rejects oversized file; rejects bad simFileId; happy path calls `bucket.put` with sanitized key; cache purge scheduled via `ctx.waitUntil` mock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `services/r2Enrichment.test.ts`  | `enrichFiles` paginates correctly; filters out preview keys; `enrichHasUploadedFiles` returns true on any non-preview key; concurrent listings respect `MAX_CONCURRENT_R2_CHECKS = 4`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lib/sanitizeFilename.test.ts`   | Ported from `packages/dtx-web/src/routes/api/simFile/upload/sanitizeFilename.test.ts` verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rest/downloadSimfile.test.ts`   | Happy path published anon; 401 anon + unpublished; 403 non-owner + unpublished; 404 missing; rate-limit 429; ZIP headers correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `rest/downloadBulk.test.ts`      | Happy path; max-ids cap; dedupe; `validate=1` returns count without streaming; rate-limit only consumed on non-validate; per-id auth split; missing R2 files for any id → 400 with id list; IP audit log anonymized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `rest/upload.test.ts`            | Happy path; 401 anon; 403 non-owner; oversize rejection; bad simFileId; bucket put called with sanitized key; cache purge scheduled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/index.test.ts` (extend)     | `/downloads/:id` GET dispatch + 405 on POST; `/downloads/bulk` POST dispatch + 405 on GET; `/upload` POST dispatch + 405 on GET; 404 for unmatched. Every route's response is CORS-wrapped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Coverage target: **≥80%** across `packages/dtx-api/src/` excluding `index.ts`.

## Deployment & verification (pre-prod only)

The implementation plan spells out exact steps. Summary:

1. `bun install` from root (picks up `zod` addition).
2. `bun run gen-schema` → commit `packages/dtx-api/dist/schema.graphql`.
3. `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env pre-prod` (and same for `pre-prod-prod-data` if magic-link is exercised there).
4. Optional: `wrangler secret put CLOUDFLARE_ZONE_ID --env pre-prod` and `CLOUDFLARE_API_TOKEN`. Skip = no cache purge, with warning logged.
5. `bun run --filter=dtx-api build` to verify dry-run bundle <600 KB.
6. `bun run deploy:api:preprod`.
7. Smoke-verify against `api.pre-prod.dtx.hapadona.com`:
    - Anonymous published list: `curl -X POST .../graphql -H 'content-type: application/json' -d '{"query":"{ simfiles(scope:PUBLISHED, pageSize:5){ count data{ id title } } }"}'`
    - Authed mine list with a real bearer token, scope: MINE
    - `upsertUserProfile` mutation with bearer
    - `GET .../downloads/{id}` returns ZIP (published or owner)
    - `POST .../downloads/bulk` with `{"ids":[1,2]}` returns ZIP
    - `POST .../upload -F file=@test.dtx -F simFileId={ownedId}` with bearer → R2 object exists; cache purge logs (or skip warning)
    - CORS preflight from `pre-prod.dtx.hapadona.com` succeeds; foreign origin denied silently
    - GraphiQL loads at `GET .../graphql`

Prod deploy stays untouched (Phase 5).

## Risks & mitigations

| Risk                                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pothos `scope-auth` v4 typings reject the simfile-scoped scopes' generic shape                                    | The Phase 1 schema already declares `AuthScopes: { user: boolean; owner: { simfileId: string }; publicOrOwner: { simfileId: string } }` and compiles. Phase 2 only swaps the stub implementations. If the v4 minor we resolved on `bun install` changes the option name, consult `https://pothos-graphql.dev/docs/plugins/scope-auth` and adjust — the test contract drives correctness. |
| GraphQL N+1 on `Simfile.files` / `Simfile.hasUploadedFiles` for list queries                                      | Both fields are lazy (resolved only when selected). When selected on a list, `services/r2Enrichment.ts` runs concurrent R2 listings capped at 4 (matches today's `MAX_CONCURRENT_R2_CHECKS`). Verified by a test that selects `hasUploadedFiles` on a 20-row list and asserts no more than 4 simultaneous in-flight calls.                                                               |
| Owner-scope cache key collision between `Mutation.updateSimfile(id:1)` and a sibling field on a different simfile | Cache key is the GraphQL ID string (`"1"`, `"2"`). Different IDs hash to different keys. Single Pothos request's `Ctx` is fresh per request — no cross-request leakage.                                                                                                                                                                                                                  |
| Bundle exceeds 1MB free-tier limit                                                                                | Phase 2 adds `zod` (~50 KB) + ~5 new service files + ~6 new schema files. Expected bundle: ~250–350 KB. Plan asserts <600 KB on first dry-run; investigation step kicks in only if over.                                                                                                                                                                                                 |
| `generateMagicLink` opens an arbitrary-email vector                                                               | Mutation takes NO arguments. Reads `ctx.user.email` directly. Same constraint as today's REST handler. Per-user KV rate limit of 5/hour gates abuse.                                                                                                                                                                                                                                     |
| Cache purge fires before R2 PUT is durable                                                                        | `bucket.put` resolves only after R2 acknowledges; purge then runs via `ctx.waitUntil`. Same ordering guarantee as today's dtx-web upload route. Cache purge is best-effort regardless.                                                                                                                                                                                                   |
| Mock D1 returns empty arrays, hiding broken queries in tests                                                      | Each test file builds per-test scripted D1 mocks for data-bearing branches. The global `createMockD1Database` only covers the no-platform fallback. Pattern matches today's `packages/dtx-web/src/routes/api/chart/server.test.ts`.                                                                                                                                                      |
| Multiple REST endpoints sharing the `RATE_LIMIT_API` KV namespace cause cross-route key collisions                | Each endpoint uses a distinct key prefix (`single:{ip}`, `bulk:{ip}`) so the sliding window is per-endpoint. Today's dtx-web behavior is preserved.                                                                                                                                                                                                                                      |
| Schema drift between resolver code and committed `schema.graphql`                                                 | CI runs `bun run --filter=dtx-api gen-schema` and `git diff --exit-code dist/schema.graphql`. Diff = CI fail.                                                                                                                                                                                                                                                                            |
| `winston`-style log shape vs `workerLogger`'s JSON shape                                                          | All Phase 2 logging goes through `ctx.logger` (= `workerLogger`). No winston imports in dtx-api.                                                                                                                                                                                                                                                                                         |
| Anonymous `simfiles(PUBLISHED)` performance under bot traffic                                                     | Same D1 query today's `/api/chart?scope=published` runs. No new attack surface. If pressed, Cloudflare's bot management + KV rate-limit on the `/graphql` endpoint can be added later.                                                                                                                                                                                                   |
| Two Workers (dtx-web + dtx-api) racing on the same D1 + R2                                                        | D1 serializes writes; R2 supports multiple Worker bindings. Phase 2 only reads in GraphQL queries; write paths in Phase 2 (createSimfile, deleteSimfile, upload) are not yet exercised by dtx-web clients (Phase 3 cutover). Cross-Worker writes happen only once dtx-web flips to dtx-api in Phase 5.                                                                                   |

## Decisions log (pinned by this spec)

1. **No presigned URLs.** All binary I/O is REST + R2 binding. `requestSimfileUploadUrl` and `requestSimfileDownloadUrl` from the parent spec are dropped. `@aws-sdk/*` deps not added. Three S3-cred secrets not added.
2. **REST sidecar for downloads + uploads.** `GET /downloads/:id`, `POST /downloads/bulk`, `POST /upload`. Ported verbatim from dtx-web's behavior.
3. **Cache purge: optional, graceful skip.** `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_API_TOKEN` documented in `.env.example` as optional; missing-secret path logs a warning and returns false. Matches dtx-web exactly.
4. **Error model: throw `GraphQLError` with stable `extensions.code`.** No typed-error unions via `@pothos/plugin-errors`. Yoga's `maskedErrors` preserves codes.
5. **Service layer: hybrid.** `services/` only for composition (`createSimfile`), new dependency (`magicLink`), or shared REST helpers (`downloads`, `uploads`, `r2Enrichment`). Plain CRUD resolvers call `@dtx/common/server` directly.
6. **Test runner: plain Vitest with per-test scripted D1 mocks.** No `@cloudflare/vitest-pool-workers`.
7. **Codegen artifact: committed `dist/schema.graphql`.** CI gate against drift.
8. **`Ctx.ownerByIdCache` shape:** `Map<string, { userId: string | null; isPublished: boolean } | null>`. Caches both owner and published-state in one entry.
9. **`Mutation` root type declared in `schema/index.ts`** before any mutation field is added.
10. **Anonymous gate on bulk download** stays driven by `PUBLIC_ENABLE_BLOG_DOWNLOAD` env var per env, matching today.

## Open questions deferred to implementation

- Exact `zod` minor (pinned at `bun install`).
- Whether `enrichFiles` should also filter `preview.*` keys (it does today via `isPreviewKey`); Phase 2 preserves today's behavior unless a use case dictates otherwise.
- Whether to log `cf-ray` on REST request logs (already done in bulk download today). Default: yes, mirror today.
- Whether to support form-encoded body in `/upload` (today only accepts multipart). Default: same as today.

## What Phase 3 will need (handoff)

- Read `packages/dtx-api/dist/schema.graphql` as the codegen schema source.
- Implement `packages/dtx-web/src/lib/api/client.ts` with a `PUBLIC_USE_GRAPHQL_API` feature flag and dispatch:
    - Browser: `fetch('https://api.{env}.dtx.hapadona.com/graphql', { headers: { Authorization: 'Bearer ${supabase.session.access_token}' } })`.
    - SSR: `platform.env.API.fetch(new Request('https://internal/graphql', …))` once the service binding lands.
- Add a service binding `{ binding: "API", service: "dtx-api" }` to `packages/dtx-web/wrangler.jsonc` (Phase 3).
- REST endpoints in `dtx-api` (`/downloads/*`, `/upload`) are direct replacements for the dtx-web URLs — dtx-web's client just swaps the base URL during cutover.

## Done criteria

- `packages/dtx-api/src/schema/simfile.ts`, `schema/user.ts`, `schema/auth.ts` exist; introspection lists all 5 queries + 5 mutations.
- `packages/dtx-api/src/rest/downloadSimfile.ts`, `downloadBulk.ts`, `upload.ts` exist; router dispatches all three.
- `packages/dtx-api/dist/schema.graphql` is committed.
- `bun run --filter=dtx-api test` passes; coverage ≥80% on Phase 2 modules.
- `bun run --filter=dtx-api check` passes (0 errors).
- `bun run --filter=@dtx/common test` and `--filter=@dtx/common check` pass (no regression).
- `bun run --filter=dtx-web test` and `--filter=dtx-web check` pass (no regression — Phase 2 doesn't touch dtx-web).
- `bun run lint` passes.
- `wrangler deploy --dry-run` bundle <600 KB.
- All 7 smoke-test curl commands succeed against `api.pre-prod.dtx.hapadona.com`.
- CORS preflight from `pre-prod.dtx.hapadona.com` succeeds; foreign origin silently denied.
- Zero changes outside `packages/dtx-api/`.
