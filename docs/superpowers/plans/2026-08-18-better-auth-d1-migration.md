# Better Auth and D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Supabase from DTXWeb by hosting Better Auth in `dtx-api`, storing auth data in the existing Cloudflare D1 database, moving web authentication to cookies, and replacing desktop magic-link/deep-link authentication with Device Authorization plus opaque Bearer sessions.

**Architecture:** `dtx-api` owns one request-scoped Better Auth instance, the official Better Auth Drizzle adapter, generated auth schema, D1 migration, and one neutral session-resolution seam. `dtx-web` uses Better Auth cookies and hosts `/app/desktop-auth`; unsafe cookie-authenticated API requests are accepted only from the existing `CORS_ALLOWED_ORIGINS` set. DTX Desktop requests a device code, opens the browser, polls natively, stores one opaque session token, and keeps the existing `valid | invalid | not-configured` restore contract.

**Tech Stack:** Better Auth 1.6.25, Device Authorization and Bearer plugins, Cloudflare Workers, D1, Drizzle ORM/Drizzle Kit, SvelteKit 2/Svelte 5, Tauri 2/Rust, Vitest, Playwright, WireMock.

**Spec:** `docs/superpowers/specs/2026-08-18-better-auth-d1-migration-design.md`

## Global Constraints

- [ ] Implement HPA-644 in **one implementation PR**. The tasks below are reviewable commits/checkpoints, not separate PRs.
- [ ] Use Better Auth **1.6.25 exactly**; do not adopt a prerelease in this migration.
- [ ] Follow Better Auth's Cloudflare pattern: request-scoped `drizzle(env.DB, { schema })` plus `drizzleAdapter(..., { provider: 'sqlite' })`.
- [ ] Keep Better Auth schema in `packages/dtx-api`; do not add it to `packages/common/src/lib/server/db/schema.ts`.
- [ ] Keep Wrangler D1 migrations as the only production migration executor; next migration is `0008_better_auth.sql`.
- [ ] Preserve every existing Supabase UUID used by application ownership rows.
- [ ] Do not add dual-auth mode, OAuth Provider, JWT/JWKS, API keys, another Worker/database, custom device protocol, or bcrypt compatibility.
- [ ] Do not preserve active Supabase sessions or old desktop access/refresh-token storage.
- [ ] Keep Google linking explicit and signup disabled.
- [ ] Keep Google Drive OAuth independent from application Google Auth.
- [ ] Reuse `CORS_ALLOWED_ORIGINS` as Better Auth `trustedOrigins`; do not create a parallel origin setting.
- [ ] Preserve all `Set-Cookie` values when a Worker/SvelteKit response is reconstructed.
- [ ] Keep `SessionValidationStatus = valid | invalid | not-configured` on desktop.
- [ ] Production data import/deploy remains an operator-runbook action, not an implementation-plan task.
- [ ] Write failing tests before each behavior change and keep each task compiling before commit.

---

## Task 1: Pin Better Auth and generate the D1 auth schema

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
- Produces generated `authSchema` plus `0008_better_auth.sql` for runtime/E2E.
- Keeps `CORS_ALLOWED_ORIGINS` as the canonical trusted-origin input.

- [ ] **Step 1: Write the failing schema contract test.**

Assert that generated schema/SQL contain Better Auth core tables, Device Authorization, database rate limiting, text user IDs, and the expected foreign keys.

```bash
bun run --filter=dtx-api test -- src/auth/schema.test.ts
```

Expected: FAIL because the schema/migration do not exist.

- [ ] **Step 2: Install pinned dependencies.**

```bash
cd packages/dtx-api
bun add --exact better-auth@1.6.25
bun add drizzle-orm@^0.45.2
bun add --dev --exact auth@1.6.25
bun add --dev drizzle-kit
cd ../..
```

Do not add a third-party Cloudflare adapter.

- [ ] **Step 3: Define shared Better Auth options.**

`createAuthOptions(config)` includes:

```ts
emailAndPassword: {
  enabled: true,
  disableSignUp: true,
},
socialProviders: {
  google: {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    disableSignUp: true,
    disableImplicitSignUp: true,
  },
},
account: {
  accountLinking: {
    enabled: true,
    disableImplicitLinking: true,
  },
},
trustedOrigins: config.trustedOrigins,
advanced: {
  crossSubDomainCookies: config.cookieDomain
    ? { enabled: true, domain: config.cookieDomain }
    : { enabled: false },
  ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
},
rateLimit: {
  enabled: true,
  storage: 'database',
},
plugins: [
  deviceAuthorization({
    verificationUri: `${config.webURL}/app/desktop-auth`,
    validateClient: (clientId) => clientId === 'dtx-desktop',
  }),
  bearer(),
],
```

Keep Better Auth CSRF/origin checks enabled.

- [ ] **Step 4: Generate schema with the pinned CLI.**

Add package scripts:

```json
{
  "auth:schema:generate": "auth generate --config src/auth/auth.cli.ts --output src/auth/schema.ts --adapter drizzle --dialect sqlite --yes",
  "auth:schema:export": "drizzle-kit export --config drizzle.auth.config.ts --sql=true",
  "auth:schema:check": "bun run auth:schema:generate && git diff --exit-code -- src/auth/schema.ts"
}
```

Run generation and review output; do not hand-maintain generated columns.

- [ ] **Step 5: Export flat Wrangler-compatible SQL.**

Configure `drizzle.auth.config.ts`, export SQL, review it, and commit it as `0008_better_auth.sql`. Do not add a runtime Drizzle migration runner.

- [ ] **Step 6: Add environment fields.**

```ts
BETTER_AUTH_URL: string;
BETTER_AUTH_SECRET: string;
DTX_WEB_URL: string;
AUTH_COOKIE_DOMAIN?: string;
GOOGLE_AUTH_CLIENT_ID: string;
GOOGLE_AUTH_CLIENT_SECRET: string;
```

`BETTER_AUTH_SECRET` and `GOOGLE_AUTH_CLIENT_SECRET` are Wrangler secrets. Keep Supabase vars temporarily until their consumers are removed.

- [ ] **Step 7: Verify schema/local D1.**

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api test -- src/auth/schema.test.ts
bun run --filter=dtx-api check
bun run packages/e2e-web/setup/prepare-stack.ts
```

- [ ] **Step 8: Commit.**

```bash
git add packages/dtx-api/package.json bun.lock \
  packages/dtx-api/src/auth packages/dtx-api/drizzle.auth.config.ts \
  packages/dtx-api/d1-migrations/0008_better_auth.sql \
  packages/dtx-api/src/env.ts packages/dtx-api/wrangler.jsonc .env.example
git commit -m "feat(auth): add Better Auth D1 schema"
```

---

## Task 2: Mount Better Auth and make CORS/cookies lossless

**Files:**

- Create: `packages/dtx-api/src/auth/auth.ts`
- Create: `packages/dtx-api/src/auth/auth.test.ts`
- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-api/src/lib/cors.ts`
- Modify: `packages/dtx-api/src/lib/cors.test.ts`

**Interfaces:**

- Produces `createAuth(env)` for Task 3.
- Exports `getAllowedOrigins(env)`/`isAllowedOrigin(env, origin)` from the existing CORS seam.
- `withCors()` preserves multiple `Set-Cookie` values for Tasks 5/6.

- [ ] **Step 1: Add failing auth-router/CORS tests.**

Cover:

- GET/POST `/api/auth/*` routing;
- unrelated GraphQL/REST routing;
- exact allowed origin and credentials;
- denied/missing origin behavior;
- **two distinct Set-Cookie values survive `withCors()`**.

- [ ] **Step 2: Export the existing origin parser.**

Keep one parser/cache in `cors.ts`:

```ts
export const getAllowedOrigins = (env: Env): ReadonlySet<string> => { /* existing parse/cache */ };

export const isAllowedOrigin = (env: Env, origin: string | null): boolean =>
  origin !== null && getAllowedOrigins(env).has(origin);
```

Use this same set when creating Better Auth `trustedOrigins`.

- [ ] **Step 3: Create the request-scoped auth factory.**

```ts
export const createAuth = (env: Env) =>
  betterAuth({
    ...createAuthOptions({
      baseURL: env.BETTER_AUTH_URL,
      webURL: env.DTX_WEB_URL,
      cookieDomain: env.AUTH_COOKIE_DOMAIN,
      googleClientId: env.GOOGLE_AUTH_CLIENT_ID,
      googleClientSecret: env.GOOGLE_AUTH_CLIENT_SECRET,
      secret: env.BETTER_AUTH_SECRET,
      trustedOrigins: [...getAllowedOrigins(env)],
    }),
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: 'sqlite',
    }),
  });
```

This mirrors `createDrizzleDb()` but does not move auth schema into common.

- [ ] **Step 4: Mount Better Auth before GraphQL/REST.**

Route GET/POST `/api/auth/*` through `createAuth(env).handler(request)` and wrap the response with `withCors()`.

- [ ] **Step 5: Preserve multiple cookies explicitly.**

When `withCors()` reconstructs a response, preserve every Set-Cookie entry using the Workers multi-cookie API. Do not read a flattened `headers.get('set-cookie')` value.

The focused test must assert both cookie strings remain individually retrievable.

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

## Task 3: Replace the Supabase verifier with one neutral session resolver

**Files:**

- Rename/rewrite: `packages/dtx-api/src/auth/verifyToken.ts` → `packages/dtx-api/src/auth/session.ts`
- Rename/rewrite: `packages/dtx-api/src/auth/verifyToken.test.ts` → `packages/dtx-api/src/auth/session.test.ts`
- Modify: `packages/dtx-api/src/context.ts`
- Modify: `packages/dtx-api/src/schema/builder.ts`
- Modify: `packages/dtx-api/src/schema/builder.test.ts`
- Modify: `packages/dtx-api/src/rest/upload.ts`
- Modify: `packages/dtx-api/src/rest/upload.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.test.ts`

**Interfaces:**

- Produces `resolveAuthSession(request, env): Promise<ResolvedAuthSession | null>`.
- Produces minimal `ApiAuthUser = { id: string }`.
- Applies the unsafe-cookie Origin rule once for GraphQL and REST.

- [ ] **Step 1: Write resolver tests first.**

Cover:

1. valid cookie GET with no Origin;
2. valid cookie POST with allowed Origin;
3. cookie POST with missing Origin => null;
4. cookie POST with disallowed Origin => null;
5. valid Bearer POST with no Origin => valid;
6. malformed Bearer => null;
7. missing credentials => null;
8. revoked/expired session => null;
9. Better Auth exception => null.

- [ ] **Step 2: Implement transport classification.**

```ts
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const hasBearer = (request: Request) =>
  /^Bearer\s+\S+$/i.test(request.headers.get('authorization') ?? '');

const cookieOriginAllowed = (request: Request, env: Env) =>
  !UNSAFE_METHODS.has(request.method) ||
  isAllowedOrigin(env, request.headers.get('origin'));
```

If there is no Bearer header and an unsafe request carries cookie authentication, reject the session before returning it unless Origin is allow-listed.

- [ ] **Step 3: Normalize the Better Auth result.**

```ts
type ApiAuthUser = { id: string };
type ResolvedAuthSession = {
  user: ApiAuthUser;
  session: { id: string };
};
```

Call only:

```ts
createAuth(env).api.getSession({ headers: request.headers })
```

Do not decode bearer tokens or propagate Better Auth/Supabase user types through application code.

- [ ] **Step 4: Retarget context and REST.**

Replace every `verifyToken()` call with `resolveAuthSession()`. Keep current Pothos scope behavior and REST status semantics.

`uploadSimfileFile()` already accepts `{ id: string }`; do not widen it.

- [ ] **Step 5: Verify no Supabase verifier use remains.**

```bash
rg -n "verifyToken|SUPABASE_ANON_KEY" packages/dtx-api/src
bun run --filter=dtx-api test
bun run --filter=dtx-api check
```

- [ ] **Step 6: Commit.**

```bash
git add packages/dtx-api/src
git commit -m "refactor(auth): resolve Better Auth sessions"
```

---

## Task 4: Remove the custom GraphQL magic-link protocol

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
- Modify: `packages/dtx-web/src/lib/api/index.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/app-page.test.ts`
- Delete: `packages/dtx-web/src/routes/(app)/app/app-page-redirect.test.ts`
- Modify: `packages/dtx-api/package.json`

**Interfaces:**

- Removes the only API consumer that needs auth-user email.
- Leaves normal `/app` dashboard and web auth guard intact for Task 5.

- [ ] **Step 1: Change schema expectations first.**

Assert `generateMagicLink` no longer exists, remove `./auth` schema registration, regenerate API schema/web GraphQL output.

- [ ] **Step 2: Delete magic-link service/mutation/rate-limit config.**

Remove service-role key use and `MAGIC_LINK_HOURLY_LIMIT`. Keep `RATE_LIMIT_API`.

- [ ] **Step 3: Remove `/app?redirect=desktop` page behavior.**

Delete magic-link generation and callback handoff from the dashboard. Do not add Device Authorization here; Task 8 owns `/app/desktop-auth`.

- [ ] **Step 4: Verify and commit.**

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run --filter=dtx-api test
bun run --filter=dtx-web test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
```

Commit all removals/generated updates together.

---

## Task 5: Replace SvelteKit Supabase session plumbing and delete desktop web exceptions

**Files:**

- Create: `packages/dtx-web/src/lib/auth/client.ts`
- Create: `packages/dtx-web/src/lib/auth/session.ts`
- Create matching tests
- Modify: `packages/dtx-web/src/lib/auth/google.ts`
- Modify: `packages/dtx-web/src/lib/auth/google.test.ts`
- Rewrite: `packages/dtx-web/src/hooks.server.ts`
- Modify: `packages/dtx-web/src/app.d.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.server.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.ts`
- Modify: `packages/dtx-web/src/routes/+layout.svelte`
- Modify: `packages/dtx-web/src/routes/layout.server.test.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`
- Modify: `packages/dtx-web/src/routes/layout.svelte.test.ts`

**Interfaces:**

- Reuses `safeAppRedirectPath()` and auth error strings in existing `google.ts`.
- Produces `authClient` for Tasks 6/8.
- Produces neutral `event.locals.user/session` and raw multi-cookie propagation.

- [ ] **Step 1: Extend existing redirect/helper tests.**

Keep `safeAppRedirectPath()` semantics and current sanitized Google/linking messages. Do **not** create `$lib/auth/redirect.ts`.

Delete only Supabase-specific callback URL builders/desktop redirect intent once no callers remain.

- [ ] **Step 2: Add failing hook/session tests.**

Cover:

- anonymous/authenticated get-session;
- incoming Cookie forwarding;
- two returned Set-Cookie headers propagated separately;
- protected `/app` redirect with safe `next`;
- authenticated `/login` redirect;
- API failure;
- no `redirect=desktop`/`desktop_callback` branch;
- no `DTXDesktopApp` CSRF bypass.

- [ ] **Step 3: Create Better Auth Svelte client.**

Point it at `PUBLIC_DTX_API_URL`, set `credentials: 'include'`, and register `deviceAuthorizationClient()`.

- [ ] **Step 4: Rewrite the server hook.**

The hook:

1. forwards `Cookie` to `/api/auth/get-session`;
2. reads all returned Set-Cookie values with the Workers multi-cookie API;
3. sets neutral locals from the response body;
4. calls `resolve(event)`;
5. appends each raw Set-Cookie value to the outgoing SvelteKit response.

Do not parse/rebuild Better Auth cookies.

- [ ] **Step 5: Delete desktop-specific hook logic.**

Remove:

```text
redirect=desktop
desktop_callback
DTXDesktopApp form-CSRF bypass
```

Keep normal same-origin SvelteKit form-CSRF protection and the `/app` guard.

- [ ] **Step 6: Simplify root layout.**

Stop constructing Supabase browser/server clients and remove `supabase:auth` invalidation/subscriptions. Return only neutral user/session plus existing locale data.

- [ ] **Step 7: Verify and commit.**

```bash
bun run --filter=dtx-web test -- src/lib/auth src/routes/layout.server.test.ts src/routes/layout.test.ts src/routes/layout.svelte.test.ts
bun run --filter=dtx-web check

git add packages/dtx-web/src/hooks.server.ts packages/dtx-web/src/app.d.ts \
  packages/dtx-web/src/lib/auth packages/dtx-web/src/routes/+layout*
git commit -m "refactor(auth): load Better Auth web sessions"
```

---

## Task 6: Move web sign-in, logout, and Google linking to Better Auth

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

**Interfaces:**

- Consumes `authClient` and retained `safeAppRedirectPath()`/sanitized messages.
- Removes the custom SvelteKit OAuth callback route without losing its reusable test cases.

- [ ] **Step 1: Move existing callback assertions before deletion.**

Retarget cases from `auth/callback/server.test.ts` and `login/page.server.test.ts` into `google.test.ts`, login tests, and account tests as appropriate:

- safe return paths;
- external/protocol-relative rejection;
- provider cancel/failure sanitization;
- existing-account-only Google copy;
- explicit-link conflict copy.

- [ ] **Step 2: Implement password sign-in.**

Use:

```ts
await authClient.signIn.email({ email, password });
window.location.assign(safeAppRedirectPath(next));
```

Preserve `/app` as the missing-`next` default in the login flow.

- [ ] **Step 3: Implement Google sign-in/linking.**

Use `authClient.signIn.social({ provider: 'google', callbackURL })` for login and `authClient.linkSocial({ provider: 'google', callbackURL })` from the account page.

Keep `account_not_linked` mapped to the existing existing-account-only message. Do not permit implicit same-email linking.

- [ ] **Step 4: Delete SvelteKit OAuth callback.**

Better Auth `/api/auth/callback/google` is authoritative. Delete old URL builders from `google.ts` only after caller/test migration.

- [ ] **Step 5: Implement logout.**

Call `authClient.signOut()` then full-navigate to `/login`. Remove Supabase identity/session assumptions from app/account UI.

- [ ] **Step 6: Verify and commit.**

Run focused web auth tests, full web unit suite, and typecheck. Commit the complete web auth action migration.

---

## Task 7: Convert **every** web API call from Bearer to cookies

**Files:**

- Modify: `packages/dtx-web/src/lib/api/transport.ts`
- Modify: `packages/dtx-web/src/lib/api/transport.test.ts`
- Modify: `packages/dtx-web/src/lib/api/client.ts`
- Modify: `packages/dtx-web/src/lib/api/client.test.ts`
- Modify: `packages/dtx-web/src/lib/api/download.ts`
- Modify: `packages/dtx-web/src/lib/api/download.test.ts`
- Modify: `packages/dtx-web/src/lib/api/index.test.ts`
- Modify token-mocking tests including:
  - `packages/dtx-web/src/lib/api/chart.test.ts`
  - `packages/dtx-web/src/lib/api/score.test.ts`
  - `packages/dtx-web/src/lib/api/user.test.ts`
- Modify affected component tests consuming `bulkDownloadHeaders`
- Delete only at the end: `packages/dtx-web/src/lib/api/token.ts`
- Delete only at the end: `packages/dtx-web/src/lib/api/token.test.ts`

**Interfaces:**

- Browser fetches use `credentials: 'include'` and no Authorization.
- Service-binding SSR uses `{ cookieHeader, origin }`, not `accessToken`.
- Desktop remains Bearer and is not part of this web transport task.

- [ ] **Step 1: Add failing browser GraphQL tests.**

Assert GraphQL client uses credentials and no Authorization header.

- [ ] **Step 2: Replace token-shaped `ClientCtx`.**

Use:

```ts
export type ClientCtx = {
  fetch?: typeof fetch;
  platform?: App.Platform;
  cookieHeader?: string | null;
  origin?: string | null;
};
```

Delete `accessToken` from web client context.

- [ ] **Step 3: Rewrite service-binding GraphQL.**

Forward:

```text
content-type: application/json
cookie: <incoming cookie>
origin: <trusted SvelteKit event.url.origin>
```

The explicit Origin is required because GraphQL POST is an unsafe cookie-authenticated method and Task 3 enforces the same origin policy on service-binding requests.

- [ ] **Step 4: Rewrite download helpers.**

`downloadSimfile()` fetches with:

```ts
{ credentials: 'include' }
```

`bulkDownloadHeaders()` returns only the content-type header; the actual bulk fetch also sets `credentials: 'include'`.

Update the component/helper call site that performs the bulk fetch, not just the header builder.

- [ ] **Step 5: Remove every token mock/import.**

```bash
rg -n "getAccessTokenOrNull|getAccessToken|tokenFromSession|from './token'|mock.*token" packages/dtx-web/src
```

Expected before deletion: zero live call sites outside `token.ts`/its test.

- [ ] **Step 6: Delete `token.ts` only after Step 5 is clean.**

This ordering keeps the commit compiling.

- [ ] **Step 7: Verify and commit.**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check

git add packages/dtx-web/src/lib/api packages/dtx-web/src/lib/components packages/dtx-web/src/routes
git commit -m "refactor(auth): use cookie-authenticated web API"
```

---

## Task 8: Add the desktop Device Authorization approval page

**Files:**

- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/+page.svelte`
- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/desktop-auth-page.test.ts`
- Modify: `packages/dtx-web/src/lib/auth/client.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`

**Interfaces:**

- Consumes authenticated Better Auth web session and `deviceAuthorizationClient()`.
- Produces browser claim/approve/deny path for native Task 9.

- [ ] **Step 1: Add failing approval-page tests.**

Cover prefilled/manual code, normalization, claim success, invalid/expired code, approve, deny, double-submit prevention, and unauthenticated return-through-login.

- [ ] **Step 2: Implement code claim.**

Normalize with trim/remove dashes/uppercase, then call Better Auth's device verification method. Rely on `/app` guard and its validated `next` return.

- [ ] **Step 3: Implement explicit Approve/Deny.**

Show user code and fixed `dtx-desktop` client identity. Disable actions while one request is in flight. Show terminal success/denial text; never redirect to a desktop callback.

- [ ] **Step 4: Verify and commit.**

Run page/layout tests plus web typecheck and commit the new route.

---

## Task 9: Replace native Supabase auth with Device Authorization

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/device_auth.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/device_auth_tests.rs`
- Rewrite: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Regenerate: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

**Interfaces:**

- `device_auth.rs` is HTTP protocol only and WireMock-testable.
- `auth.rs` retains `AuthState`, session generation/epoch, and existing command names.
- `validate_session` retains `SessionValidationStatus`.

- [ ] **Step 1: Add WireMock protocol tests.**

Cover code request, display-safe response, pending, slow-down, approval, denial, expiry, invalid grant, malformed body, timeout, and network failure. Confirm `device_code` never crosses Tauri IPC.

- [ ] **Step 2: Implement protocol-only `device_auth.rs`.**

Use Better Auth 1.6.25 wire names exactly, centralize API-base construction, and never log device/session tokens.

- [ ] **Step 3: Define native DTOs in `api_contracts.rs`.**

Add `DesktopAuthUser`, `DesktopAuthSession`, and `DeviceAuthorizationAttempt` with `TS` export. Attempt exposes only:

```text
userCode
verificationUri
verificationUriComplete
expiresAt
```

- [ ] **Step 4: Preserve `AuthState` identity/epoch semantics.**

Keep authenticated user ID, generation counter, and `AuthSessionEpoch` so Google Drive reconciliation does not regress. Replace Supabase JSON/refresh state with typed opaque session state and one pending native device code.

- [ ] **Step 5: Add Device Authorization commands.**

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

- [ ] **Step 6: Preserve `SessionValidationStatus`.**

Keep:

```rust
Valid
Invalid
NotConfigured
```

Behavior:

- missing/blank desktop API config => `NotConfigured`;
- `/api/auth/get-session` returns authenticated user => `Valid`;
- 401/no session => `Invalid`;
- network/5xx remains fail-closed and is **not** mislabeled as local configuration absence.

Do not introduce Better Auth server secret into desktop config.

- [ ] **Step 7: Replace API token access.**

Rename `ensure_valid_access_token` to `current_session_token`. Remove JWT expiry parsing, refresh calls, refresh lock, and refresh events. Existing API code continues sending `Authorization: Bearer <opaque-session-token>`.

- [ ] **Step 8: Remove callback machinery.**

Delete auth deep-link handlers/queues, loopback TCP server, magic-link parsing, callback validation, Supabase verify/refresh/logout code, JWT decoder, and auth events. Preserve `tauri-plugin-single-instance` for normal window behavior. Remove deep-link plugin only after repository search proves no non-auth use.

- [ ] **Step 9: Verify and commit.**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
bun run gen:native-types
```

Commit Rust and generated TypeScript together.

---

## Task 10: Rewire desktop renderer persistence/lifecycle

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

**Interfaces:**

- Consumes generated Task 9 DTOs/commands.
- Persists one `{ sessionToken, user }` value.
- Keeps renderer restore behavior aware of `not-configured`.

- [ ] **Step 1: Add lifecycle tests.**

Cover start, displayed code, browser open, poll success, persistence, restore valid, restore invalid cleanup, restore not-configured preserving storage, logout cleanup, cancel/retry, and browser-open fallback.

- [ ] **Step 2: Replace Supabase-shaped persistence.**

Store one neutral object:

```ts
{
  sessionToken: string;
  user: DesktopAuthUser;
}
```

Delete old Supabase access/refresh local-storage keys when encountered; do not migrate them.

- [ ] **Step 3: Rewrite renderer auth service.**

After `beginDeviceAuthorization`, open `verificationUriComplete`, show manual URI/code fallback, and poll. Remove magic-link/session-refreshed listeners.

- [ ] **Step 4: Keep tri-state restore behavior.**

If native returns `not-configured`, show the build/configuration error and **do not wipe the stored Better Auth session**. If `invalid`, clear it.

- [ ] **Step 5: Remove callback/deep-link configuration.**

Remove:

```text
DTX_DESKTOP_AUTH_CALLBACK_PORT
VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT
PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL
```

Simplify dev scripts/topology tests. Remove auth URI schemes only after no non-auth use remains.

- [ ] **Step 6: Verify and commit.**

Run renderer tests, typecheck, Rust tests, and native type generation; commit desktop renderer/config changes together.

---

## Task 11: Add ID-preserving identity import and Better Auth E2E seed

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

**Interfaces:**

- Produces reviewed SQL only under ignored `tmp/auth-migration/`.
- Seeds the fixed E2E UUID into the same D1 that `prepare-stack.ts` already migrates.

- [ ] **Step 1: Specify import invariants in tests.**

Assert exact UUID preservation, email/name/verification/timestamps, Google identity mapping, no sessions/tokens, deterministic account IDs, SQL escaping, duplicate rejection, unsupported-provider rejection, and owner-ID reconciliation.

- [ ] **Step 2: Implement local-only import tool.**

Consume sanitized Supabase Admin export JSON and emit D1 SQL; do not import `@supabase/supabase-js` and do not write directly to remote D1.

- [ ] **Step 3: Handle credential users without bcrypt compatibility.**

Require explicit replacement password input and hash it with Better Auth's password helper. No replacement password means no credential account is generated.

- [ ] **Step 4: Seed local Better Auth auth rows.**

Replace `create-local-supabase-user.ts` with D1 seeding after `prepare-stack.ts` applies all `d1-migrations/*.sql`. Preserve the existing fixed test UUID used by application seed rows.

- [ ] **Step 5: Retarget Playwright env/setup.**

Remove Supabase E2E URL/anon/service-role inputs. Keep fail-loud CI behavior for incomplete Better Auth test credentials/config.

- [ ] **Step 6: Verify and commit.**

Run import tests, local stack preparation, Playwright setup, and E2E typecheck. Commit no real-user export/SQL/secrets.

---

## Task 12: Remove all Supabase residue and obsolete typegen

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

**Interfaces:**

- Deletes the root/turbo Supabase `gen-types` task so Task 14 does not call it.
- Leaves GraphQL codegen and `gen:native-types` intact.

- [ ] **Step 1: Add/run a residue gate.**

```bash
rg -n -i "@supabase|supabase|PUBLIC_SUPABASE|SUPABASE_" \
  packages package.json turbo.json .env.example CLAUDE.md __mocks__ .github
```

Exclude only historical docs and the named one-shot import tool/tests where “Supabase” describes the input format.

- [ ] **Step 2: Remove packages/types/mocks.**

Remove `@supabase/ssr`, `@supabase/supabase-js`, the common peer dependency, generated Supabase types/exports, and Supabase-specific mocks.

- [ ] **Step 3: Remove environment/workflow residue.**

Delete Supabase URL/anon/service-role variables, magic-link limit, callback variables, Turbo env entries, and old E2E secret requirements.

- [ ] **Step 4: Delete obsolete root typegen.**

Remove:

```text
package.json scripts.gen-types
turbo.json tasks.gen-types
```

because that task exists only to generate `packages/common/src/lib/types/supabase.types.ts`, which this task deletes.

Keep:

```text
packages/dtx-api gen-schema
dtx-web codegen
root gen:native-types
```

- [ ] **Step 5: Verify and commit.**

Run residue gate, lockfile/install check, package typechecks, and unit tests, then commit the cleanup.

---

## Task 13: Add E2E coverage and write the production cutover runbook

**Files:**

- Modify/create authenticated specs under `packages/e2e-web/`
- Modify/create desktop auth specs under `packages/e2e-desktop/`
- Create: `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md`
- After PR #221 lands, modify:
  - `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
  - `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`
  - `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Produces automated end-to-end proof for Task 14.
- Production runbook owns production import/deploy/rollback; Task 14 does not execute them.

- [ ] **Step 1: Update web E2E.**

Cover password login, `/app` guard, authenticated GraphQL/score flow, authenticated download, logout, and invalid-session redirect without Supabase credentials.

- [ ] **Step 2: Add Device Authorization integration E2E.**

Against local API/D1: request code, authenticate browser, claim, approve, poll, validate user, revoke. Cover deny and expiry. Do not add test-only auth endpoints.

- [ ] **Step 3: Update desktop E2E.**

Cover renderer state and authenticated desktop behavior using supported Better Auth/D1 setup. Keep one manual real-browser-open handoff check in the runbook because OS browser launching is outside stable WDIO coverage.

- [ ] **Step 4: Write the runbook.**

Include exact sections for:

1. backup/export prerequisites;
2. pinned versions;
3. Google callbacks;
4. Wrangler secrets;
5. Supabase Admin export;
6. generated import SQL review;
7. D1 migration/import order;
8. owner-ID reconciliation queries;
9. deployment order;
10. web matrix;
11. desktop matrix;
12. Cloudflare Access matrix;
13. go/no-go;
14. production cutover;
15. Supabase-disable proof;
16. rollback.

Production actions are instructions for an operator, not automated steps in this implementation plan.

- [ ] **Step 5: Reconcile PR #221 documentation.**

Replace Supabase as the inner gate, replace `/login?redirect=desktop`/callbacks with `/app/desktop-auth`/Device Authorization, keep production `/app` operator-only, keep pre-prod Access behavior, keep API hostnames outside Access.

- [ ] **Step 6: Verify and commit.**

Run both E2E suites, formatting, and `git diff --check`; commit tests/runbook/docs together.

---

## Task 14: Full verification and pre-production proof

**Files:**

- Modify only files required by failed verification.
- Update the runbook with corrected **non-secret** assumptions/results.

**Interfaces:**

- Final code-PR gate.
- Stops after pre-production proof and a production-ready runbook.
- Does **not** execute production D1 import/deploy or remove production Supabase credentials.

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

Do **not** run the deleted root `gen-types` Supabase task.

- [ ] **Step 2: Run generated-artifact gates.**

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run gen:native-types
git diff --exit-code
```

- [ ] **Step 3: Run residue gates.**

Confirm:

```text
no runtime Supabase imports/config
no getAccessTokenOrNull/token.ts seam
no desktop auth callback variables
no auth deep-link/loopback/JWT/refresh code
no root/turbo Supabase gen-types task
```

- [ ] **Step 4: Run E2E.**

```bash
bun run e2e:web
bun run e2e:desktop
```

Expected: PASS without Supabase credentials.

- [ ] **Step 5: Prepare and prove pre-production only.**

Using the runbook:

- configure pre-prod Better Auth/Google secrets and callback;
- apply D1 migrations;
- generate/review/apply sanitized identity-import SQL to pre-prod;
- reconcile every application owner ID;
- deploy API then web;
- build desktop candidate pointed at pre-prod;
- execute password, Google, linking, GraphQL, upload/download, Device Authorization approve/deny/expiry, restore/logout, and Access checks;
- confirm API auth endpoints remain outside Access and `/app/desktop-auth` remains protected;
- confirm the candidate no longer needs Supabase at runtime.

- [ ] **Step 6: Record pre-prod evidence and production go/no-go criteria.**

Record only non-secret outcomes in the runbook. Production go/no-go requires all automated/pre-prod checks, exact owner reconciliation, configured callbacks/secrets, and rollback artifacts.

- [ ] **Step 7: Stop before production execution.**

Do not run production `0008`, production identity import, production deploy, desktop publication, or credential removal from this task. Those remain explicit operator actions in the runbook after review/approval.

- [ ] **Step 8: Final repository verification.**

```bash
git status --short
git diff --check
```

Commit only verification-driven code/doc corrections; do not create an empty commit.

## Completion Definition

The implementation PR is ready when:

- [ ] D1 schema/migration includes Better Auth core, Device Authorization, and rate-limit tables.
- [ ] Existing application owner UUIDs are preserved by the import tooling.
- [ ] Password and Google web sign-in use Better Auth.
- [ ] Explicit Google linking works; implicit linking/signup are disabled.
- [ ] `CORS_ALLOWED_ORIGINS` is the one browser-origin trust list for CORS, Better Auth, and unsafe cookie auth.
- [ ] Multi-value Set-Cookie survives API CORS wrapping and SvelteKit session forwarding.
- [ ] Browser GraphQL and REST/download paths use cookies and no Supabase bearer helper remains.
- [ ] Service-binding SSR forwards Cookie plus trusted Origin.
- [ ] Desktop uses Device Authorization plus opaque Bearer sessions.
- [ ] Desktop preserves `valid | invalid | not-configured` restore semantics and session epoch/Drive reconciliation.
- [ ] Desktop contains no magic-link, auth deep-link, loopback callback, JWT decoder, or refresh-token rotation.
- [ ] No active package/test/config/environment contract depends on Supabase.
- [ ] Obsolete root/turbo Supabase `gen-types` is deleted.
- [ ] Unit, integration, Rust, web E2E, and desktop E2E checks pass.
- [ ] Pre-production acceptance passes.
- [ ] Production runbook is complete and ready for separate operator execution.