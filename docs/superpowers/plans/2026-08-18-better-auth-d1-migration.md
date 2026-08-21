# Better Auth and D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Supabase from DTXWeb by hosting Better Auth in `dtx-api`, storing auth data in the existing Cloudflare D1 database, moving web authentication to cookies, and replacing desktop magic-link/deep-link authentication with Device Authorization plus opaque Bearer sessions.

**Architecture:** Delivery is split at the additive/destructive seam. Foundation PR A adds and proves Better Auth schema, routing, credentialed CORS, the neutral resolver, environment-specific cookies, rate-limit policy, and a production API service binding while leaving Supabase as the live application authorization source. Cutover PR B then switches GraphQL/REST, web, desktop, E2E, and identity import together; it merges/deploys only after full-system tests and pre-production proof.

**Tech Stack:** Better Auth 1.6.x pinned exactly at implementation start, Better Auth Device Authorization and Bearer plugins, Cloudflare Workers/D1/Service Bindings, Drizzle ORM/Drizzle Kit, SvelteKit 2/Svelte 5, Tauri 2/Rust, Vitest, Playwright, WDIO, WireMock.

**Spec:** `docs/superpowers/specs/2026-08-18-better-auth-d1-migration-design.md`

## Global Constraints

- [ ] Track both implementation PRs under HPA-644.
- [ ] At Task 1 start, select the then-current stable `1.6.x` patch and pin `better-auth` and npm package `auth` to that same exact version.
- [ ] Do not jump to Better Auth 1.7.x during this migration without revalidating schema, account, Device Authorization, Bearer, and callback contracts.
- [ ] `auth` is intentionally the Better Auth CLI package; do not replace it with `@better-auth/cli` by assumption.
- [ ] Use request-scoped `drizzle(env.DB, { schema })` plus the official Drizzle adapter with `provider: 'sqlite'`.
- [ ] Keep Better Auth schema in `packages/dtx-api`; do not add it to `packages/common/src/lib/server/db/schema.ts`.
- [ ] Keep Wrangler D1 migrations as the only production migration executor; next migration is `0008_better_auth.sql`.
- [ ] Preserve every existing Supabase UUID used by application ownership rows.
- [ ] Do not add dual-auth application authorization, OAuth Provider, JWT/JWKS, API keys, another Worker/database, custom device protocol, FKs to auth users, or bcrypt compatibility.
- [ ] Do not preserve active Supabase sessions or old desktop access/refresh-token storage.
- [ ] Keep Google linking explicit and signup disabled.
- [ ] Keep Google Drive OAuth independent from application Google Auth.
- [ ] Use `DTX_WEB_URL` as the only application-auth trusted web origin.
- [ ] Keep `CORS_ALLOWED_ORIGINS` for CORS only.
- [ ] Use distinct `AUTH_COOKIE_PREFIX` values for production, pre-production, and local development.
- [ ] Preserve multiple Set-Cookie values; never flatten through `headers.get('set-cookie')`.
- [ ] Keep `SessionValidationStatus = valid | invalid | not-configured` on desktop.
- [ ] Preserve the existing feature-gated debug-only desktop E2E auth seam, reshaped for Better Auth.
- [ ] Production identity import/deploy remains an operator-runbook action, not an implementation-plan task.
- [ ] Write failing tests before behavior changes and keep each task compiling before commit.

## Delivery Boundary

### Foundation PR A

Tasks 1-3 are additive and independently deployable. They may create Better Auth tables/endpoints, but `verifyToken()` remains the only authorization source for existing GraphQL/REST application data.

After Task 3, deploy PR A to pre-production and prove the migration, handler, cookie configuration, neutral resolver tests, and service binding before merging.

### Cutover PR B

Tasks 4-15 perform the application cutover. The branch may be temporarily cross-component-inconsistent between commits; do not deploy it mid-task. Merge/deploy only after Task 15 passes.

---

# Foundation PR A

## Task 1: Select/pin Better Auth 1.6.x and generate the D1 auth schema

**Files:**

- Modify: `packages/dtx-api/package.json`
- Modify: `bun.lock`
- Create: `packages/dtx-api/src/auth/options.ts`
- Create: `packages/dtx-api/src/auth/auth.cli.ts`
- Create: `packages/dtx-api/src/auth/schema.ts`
- Create: `packages/dtx-api/src/auth/schema.test.ts`
- Create: `packages/dtx-api/drizzle.auth.config.ts`
- Create: `packages/dtx-api/d1-migrations/0008_better_auth.sql`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `.env.example`

**Interfaces:**

- Produces `createAuthOptions(config)` for Task 2.
- Produces generated `authSchema` and `0008_better_auth.sql`.
- Adds `DTX_WEB_URL`, `AUTH_COOKIE_DOMAIN`, and `AUTH_COOKIE_PREFIX` to runtime configuration.

- [ ] **Step 1: Verify the implementation-time 1.6.x patch.**

Check Better Auth release/tag state and inspect changes since the planning version. Confirm the selected 1.6.x patch still exposes the required Device Authorization, Bearer, Drizzle adapter, cookiePrefix, trustedOrigins, rateLimit customRules, and CLI schema-generation APIs.

Record the exact version in the PR description/runbook.

- [ ] **Step 2: Add a failing schema contract test.**

Assert generated schema/SQL include Better Auth core tables, Device Authorization tables, database rate-limit table, text user IDs, and expected foreign keys.

```bash
bun run --filter=dtx-api test -- src/auth/schema.test.ts
```

Expected: FAIL because schema/migration do not exist.

- [ ] **Step 3: Install matching exact packages.**

If the selected patch is `1.6.X`:

```bash
cd packages/dtx-api
bun add --exact better-auth@1.6.X
bun add drizzle-orm@^0.45.2
bun add --dev --exact auth@1.6.X
bun add --dev drizzle-kit
cd ../..
```

The package named `auth` is the Better Auth CLI.

- [ ] **Step 4: Define shared options.**

`createAuthOptions(config)` must include:

```ts
const trustedWebOrigin = new URL(config.webURL).origin;

return {
	baseURL: config.baseURL,
	secret: config.secret,
	trustedOrigins: [trustedWebOrigin],
	emailAndPassword: {
		enabled: true,
		disableSignUp: true
	},
	socialProviders: {
		google: {
			clientId: config.googleClientId,
			clientSecret: config.googleClientSecret,
			disableSignUp: true,
			disableImplicitSignUp: true
		}
	},
	account: {
		accountLinking: {
			enabled: true,
			disableImplicitLinking: true
		}
	},
	advanced: {
		cookiePrefix: config.cookiePrefix,
		crossSubDomainCookies: config.cookieDomain
			? { enabled: true, domain: config.cookieDomain }
			: { enabled: false },
		ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
	},
	rateLimit: {
		enabled: true,
		storage: 'database',
		customRules: {
			'/get-session': false
		}
	},
	plugins: [
		deviceAuthorization({
			verificationUri: `${config.webURL}/app/desktop-auth`,
			validateClient: (clientId) => clientId === 'dtx-desktop'
		}),
		bearer()
	]
};
```

Keep Better Auth CSRF/origin checks enabled.

Do not use `CORS_ALLOWED_ORIGINS` in Better Auth options.

- [ ] **Step 5: Generate schema with the pinned CLI.**

Add scripts using the selected exact CLI:

```json
{
	"auth:schema:generate": "auth generate --config src/auth/auth.cli.ts --output src/auth/schema.ts --adapter drizzle --dialect sqlite --yes",
	"auth:schema:export": "drizzle-kit export --config drizzle.auth.config.ts --sql=true",
	"auth:schema:check": "bun run auth:schema:generate && git diff --exit-code -- src/auth/schema.ts"
}
```

Run generation and review output; do not hand-maintain Better Auth columns.

- [ ] **Step 6: Export flat Wrangler-compatible SQL.**

Configure `drizzle.auth.config.ts`, export SQL, review it, and commit as `0008_better_auth.sql`. Do not add a runtime Drizzle migration runner.

- [ ] **Step 7: Add environment values.**

Add to `Env`:

```ts
BETTER_AUTH_URL: string;
BETTER_AUTH_SECRET: string;
DTX_WEB_URL: string;
AUTH_COOKIE_DOMAIN?: string;
AUTH_COOKIE_PREFIX: string;
GOOGLE_AUTH_CLIENT_ID: string;
GOOGLE_AUTH_CLIENT_SECRET: string;
```

Wrangler values:

```text
prod:     DTX_WEB_URL=https://dtx.hapadona.com
          AUTH_COOKIE_DOMAIN=dtx.hapadona.com
          AUTH_COOKIE_PREFIX=dtx

pre-prod: DTX_WEB_URL=https://pre-prod.dtx.hapadona.com
          AUTH_COOKIE_DOMAIN=pre-prod.dtx.hapadona.com
          AUTH_COOKIE_PREFIX=dtx-preprod

local:    DTX_WEB_URL=http://localhost:5173
          AUTH_COOKIE_DOMAIN omitted
          AUTH_COOKIE_PREFIX=dtx-local
```

`BETTER_AUTH_SECRET` and `GOOGLE_AUTH_CLIENT_SECRET` remain Wrangler secrets. Keep Supabase vars temporarily because application authorization still uses them in PR A.

- [ ] **Step 8: Verify schema/local D1.**

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api test -- src/auth/schema.test.ts
bun run --filter=dtx-api check
bun run packages/e2e-web/setup/prepare-stack.ts
```

- [ ] **Step 9: Commit.**

```bash
git add packages/dtx-api/package.json bun.lock \
  packages/dtx-api/src/auth packages/dtx-api/drizzle.auth.config.ts \
  packages/dtx-api/d1-migrations/0008_better_auth.sql \
  packages/dtx-api/src/env.ts packages/dtx-api/wrangler.jsonc .env.example
git commit -m "feat(auth): add Better Auth D1 schema"
```

---

## Task 2: Mount Better Auth and make CORS credential-capable

**Files:**

- Create: `packages/dtx-api/src/auth/auth.ts`
- Create: `packages/dtx-api/src/auth/auth.test.ts`
- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-api/src/lib/cors.ts`
- Modify: `packages/dtx-api/src/lib/cors.test.ts`

**Interfaces:**

- Produces request-scoped `createAuth(env)` for Task 3.
- Exports the existing `getAllowedOrigins(env)` only for CORS.
- Keeps existing application GraphQL/REST auth on `verifyToken()`.

- [ ] **Step 1: Add failing auth-router/CORS tests.**

Cover:

1. GET/POST `/api/auth/*` route to Better Auth;
2. unrelated GraphQL/REST still route normally;
3. allowed preflight echoes exact Origin + credentials true;
4. allowed normal response echoes exact Origin + credentials true;
5. denied/missing Origin receives no credentialed CORS grant;
6. two distinct Set-Cookie values survive `withCors()`.

- [ ] **Step 2: Make both existing CORS call sites credentialed.**

In `handlePreflight()` for an allowed origin:

```ts
headers['Access-Control-Allow-Origin'] = origin;
headers['Access-Control-Allow-Credentials'] = 'true';
headers.Vary = 'Origin';
```

In `withCors()` for an allowed origin:

```ts
headers.set('Access-Control-Allow-Origin', origin);
headers.set('Access-Control-Allow-Credentials', 'true');
appendVary(headers, 'Origin');
```

Leave `CORS_ALLOWED_ORIGINS` parsing/caching otherwise unchanged.

- [ ] **Step 3: Keep `withCors()` structure unless the multi-cookie test fails.**

Current code starts from:

```ts
const headers = new Headers(response.headers);
```

If Step 1 proves two Set-Cookie values survive, keep this copy path. Do not replace it with `headers.get('set-cookie')`.

If the supported Workers test runtime proves cardinality is lost, implement the smallest multi-cookie-preserving copy and keep the regression test.

- [ ] **Step 4: Create request-scoped Better Auth.**

```ts
export const createAuth = (env: Env) =>
	betterAuth({
		...createAuthOptions({
			baseURL: env.BETTER_AUTH_URL,
			webURL: env.DTX_WEB_URL,
			cookieDomain: env.AUTH_COOKIE_DOMAIN,
			cookiePrefix: env.AUTH_COOKIE_PREFIX,
			googleClientId: env.GOOGLE_AUTH_CLIENT_ID,
			googleClientSecret: env.GOOGLE_AUTH_CLIENT_SECRET,
			secret: env.BETTER_AUTH_SECRET
		}),
		database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
			provider: 'sqlite'
		})
	});
```

- [ ] **Step 5: Mount handler before GraphQL/REST.**

Handle CORS preflight first, then GET/POST `/api/auth/*`, then existing GraphQL/REST. Wrap auth responses with `withCors()`.

Do not add Hono.

- [ ] **Step 6: Verify and commit.**

```bash
bun run --filter=dtx-api test -- src/auth/auth.test.ts src/index.test.ts src/lib/cors.test.ts
bun run --filter=dtx-api check

git add packages/dtx-api/src/auth/auth.ts packages/dtx-api/src/auth/auth.test.ts \
  packages/dtx-api/src/index.ts packages/dtx-api/src/index.test.ts \
  packages/dtx-api/src/lib/cors.ts packages/dtx-api/src/lib/cors.test.ts
git commit -m "feat(auth): mount Better Auth API"
```

---

## Task 3: Add an unwired neutral session resolver and production API service binding

**Files:**

- Create: `packages/dtx-api/src/auth/session.ts`
- Create: `packages/dtx-api/src/auth/session.test.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify generated/declared Cloudflare binding types if required by `cf-typegen`

**Interfaces:**

- Produces `resolveAuthSession(request, env)` for Cutover Task 4.
- Produces minimal `ApiAuthUser = { id: string }`.
- Does **not** modify `packages/dtx-api/src/context.ts` or REST routes yet.
- Adds root `API -> dtx-api` service binding for production SSR.

- [ ] **Step 1: Add failing resolver tests.**

Cover:

1. valid cookie GET without Origin;
2. valid cookie POST with exact `new URL(DTX_WEB_URL).origin`;
3. cookie POST with missing Origin => null;
4. cookie POST with different Origin => null;
5. valid Bearer POST without Origin => valid;
6. malformed Bearer => null;
7. missing credentials => null;
8. revoked/expired session => null;
9. Better Auth exception => null.

- [ ] **Step 2: Implement canonical trusted-origin classification.**

```ts
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const trustedWebOrigin = new URL(env.DTX_WEB_URL).origin;
const hasBearer = request.headers.get('authorization')?.startsWith('Bearer ') === true;
const hasCookie = request.headers.has('cookie');

if (
	!hasBearer &&
	hasCookie &&
	UNSAFE_METHODS.has(request.method) &&
	request.headers.get('origin') !== trustedWebOrigin
) {
	return null;
}
```

Then call `createAuth(env).api.getSession({ headers: request.headers })` and normalize to local types.

Do not import or consult `CORS_ALLOWED_ORIGINS` here.

- [ ] **Step 3: Keep the live Supabase verifier wired.**

Do not edit `context.ts`, upload/download routes, or delete `verifyToken.ts` in PR A.

Add a source-level assertion/test if helpful so a future edit cannot accidentally wire Better Auth before the cutover PR.

- [ ] **Step 4: Add the production service binding.**

In the root production stanza of `packages/dtx-web/wrangler.jsonc` add:

```json
"services": [{ "binding": "API", "service": "dtx-api" }]
```

Keep existing pre-prod bindings:

```text
pre-prod           -> dtx-api-pre-prod
pre-prod-prod-data -> dtx-api-pre-prod-prod-data
```

- [ ] **Step 5: Verify and commit.**

```bash
bun run --filter=dtx-api test -- src/auth/session.test.ts
bun run --filter=dtx-api check
bun run --filter=dtx-web check
bun run --filter=dtx-web cf-typegen

git add packages/dtx-api/src/auth/session.ts packages/dtx-api/src/auth/session.test.ts \
  packages/dtx-web/wrangler.jsonc packages/dtx-web/worker-configuration.d.ts
git commit -m "feat(auth): add Better Auth session foundation"
```

If `cf-typegen` writes a different tracked type file, stage that exact generated file instead of inventing `worker-configuration.d.ts`.

---

## Foundation PR A gate

- [ ] Rebase on current `main`.
- [ ] Run Tasks 1-3 verification again.
- [ ] Confirm the diff contains no GraphQL/REST authorization switch and no Supabase deletion.
- [ ] Deploy D1 migration/API/web config to pre-production.
- [ ] Verify `0008_better_auth.sql` applies cleanly.
- [ ] Verify `/api/auth/get-session` anonymous behavior and Device Authorization code issuance/validation behavior expected for the pinned patch.
- [ ] Verify credentialed CORS from the exact pre-production web origin.
- [ ] Verify localhost may remain in `CORS_ALLOWED_ORIGINS` without appearing in Better Auth `trustedOrigins`.
- [ ] Verify the production service-binding config resolves `dtx-api` in Wrangler validation.
- [ ] Record non-secret smoke evidence in PR A/HPA-644.
- [ ] Merge PR A before starting PR B from updated `main`.

---

# Cutover PR B

## Task 4: Switch GraphQL and REST authorization to Better Auth

**Files:**

- Modify: `packages/dtx-api/src/context.ts`
- Modify: `packages/dtx-api/src/schema/builder.ts`
- Modify: `packages/dtx-api/src/schema/builder.test.ts`
- Modify: `packages/dtx-api/src/rest/upload.ts`
- Modify: `packages/dtx-api/src/rest/upload.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.test.ts`
- Delete after all callers move: `packages/dtx-api/src/auth/verifyToken.ts`
- Delete after all callers move: `packages/dtx-api/src/auth/verifyToken.test.ts`

**Interfaces:**

- Consumes Foundation `resolveAuthSession()`.
- Makes `ApiAuthUser = { id: string }` the application authorization boundary.

- [ ] **Step 1: Retarget API route/context tests first.**

For GraphQL and protected REST prove:

- valid Better Auth cookie session;
- valid desktop Bearer session;
- unsafe cookie missing/wrong Origin is unauthorized;
- Bearer needs no Origin;
- anonymous/invalid remains existing unauthorized behavior.

- [ ] **Step 2: Replace `verifyToken()` callers.**

Use `resolveAuthSession(request, env)` in `context.ts` and protected REST routes. Preserve existing Pothos auth scopes/status/error semantics.

- [ ] **Step 3: Narrow API user shape.**

Use:

```ts
type ApiAuthUser = { id: string };
```

Do not export Better Auth or Supabase provider-specific user/session types into schema/services.

- [ ] **Step 4: Delete old verifier after search is clean.**

```bash
rg -n "verifyToken|SUPABASE_ANON_KEY" packages/dtx-api/src
```

Delete `verifyToken.ts` only when no application caller remains.

- [ ] **Step 5: Verify and commit.**

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check

git add packages/dtx-api/src
git commit -m "refactor(auth): use Better Auth application sessions"
```

---

## Task 5: Remove the custom magic-link/desktop web handoff

**Files:**

- Delete: `packages/dtx-api/src/services/magicLink.ts`
- Delete: `packages/dtx-api/src/services/magicLink.test.ts`
- Delete: `packages/dtx-api/src/schema/auth.ts`
- Delete: `packages/dtx-api/src/schema/auth.test.ts`
- Modify: `packages/dtx-api/src/schema/index.ts`
- Delete: `packages/dtx-web/src/lib/api/operations/auth.graphql`
- Delete: `packages/dtx-web/src/lib/api/auth.ts`
- Delete: `packages/dtx-web/src/lib/api/auth.test.ts`
- Modify/regenerate: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/app-page.test.ts`
- Delete: `packages/dtx-web/src/routes/(app)/app/app-page-redirect.test.ts`
- Modify: `packages/dtx-api/package.json`

- [ ] **Step 1: Change schema expectations first.**

Assert `generateMagicLink` disappears, remove schema registration, regenerate GraphQL schema/client output.

- [ ] **Step 2: Remove server magic-link code.**

Delete service, mutation, tests, magic-link service-role usage, callback allowlist, magic-link KV keys, and local `MAGIC_LINK_HOURLY_LIMIT` override.

Keep `RATE_LIMIT_API` because downloads still use it.

- [ ] **Step 3: Remove `/app?redirect=desktop` UI handoff.**

Remove magic-link generation and callback URL forwarding from the dashboard. Do not add Device Authorization here; Task 9 adds `/app/desktop-auth`.

- [ ] **Step 4: Verify and commit.**

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run --filter=dtx-api test
bun run --filter=dtx-web test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
```

Commit server/schema/generated-web removals together.

---

## Task 6: Replace SvelteKit Supabase session plumbing

**Files:**

- Create: `packages/dtx-web/src/lib/auth/client.ts`
- Create: `packages/dtx-web/src/lib/auth/session.ts`
- Create matching tests
- Rewrite: `packages/dtx-web/src/hooks.server.ts`
- Modify: `packages/dtx-web/src/app.d.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.server.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.ts`
- Modify: `packages/dtx-web/src/routes/+layout.svelte`
- Modify related layout/hook tests

**Interfaces:**

- Reuses `safeAppRedirectPath()` from `$lib/auth/google.ts`; no second redirect helper.
- Uses production/pre-prod `event.platform.env.API` service binding when available.
- Falls back to `PUBLIC_DTX_API_URL` for local Vite/non-Workers execution.

- [ ] **Step 1: Add failing session/guard tests.**

Cover anonymous/authenticated session lookup, service binding preference, public fallback, forwarded cookies, two Set-Cookie propagation, protected `/app` redirect, safe `next`, authenticated `/login` redirect, and API failure.

- [ ] **Step 2: Add Better Auth Svelte client.**

Point it at `PUBLIC_DTX_API_URL`, set `credentials: 'include'`, and register `deviceAuthorizationClient()`.

- [ ] **Step 3: Implement server session lookup without a public production round-trip.**

If `event.platform?.env.API` exists, call its `fetch()` handler with `/api/auth/get-session`. Otherwise fetch `PUBLIC_DTX_API_URL`.

Forward the incoming Cookie header.

For service-binding unsafe GraphQL later, the external trusted origin is `event.url.origin`; session GET itself remains read-only and does not require Origin.

- [ ] **Step 4: Preserve every Set-Cookie value.**

Use the runtime multi-cookie API and append each raw Set-Cookie value to the SvelteKit response. Never use a single `headers.get('set-cookie')` value.

- [ ] **Step 5: Delete old desktop web exceptions.**

Remove from `hooks.server.ts`:

```text
redirect=desktop
desktop_callback
DTXDesktopApp user-agent/x-requested-with CSRF bypass
```

Keep normal SvelteKit form-CSRF behavior and `/app` guard.

- [ ] **Step 6: Simplify layout data.**

Remove Supabase clients/subscriptions/invalidation. Return neutral user/session plus existing locale data.

- [ ] **Step 7: Verify and commit.**

Run focused hook/layout tests, full web tests, and `bun run --filter=dtx-web check`.

---

## Task 7: Move web sign-in, logout, and Google linking to Better Auth

**Files:**

- Modify: `packages/dtx-web/src/lib/auth/google.ts`
- Modify: `packages/dtx-web/src/lib/auth/google.test.ts`
- Rewrite: `packages/dtx-web/src/routes/(login)/login/+page.svelte`
- Delete/replace: `packages/dtx-web/src/routes/(login)/login/+page.server.ts`
- Retarget: `packages/dtx-web/src/routes/(login)/login/page.server.test.ts`
- Delete: `packages/dtx-web/src/routes/auth/callback/+server.ts`
- Retarget/delete after migration: `packages/dtx-web/src/routes/auth/callback/server.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/+layout.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/layout.svelte.test.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/account/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/account/account-page.test.ts`

- [ ] **Step 1: Move existing redirect/error assertions before route deletion.**

Retarget existing callback/login tests for safe `/app` paths, external/protocol-relative rejection, provider cancellation/failure sanitization, existing-account-only copy, and explicit-link conflict copy.

- [ ] **Step 2: Implement password sign-in.**

```ts
await authClient.signIn.email({ email, password });
window.location.assign(safeAppRedirectPath(next));
```

Preserve `/app` as the missing-next default.

- [ ] **Step 3: Implement Google sign-in/linking.**

Use `signIn.social({ provider: 'google', callbackURL })` for login and `linkSocial({ provider: 'google', callbackURL })` on the account page. Keep implicit linking/signup disabled.

- [ ] **Step 4: Delete old SvelteKit OAuth callback.**

Better Auth `/api/auth/callback/google` is authoritative. Delete only old Supabase callback URL builders after callers/tests move.

- [ ] **Step 5: Implement logout and verify.**

Call `authClient.signOut()` then full-navigate to `/login`. Run web auth tests/typecheck and commit.

---

## Task 8: Convert every web API call from Bearer to cookies

**Files:**

- Modify: `packages/dtx-web/src/lib/api/transport.ts`
- Modify: `packages/dtx-web/src/lib/api/transport.test.ts`
- Modify: `packages/dtx-web/src/lib/api/client.ts`
- Modify: `packages/dtx-web/src/lib/api/client.test.ts`
- Modify: `packages/dtx-web/src/lib/api/download.ts`
- Modify: `packages/dtx-web/src/lib/api/download.test.ts`
- Modify: `packages/dtx-web/src/lib/api/index.test.ts`
- Modify token-mocking tests including `chart.test.ts`, `score.test.ts`, `user.test.ts`
- Modify affected bulk-download component/helper tests
- Delete only at end: `packages/dtx-web/src/lib/api/token.ts`
- Delete only at end: `packages/dtx-web/src/lib/api/token.test.ts`

- [ ] **Step 1: Add browser GraphQL tests.**

Assert browser GraphQL uses `credentials: 'include'` and no Authorization header.

- [ ] **Step 2: Replace token-shaped `ClientCtx`.**

```ts
export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	cookieHeader?: string | null;
	origin?: string | null;
};
```

- [ ] **Step 3: Rewrite service-binding GraphQL.**

Forward:

```text
content-type: application/json
cookie: <incoming cookie>
origin: <canonical DTX web origin>
```

The Origin must be the external trusted web origin, not an internal service-binding URL.

- [ ] **Step 4: Rewrite download helpers.**

`downloadSimfile()` fetches with `credentials: 'include'`. `bulkDownloadHeaders()` stops adding Bearer; the actual bulk fetch also sets `credentials: 'include'`.

- [ ] **Step 5: Remove all token mocks/imports before deleting helper.**

```bash
rg -n "getAccessTokenOrNull|getAccessToken|tokenFromSession|from './token'|mock.*token" packages/dtx-web/src
```

Delete `token.ts` only after the search is clean.

- [ ] **Step 6: Verify and commit.**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check
```

---

## Task 9: Add the desktop Device Authorization approval page

**Files:**

- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/+page.svelte`
- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/desktop-auth-page.test.ts`
- Modify: `packages/dtx-web/src/lib/auth/client.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`

- [ ] **Step 1: Add failing approval-page tests.**

Cover prefilled/manual code, normalization, claim success, invalid/expired code, approve, deny, double-submit prevention, and unauthenticated return-through-login.

- [ ] **Step 2: Implement claim.**

Normalize code by trim/remove dashes/uppercase, call the pinned Better Auth Device Authorization verification method, and rely on `/app` guard for auth/next.

- [ ] **Step 3: Implement explicit approve/deny.**

Show user code and fixed `dtx-desktop` client identity. Disable both buttons while processing. Show terminal success/denial text; never redirect to a desktop callback.

- [ ] **Step 4: Verify and commit.**

Run page/layout tests plus web typecheck.

---

## Task 10: Replace native Supabase auth with Device Authorization and retarget native E2E auth

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/device_auth.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/device_auth_tests.rs`
- Rewrite: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/e2e.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/e2e_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Regenerate: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

**Interfaces:**

- `device_auth.rs` is HTTP protocol only and WireMock-testable.
- `auth.rs` retains `AuthState`, session generation/epoch, existing command names, and e2e/debug seed path.
- `SessionData` becomes Better Auth-shaped `{ sessionToken, user }`.

- [ ] **Step 1: Add WireMock protocol tests.**

Cover code request, display-safe response, pending, slow-down, approval, denial, expiry, invalid grant, malformed body, timeout, and network failure. Confirm `device_code` never crosses Tauri IPC.

- [ ] **Step 2: Implement protocol-only module.**

Use exact wire fields of the Task-1 pinned Better Auth patch. Centralize API base URL construction and never log device/session tokens.

- [ ] **Step 3: Define native DTOs.**

Add `DesktopAuthUser`, `DesktopAuthSession`, `DeviceAuthorizationAttempt` in `api_contracts.rs` with existing `ts-rs` export target.

Attempt exposes only:

```text
userCode
verificationUri
verificationUriComplete
expiresAt
```

- [ ] **Step 4: Preserve `AuthState`/Drive epoch semantics.**

Keep authenticated user ID, generation counter, and `AuthSessionEpoch`. Replace Supabase JSON/refresh state with typed opaque session state and one pending native device code.

- [ ] **Step 5: Retarget `SessionData` and native E2E validation.**

Replace:

```text
access_token
refresh_token
user
```

with:

```text
sessionToken
user
```

Update `e2e_session_matches_user()` to require the expected user ID and a non-empty session token only.

Update `AuthState::for_e2e_user()` and `src/tests/e2e_tests.rs` so no fake Supabase refresh token remains.

Keep this path gated by `feature = "e2e"` + `debug_assertions`; it must remain impossible in release binaries.

- [ ] **Step 6: Add/retarget commands.**

Add:

```text
begin_device_authorization
poll_device_authorization
cancel_device_authorization
```

Retarget without renaming:

```text
validate_session
get_current_session
logout_session
open_external_url
```

`validate_session` retains `Valid | Invalid | NotConfigured`.

- [ ] **Step 7: Replace API token access.**

Rename `ensure_valid_access_token` to `current_session_token`. Remove JWT expiry parsing, refresh calls, refresh lock, and refresh events. Existing API calls continue `Authorization: Bearer <opaque-session-token>`.

- [ ] **Step 8: Remove production callback machinery.**

Delete auth deep-link handlers/queues, loopback server, magic-link parsing, callback validation, Supabase verify/refresh/logout code, JWT decoder, auth events. Keep single-instance behavior; remove deep-link plugin only if no non-auth use remains.

- [ ] **Step 9: Verify and commit.**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
bun run gen:native-types
```

Commit native/generated changes together.

---

## Task 11: Rewire desktop renderer and every existing desktop E2E session seed

**Files:**

- Rewrite: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Rename/rewrite: `packages/dtx-desktop/src/renderer/src/services/supabaseService.ts` → `sessionStorage.ts`
- Rename/rewrite matching test
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/App.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/authService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/env.d.ts`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/dtx-desktop/src-tauri/tauri.conf.json`
- Modify: `packages/dtx-desktop/src-tauri/tauri.dev.conf.json`
- Modify: root `package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/support/standalone-session.ts`
- Modify: `packages/e2e-desktop/support/standalone-session.test.mjs`
- Modify: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs`

- [ ] **Step 1: Add renderer lifecycle tests.**

Cover start, displayed code, browser open, poll success, persistence, restore valid, restore invalid cleanup, restore not-configured preserving storage, logout cleanup, cancellation/retry, and browser-open fallback.

- [ ] **Step 2: Replace renderer persistence.**

Store one neutral object:

```ts
{
	sessionToken: string;
	user: DesktopAuthUser;
}
```

Delete old `auth_access_token`, `auth_refresh_token`, and `auth_user_data` values when encountered; do not migrate them.

- [ ] **Step 3: Rewrite renderer auth service.**

After `beginDeviceAuthorization`, call existing `openExternalUrl(verificationUriComplete)`, show manual URI/code fallback, and poll. Remove magic-link/session-refreshed listeners.

- [ ] **Step 4: Keep tri-state restore behavior.**

`not-configured` preserves stored Better Auth session and surfaces build/config error. `invalid` clears it.

- [ ] **Step 5: Retarget WDIO/standalone E2E injection.**

Keep `DTX_E2E_DRUMERY_USER_ID`; it still identifies the debug-only seeded user.

Update renderer/localStorage setup in `google-drive-upload.e2e.ts` and `google-drive-crash-recovery.ts` to write the new neutral session object instead of Supabase access/refresh keys.

Update `standalone-session.test.mjs` and `google-drive-crash-recovery.test.mjs` where they assert the old auth storage/env shape.

Do not add an API test-auth endpoint; reuse the native e2e/debug seed path from Task 10.

- [ ] **Step 6: Remove callback/deep-link configuration.**

Remove:

```text
DTX_DESKTOP_AUTH_CALLBACK_PORT
VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT
PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL
```

Simplify dev scripts/topology tests. Remove auth URI schemes only after no non-auth use remains.

- [ ] **Step 7: Verify and commit.**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
bun run --filter=dtx-e2e-desktop check
bun test packages/e2e-desktop/support/standalone-session.test.mjs \
  packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-features
bun run gen:native-types
```

---

## Task 12: Add ID-preserving identity import and Better Auth web E2E seed

**Files:**

- Create: `packages/dtx-api/src/scripts/migrate-supabase-auth.ts`
- Create: `packages/dtx-api/src/scripts/migrate-supabase-auth.test.ts`
- Create sanitized fixtures under `packages/dtx-api/src/scripts/fixtures/`
- Modify: `packages/dtx-api/package.json`
- Delete: `packages/e2e-web/setup/create-local-supabase-user.ts`
- Create: `packages/e2e-web/setup/seed-better-auth-user.ts`
- Modify: `packages/e2e-web/setup/prepare-stack.ts`
- Modify: `packages/e2e-web/playwright.config.ts`
- Modify: `packages/e2e-web/test-config.ts`
- Modify: `packages/e2e-web/global.setup.ts`
- Modify: `packages/e2e-web/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Specify import invariants.**

Test exact UUID preservation, email/name/verification/timestamps, Google identity, no sessions/tokens, deterministic account IDs, SQL escaping, duplicate rejection, unsupported-provider rejection, and owner-ID reconciliation.

- [ ] **Step 2: Implement local-only import tool.**

Consume sanitized Supabase Admin export JSON and emit reviewed D1 SQL under ignored `tmp/auth-migration/`. Do not import `@supabase/supabase-js`; do not write remote D1 directly.

- [ ] **Step 3: Handle credential users without bcrypt compatibility.**

Require explicit replacement password input and hash it with the pinned Better Auth password helper. No replacement password means no credential account.

- [ ] **Step 4: Seed local Better Auth web user.**

After `prepare-stack.ts` applies every migration, seed Better Auth user/account rows into the same D1 using the fixed test UUID already used by application seed rows.

- [ ] **Step 5: Retarget Playwright env/setup and verify.**

Remove Supabase E2E URL/anon/service-role inputs. Keep fail-loud CI behavior for incomplete Better Auth test config. Run import tests, local stack prep, Playwright setup, and E2E typecheck.

---

## Task 13: Remove Supabase residue and obsolete typegen

**Files:**

- Modify: root `package.json`
- Modify: `turbo.json`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/common/package.json`
- Modify: `bun.lock`
- Delete: `packages/common/src/lib/types/supabase.types.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/dtx-web/.env.types-only`
- Modify: `packages/dtx-web/vitest.config.ts`
- Modify: `packages/dtx-desktop/vitest.config.ts`
- Modify: `.env.example`
- Modify affected mocks/tests/workflows
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run residue gate before edits.**

```bash
rg -n -i "@supabase|supabase|PUBLIC_SUPABASE|SUPABASE_" \
  packages package.json turbo.json .env.example CLAUDE.md __mocks__ .github
```

Historical migration docs and the one-shot import tool may describe Supabase as an input format; runtime/config/tests may not depend on it.

- [ ] **Step 2: Remove packages/types/mocks.**

Remove `@supabase/ssr`, `@supabase/supabase-js`, common peer dependency, generated Supabase types/exports, and provider mocks.

- [ ] **Step 3: Remove environment/workflow residue.**

Delete Supabase URL/anon/service-role variables, magic-link limit, callback vars, Turbo env entries, and old E2E secret requirements.

- [ ] **Step 4: Delete obsolete root typegen.**

Remove:

```text
package.json scripts.gen-types
turbo.json tasks.gen-types
```

Keep API GraphQL schema generation, dtx-web codegen, and root `gen:native-types`.

- [ ] **Step 5: Verify and commit.**

Run residue gate, lockfile/install check, all package typechecks, and unit tests.

---

## Task 14: Add E2E coverage and write/reconcile the production runbook

**Files:**

- Modify/create authenticated specs under `packages/e2e-web/`
- Modify/create desktop auth specs under `packages/e2e-desktop/`
- Revisit: `packages/e2e-desktop/wdio.conf.ts`
- Revisit: `packages/e2e-desktop/support/standalone-session.ts`
- Revisit: `packages/e2e-desktop/support/standalone-session.test.mjs`
- Revisit: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Revisit: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`
- Revisit: `packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs`
- Create: `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md`
- After PR #221 lands, modify its Zero Trust spec/plan/runbook documents

- [ ] **Step 1: Update web E2E.**

Cover password login, `/app` guard, authenticated GraphQL/score flow, authenticated download, logout, and invalid-session redirect without Supabase credentials.

- [ ] **Step 2: Cover real Device Authorization at API/web integration level.**

Against local API/D1: request code, authenticate browser, claim, approve, poll, validate user, and revoke. Cover deny and expiry.

Do not add a production or API-wide test-auth endpoint. It is acceptable to retain the existing native `e2e + debug_assertions` seed seam for WDIO desktop tests; that path is already compile-time excluded from release builds.

- [ ] **Step 3: Re-run desktop E2E session-shape audit.**

```bash
rg -n "auth_access_token|auth_refresh_token|auth_user_data|e2e-supabase|refresh_token|DTX_E2E_DRUMERY_USER_ID" \
  packages/e2e-desktop packages/dtx-desktop/src-tauri/src
```

Expected after intended debug-only identifiers are accounted for: no Supabase-shaped renderer session seed or fake refresh token remains.

- [ ] **Step 4: Update desktop E2E.**

Cover renderer auth state and authenticated desktop behavior using the debug-only native seed plus Better Auth-shaped `{ sessionToken, user }` storage. Keep one manual real-browser-open Device Authorization handoff check in the runbook because OS browser launch is outside stable WDIO coverage.

- [ ] **Step 5: Write production runbook.**

Include exact sections for backup/export, pinned version, cookie prefixes/domains, trusted web origins, service binding, Google callbacks, Wrangler secrets, Supabase Admin export, generated import SQL review, D1 order, owner reconciliation, deployment order, web matrix, desktop matrix, Access matrix, go/no-go, production cutover, Supabase-disable proof, and rollback.

Production actions remain operator instructions.

- [ ] **Step 6: Reconcile PR #221 documentation.**

Replace Supabase inner gate with Better Auth and `/login?redirect=desktop` callbacks with `/app/desktop-auth` Device Authorization. Preserve production `/app` operator policy, pre-prod Access behavior, and public API hostnames.

- [ ] **Step 7: Verify and commit.**

Run web E2E, desktop E2E, formatting, and `git diff --check`.

---

## Task 15: Full verification and pre-production cutover proof

**Files:**

- Modify only files required by failed verification.
- Update runbook with corrected non-secret assumptions/results.

- [ ] **Step 1: Run static/unit/Rust verification.**

```bash
bun run format
bun run lint
bun run check
bun run test
git diff --check
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
```

Do not run deleted root `gen-types`.

- [ ] **Step 2: Run generated-artifact gates.**

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run gen:native-types
git diff --exit-code
```

- [ ] **Step 3: Run auth/trust residue gates.**

Confirm:

```text
no runtime Supabase import/config
no getAccessTokenOrNull/token.ts
no desktop auth callback vars
no production auth deep-link/loopback/JWT/refresh code
no root/turbo Supabase gen-types
auth trustedOrigins comes from DTX_WEB_URL, not CORS_ALLOWED_ORIGINS
prod/pre-prod cookie prefixes differ
credentialed CORS true on preflight and normal responses
production dtx-web has API service binding
/get-session is exempt from DB-backed rate limiting
```

- [ ] **Step 4: Run E2E.**

```bash
bun run e2e:web
bun run e2e:desktop
```

Expected: PASS without Supabase credentials.

- [ ] **Step 5: Prove pre-production.**

Using the runbook:

- configure pre-prod Better Auth/Google secrets/callback;
- confirm `DTX_WEB_URL=https://pre-prod.dtx.hapadona.com`;
- confirm `AUTH_COOKIE_PREFIX=dtx-preprod`;
- apply D1 migration;
- generate/review/apply sanitized identity-import SQL to pre-prod only;
- reconcile every application owner ID;
- deploy API then web;
- verify SvelteKit SSR uses service binding;
- build desktop candidate pointed at pre-prod;
- execute password, Google, linking, GraphQL, upload/download, Device Authorization approve/deny/expiry, restore/logout, and Access checks;
- verify localhost CORS origins do not become Better Auth trusted origins;
- verify production `dtx.*` cookie is not interpreted as pre-production session;
- verify candidate no longer needs Supabase runtime access.

- [ ] **Step 6: Record evidence and stop before production.**

Record only non-secret outcomes. Production go/no-go requires all checks, exact owner reconciliation, callbacks/secrets, rollback artifacts, and reviewed runbook.

Do not run production `0008`, production identity import, production deploy, desktop publication, or credential removal from this task.

- [ ] **Step 7: Final repository verification.**

```bash
git status --short
git diff --check
```

Commit only verification-driven corrections.

## Risks

### Foundation/cutover drift

PR A intentionally adds unused Better Auth infrastructure while Supabase remains live. PR B must start from merged PR A and must not reintroduce a dual-auth application authorization path.

### Cookie collision

Production domain cookie scope includes nested pre-production hosts. Distinct `AUTH_COOKIE_PREFIX` values are required before browser Better Auth sessions are used.

### Origin confusion

`CORS_ALLOWED_ORIGINS` contains deployed pre-production localhost entries. It is never an auth trust list. `DTX_WEB_URL` is the only trusted application web origin.

### SSR hot path

Production session lookup must use the service binding, and `/get-session` must be exempt from DB rate limiting.

### Desktop E2E seam

Existing debug E2E currently assumes access + refresh tokens. Task 10/11 must migrate the seed and renderer storage before Task 15 runs `e2e:desktop`.

### Identity mismatch

No application ownership FK is added; exact import reconciliation is therefore a hard pre-production/production gate.

## Completion Definition

HPA-644 is ready for production operator execution when:

- [ ] Foundation PR A merged/deployed and additive pre-production proof passed.
- [ ] Cutover PR B static/type/unit/Rust/web-E2E/desktop-E2E gates pass.
- [ ] Better Auth/CLI are pinned to the same reviewed 1.6.x patch.
- [ ] D1 holds Better Auth core, Device Authorization, and rate-limit tables.
- [ ] Existing application owner UUIDs are preserved by import tooling.
- [ ] Password and Google web sign-in use Better Auth.
- [ ] Explicit linking works; implicit linking/signup remain disabled.
- [ ] `DTX_WEB_URL` is the auth trust origin; `CORS_ALLOWED_ORIGINS` is CORS-only.
- [ ] Production/pre-prod/local cookies have distinct prefixes.
- [ ] Credentialed CORS is enabled on preflight and normal responses.
- [ ] Multi-value Set-Cookie survives CORS and SvelteKit forwarding.
- [ ] Production SSR uses the `API -> dtx-api` service binding.
- [ ] `/get-session` does not use database-backed rate limiting.
- [ ] Browser GraphQL/REST/downloads use cookie sessions and unsafe-method canonical-Origin validation.
- [ ] Desktop uses Device Authorization + opaque Bearer sessions.
- [ ] Desktop retains valid/invalid/not-configured and Drive session-epoch semantics.
- [ ] Desktop E2E uses Better Auth-shaped `{ sessionToken, user }` and no fake refresh token.
- [ ] No production auth magic-link/deep-link/loopback/JWT/refresh-token machinery remains.
- [ ] No active package/config/test depends on Supabase.
- [ ] Obsolete root/turbo Supabase `gen-types` is removed.
- [ ] Full pre-production acceptance passes.
- [ ] Production runbook is ready for separate operator execution.
