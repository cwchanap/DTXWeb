# API Migration Phase 1 — Scaffold `packages/dtx-api`

**Date:** 2026-05-18
**Parent spec:** [docs/superpowers/specs/2026-05-16-api-server-migration-design.md](2026-05-16-api-server-migration-design.md)
**Phase 0 plan:** [docs/superpowers/plans/2026-05-16-api-migration-phase-0.md](../plans/2026-05-16-api-migration-phase-0.md) (complete)
**Packages:** new `packages/dtx-api`; extends `packages/common`

## Goal

Scaffold a new Cloudflare Worker (`dtx-api`) that will host the project's GraphQL API at `api.dtx.hapadona.com`. Phase 1 produces a deployable empty Worker with the auth, CORS, and observability primitives in place, so Phase 2 can land real resolvers as pure additive code with no further infra work.

The Worker must be reachable on pre-prod at `api.pre-prod.dtx.hapadona.com` at the end of this phase. Prod deploy is intentionally deferred to Phase 5.

## Non-goals

- Implementing any real GraphQL resolver beyond the `Query.healthz` placeholder.
- Porting `POST /downloads/bulk` (REST sidecar) — Phase 2.
- Wiring presigned upload/download URLs or pulling in `@aws-sdk/s3-request-presigner` — Phase 2.
- Service binding between `dtx-web` and `dtx-api` — Phase 3.
- Any change to `packages/dtx-web/src/hooks.server.ts` or `packages/dtx-web/src/routes/api/` — Phases 3–6.
- Any change to `packages/dtx-desktop` — Phase 5.
- Production deploy of `dtx-api` — Phase 5.
- Wiring Pothos `@auth` scopes to specific fields (the plugin is registered, scopes are declared, but no resolver enforces a scope in Phase 1 — `healthz` is anonymous).

## Current state

Phase 0 is complete on `main`:

- `packages/common/src/lib/server/` hosts `logger.ts` (winston), `rateLimiter.ts`, `r2.ts`, `zipBuilder.ts`, `db.ts`, `db/schema.ts`, all with their tests.
- `@dtx/common/server` exports the full surface used by the new Worker.
- `packages/dtx-web/src/lib/server/` retains only the `getDb(platform)` wrapper.

No other moves or refactors land in Phase 1.

## Design

### Architecture

```text
┌──────────────────────────────────────────┐
│  api.pre-prod.dtx.hapadona.com           │
│  (Phase 1 deploy target)                  │
│                                           │
│  POST /graphql      → Yoga + Pothos       │
│  GET  /graphql      → GraphiQL (env-gate) │
│  GET  /healthz      → REST liveness JSON  │
│  *                  → 404                 │
│                                           │
│  bindings: DB (D1), DTXFILE_BUCKET (R2),  │
│            RATE_LIMIT_API (KV, new)       │
└──────────────────────────────────────────┘
```

The Worker is standalone in Phase 1 — `dtx-web` does not call it; no service binding exists yet. D1 and R2 bindings refer to the same physical resources `dtx-web` already binds to (D1 and R2 both accept multi-Worker bindings; reads are eventually consistent under the same model as today). The KV binding (`RATE_LIMIT_API`) is a **new namespace per env**, deliberately separate from the existing `RATE_LIMIT` namespace, to keep web and api rate-limit state decoupled during the parallel period.

### Repo layout

```text
packages/dtx-api/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.jsonc
├── README.md                          one-paragraph orientation
└── src/
    ├── index.ts                       Worker entry: CORS → router → /graphql | /healthz | 404
    ├── index.test.ts                  Worker entrypoint routing + CORS coverage
    ├── context.ts                     GraphQL context type + createContext
    ├── env.ts                         Env type for typed bindings + vars
    ├── auth/
    │   ├── verifyToken.ts             Bearer verify + JWT exp decode + synthetic Session
    │   └── verifyToken.test.ts
    ├── lib/
    │   ├── cors.ts                    Allow-list + preflight handler
    │   └── cors.test.ts
    ├── schema/
    │   ├── builder.ts                 Pothos builder + plugin registration
    │   ├── index.ts                   yoga + `export const schema = builder.toSchema()`
    │   ├── healthz.ts                 Query.healthz placeholder
    │   └── schema.test.ts             yoga.fetch('/graphql') happy-path + GraphiQL gate
    └── rest/
        ├── healthz.ts                 GET /healthz handler
        └── healthz.test.ts
```

```text
packages/common/src/lib/server/
└── workerLogger.ts                    NEW: console.log JSON formatter
packages/common/src/lib/server.ts      add re-export
```

### Tooling

- **Bundler:** wrangler's built-in esbuild bundler. `main: "src/index.ts"` in `wrangler.jsonc`. No Vite — the package is server-only and has no Svelte.
- **Test runner:** `vitest` with mocked D1/R2/KV. No `@cloudflare/vitest-pool-workers` — Phase 1 exercises no Worker-runtime-specific behavior (streaming, ReadableStream tee, etc.); plain vitest matches the rest of the monorepo.
- **TypeScript:** strict, `target: "ES2022"`, `lib: ["ES2022"]`, `types: ["@cloudflare/workers-types"]`. Mirror `packages/dtx-web/tsconfig.json` minus the SvelteKit-specific pieces.
- **Bun workspaces:** add `packages/dtx-api` to the root `workspaces` array in `/package.json`.

### Wrangler configuration

Three envs from day 1; default = prod (matching `dtx-web`'s structure). Bindings are present on all three envs even though Phase 1 only exercises `/healthz`.

| Env                  | Route                           | D1                | R2                    | KV (new namespace)                       | `GRAPHIQL` |
| -------------------- | ------------------------------- | ----------------- | --------------------- | ---------------------------------------- | ---------- |
| default (prod)       | `api.dtx.hapadona.com`          | `dtx-web`         | `simfile-dtx`         | `RATE_LIMIT_API` (prod ID)               | `false`    |
| `pre-prod`           | `api.pre-prod.dtx.hapadona.com` | `dtx-web-preprod` | `simfile-dtx-preprod` | `RATE_LIMIT_API` (pre-prod ID)           | `true`     |
| `pre-prod-prod-data` | `api.pre-prod.dtx.hapadona.com` | `dtx-web`         | `simfile-dtx`         | `RATE_LIMIT_API` (pre-prod-prod-data ID) | `true`     |

**Shared config:**

- `compatibility_date: "2025-01-01"`, `compatibility_flags: ["nodejs_compat"]`.
- `observability.logs.enabled: true`.
- `keep_vars: true`.
- `route: { pattern, custom_domain: true }` per env.

**Vars (committed to wrangler.jsonc — none secret):**

- `SUPABASE_URL` — same value as `dtx-web`'s `PUBLIC_SUPABASE_URL`.
- `SUPABASE_ANON_KEY` — same value as `dtx-web`'s `PUBLIC_SUPABASE_ANON_KEY` (anonymous key, designed to be public).
- `RATE_LIMIT_ENV` — `prod` / `pre-prod` / `pre-prod-prod-data` (parity with dtx-web; used by Phase 2's KV rate-limiter key prefix).
- `GRAPHIQL` — `false` in prod; `true` in pre-prod and pre-prod-prod-data.
- `CORS_ALLOWED_ORIGINS` — comma-separated allow-list per env (see CORS section).
- `PUBLIC_ENABLE_BLOG_DOWNLOAD` — mirror dtx-web's setting per env (consumed by Phase 2's bulk-download REST; declaring now means Phase 2 doesn't touch wrangler).

**Per-env `CORS_ALLOWED_ORIGINS` values:**

- prod: `"https://dtx.hapadona.com"`
- pre-prod: `"https://pre-prod.dtx.hapadona.com,http://localhost:5173,http://localhost:8788"`
- pre-prod-prod-data: same as pre-prod

**Secrets:** none in Phase 1. Phase 2 will add `R2_S3_ACCESS_KEY_ID`, `R2_S3_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`.

**No `migrations_dir`** on the D1 binding — `dtx-web` retains migration ownership until Phase 6.

**One-time manual setup before first deploy** (instructions go in the implementation plan):

1. `wrangler kv namespace create RATE_LIMIT_API` × 3 (prod, pre-prod, pre-prod-prod-data). Record IDs in `wrangler.jsonc`.
2. Confirm `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` are claimable subdomains on the existing `hapadona.com` zone in Cloudflare. Wrangler creates the custom-domain route on first deploy.

### Code surface

#### Entry (`src/index.ts`)

```ts
import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { handlePreflight, withCors } from './lib/cors';
import type { Env } from './env';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;

		const url = new URL(request.url);

		if (url.pathname === '/healthz') {
			return withCors(healthz(request, env), request, env);
		}

		if (url.pathname === '/graphql') {
			const response = await yoga.fetch(request, env, ctx);
			return withCors(response, request, env);
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
```

Yoga is constructed once at module scope (`src/schema/index.ts`). `createContext` runs per request and reads bearer + builds `Ctx`.

#### Auth (`src/auth/verifyToken.ts`)

Pure function, no SvelteKit dependence, no cookies. Bearer-only.

- Signature: `verifyToken(request: Request, env: Env): Promise<{ user: User; session: Session } | null>`.
- Read `Authorization: Bearer <token>` (case-insensitive). Absent → return `null` (anonymous).
- Construct a per-request Supabase client: `createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. Call `supabase.auth.getUser(token)`.
- On error → return `null` (the GraphQL scope check, not the auth middleware, decides whether anonymous is acceptable for a given operation). REST `/downloads/bulk` (Phase 2) will turn this into a 401 itself.
- On success → decode JWT payload (`atob`-based, ported from `hooks.server.ts`'s `decodeJwtPayload`) to derive `exp`. Build a synthetic Session with `access_token`, `refresh_token: ''`, `expires_in` (clamped ≥ 0), `expires_at`, `token_type: 'bearer'`, `user`. Return `{ user, session }`.
- `_sanitizeFilename`, `DTXDesktopApp` user-agent check, and `X-Requested-With` CSRF check are **not** ported — they belong to the SvelteKit cookie-auth path that is not part of `dtx-api`.

`verifyToken` is exported from `src/auth/`; `context.ts` is its only consumer in Phase 1.

#### CORS (`src/lib/cors.ts`)

- Allow-list comes from `env.CORS_ALLOWED_ORIGINS`, split on commas and trimmed. Cached at module scope keyed by the raw string so the split runs once per Worker isolate, not per request.
- `handlePreflight(request, env)`:
    - If `request.method !== 'OPTIONS'` → return `null` (caller continues).
    - If `Origin` not in allow-list → return `new Response(null, { status: 204 })` with **no** ACAO header. Browser will block. No 403; that just leaks policy.
    - Otherwise return 204 with: `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Allow-Credentials: false`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, content-type, x-requested-with`, `Access-Control-Max-Age: 86400`.
- `withCors(response, request, env)`:
    - If `Origin` absent (Electron desktop, curl, server-to-server) → return `response` unchanged. CORS doesn't apply.
    - If `Origin` is allow-listed → attach `Access-Control-Allow-Origin` + `Vary: Origin` to the response.
    - If `Origin` is present but not allow-listed → return `response` unchanged (no ACAO).

#### Schema (`src/schema/`)

```ts
// builder.ts
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import type { Ctx } from '../context';

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
			// Phase 2 will wire these to ctx.ownerByIdCache + getSimfileOwner.
			// In Phase 1 they only need to type-check; no resolver enforces them yet.
			owner: async () => false,
			publicOrOwner: async () => false
		})
	}
});

builder.queryType({});
// Intentionally omit builder.mutationType({}) in Phase 1.
// GraphQL root types must expose at least one field, and no mutations exist yet.
```

```ts
// healthz.ts
import { builder } from './builder';
builder.queryField('healthz', (t) => t.string({ resolve: () => 'ok' }));
```

```ts
// index.ts
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import './healthz';
import { createContext } from '../context';
import type { Env } from '../env';

export const schema = builder.toSchema();

export const yoga = createYoga<{ env: Env; ctx: ExecutionContext }>({
	schema,
	context: ({ request, env }) => createContext(request, env),
	graphiql: (_request, { env }) => env.GRAPHIQL === 'true',
	landingPage: false,
	cors: false, // outer CORS middleware handles allow-list uniformly
	maskedErrors: true
});
```

#### Context (`src/context.ts`)

```ts
import type { User, Session } from '@supabase/supabase-js';
import { verifyToken } from './auth/verifyToken';
import { workerLogger, type WorkerLogger } from '@dtx/common/server';
import type { Env } from './env';

export type Ctx = {
	user: User | null;
	session: Session | null;
	env: Env;
	db: D1Database;
	r2: R2Bucket;
	kv: KVNamespace;
	request: Request;
	logger: WorkerLogger;
	ownerByIdCache: Map<string, string | null>;
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

`ownerByIdCache` is included in Phase 1's context shape (even though no Phase 1 resolver uses it) so the `owner` scope can wire up cleanly in Phase 2 without a context shape change.

#### Env (`src/env.ts`)

```ts
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
};
```

#### REST `/healthz` (`src/rest/healthz.ts`)

```ts
import type { Env } from '../env';

declare const __BUILD_SHA__: string | undefined;

export const healthz = (_request: Request, _env: Env): Response =>
	new Response(
		JSON.stringify({
			ok: true,
			service: 'dtx-api',
			version: '0.0.1',
			buildSha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
```

Liveness only. Does not touch D1/R2/KV (decision rationale: avoid burning quota on probe traffic; uptime checks shouldn't false-positive on transient binding latency). `buildSha` reads `__BUILD_SHA__` when a build-time define is provided and otherwise falls back to `'dev'`; Phase 1 does not require the Wrangler/deploy-script wiring yet.

### Workers-native logger (`packages/common`)

Add a new file `packages/common/src/lib/server/workerLogger.ts`:

```ts
type Meta = Record<string, unknown>;
const format = (level: string, msg: string, meta?: Meta) =>
	JSON.stringify({ ...(meta ?? {}), ts: new Date().toISOString(), level, msg });

export const workerLogger = {
	info: (msg: string, meta?: Meta) => console.log(format('info', msg, meta)),
	warn: (msg: string, meta?: Meta) => console.warn(format('warn', msg, meta)),
	error: (msg: string, meta?: Meta) => console.error(format('error', msg, meta)),
	debug: (msg: string, meta?: Meta) => console.debug(format('debug', msg, meta))
};
export type WorkerLogger = typeof workerLogger;
```

Re-export from `packages/common/src/lib/server.ts`:

```ts
export { workerLogger, type WorkerLogger } from './server/workerLogger';
```

The existing winston `logger` export stays unchanged. `dtx-api` only imports `workerLogger`. `dtx-web` continues using `logger`. Phase 6 cleanup can collapse to a single logger if winston is retired alongside the REST routes.

### Dependencies

`packages/dtx-api/package.json`:

```jsonc
{
	"name": "dtx-api",
	"version": "0.0.1",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "wrangler dev",
		"build": "wrangler deploy --dry-run --outdir=dist",
		"deploy:prod": "wrangler deploy",
		"deploy:preprod": "wrangler deploy --env pre-prod",
		"deploy:preprod:prod-data": "wrangler deploy --env pre-prod-prod-data",
		"test": "vitest --run",
		"test:watch": "vitest",
		"check": "tsc --noEmit",
		"cf-typegen": "wrangler types --env-interface CloudflareBindings"
	},
	"dependencies": {
		"@dtx/common": "*",
		"@pothos/core": "^4.0.0",
		"@pothos/plugin-errors": "^4.0.0",
		"@pothos/plugin-scope-auth": "^4.0.0",
		"@supabase/supabase-js": "^2.49.4",
		"graphql": "^16.10.0",
		"graphql-yoga": "^5.10.0"
	},
	"devDependencies": {
		"@cloudflare/workers-types": "^4.20250620.0",
		"@vitest/coverage-v8": "^3.0.0",
		"typescript": "^5.8.3",
		"vitest": "^3.1.4",
		"wrangler": "^4.0.0"
	}
}
```

Exact minor versions resolved during install — the plan pins them once `bun install` runs.

### Root `package.json` additions

Mirror existing `deploy:web*` scripts:

```jsonc
{
	"scripts": {
		"deploy:api": "bun run --filter=dtx-api deploy:prod",
		"deploy:api:preprod": "bun run --filter=dtx-api deploy:preprod",
		"deploy:api:preprod:prod-data": "bun run --filter=dtx-api deploy:preprod:prod-data"
	},
	"workspaces": [
		"packages/dtx-web",
		"packages/dtx-desktop",
		"packages/common",
		"packages/ui-components",
		"packages/dtx-api"
	]
}
```

`deploy:api` is not run in Phase 1 (prod deploy is Phase 5). It's present so the workflow is symmetric.

### Testing

Plain vitest, mocked Supabase + D1/R2/KV stubs. Patterns mirror `packages/dtx-web/src/hooks.server.test.ts`.

| File                       | Coverage                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/verifyToken.test.ts` | Bearer present + valid → returns `{ user, session }`. `supabase.auth.getUser` rejects → returns null (Supabase is the authoritative validator). Mock case: `getUser` succeeds but JWT `exp` is in the past → `session.expires_in` clamped to 0 (parity with `hooks.server.ts`). Malformed JWT (undecodable payload) → null. Absent / non-bearer Authorization header → null. |
| `lib/cors.test.ts`         | Preflight from allow-listed origin → 204 + ACAO + Vary + correct methods/headers. Preflight from foreign origin → 204 + no ACAO. Non-preflight response gets ACAO+Vary when Origin allow-listed. Absent Origin → no ACAO. `CORS_ALLOWED_ORIGINS` parsed correctly (trim, empty entries ignored).                                                                             |
| `rest/healthz.test.ts`     | Raw `healthz` handler returns 200 JSON with expected keys (`ok`, `service`, `version`, `buildSha`).                                                                                                                                                                                                                                                                          |
| `index.test.ts`            | Worker entrypoint covers preflight short-circuiting, `GET /healthz`, non-GET `/healthz` → 405, `/graphql` dispatch through the exported Yoga instance, 404 handling, and route-level CORS wrapping.                                                                                                                                                                          |
| `schema/schema.test.ts`    | `yoga.fetch('/graphql', POST { query: '{ healthz }' })` → 200 with `{ data: { healthz: 'ok' } }`. Introspection query returns a schema. `GRAPHIQL=false` → GET /graphql returns 405 or 400 (no playground). `GRAPHIQL=true` → GET returns the GraphiQL HTML.                                                                                                                 |

Coverage target: 80%+ across the Phase 1 `dtx-api` modules. No fixtures needed beyond hand-crafted JWTs (lifted directly from `hooks.server.test.ts`).

### Deployment & verification (pre-prod only)

The implementation plan will spell out the exact commands. Summary:

1. `bun install` from repo root.
2. `wrangler kv namespace create RATE_LIMIT_API` × 3; paste IDs into `wrangler.jsonc`.
3. `bun run --filter=dtx-api deploy:preprod`. Wrangler attaches the `api.pre-prod.dtx.hapadona.com` custom domain on first deploy.
4. Smoke verify:
    - `curl https://api.pre-prod.dtx.hapadona.com/healthz` → `{ "ok": true, "service": "dtx-api", ... }`.
    - `curl -X POST https://api.pre-prod.dtx.hapadona.com/graphql -H 'content-type: application/json' -d '{"query":"{ healthz }"}'` → `{ "data": { "healthz": "ok" } }`.
    - Browser → `https://api.pre-prod.dtx.hapadona.com/graphql` → GraphiQL loads.
    - `curl -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql -H 'Origin: https://pre-prod.dtx.hapadona.com' -H 'Access-Control-Request-Method: POST'` → 204 with `Access-Control-Allow-Origin: https://pre-prod.dtx.hapadona.com`.
    - `curl -I -X OPTIONS https://api.pre-prod.dtx.hapadona.com/graphql -H 'Origin: https://evil.example.com'` → 204 with no ACAO.
5. Confirm bundle size from `wrangler deploy` output is well under 1MB.

Prod deploy stays untouched in Phase 1.

### Risks & mitigations

| Risk                                                                  | Mitigation                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pothos scope-auth typing rejects the empty Phase 1 schema             | The placeholder `Query.healthz` does not declare scopes, so no scope check runs. `authScopes` returns concrete booleans (`user: ctx.user != null`) plus async stubs for `owner`/`publicOrOwner` (return `false`). |
| `nodejs_compat` quirks with `winston` leak into the api Worker        | `dtx-api` imports only `workerLogger`, not `logger`. Winston is never bundled into `dtx-api`.                                                                                                                     |
| Two Workers binding the same R2/D1 cause unexpected conflicts         | D1 and R2 explicitly support multiple Worker bindings. No Phase 1 code mutates D1/R2 — `/healthz` doesn't touch them.                                                                                             |
| Custom domain not yet attached to the CF zone                         | Phase 1 plan includes a verification step before deploy; wrangler will fail-fast if the subdomain isn't claimable. Resolution is a one-line zone change.                                                          |
| Bundle exceeds 1MB free-tier limit                                    | Phase 1 surface is small (Yoga + Pothos + Supabase client only). Expected <300KB. Plan asserts the size on first deploy with `wrangler deploy --dry-run --outdir`.                                                |
| GraphiQL exposed unintentionally on prod                              | `GRAPHIQL` defaults to `false`; only pre-prod envs set it `true`. Schema test covers both branches.                                                                                                               |
| `supabase.auth.getUser(token)` cold-start latency hurts every request | Acceptable for Phase 1 (only `/healthz` is hit, and it's anonymous so it short-circuits). Future optimization: locally verify the JWT signature with the Supabase JWKS instead of round-tripping.                 |

## Decisions log (for future reference)

These were settled during brainstorming and are pinned by this spec:

1. **Logger:** add a new `workerLogger` (console.log JSON) to `@dtx/common/server` alongside the existing winston `logger`. `dtx-api` uses `workerLogger`; `dtx-web` keeps using `logger`. No renames.
2. **/healthz scope:** liveness only. No D1/R2/KV probing. Returns `{ ok, service, version, buildSha }`.
3. **GraphiQL:** env-gated. Off in prod, on in both pre-prod envs.
4. **Bindings in wrangler.jsonc:** D1, R2, KV bound from day 1 even though Phase 1 doesn't use them — saves a wrangler change in Phase 2.
5. **New KV namespace:** `RATE_LIMIT_API`, distinct from `RATE_LIMIT`, three IDs (one per env).
6. **Pothos schema:** code-first builder set up with `scope-auth` + `errors` plugins ready, single `Query.healthz: String!` field. No real resolvers, no enforced scopes.
7. **Test runner:** plain vitest with mocked bindings (no `@cloudflare/vitest-pool-workers`).
8. **Custom domains:** wrangler-managed via `route.custom_domain: true`. Phase 1 attaches `api.pre-prod.dtx.hapadona.com` only.
9. **No `migrations_dir`** on `dtx-api`'s D1 binding — `dtx-web` retains migration ownership through Phase 6.
10. **CSRF / desktop user-agent checks:** not ported. `dtx-api` is API-only with no cookie auth; CSRF doesn't apply.

## Done criteria

- `packages/dtx-api/` exists with the layout above.
- `bun run --filter=dtx-api test` passes.
- `bun run --filter=dtx-api check` (tsc --noEmit) passes.
- `bun run --filter=@dtx/common test` and `bun run --filter=@dtx/common check` pass (the `workerLogger` addition doesn't break anything).
- `bun run lint` passes.
- Wrangler bundle size <1MB on first `wrangler deploy --dry-run`.
- `https://api.pre-prod.dtx.hapadona.com/healthz` returns the expected JSON in production traffic.
- `https://api.pre-prod.dtx.hapadona.com/graphql` (POST) returns `{ data: { healthz: 'ok' } }`.
- `https://api.pre-prod.dtx.hapadona.com/graphql` (GET, in pre-prod) loads the GraphiQL playground.
- CORS preflight to the GraphQL endpoint succeeds for `pre-prod.dtx.hapadona.com` and is silently denied for foreign origins.
- Zero changes to `packages/dtx-web/`, `packages/dtx-desktop/`, or `packages/ui-components/`.
- Only changes outside `packages/dtx-api/` are: new `packages/common/src/lib/server/workerLogger.ts`, two added lines in `packages/common/src/lib/server.ts`, three added scripts + one workspace entry in `/package.json`.

## Open questions deferred to implementation

- Pin exact minor versions for `@pothos/core`, `graphql-yoga`, `graphql`. Resolved on first `bun install`.
- Whether to wire `wrangler dev` `--env pre-prod` for local development against pre-prod bindings, or use a separate local-only env. Default: use `wrangler dev` without `--env`, with local mocks via `--local`.
- Whether to add a `.dev.vars` file for local Supabase credentials, or rely on `wrangler dev`'s built-in `vars` pickup. Pick whichever wrangler version supports cleanly.

## What Phase 2 will need (handoff)

For continuity, Phase 2 should expect:

- The Yoga + Pothos pipeline is live; new resolvers are pure additions in `src/schema/*.ts` + `src/services/*.ts`.
- The `owner` and `publicOrOwner` scopes need a real implementation; Phase 2 implements them against `ctx.ownerByIdCache` + `getSimfileOwner` from `@dtx/common/server`.
- `Env` type and `createContext` are stable; Phase 2 adds Phase-2-specific bindings (presigner secrets) but doesn't restructure `Ctx`.
- The CORS allow-list is per-env; Phase 2's `POST /downloads/bulk` REST endpoint reuses the same `withCors` wrapper.
- The bulk-download REST endpoint goes under `src/rest/bulkDownload.ts`, sibling to `src/rest/healthz.ts`.
