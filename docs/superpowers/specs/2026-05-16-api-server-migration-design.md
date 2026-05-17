# API Server Migration — Design

**Date:** 2026-05-16
**Packages:** new `packages/dtx-api`; modifies `packages/dtx-web`, `packages/dtx-desktop`, `packages/common`

## Goal

Extract the backend API currently embedded in `packages/dtx-web` SvelteKit `+server.ts` routes into a dedicated, API-first GraphQL server deployed as a separate Cloudflare Worker at `api.dtx.hapadona.com`. The new server is the single backend for the existing web client, the existing desktop client, and any future mobile client.

## Non-goals

- Replacing Supabase for authentication.
- Changing the D1 schema or the R2 bucket layout (the new Worker binds to the same resources).
- Reworking the rhythm-game runtime, DTX parsing, or any Phaser-side code in `@dtx/common`.
- Building a mobile client. The migration only enables it.
- Multi-region or non-Cloudflare deployment.
- API versioning (`/v1`, `/v2`) — GraphQL evolves field-by-field.
- Service-level observability beyond Cloudflare's built-in `observability.logs.enabled` (Sentry/OTel are future work).

## Current state

`packages/dtx-web` is a SvelteKit app deployed to Cloudflare Workers via `@sveltejs/adapter-cloudflare`. It serves SSR pages **and** owns 12 REST endpoints under `src/routes/api/`:

| Endpoint                             | Verb                                  |
| ------------------------------------ | ------------------------------------- |
| `/api/auth/generate-magic-link`      | POST                                  |
| `/api/chart`                         | GET (list), POST (create)             |
| `/api/chart/[id]`                    | GET (read), PATCH (update)            |
| `/api/chart/next-display-id`         | GET                                   |
| `/api/chart/search`                  | GET                                   |
| `/api/simFile/upload`                | POST (multipart, ≤50MB)               |
| `/api/simFile/delete/[simfileID]`    | DELETE                                |
| `/api/simFile/download/[simfileID]`  | GET (R2 stream + cache headers)       |
| `/api/simFile/download/bulk`         | POST (streaming ZIP, KV rate-limited) |
| `/api/simFile/list/[simFileId]`      | GET                                   |
| `/api/simFile/listFiles/[simfileID]` | GET                                   |
| `/api/user/profile`                  | GET, PUT                              |

Bindings on `dtx-web` Worker: D1 (`DB`), R2 (`DTXFILE_BUCKET`), KV (`RATE_LIMIT`). Auth runs in `hooks.server.ts` and supports both Supabase cookie sessions (web) and `Authorization: Bearer` tokens (desktop, identified by `DTXDesktopApp` user-agent). Public/anonymous GETs are allowed for published-chart listing, single chart, listFiles, and downloads.

Server-side modules already factored as testable units in `packages/dtx-web/src/lib/server/`:

- `db.ts` — Drizzle ORM queries over D1.
- `db/schema.ts` — Drizzle schema.
- `r2.ts` — R2 listing + preview-key filtering.
- `rateLimiter.ts` — KV-based sliding-window byte limiter for bulk downloads.
- `zipBuilder.ts` — streaming ZIP construction.
- `logger.ts` — Winston wrapper.

Existing consumers:

- Web SPA: same-origin `fetch('/api/...')` and `<a href="/api/simFile/download/...">`.
- Desktop (Electron): `fetch('${VITE_DTX_SERVER_URL}/api/...')` with bearer.
- Public blog (SSR + anonymous browse): unauthenticated GETs to published-chart endpoints.

Three deployment environments mirror `wrangler.jsonc`: prod (`dtx.hapadona.com`), `pre-prod`, `pre-prod-prod-data`.

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser / Web SPA                Desktop (Electron)     Mobile (TBD)│
│  dtx.hapadona.com                  VITE_DTX_SERVER_URL              │
└──────────────┬──────────────────────────┬─────────────────┬─────────┘
               │ Bearer (Supabase JWT)    │ Bearer          │ Bearer
               ▼                          ▼                 ▼
        ┌─────────────────────────────────────────────────────────┐
        │  dtx-api Worker @ api.dtx.hapadona.com                  │
        │                                                          │
        │   POST /graphql       ← Yoga + Pothos                    │
        │   POST /downloads/bulk ← REST: streaming ZIP            │
        │   GET  /healthz                                          │
        │                                                          │
        │   bindings: D1 (DB), R2 (DTXFILE_BUCKET), KV (RATE_LIMIT)│
        └────────┬───────────────────┬─────────────────┬──────────┘
                 ▼                   ▼                 ▼
              D1 (dtx-web)      R2 (simfile-dtx)   KV (rate limit)
                                       ▲
                                       │ presigned PUT/GET
              ┌────────────────────────┘
              │
         clients upload/download files DIRECTLY to R2 via short-lived presigned URLs


  dtx-web Worker @ dtx.hapadona.com (SvelteKit, post-migration)
   - serves SSR pages, blog, app shell
   - SSR `load()` → dtx-api via Cloudflare service binding (low-latency, no public hop)
   - browser-side → dtx-api over HTTPS with bearer token
   - no longer owns D1/R2/KV bindings after cutover
```

**Key decisions:**

- One Worker per environment for the API (prod / pre-prod / pre-prod-prod-data), mirroring web's three envs.
- `dtx-web` keeps a **service binding** to `dtx-api` so SSR can call internally without a public DNS hop (faster, no CORS).
- D1/R2/KV bindings physically move from `dtx-web/wrangler.jsonc` to `dtx-api/wrangler.jsonc` at decommission. During the parallel period both Workers may bind to the same D1 database and R2 bucket — D1 and R2 accept multiple Worker bindings.
- Bulk ZIP download stays a REST endpoint co-located on the new Worker. GraphQL handles JSON data; streaming binary is a side endpoint.

### Repo & module structure

```
packages/dtx-api/                          ← NEW
├── wrangler.jsonc                         (D1 + R2 + KV + custom domains)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                           Worker entry: route /graphql, /downloads/bulk, /healthz
    ├── context.ts                         GraphQL context type + builder
    ├── auth/
    │   ├── verifyToken.ts                 Supabase JWT verify (current logic from hooks.server.ts)
    │   └── scopes.ts                      Pothos scope-auth plugin config
    ├── schema/
    │   ├── builder.ts                     Pothos builder + plugins (scope-auth, errors, dataloader)
    │   ├── index.ts                       schema = builder.toSchema()
    │   ├── simfile.ts                     Simfile type + queries + mutations
    │   ├── user.ts                        UserProfile, me, generateMagicLink
    │   └── files.ts                       PresignedUploadUrl / PresignedDownloadUrl mutations
    ├── services/                          pure business logic; takes deps explicitly
    │   ├── simfiles.ts                    createSimfile, updateSimfile, listSimfiles…
    │   ├── files.ts                       presignR2Url, listR2Files
    │   └── users.ts                       upsertUserProfile, generateMagicLink
    ├── rest/
    │   └── bulkDownload.ts                POST /downloads/bulk (ported from dtx-web)
    └── lib/
        └── cors.ts                        CORS middleware

packages/common/                           ← EXTEND
└── src/server/                            (new sub-export "@dtx/common/server")
    ├── db/
    │   ├── schema.ts                      ← moved from dtx-web/src/lib/server/db/schema.ts
    │   └── queries.ts                     ← moved from dtx-web/src/lib/server/db.ts
    ├── r2.ts                              ← moved
    ├── rateLimiter.ts                     ← moved
    ├── zipBuilder.ts                      ← moved
    └── logger.ts                          ← moved

packages/dtx-web/                          ← MODIFIED
├── src/lib/api/                           + GraphQL client wrapper (browser + server)
└── src/routes/api/                        DELETED at end of cutover

packages/dtx-desktop/                      ← MODIFIED
└── src/main/simfile-service.ts            calls GraphQL + R2 directly via presigned URLs
```

**Why this shape:**

- `services/` is the testable seam — pure functions with explicit dependencies, no GraphQL/HTTP knowledge. Each resolver is a 3-line wrapper.
- `@dtx/common/server` becomes the single home for D1/R2/KV building blocks, importable by either Worker during transition. Move-only, no duplication.
- `rest/` lives next to `schema/` so the bulk download endpoint is co-located with the rest of the API.

### GraphQL schema (SDL projection)

Code-first via Pothos; SDL shown for the contract.

```graphql
type Simfile {
	id: ID!
	displayId: Int
	title: String!
	artist: String!
	bpm: Float!
	isPublished: Boolean!
	downloadUrl: String
	previewUrl: String
	videoPreviewUrl: String
	publishDate: String!
	createdAt: String!
	updatedAt: String!
	userId: ID!
	dtxFiles: [DtxFile!]!
	files: [R2File!]!
	hasUploadedFiles: Boolean!
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

enum SimfileScope {
	MINE
	PUBLISHED
}
type SimfileConnection {
	data: [Simfile!]!
	count: Int!
}

type Query {
	simfiles(
		scope: SimfileScope!
		search: String
		page: Int = 1
		pageSize: Int = 20
	): SimfileConnection!
	simfile(id: ID!): Simfile
	simfileSearch(query: String!, excludeIds: [ID!], limit: Int = 8): [Simfile!]!
	nextDisplayId: Int!
	me: UserProfile
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
input DtxFileInput {
	label: String!
	level: Float!
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

type DeleteResult {
	id: ID!
	deleted: Boolean!
}
type MagicLinkResult {
	magicLinkUrl: String!
	success: Boolean!
}

type HeaderEntry {
	name: String!
	value: String!
}
type PresignedUploadUrl {
	url: String!
	key: String!
	method: String! # "PUT"
	headers: [HeaderEntry!]!
	expiresAt: String!
}
type PresignedDownloadUrl {
	url: String!
	expiresAt: String!
}

type Mutation {
	createSimfile(input: CreateSimfileInput!): Simfile!
	updateSimfile(id: ID!, input: UpdateSimfileInput!): Simfile!
	deleteSimfile(id: ID!): DeleteResult!

	requestSimfileUploadUrl(
		simfileId: ID!
		filename: String!
		contentType: String!
	): PresignedUploadUrl!

	requestSimfileDownloadUrl(simfileId: ID!, filename: String!): PresignedDownloadUrl!

	upsertUserProfile(input: UpsertUserProfileInput!): UserProfile!
	generateMagicLink: MagicLinkResult!
}
```

**Authorization scopes** (Pothos scope-auth plugin):

- `user` — `ctx.user != null`. Required for: `nextDisplayId`, `me`, all mutations except `requestSimfileDownloadUrl` against published files.
- `owner: { simfileId: ID }` — loads simfile owner once per request (cached in ctx); fails if `ctx.user.id != simfile.userId`. Required for: `updateSimfile`, `deleteSimfile`, `requestSimfileUploadUrl`.
- `publicOrOwner` — used by `simfile(id)` and `requestSimfileDownloadUrl`: allowed if the simfile is `isPublished=true` OR caller owns it.
- `Query.simfiles(scope: MINE)` requires `user`. `Query.simfiles(scope: PUBLISHED)` is anonymous-safe.

**REST sidecar (same Worker):**

```
POST /downloads/bulk        # body: { ids: number[], validate?: 1 }; auth: bearer optional if blog-download enabled
GET  /healthz               # liveness + bindings probe
```

**REST → GraphQL mapping:**

| Current REST                                                | Replacement                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/chart?scope=mine\|published&search&page&pageSize` | `Query.simfiles(scope, search, page, pageSize)`                                              |
| `GET /api/chart/[id]`                                       | `Query.simfile(id)`                                                                          |
| `POST /api/chart`                                           | `Mutation.createSimfile`                                                                     |
| `PATCH /api/chart/[id]`                                     | `Mutation.updateSimfile`                                                                     |
| `GET /api/chart/search?query=&excludeIds=&limit=`           | `Query.simfileSearch`                                                                        |
| `GET /api/chart/next-display-id`                            | `Query.nextDisplayId`                                                                        |
| `POST /api/simFile/upload` (multipart)                      | `Mutation.requestSimfileUploadUrl` + client PUT to R2                                        |
| `DELETE /api/simFile/delete/[id]`                           | `Mutation.deleteSimfile`                                                                     |
| `GET /api/simFile/download/[id]`                            | `Mutation.requestSimfileDownloadUrl` (public R2 URL when published, presigned GET otherwise) |
| `GET /api/simFile/list/[id]`                                | `Query.simfile(id) { dtxFiles { level label } }`                                             |
| `GET /api/simFile/listFiles/[id]`                           | `Query.simfile(id) { files { key size uploaded } }`                                          |
| `POST /api/simFile/download/bulk`                           | **REST: `POST /downloads/bulk`**                                                             |
| `GET /api/user/profile`                                     | `Query.me`                                                                                   |
| `PUT /api/user/profile`                                     | `Mutation.upsertUserProfile` (validates `username` 1–30 chars)                               |
| `POST /api/auth/generate-magic-link`                        | `Mutation.generateMagicLink`                                                                 |

### Auth & context flow

Request lifecycle:

```
Request → CORS middleware → auth middleware → Yoga handler or REST handler
```

Auth middleware (single implementation, used by both `/graphql` and `/downloads/bulk`):

1. Read `Authorization: Bearer <token>`.
2. If absent → `ctx.user = null`, `ctx.session = null` (anonymous allowed).
3. If present → verify with `supabase.auth.getUser(token)`.
    - On failure → 401 (REST); for GraphQL, leave `ctx.user = null` and let the resolver's scope check raise `ForbiddenError`.
    - On success → attach `ctx.user`, build a synthetic session from the JWT payload's `exp` (lifted directly from `hooks.server.ts`).

GraphQL context shape:

```ts
type Ctx = {
	user: User | null;
	session: Session | null;
	db: D1Database;
	r2: R2Bucket;
	kv: KVNamespace;
	env: Env;
	request: Request;
	logger: Logger;
};
```

Pothos scope-auth example:

```ts
builder.queryField('nextDisplayId', (t) =>
	t.int({
		authScopes: { user: true },
		resolve: (_root, _args, ctx) => services.nextDisplayId(ctx.db, ctx.user!.id)
	})
);
```

`owner` scope loads `getSimfileOwner(db, simfileId)` once and caches in `ctx._ownerByIdCache` so multiple owner-scoped fields on the same request only hit D1 once.

### Binary I/O

**Upload (single file, ≤50MB):**

```
client                                api Worker                     R2
  │  requestSimfileUploadUrl({…}) ───▶ verify owner, sanitize
  │                                    filename, build key, sign URL
  │  ◀───── { url, key, headers, expiresAt }
  │
  │  PUT url (body=file, +required headers) ──────────────────────▶ object stored
  │  ◀── 200
```

- URL TTL: 5 min.
- Signing: `@aws-sdk/s3-request-presigner` against R2's S3-compatible endpoint. Credentials from a new secret pair `R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY`.
- Filename sanitization (`_sanitizeFilename`) stays server-side. The key is `{simfileId}/{sanitizedFilename}` — identical to today.
- `contentType` and a max `content-length` are signed into the URL so a leaked URL cannot be abused to upload arbitrary content types or sizes.
- Optional follow-up mutation `finalizeUpload(key)` triggers the Cloudflare cache-purge call (today's fire-and-forget logic from the upload endpoint). Out of scope for the initial schema; can be added when needed.

**Download (single file):**

- Published simfile → `requestSimfileDownloadUrl` returns the public R2 URL (`PUBLIC_SIMFILE_BUCKET_URL/{key}`). No signing; leverages the existing CDN cache.
- Owner-only / unpublished → 5-minute presigned GET URL.

**Bulk download (REST):**

- `POST /downloads/bulk` body `{ ids: number[], validate?: 1 }`.
- Logic ported verbatim from `packages/dtx-web/src/routes/api/simFile/download/bulk/+server.ts`: auth via bearer, IP-based KV rate-limit (1 GiB/min sliding window), R2 listing, `zipBuilder` streaming response.
- Anonymous access gated on `PUBLIC_ENABLE_BLOG_DOWNLOAD === 'true'` (same as today).

### Web client migration

```
packages/dtx-web/src/lib/api/
├── client.ts          GraphQL client (graphql-request) — browser + server
├── token.ts           getAccessToken(): reads Supabase session
├── operations/        hand-written .graphql or .ts files per page
│   ├── simfiles.ts
│   ├── user.ts
│   └── ...
└── generated/         types from graphql-codegen (introspection)
```

- **Client:** `graphql-request` (~50KB) for minimal moving parts during the cutover. Reconsider `urql`/Houdini once stable if browser-side caching becomes a need.
- **Token handling:**
    - Browser: `supabase.auth.getSession()` → `access_token` → `Authorization: Bearer …`.
    - SSR (`+page.server.ts`): uses `event.locals.session.access_token` and calls via service binding (`platform.env.API.fetch(...)`) — no public hop, no CORS.
- **Codegen:** `graphql-codegen` against the pre-prod GraphQL introspection. Output committed to `src/lib/api/generated/`. CI fails if regenerating produces a diff.
- **Feature flag:** `PUBLIC_USE_GRAPHQL_API` (env var) toggles a dispatch in `lib/api/client.ts`:

    ```ts
    export const listSimfiles = (params) =>
    	USE_GRAPHQL ? gqlClient.request(LIST_SIMFILES, params) : restListSimfiles(params); // current fetch('/api/chart?…')
    ```

    Both code paths ship in production for at least one week post-cutover. A single env-var flip reverts.

### Desktop client migration

- Set `VITE_DTX_SERVER_URL=https://api.dtx.hapadona.com` (and `https://api.pre-prod.dtx.hapadona.com` for pre-prod build).
- Replace `${apiBaseUrl}/api/...` fetches with `graphql-request` calls to `${apiBaseUrl}/graphql`.
- Upload flow rewrite (`packages/dtx-desktop/src/main/simfile-service.ts`):
    1. Call `requestSimfileUploadUrl` mutation.
    2. PUT file directly to R2 from the Electron main process (`fetch`).
    3. Drop the multipart upload path.
- Bearer token: unchanged (already in use).
- Hard cutover (no flag) — no active production users.

### Deployment & environments

**`packages/dtx-api/wrangler.jsonc`** mirrors the existing dtx-web layout:

| Env                  | Route                           | D1                | R2                    | KV                             |
| -------------------- | ------------------------------- | ----------------- | --------------------- | ------------------------------ |
| default (prod)       | `api.dtx.hapadona.com`          | `dtx-web`         | `simfile-dtx`         | new `RATE_LIMIT_API` namespace |
| `pre-prod`           | `api.pre-prod.dtx.hapadona.com` | `dtx-web-preprod` | `simfile-dtx-preprod` | new pre-prod namespace         |
| `pre-prod-prod-data` | `api.pre-prod.dtx.hapadona.com` | `dtx-web`         | `simfile-dtx`         | new pre-prod namespace         |

A **new KV namespace** for the API's rate-limiter keeps the two systems decoupled even while web and api overlap.

**Service binding in `dtx-web/wrangler.jsonc`** (added during transition, kept after):

```jsonc
"services": [
  { "binding": "API", "service": "dtx-api" }
]
```

SSR calls become `platform.env.API.fetch(new Request('https://internal/graphql', …))`. Fall back to public HTTPS if the service binding is unavailable for any reason — flag-controlled in `lib/api/client.ts`.

**Root `package.json` scripts:**

```
deploy:api                        → bun --filter=dtx-api deploy:prod
deploy:api:preprod                → bun --filter=dtx-api deploy:preprod
deploy:api:preprod:prod-data      → bun --filter=dtx-api deploy:preprod:prod-data
```

**Custom domains:** add `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` as Worker custom domains in the Cloudflare zone before first deploy.

**Secrets** (set per environment via `wrangler secret put`):

- `SUPABASE_SERVICE_ROLE_KEY` — for `generateMagicLink` admin call.
- `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY` — for presigned URL signing.
- `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` — for cache purge (existing).

### Migration phases

**Phase 0 — Extract shared server code (1 PR, no behaviour change)**

- Move `dtx-web/src/lib/server/{db.ts,db/schema.ts,r2.ts,rateLimiter.ts,zipBuilder.ts,logger.ts}` into `@dtx/common/src/server/`.
- Add `"./server"` to the package exports.
- Replace imports in `dtx-web` with `@dtx/common/server`.
- All existing tests must pass unchanged.
- Ship to prod. Reversible; unblocks parallel work.

**Phase 1 — Scaffold `packages/dtx-api`**

- New package + `wrangler.jsonc` for all three envs.
- Yoga + Pothos with hello-world `Query.healthz`.
- Auth middleware (Supabase bearer verify) ported.
- CORS middleware for `dtx.hapadona.com`, `pre-prod.dtx.hapadona.com`, `localhost:5173`.
- `/healthz` REST endpoint.
- Deploy empty Worker to pre-prod; add custom domains.

**Phase 2 — Implement GraphQL surface**

- Resolvers grouped by file (`schema/simfile.ts`, `schema/user.ts`, `schema/files.ts`).
- Each resolver is a 3-line wrapper around a `services/*` function.
- Pothos scope-auth for `user` + `owner` + `publicOrOwner` scopes.
- Presigned URL helpers (`@aws-sdk/s3-request-presigner`).
- Port `POST /downloads/bulk` REST route verbatim.
- Generate introspection schema artifact for codegen.
- Deploy to pre-prod and smoke-test via GraphiQL.

**Phase 3 — Web client integration (flag OFF)**

- Add `graphql-request`, `graphql-codegen` to `dtx-web`.
- Wire `lib/api/client.ts` with dual-path dispatch (`if USE_GRAPHQL`).
- Add service binding to `dtx-web/wrangler.jsonc`.
- Replace each fetch call-site to go through `lib/api/`. Both paths compile and pass tests; flag stays OFF.
- Ship to prod (no user-visible change).

**Phase 4 — Validate end-to-end on pre-prod**

- Flip `PUBLIC_USE_GRAPHQL_API=true` on `pre-prod.dtx.hapadona.com`.
- Manual smoke + the four e2e suites described below.
- Compare GraphQL responses to old REST responses for representative payloads.
- Fix any deltas.

**Phase 5 — Production cutover**

- Web: flip `PUBLIC_USE_GRAPHQL_API=true` on prod. Monitor errors + p95.
- Desktop: bump `VITE_DTX_SERVER_URL`, build + ship a new desktop release.
- Mobile: builds against the new API from day one (no migration).

**Phase 6 — Decommission (1 PR, after a week stable in prod)**

- Delete `dtx-web/src/routes/api/` and all colocated `server.test.ts`.
- Strip API auth branch from `hooks.server.ts`.
- Remove the dispatch branch from `lib/api/client.ts` and the feature flag.
- Remove `D1`, `R2`, `KV` bindings from `dtx-web/wrangler.jsonc`.
- Move `d1-migrations/` directory from `packages/dtx-web/` to `packages/dtx-api/` and update `migrations_dir` in both `wrangler.jsonc` files accordingly.

### Testing strategy

**Unit (services):** Vitest, mock D1/R2/KV bindings (same patterns as today's `dtx-web` server tests). Move existing tests alongside the code into `@dtx/common/server`; they continue to gate behaviour.

**GraphQL operation tests:** drive Yoga's HTTP entry directly:

```ts
const result = await yoga.fetch('http://api/graphql', {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		authorization: `Bearer ${jwt}`
	},
	body: JSON.stringify({ query: LIST_SIMFILES })
});
```

Uses the existing mock D1. Covers schema → resolver → service composition.

**REST (`/downloads/bulk`):** port the existing `server.test.ts` directly into `packages/dtx-api/src/rest/`.

**Auth middleware:** unit tests for token expiry, malformed JWT, missing token, anonymous flow.

**CORS:** assertions on allowed origins + preflight handling.

**Schema/type contract:** Pothos types are compile-time checked; CI fails if a resolver's return shape drifts. `graphql-codegen` in `dtx-web` re-runs against pre-prod introspection; CI fails on generated-types diff.

**E2E (Playwright):** four critical-journey tests, kept deliberately minimal.

1. **Authenticated chart lifecycle** — login → create a chart with dtx levels → see it in `/app` list → edit title → delete. Exercises bearer auth, `createSimfile` + `updateSimfile` + `deleteSimfile`, `simfiles(MINE)`.
2. **File upload via presigned URL** — open an existing chart → upload a `.dtx` file → file appears in the chart's files list. Exercises `requestSimfileUploadUrl` → direct R2 PUT → `Simfile.files`.
3. **Anonymous blog browse + single download** — visit `/blog`, see published list (SSR), open a chart, click download, file downloads. Exercises anonymous `simfiles(PUBLISHED)` + `simfile(id)` + `requestSimfileDownloadUrl` (or public R2 URL).
4. **Bulk ZIP download** — select two charts on blog → click bulk download → ZIP arrives. Exercises REST `POST /downloads/bulk` with rate limit.

Out of scope for e2e (kept in unit tests): validation errors, malformed JWTs, permission-denied paths, edge cases, rate-limit boundaries, sanitization, pagination math, codegen drift.

**Transition gate:** during phases 3–5 the four e2e tests run twice in CI — once with `PUBLIC_USE_GRAPHQL_API=false` and once with `=true`. This is the parity gate. After Phase 6 the REST run is deleted.

**E2E hygiene:** no `waitForTimeout`; isolated test user per spec; `beforeEach` seeds, `afterEach` cleans; assertions on URL / visible elements only.

### `generateMagicLink` hardening

The current handler at `packages/dtx-web/src/routes/api/auth/generate-magic-link/+server.ts` requires the requester to be logged in and sends a link to **their own email** (`session.user.email`), with `redirectTo: 'dtx://auth-callback'` for the desktop sign-in flow. No arbitrary-email vector exists today. The migration adds:

- `@auth(user)` scope — no anonymous link generation. Matches current behaviour.
- Per-user KV rate limit: key `magiclink:{user.id}:{floor(now/3600)}`, ceiling 5 / hour. Reuses the existing `rateLimiter.ts` pattern.
- Structured audit log: `logger.info({ event: 'magiclink_generated', userId, ip })`. No PII beyond user id + truncated IP.
- Email comes from `ctx.user.email`; the mutation takes no arguments. Signature: `generateMagicLink(): MagicLinkResult!`.

### Risks & mitigations

| Risk                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL N+1 on `simfiles.dtxFiles` and `Simfile.files`    | `dtxFiles` reuses the existing IN-batched D1 query in `listSimfiles`. `Simfile.files` (R2 listing per simfile) reuses the existing concurrency-limited pattern from `enrichWithUploadedFiles` (`MAX_CONCURRENT_R2_CHECKS = 4`); R2 list isn't naturally batchable by id, so dataloader doesn't apply. The field is resolved lazily — only computed if the client selects it. |
| Worker bundle size with Yoga + Pothos + AWS SDK presigner | Tree-shake; target <800KB, hard limit 1MB (free) / 10MB (paid). Verify with `wrangler deploy --dry-run`.                                                                                                                                                                                                                                                                     |
| Service binding latency or unavailability                 | Public HTTPS fallback in `lib/api/client.ts`. Service binding is a perf optimization, not a correctness requirement.                                                                                                                                                                                                                                                         |
| CORS misconfiguration                                     | Strict allow-list (no wildcards) + preflight tests in CI. Desktop sends no `Origin` header.                                                                                                                                                                                                                                                                                  |
| Presigned URL bypass of business rules                    | URL TTL ≤5 min; ownership re-checked at issue time; key path bakes in `simfile_id`; `contentType` + max `content-length` are signed in.                                                                                                                                                                                                                                      |
| Supabase token visible to browser JS                      | Identical to current desktop bearer flow and to any Supabase SPA. Short-lived tokens + Supabase's built-in refresh. No new XSS surface introduced.                                                                                                                                                                                                                           |
| D1 schema drift between web and api during transition     | Schema lives in `@dtx/common/server/db/schema.ts`; both Workers import it. Single source of truth, single migrations directory (`d1-migrations/`, owned by `dtx-web` until Phase 6 then by `dtx-api`).                                                                                                                                                                       |
| Big-bang web cutover regression                           | The feature flag is the safety net. Both code paths ship in prod for ≥1 week.                                                                                                                                                                                                                                                                                                |
| Mobile client built against pre-stable schema             | Schema is published via `/graphql` introspection. Mobile can pin a schema SHA in its build if it ships before Phase 5 stabilizes. Optional; low cost.                                                                                                                                                                                                                        |
| Two open D1 connections from concurrent Workers writing   | D1 serializes writes per database. No additional locking needed. Cross-Worker reads see consistent state within the same eventual-consistency model as today.                                                                                                                                                                                                                |

## Deferred for follow-up (post-migration)

Not in scope for the cutover, called out so they aren't forgotten:

- `Query.userProfile(userId)` — look up another user's profile (needed if/when blog shows author pages).
- `Mutation.updateSimfile` editing of `dtxFiles` (today's PATCH endpoint only updates the simfile row; dtx_files editing would be a separate mutation like `replaceDtxFiles(simfileId, files)`).
- `finalizeUpload(key)` mutation — currently the upload endpoint triggers a fire-and-forget Cloudflare cache-purge. With presigned uploads the client knows when the PUT completes; we can add an explicit mutation that purges and returns success. Acceptable to skip on day one since R2 has no event hook.

## Open questions for implementation phase

These are deferrable to the implementation plan, not blocking the design:

- Exact CORS allow-list values for desktop dev (Electron `file://` origin behaviour).
- Whether to expose `/graphql` over GET (for GraphiQL UI in pre-prod) or POST-only. Default: GET enabled only when `env.GRAPHIQL === 'true'`.
- Whether to keep the existing `winston` logger (Node-only) or replace with a Workers-native structured logger (e.g. a thin wrapper around `console.log` + JSON formatter). The existing `logger.ts` may need Worker-compat changes.
- Service-binding `Request` URL convention — `https://internal/graphql` or `https://api.internal/graphql`. Cosmetic.
