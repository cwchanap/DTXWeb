# Better Auth and D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Supabase from DTXWeb by hosting Better Auth in `dtx-api`, storing auth data in the existing Cloudflare D1 database, moving web authentication to cookies, and replacing desktop magic-link/deep-link authentication with Device Authorization plus Bearer sessions.

**Architecture:** `dtx-api` owns one request-scoped Better Auth instance, the official Better Auth Drizzle adapter, generated auth schema, D1 migration, and neutral session resolution. `dtx-web` is a separate-origin SvelteKit client that uses a shared-parent cookie and hosts `/app/desktop-auth`. DTX Desktop requests a device code, opens the verification URL, polls natively, stores one opaque session token, and sends it as Bearer auth to the existing GraphQL and REST API. Existing application tables continue using preserved auth user IDs.

**Tech Stack:** Better Auth 1.6.25, Better Auth Device Authorization and Bearer plugins, Cloudflare Workers, D1, Drizzle ORM/Drizzle Kit, SvelteKit 2/Svelte 5, Tauri 2/Rust, Vitest, Playwright, WireMock.

**Spec:** `docs/superpowers/specs/2026-08-18-better-auth-d1-migration-design.md`

## Global Constraints

- [ ] Use Better Auth 1.6.25 exactly; do not adopt a prerelease during this migration.
- [ ] Follow Better Auth's Cloudflare fixture: request-scoped `drizzle(env.DB, { schema })` plus `drizzleAdapter(..., { provider: "sqlite" })`.
- [ ] Keep Wrangler D1 migrations as the only production migration executor.
- [ ] Preserve every existing Supabase UUID used by application ownership rows.
- [ ] Do not add dual-auth mode, OAuth Provider, JWT/JWKS, API keys, another Worker, another database, or custom device protocol.
- [ ] Do not preserve active Supabase sessions or old desktop access/refresh-token storage.
- [ ] Keep Google linking explicit and signup disabled.
- [ ] Keep the existing application-data schema and authorization scopes unchanged.
- [ ] Write tests before each behavior change and keep each task compiling before commit.

---

## Task 1: Pin Better Auth and create a reproducible D1 auth schema

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

### Step 1: Add a failing schema contract test

- [ ] Create `src/auth/schema.test.ts`.
- [ ] Read `src/auth/schema.ts` and `d1-migrations/0008_better_auth.sql`.
- [ ] Assert the generated schema and SQL include Better Auth core models, Device Authorization, and database rate limiting.
- [ ] Assert user IDs are text primary keys and session/account/device rows reference the Better Auth user table.
- [ ] Run:

```bash
bun run --filter=dtx-api test -- src/auth/schema.test.ts
```

Expected: FAIL because the schema and migration do not exist.

### Step 2: Install pinned dependencies

- [ ] Run:

```bash
cd packages/dtx-api
bun add --exact better-auth@1.6.25
bun add drizzle-orm@^0.45.2
bun add --dev --exact auth@1.6.25
bun add --dev drizzle-kit
cd ../..
```

- [ ] Do not add a third-party Better Auth Cloudflare adapter.

### Step 3: Define shared options

- [ ] Create `options.ts` with one `createAuthOptions(config)` function.
- [ ] Include:

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
advanced: {
  crossSubDomainCookies: config.cookieDomain
    ? { enabled: true, domain: config.cookieDomain }
    : { enabled: false },
  ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
},
rateLimit: {
  enabled: true,
  storage: "database",
},
plugins: [
  deviceAuthorization({
    verificationUri: `${config.webURL}/app/desktop-auth`,
    validateClient: (clientId) => clientId === "dtx-desktop",
  }),
  bearer(),
],
```

- [ ] Set `baseURL`, `secret`, and `trustedOrigins` explicitly.
- [ ] Do not disable Better Auth CSRF or origin checks.

### Step 4: Generate the Drizzle schema

- [ ] Create `auth.cli.ts` using the shared options and non-production placeholder values.
- [ ] Add scripts:

```json
{
  "auth:schema:generate": "auth generate --config src/auth/auth.cli.ts --output src/auth/schema.ts --adapter drizzle --dialect sqlite --yes",
  "auth:schema:export": "drizzle-kit export --config drizzle.auth.config.ts --sql=true",
  "auth:schema:check": "bun run auth:schema:generate && git diff --exit-code -- src/auth/schema.ts"
}
```

- [ ] Run `bun run --filter=dtx-api auth:schema:generate`.
- [ ] Review the generated schema; do not hand-maintain Better Auth columns.

### Step 5: Export reviewed SQL

- [ ] Configure `drizzle.auth.config.ts` for SQLite using `src/auth/schema.ts`.
- [ ] Run the export into a temporary file.
- [ ] Copy only the generated DDL into `0008_better_auth.sql`.
- [ ] Ensure the migration is flat SQL compatible with `wrangler d1 migrations apply`.
- [ ] Do not add a runtime Drizzle Kit migration runner.

### Step 6: Add the environment contract

- [ ] Add to `Env`:

```ts
BETTER_AUTH_URL: string;
BETTER_AUTH_SECRET: string;
DTX_WEB_URL: string;
AUTH_COOKIE_DOMAIN?: string;
GOOGLE_AUTH_CLIENT_ID: string;
GOOGLE_AUTH_CLIENT_SECRET: string;
```

- [ ] Add non-secret URL/domain/client-ID values to each Wrangler environment.
- [ ] Keep `BETTER_AUTH_SECRET` and `GOOGLE_AUTH_CLIENT_SECRET` as Wrangler secrets.
- [ ] Keep Supabase variables temporarily until the cutover tasks remove their consumers.

### Step 7: Verify schema generation

- [ ] Run:

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api test -- src/auth/schema.test.ts
bun run --filter=dtx-api check
bun run packages/e2e-web/setup/prepare-stack.ts
```

Expected: generated schema is clean and all D1 migrations apply to fresh local state.

### Step 8: Commit

- [ ] Commit:

```bash
git add packages/dtx-api/package.json bun.lock \
  packages/dtx-api/src/auth packages/dtx-api/drizzle.auth.config.ts \
  packages/dtx-api/d1-migrations/0008_better_auth.sql \
  packages/dtx-api/src/env.ts packages/dtx-api/wrangler.jsonc .env.example
git commit -m "feat(auth): add Better Auth D1 schema"
```

---

## Task 2: Mount Better Auth and enable credentialed CORS

**Files:**

- Create: `packages/dtx-api/src/auth/auth.ts`
- Create: `packages/dtx-api/src/auth/auth.test.ts`
- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-api/src/lib/cors.ts`
- Modify: `packages/dtx-api/src/lib/cors.test.ts`

### Step 1: Add failing handler tests

- [ ] Add tests proving:
  - GET and POST under `/api/auth/*` reach Better Auth;
  - unrelated routes still reach GraphQL/REST;
  - unsupported methods preserve existing behavior;
  - session lookup without credentials returns null;
  - D1 is request-scoped.
- [ ] Run the focused tests and confirm failure.

### Step 2: Create the runtime auth factory

- [ ] Implement:

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
    }),
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
    }),
  });
```

- [ ] Do not cache an auth instance across unrelated Worker environments.

### Step 3: Mount the handler before GraphQL/REST

- [ ] In `src/index.ts`, handle CORS preflight first.
- [ ] Route `/api/auth/*` GET/POST to `createAuth(env).handler(request)`.
- [ ] Wrap the response with the existing `withCors(response, request, env)` helper.
- [ ] Keep the current small hand-written router; do not add Hono solely for this route.

### Step 4: Make CORS credential-safe

- [ ] For configured origins, set:

```text
Access-Control-Allow-Origin: <exact origin>
Access-Control-Allow-Credentials: true
Vary: Origin
```

- [ ] Keep allowed methods/headers explicit.
- [ ] Never combine credentials with `Access-Control-Allow-Origin: *`.
- [ ] Add preflight and normal-response tests for allowed, denied, missing, and multiple configured origins.

### Step 5: Verify and commit

- [ ] Run:

```bash
bun run --filter=dtx-api test -- src/auth/auth.test.ts src/index.test.ts src/lib/cors.test.ts
bun run --filter=dtx-api check
```

- [ ] Commit:

```bash
git add packages/dtx-api/src/auth/auth.ts packages/dtx-api/src/auth/auth.test.ts \
  packages/dtx-api/src/index.ts packages/dtx-api/src/index.test.ts \
  packages/dtx-api/src/lib/cors.ts packages/dtx-api/src/lib/cors.test.ts
git commit -m "feat(auth): mount Better Auth API"
```

---

## Task 3: Replace Supabase token verification with one neutral session resolver

**Files:**

- Create: `packages/dtx-api/src/auth/session.ts`
- Create: `packages/dtx-api/src/auth/session.test.ts`
- Modify: `packages/dtx-api/src/context.ts`
- Modify: `packages/dtx-api/src/schema/builder.ts`
- Modify: `packages/dtx-api/src/schema/builder.test.ts`
- Modify: `packages/dtx-api/src/rest/upload.ts`
- Modify: `packages/dtx-api/src/rest/upload.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.ts`
- Modify: `packages/dtx-api/src/rest/downloadSimfile.test.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.ts`
- Modify: `packages/dtx-api/src/rest/downloadBulk.test.ts`
- Delete later in this task: `packages/dtx-api/src/auth/verifyToken.ts`
- Delete later in this task: `packages/dtx-api/src/auth/verifyToken.test.ts`

### Step 1: Add resolver tests

- [ ] Test cookie session, Bearer session, missing credentials, revoked/expired token, malformed header, and Better Auth failure.
- [ ] Require the same normalized `{ user, session }` shape for cookie and Bearer callers.
- [ ] Confirm invalid credentials normalize to null rather than leaking provider errors.

### Step 2: Implement `resolveAuthSession`

- [ ] Call:

```ts
createAuth(env).api.getSession({ headers: request.headers })
```

- [ ] Return neutral local types, not Better Auth internals throughout the codebase.
- [ ] Do not decode or validate tokens independently.

### Step 3: Retarget GraphQL context and REST

- [ ] Replace `verifyToken()` in `context.ts` and protected REST routes.
- [ ] Keep current Pothos scope behavior and existing unauthorized responses.
- [ ] Cover both cookie and Bearer at the resolver boundary; route tests may mock the neutral helper.

### Step 4: Delete the Supabase verifier

- [ ] Delete `verifyToken.ts` and its tests after all imports are gone.
- [ ] Run:

```bash
rg -n "verifyToken|SUPABASE_ANON_KEY" packages/dtx-api/src
```

Expected: no live verifier use.

### Step 5: Verify and commit

- [ ] Run API tests and typecheck.
- [ ] Commit:

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
- Rewrite: `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/app-page.test.ts`
- Delete: `packages/dtx-web/src/routes/(app)/app/app-page-redirect.test.ts`
- Modify: `packages/dtx-api/package.json`

### Step 1: Change schema expectations first

- [ ] Update schema tests to assert `generateMagicLink` no longer exists.
- [ ] Remove `./auth` registration from `schema/index.ts`.
- [ ] Regenerate API schema and web GraphQL output.

### Step 2: Remove server magic-link code

- [ ] Delete the service, mutation, tests, service-role key use, callback allowlist, and magic-link-specific KV keys.
- [ ] Remove the inline `MAGIC_LINK_HOURLY_LIMIT` local-dev override.
- [ ] Keep `RATE_LIMIT_API` because non-auth API paths still use it.

### Step 3: Remove the web handoff

- [ ] Remove `/app?redirect=desktop`, `desktop_callback`, magic-link generation, and callback forwarding.
- [ ] Keep the normal dashboard page.
- [ ] Do not add Device Authorization here; Task 8 adds the dedicated approval page.

### Step 4: Verify and commit

- [ ] Run:

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run --filter=dtx-api test
bun run --filter=dtx-web test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
```

- [ ] Commit all server and generated-client removals together so the branch compiles.

---

## Task 5: Replace SvelteKit Supabase session plumbing

**Files:**

- Create: `packages/dtx-web/src/lib/auth/client.ts`
- Create: `packages/dtx-web/src/lib/auth/session.ts`
- Create: `packages/dtx-web/src/lib/auth/redirect.ts`
- Create matching tests under `packages/dtx-web/src/lib/auth/`
- Rewrite: `packages/dtx-web/src/hooks.server.ts`
- Modify: `packages/dtx-web/src/app.d.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.server.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.ts`
- Modify: `packages/dtx-web/src/routes/+layout.svelte`
- Modify: `packages/dtx-web/src/routes/layout.server.test.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`
- Modify: `packages/dtx-web/src/routes/layout.svelte.test.ts`

### Step 1: Test session loading and guards

- [ ] Add tests for anonymous/authenticated API session responses, forwarded cookies, propagated `Set-Cookie`, protected `/app` redirects, safe `next`, login-page redirect, and API failure.
- [ ] Preserve the current allowlist semantics: return only to `/app` paths.

### Step 2: Add a neutral web auth client

- [ ] Create the Better Auth Svelte client pointed at `PUBLIC_DTX_API_URL`.
- [ ] Set `credentials: "include"`.
- [ ] Register `deviceAuthorizationClient()` for Task 8.

### Step 3: Rewrite the server hook

- [ ] Remove `createServerClient`, `safeGetSession`, and Supabase locals.
- [ ] Forward the incoming `Cookie` header to `/api/auth/get-session`.
- [ ] Propagate all Better Auth `Set-Cookie` headers.
- [ ] Populate neutral `event.locals.user` and `event.locals.session`.
- [ ] Keep CSRF protection for SvelteKit form endpoints and the existing `/app` guard.

### Step 4: Simplify root layout data

- [ ] Stop constructing browser/server Supabase clients.
- [ ] Return only neutral session/user data plus existing locale data.
- [ ] Remove `supabase:auth` invalidation and auth-state subscription.

### Step 5: Verify and commit

- [ ] Run focused layout/hook tests and `bun run --filter=dtx-web check`.
- [ ] Commit:

```bash
git add packages/dtx-web/src/hooks.server.ts packages/dtx-web/src/app.d.ts \
  packages/dtx-web/src/lib/auth packages/dtx-web/src/routes/+layout*
git commit -m "refactor(auth): load Better Auth web sessions"
```

---

## Task 6: Move web sign-in, logout, and Google linking to Better Auth

**Files:**

- Rewrite: `packages/dtx-web/src/routes/(login)/login/+page.svelte`
- Delete/replace: `packages/dtx-web/src/routes/(login)/login/+page.server.ts`
- Modify: `packages/dtx-web/src/routes/(login)/login/page.server.test.ts`
- Delete: `packages/dtx-web/src/routes/auth/callback/+server.ts`
- Delete: `packages/dtx-web/src/routes/auth/callback/server.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/+layout.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/layout.svelte.test.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/account/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/account/account-page.test.ts`

### Step 1: Add failing login/account tests

- [ ] Cover password success/failure, safe `next`, Google redirect, `account_not_linked`, logout, linked-method listing, explicit Google linking, and no signup UI.

### Step 2: Implement password sign-in

- [ ] Use `authClient.signIn.email({ email, password })`.
- [ ] Perform a full browser navigation to the validated `/app` destination after success.
- [ ] Keep provider errors sanitized.

### Step 3: Implement Google sign-in and explicit linking

- [ ] Use `authClient.signIn.social` for login and `authClient.linkSocial` from the authenticated account page.
- [ ] Set callback URLs to validated application routes.
- [ ] Delete the SvelteKit OAuth callback route; Better Auth's API callback is authoritative.
- [ ] Do not permit implicit same-email linking.

### Step 4: Implement logout

- [ ] Call `authClient.signOut()` and navigate to `/login`.
- [ ] Remove Supabase identity/session assumptions from layout and account UI.

### Step 5: Verify and commit

- [ ] Run web unit tests and typecheck.
- [ ] Commit the complete web auth action migration.

---

## Task 7: Authenticate browser API traffic with cookies

**Files:**

- Modify: `packages/dtx-web/src/lib/api/transport.ts`
- Modify: `packages/dtx-web/src/lib/api/client.ts`
- Modify matching tests
- Delete: `packages/dtx-web/src/lib/api/token.ts`
- Delete: `packages/dtx-web/src/lib/api/token.test.ts`

### Step 1: Add transport tests

- [ ] Browser GraphQL sets `credentials: "include"` and no Authorization header.
- [ ] Service-binding GraphQL forwards the incoming Cookie header.
- [ ] Anonymous requests remain anonymous.
- [ ] Existing GraphQL error mapping remains unchanged.

### Step 2: Rewrite only the transport seam

- [ ] Keep generated GraphQL operations and feature wrappers unchanged.
- [ ] Remove token lookup/injection.
- [ ] Do not introduce a proxy route solely to make auth same-origin.

### Step 3: Verify and commit

- [ ] Run API client tests, web tests, and typecheck.
- [ ] Commit:

```bash
git add packages/dtx-web/src/lib/api
git commit -m "refactor(auth): use cookie-authenticated web API"
```

---

## Task 8: Add the desktop Device Authorization approval page

**Files:**

- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/+page.svelte`
- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/desktop-auth-page.test.ts`
- Modify: `packages/dtx-web/src/lib/auth/client.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`

### Step 1: Add failing UI tests

- [ ] Cover prefilled/manual code, formatting, claim success, invalid/expired code, approve, deny, double-submit prevention, and unauthenticated return-through-login.

### Step 2: Implement the claim step

- [ ] Normalize the user code by trimming, removing dashes, and uppercasing.
- [ ] Call Better Auth's Device Authorization verification method before showing approval controls.
- [ ] Rely on the `/app` guard to require an authenticated browser session and preserve the page URL as `next`.

### Step 3: Implement explicit approve/deny

- [ ] Display the code and fixed `dtx-desktop` client identity.
- [ ] Require an explicit button action.
- [ ] Disable both actions while one is in flight.
- [ ] Show terminal success/denial text instead of redirecting to a desktop callback.

### Step 4: Verify and commit

- [ ] Run the page and layout tests plus web typecheck.
- [ ] Commit:

```bash
git add "packages/dtx-web/src/routes/(app)/app/desktop-auth" \
  packages/dtx-web/src/lib/auth/client.ts
git commit -m "feat(auth): add desktop device approval"
```

---

## Task 9: Replace native refresh/deep-link auth with Device Authorization

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

### Step 1: Add protocol tests with WireMock

- [ ] Cover code request, display-safe response, pending, slow-down, approval, denial, expiry, invalid grant, malformed responses, timeout, and network failure.
- [ ] Use paused Tokio time where practical.
- [ ] Confirm `device_code` never crosses the Tauri command boundary.

### Step 2: Implement a protocol-only module

- [ ] Keep `device_auth.rs` independent of Tauri UI APIs.
- [ ] Use Better Auth 1.6.25's exact wire field names.
- [ ] Centralize API base URL construction.
- [ ] Never log device codes or session tokens.

### Step 3: Replace `AuthState` with typed state

- [ ] Define renderer-facing `DesktopAuthUser`, `DesktopAuthSession`, and `DeviceAuthorizationAttempt` in `api_contracts.rs` and derive `TS`.
- [ ] Reuse the existing export target `../../src/renderer/src/lib/generated/native-api-contracts.ts`.
- [ ] Include `userCode`, `verificationUri`, `verificationUriComplete`, and `expiresAt` in the attempt.
- [ ] Keep one pending opaque device code in native memory.
- [ ] Preserve authenticated user ID, session generation, and session epoch used by Google Drive reconciliation.
- [ ] Prevent stale polls from committing after cancel/restart.

### Step 4: Implement native commands

- [ ] Add:

```text
begin_device_authorization
poll_device_authorization
cancel_device_authorization
```

- [ ] Preserve and retarget existing names:

```text
validate_session
get_current_session
logout_session
open_external_url
```

- [ ] `begin_device_authorization` requests/stores codes and returns display-safe data only.
- [ ] The renderer, not the protocol module, calls `open_external_url(verificationUriComplete)`.
- [ ] `poll_device_authorization` owns polling, handles pending/slow-down, fetches `/api/auth/get-session` after approval, and returns `DesktopAuthSession`.
- [ ] `validate_session` calls `/api/auth/get-session` with Bearer auth and never decodes JWTs.
- [ ] `logout_session` posts to `/api/auth/sign-out`, always clears native state, and reports whether revocation succeeded.

### Step 5: Replace API token access

- [ ] Rename `ensure_valid_access_token` to `current_session_token`.
- [ ] Remove expiry parsing, refresh calls, and refresh locks.
- [ ] Keep existing `Authorization: Bearer` request code, now with the opaque Better Auth session token.

### Step 6: Remove auth callback machinery

- [ ] Delete magic-link parsing, auth deep-link handlers/queues, loopback TCP server, callback parser, JWT parsing, Supabase refresh/logout endpoints, and auth events.
- [ ] Remove `tauri-plugin-deep-link` only after no non-test use remains.
- [ ] Keep `tauri-plugin-single-instance` for window focusing but remove auth URL extraction.

### Step 7: Verify generated bindings and Rust

- [ ] Run:

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
bun run gen:native-types
```

- [ ] Commit native changes and generated TypeScript together.

---

## Task 10: Rewire the desktop renderer and remove callback configuration

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

### Step 1: Add renderer lifecycle tests

- [ ] Cover start, displayed code, browser open, poll success, one-token persistence, restore, invalid restore cleanup, logout cleanup, cancellation, retry, and browser-open failure fallback.
- [ ] Remove assumptions about refresh tokens, JWT expiry, magic links, or session-refresh events.

### Step 2: Replace Supabase-shaped persistence

- [ ] Store only `{ sessionToken, user }` under one neutral key.
- [ ] Validate stored shape and clear malformed values.
- [ ] Do not migrate old Supabase local-storage values; delete them when encountered.

### Step 3: Rewrite the renderer service

- [ ] Use generated native commands/types.
- [ ] After `beginDeviceAuthorization`, call the existing `openExternalUrl(attempt.verificationUriComplete)` and then poll.
- [ ] Show `verificationUri` and `userCode` when browser opening fails.
- [ ] Keep one `idle | waiting | authenticated | error` state model.
- [ ] Remove `magic-link-result` and `session-refreshed` listeners.

### Step 4: Remove callback/deep-link configuration

- [ ] Remove:

```text
DTX_DESKTOP_AUTH_CALLBACK_PORT
VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT
PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL
```

- [ ] Remove auth URI scheme registration only after repository search confirms no non-auth use.
- [ ] Simplify `dev`, `dev:local-web`, and root dev scripts.
- [ ] Update topology tests to assert API/web URLs only.

### Step 5: Verify and commit

- [ ] Run desktop renderer tests, Svelte typecheck, Rust tests, and `bun run gen:native-types`.
- [ ] Commit:

```bash
git add packages/dtx-desktop package.json
git commit -m "refactor(auth): rewire desktop session lifecycle"
```

---

## Task 11: Add a one-shot identity import and local Better Auth E2E user

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

### Step 1: Specify import invariants in tests

- [ ] Preserve user UUIDs exactly.
- [ ] Map email/name/verified/timestamps and Google identity.
- [ ] Reject duplicate email/ID and unsupported providers.
- [ ] Import no session/access/refresh token.
- [ ] Emit deterministic account IDs and safely escaped SQL.
- [ ] Fail when any application owner ID lacks an imported Better Auth user.

### Step 2: Implement local-only import tooling

- [ ] Consume a sanitized Supabase Admin export JSON file.
- [ ] Write only to `tmp/auth-migration/`.
- [ ] Produce reviewed SQL for D1; do not write directly to production.
- [ ] Do not import or depend on `@supabase/supabase-js`.
- [ ] Hash replacement credential passwords with Better Auth's password helper.
- [ ] Require explicit replacement password input for credential users; do not add bcrypt compatibility.

### Step 3: Seed local E2E auth in D1

- [ ] Replace Supabase E2E variables with Better Auth secret, fixed test user ID/email/password, API URL, and web URL.
- [ ] Seed Better Auth user/account rows into the same local D1 state prepared by `prepare-stack.ts`.
- [ ] Preserve the fixed test UUID used by application seed rows.
- [ ] Keep CI fail-loud behavior when auth E2E inputs are incomplete.

### Step 4: Verify and commit

- [ ] Run import tests, local stack preparation, Playwright setup, API tests, and E2E typecheck.
- [ ] Commit migration tooling without generated real-user SQL or secrets.

---

## Task 12: Remove all remaining Supabase runtime and configuration residue

**Files:**

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
- Modify: `turbo.json`
- Modify affected mocks and tests
- Modify: `CLAUDE.md`

### Step 1: Add a residue gate

- [ ] Search active code/config for:

```bash
rg -n -i "@supabase|supabase|PUBLIC_SUPABASE|SUPABASE_" \
  packages package.json turbo.json .env.example CLAUDE.md __mocks__
```

- [ ] Exclude only historical migration documents and the named one-shot import tool/tests.
- [ ] The import tool may mention Supabase as an input format but must not import a Supabase package.

### Step 2: Remove packages and types

- [ ] Remove `@supabase/ssr` and `@supabase/supabase-js` from all packages.
- [ ] Remove the common peer dependency.
- [ ] Delete generated Supabase database types and exports.
- [ ] Replace Supabase mocks with neutral auth fixtures.

### Step 3: Remove environment/config residue

- [ ] Remove Supabase URL, anon key, service-role key, callback allowlist, and magic-link-limit variables from env types, Wrangler config, Vite/Vitest setup, Turbo env lists, docs, and workflows.
- [ ] Keep unrelated D1/R2/KV/Google Drive settings.

### Step 4: Verify and commit

- [ ] Run the residue gate, install lockfile check, all package typechecks, and unit tests.
- [ ] Commit:

```bash
git add .
git commit -m "chore(auth): remove Supabase dependencies"
```

---

## Task 13: Cover cutover flows and reconcile Zero Trust documentation

**Files:**

- Modify/create authenticated specs under `packages/e2e-web/`
- Modify/create desktop auth specs under `packages/e2e-desktop/`
- Create: `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md`
- After PR #221 merges, modify:
  - `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`
  - `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`
  - `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

### Step 1: Update web E2E

- [ ] Remove Supabase setup/secrets.
- [ ] Cover password login, protected navigation, authenticated GraphQL/score flow, logout, and invalid-session redirect.
- [ ] Keep Google provider behavior in integration/unit tests unless a controlled Google test identity is configured.

### Step 2: Add Device Authorization integration coverage

- [ ] Against local API/D1, request a device code, claim it with an authenticated browser session, approve it, poll for the token, validate the user, and revoke it.
- [ ] Cover deny and expiry.
- [ ] Do not reproduce Better Auth internals in test-only endpoints.

### Step 3: Update desktop E2E

- [ ] Cover renderer state and authenticated desktop behavior using a Better Auth session seeded through supported auth/D1 setup.
- [ ] Keep one manual bundled desktop browser-handoff check in the runbook because OS browser launch is outside stable WDIO coverage.
- [ ] Do not restore loopback/deep-link test hooks.

### Step 4: Write the cutover runbook

- [ ] Include exact sections for prerequisites, pinned versions, Google callbacks, Wrangler secrets, Supabase Admin export, import/reconciliation, D1 migration, deployment order, web matrix, desktop matrix, ownership queries, go/no-go, production cutover, Supabase-disable proof, and rollback.
- [ ] Rollback redeploys previous API/web/desktop versions and leaves additive Better Auth tables in place.

### Step 5: Reconcile PR #221

- [ ] Rebase onto current `main` after PR #221 lands.
- [ ] Replace Supabase as the inner gate with Better Auth.
- [ ] Replace `/login?redirect=desktop` and callback verification with `/app/desktop-auth` and Device Authorization.
- [ ] Preserve production `/app` operator-only policy, pre-production web Access protection, and public API hostnames.

### Step 6: Verify and commit

- [ ] Run both E2E suites, formatting, and `git diff --check`.
- [ ] Commit tests and runbook together.

---

## Task 14: Run full verification and execute the atomic cutover

**Files:**

- Modify only files required by failed verification.
- Update the cutover runbook with corrected non-secret assumptions/results.

### Step 1: Run static and unit verification

- [ ] Run:

```bash
bun run format
bun run lint
bun run check
bun run test
bun run gen-types
git diff --check
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
```

### Step 2: Run generated-artifact and residue gates

- [ ] Run:

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run gen:native-types
git diff --exit-code
```

- [ ] Confirm no live Supabase or desktop callback protocol remains.

### Step 3: Run E2E

- [ ] Run:

```bash
bun run e2e:web
bun run e2e:desktop
```

Expected: PASS without Supabase credentials.

### Step 4: Prepare pre-production

- [ ] Set `BETTER_AUTH_SECRET` and `GOOGLE_AUTH_CLIENT_SECRET` with Wrangler secrets.
- [ ] Configure the exact pre-production Google callback from the runbook.
- [ ] Apply D1 migrations.
- [ ] Generate/review/apply sanitized identity-import SQL.
- [ ] Fail rollout if any distinct application owner ID lacks a Better Auth user.

### Step 5: Deploy and prove pre-production

- [ ] Deploy API first, then web.
- [ ] Build a desktop candidate pointed at pre-production.
- [ ] Execute password, Google, explicit linking, GraphQL, upload/download, device approve/deny/expiry, restore/logout, and Access-gate checks.
- [ ] Confirm API auth endpoints are outside Access and `/app/desktop-auth` is protected.
- [ ] Confirm Supabase can be unreachable without breaking the candidate.

### Step 6: Production go/no-go

- [ ] Proceed only when automated checks pass, identity reconciliation is exact, pre-production web/desktop flows pass, rollback artifacts exist, callbacks/secrets are configured, and PR #221 policies are verified or scheduled in the same window.

### Step 7: Execute the production cutover

- [ ] Apply `0008_better_auth.sql`.
- [ ] Apply reviewed identity-import SQL.
- [ ] Deploy API, then web.
- [ ] Publish/install the new desktop build.
- [ ] Run production smoke checks.
- [ ] Revoke/remove Supabase application credentials only after proof succeeds.
- [ ] Do not immediately delete the Supabase project; retain rollback ability for the cutover window.

### Step 8: Final verification

- [ ] Record only non-secret results/corrections in the runbook.
- [ ] Confirm `tmp/auth-migration/` is not tracked.
- [ ] Re-run `git status --short` and `git diff --check`.
- [ ] Commit verification-only fixes when needed; do not create an empty commit.

## Completion Definition

The migration is complete only when:

- [ ] D1 holds Better Auth core, Device Authorization, and rate-limit tables.
- [ ] Existing application owner UUIDs are preserved.
- [ ] Password and Google web sign-in use Better Auth.
- [ ] Explicit Google linking works and implicit linking is disabled.
- [ ] Browser GraphQL/REST use cookie sessions.
- [ ] Desktop uses Device Authorization and Bearer sessions.
- [ ] Desktop contains no magic-link, auth deep-link, loopback callback, JWT decoder, or refresh-token rotation.
- [ ] No active package, test, config, or environment contract depends on Supabase.
- [ ] Unit, integration, Rust, web E2E, and desktop E2E checks pass.
- [ ] Pre-production and production runbook matrices pass.
- [ ] Disabling Supabase causes no DTXWeb runtime failure.
