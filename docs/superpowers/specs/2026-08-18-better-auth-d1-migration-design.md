# Better Auth and Cloudflare D1 Migration Design

**Status:** Approved direction, implementation pending  
**Date:** 2026-08-18  
**Tracking:** HPA-644  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb already stores application data in Cloudflare D1. Supabase remains as the authentication provider and as Supabase-shaped session plumbing across the web app, API, desktop app, E2E setup, dependencies, generated types, and environment configuration.

Complete the migration by hosting Better Auth in `dtx-api`, storing Better Auth tables in the existing D1 database, using cookies for web authentication, and replacing the desktop magic-link/deep-link protocol with Better Auth Device Authorization plus opaque Bearer sessions.

The architecture stays intentionally small:

- one auth runtime in `dtx-api`;
- one existing D1 database per deployed environment;
- the official Better Auth Drizzle adapter;
- cookies for browser sessions;
- Device Authorization + Bearer for desktop;
- one-shot ID-preserving identity import;
- no dual-auth compatibility mode;
- no OAuth Provider/JWT/JWKS layer;
- no second Worker;
- no custom device protocol;
- no permanent bcrypt compatibility;
- no foreign keys from application ownership columns to Better Auth tables.

Active Supabase sessions are invalidated at cutover. Existing application ownership identifiers are preserved exactly.

## Current State

### Application data is already D1-backed

`dtx-api` owns the `DB` binding and versioned Wrangler D1 migrations. Shared application queries use the existing D1 schema for simfiles, DTX files, user profiles, chart scores, and scores.

Runtime application data no longer depends on Supabase tables or Supabase Storage.

Application ownership is keyed by Supabase UUIDs stored as text, including `simfiles.user_id`, `user_profiles.user_id`, and `chart_scores.user_id`. Those columns intentionally remain text ownership keys without foreign keys to Better Auth. The import/reconciliation gate is the cheaper invariant for this project.

### Remaining Supabase responsibilities

Supabase still owns or shapes:

- SvelteKit SSR/browser session creation and validation;
- password sign-in, Google sign-in, explicit provider linking, and logout;
- API Bearer-token validation;
- desktop magic-link generation and exchange;
- desktop deep-link and loopback callback handling;
- desktop JWT expiry parsing and refresh-token rotation;
- desktop E2E auth seeding;
- web E2E user provisioning;
- environment variables, dependencies, generated Supabase types, and mocks.

The desktop path has the largest simplification opportunity. Device Authorization removes the custom magic-link mutation, callback allowlists, auth URI schemes, loopback HTTP server, JWT decoder, refresh lock, and session-refresh events.

## Goals

1. Make D1 the only database used by DTXWeb runtime services.
2. Replace Supabase Auth with an exactly pinned Better Auth 1.6.x patch selected at implementation start.
3. Preserve every migrated Supabase UUID as the matching Better Auth `user.id`.
4. Keep password and Google sign-in for existing users.
5. Keep Google linking explicit and signup disabled.
6. Authenticate browser API traffic with Better Auth cookies.
7. Authenticate desktop API traffic with Device Authorization plus opaque Bearer sessions.
8. Preserve the existing desktop `valid | invalid | not-configured` restore contract and Drive session-epoch semantics.
9. Remove all runtime Supabase dependencies, variables, callbacks, refresh logic, generated types, and E2E bootstrap code.
10. Prove the additive Better Auth foundation separately before the destructive cutover.
11. Keep production cutover operations in an operator runbook, not in implementation tasks.

## Non-goals

Do not add:

- public registration;
- password-reset or email-verification delivery;
- passkeys, 2FA, organizations, roles, or an admin dashboard;
- Better Auth Infrastructure;
- OAuth Provider, OIDC Provider, JWT/JWKS, API keys, scopes, or resource audiences;
- another Worker or database;
- KV/Redis session storage;
- desktop keychain migration;
- backward compatibility for active Supabase sessions;
- permanent bcrypt verification.

Google Drive OAuth remains separate from application authentication.

## Decisions

### 1. Host Better Auth in `dtx-api`

`dtx-api` already owns D1 and the public API hostname. Mount Better Auth under `/api/auth/*` before the existing GraphQL and REST routes in the current hand-written router.

`dtx-web` does not receive a D1 binding. Do not add Hono or another router solely for authentication.

This avoids two auth instances, another Worker, or a new internal auth service.

### 2. Use the official Drizzle-on-D1 adapter

Follow the Better Auth 1.6.x Cloudflare pattern:

```ts
const db = drizzle(env.DB, { schema: authSchema });

database: drizzleAdapter(db, {
  provider: 'sqlite',
});
```

This mirrors the existing `createDrizzleDb()` pattern in `@dtx/common/server`, but the Better Auth schema remains owned by `dtx-api` because it is auth-runtime data, not application-domain data.

The Better Auth CLI generates `packages/dtx-api/src/auth/schema.ts`. `drizzle-kit export` produces reviewed flat SQL for `packages/dtx-api/d1-migrations/0008_better_auth.sql`. Wrangler remains the only production migration executor.

### 3. Pin the Better Auth 1.6 line at implementation start

Do not freeze the implementation to the patch that happened to be current when the first draft was written.

At the start of Foundation Task 1:

1. determine the current stable `1.6.x` tag;
2. inspect changes since the version used to write this plan;
3. verify Device Authorization, Bearer, Drizzle/D1, cookie, and schema-generation APIs used by this plan;
4. pin `better-auth` and the `auth` CLI to the **same exact 1.6.x version**;
5. record that exact version in the implementation PR and runbook.

As of this review, repository tags `v1.6.30` and `v1.7.1` exist while `v1.6.31` does not. Stay on the 1.6 line for this migration unless a separate review explicitly accepts the 1.7 breaking surface.

The npm package named `auth` is intentionally the Better Auth CLI. Do not replace it with `@better-auth/cli` without re-checking the project/version contract.

### 4. Separate CORS configuration from the authentication trust boundary

`CORS_ALLOWED_ORIGINS` remains a CORS configuration only. It may legitimately include localhost entries in deployed pre-production for developer tooling, so it must **not** be reused as an authentication/open-redirect trust boundary.

`DTX_WEB_URL` is already required for Device Authorization and becomes the one canonical trusted web origin.

```ts
const trustedWebOrigin = new URL(env.DTX_WEB_URL).origin;

trustedOrigins: [trustedWebOrigin];
```

Use the same exact origin for unsafe cookie-authenticated application API checks.

This introduces no second origin list:

- `CORS_ALLOWED_ORIGINS`: which browser origins may read API responses;
- `DTX_WEB_URL`: the one web application origin trusted for auth redirects and cookie-authenticated mutations.

Local development sets `DTX_WEB_URL=http://localhost:5173`. Production and pre-production set their deployed HTTPS web origins.

Better Auth's default SameSite cookie behavior remains defense in depth, not the only application-CSRF boundary.

### 5. Use cross-subdomain cookies with environment-specific prefixes

| Environment | API base URL | Web origin | Cookie domain | Cookie prefix |
| --- | --- | --- | --- | --- |
| Production | `https://api.dtx.hapadona.com` | `https://dtx.hapadona.com` | `dtx.hapadona.com` | `dtx` |
| Pre-production | `https://api.pre-prod.dtx.hapadona.com` | `https://pre-prod.dtx.hapadona.com` | `pre-prod.dtx.hapadona.com` | `dtx-preprod` |
| Local | `http://localhost:8787` | `http://localhost:5173` | omitted | `dtx-local` |

The production domain cookie is intentionally shared with `api.dtx.hapadona.com`, but that domain also covers nested pre-production hostnames. Without distinct names, a browser can send production and pre-production cookies with the same Better Auth cookie name to pre-production hosts.

Set `advanced.cookiePrefix` from one environment field, `AUTH_COOKIE_PREFIX`, so the two environments never compete on the same cookie name.

`pre-prod-prod-data` uses the pre-production web/API hostname and therefore the pre-production prefix; changing its backing D1 does not make it a production-origin browser session.

### 6. Make credentialed CORS explicit

Browser auth, GraphQL, and authenticated REST/download requests use `credentials: 'include'`.

For an allowed CORS origin both current CORS paths must set:

```text
Access-Control-Allow-Origin: <exact origin>
Access-Control-Allow-Credentials: true
Vary: Origin
```

Specifically:

- `handlePreflight()` changes its current `Access-Control-Allow-Credentials: false` to `true` for allowed origins;
- `withCors()` sets `Access-Control-Allow-Credentials: true` on allowed normal responses.

Denied origins receive no credentialed CORS grant. Never combine credentials with `Access-Control-Allow-Origin: *`.

### 7. Enforce the canonical web Origin on unsafe cookie-authenticated application API requests

`resolveAuthSession()` distinguishes authentication transport:

- If a valid `Authorization: Bearer` header is present, validate it with Better Auth and do not require `Origin`. This is the desktop/native path.
- If authentication comes from cookies and the method is `POST`, `PUT`, `PATCH`, or `DELETE`, require `Origin` to equal `new URL(env.DTX_WEB_URL).origin` before accepting the session.
- Cookie-authenticated `GET`/`HEAD` stays usable without `Origin` so authenticated reads and downloads are not broken.

An unsafe request with a cookie but an absent/different Origin is treated as unauthenticated at the shared session boundary. Protected GraphQL/REST code then returns its existing forbidden/unauthorized result.

SvelteKit service-binding GraphQL calls explicitly forward both the incoming cookie and the canonical external web Origin so they satisfy the same rule.

Better Auth's own `/api/auth/*` handler keeps Better Auth's built-in origin/CSRF checks enabled and uses `DTX_WEB_URL` as `trustedOrigins`.

### 8. Preserve multiple `Set-Cookie` values without unnecessary CORS refactoring

The current `withCors()` copies `response.headers` via `new Headers(response.headers)`. Keep that implementation if the new two-cookie regression test proves cardinality survives in the supported Workers runtime.

Do **not** rewrite `withCors()` around `headers.get('set-cookie')`, which can flatten cookie values.

The SvelteKit session hook must likewise forward each Set-Cookie value individually using the runtime's multi-cookie API rather than reading a single flattened header.

The rule is test-first:

1. create a response with two Set-Cookie values;
2. pass it through `withCors()`;
3. assert both values remain individually retrievable;
4. only change `withCors()` if that test fails.

### 9. Add a production API service binding for SSR

Production `dtx-web` currently lacks the `API` service binding already present in both pre-production stanzas.

Add the root binding:

```json
{
  "services": [{ "binding": "API", "service": "dtx-api" }]
}
```

The server hook uses the service binding when available and falls back to `PUBLIC_DTX_API_URL` for local/non-Workers execution.

This removes an avoidable public HTTP round-trip from every production SSR session lookup and makes production/pre-production use the same server-side auth seam.

Browser requests still call the public API hostname directly.

### 10. Keep Better Auth database rate limiting off the SSR session hot path

Better Auth database-backed rate limiting is useful for client-initiated authentication abuse, but `/get-session` is called on normal SSR navigation and must not cause a D1 rate-limit write on every page render.

Keep database rate limiting enabled, but explicitly exempt the high-frequency session-read endpoint:

```ts
rateLimit: {
  enabled: true,
  storage: 'database',
  customRules: {
    '/get-session': false,
  },
},
```

Retain Better Auth's default and plugin-specific limits for sign-in, device authorization, and other auth operations. Do not replace them with a broad catch-all allowlist unless implementation-time tests show another read endpoint is hot enough to justify an exemption.

`cf-connecting-ip` remains the trusted IP header for browser-facing rate limits.

Keep the existing `RATE_LIMIT_API` KV binding for downloads and other application API rate limits. Delete only magic-link-specific rate-limit code/configuration.

### 11. Disable signup and implicit linking

Use:

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
```

Imported Google identities may sign in. An authenticated user links Google explicitly with `linkSocial()`.

### 12. Reuse the existing web redirect/error allowlist

Do not create a second redirect helper.

Keep `packages/dtx-web/src/lib/auth/google.ts` as the application-auth redirect/error seam:

- retain `safeAppRedirectPath()`;
- retain sanitized Google/auth error messages;
- retain explicit-linking messages;
- delete only the Supabase-specific `/auth/callback` URL builders and desktop redirect intent after callers are migrated.

Existing login and callback tests are retargeted so the current allowlist/error cases remain covered instead of being replaced by thinner tests.

### 13. Use Device Authorization and Bearer for desktop

DTX Desktop is a first-party client of the same application. It does not need OAuth Provider, scopes, JWT access tokens, JWKS, or refresh-token rotation.

Configure Device Authorization + Bearer using the exact APIs of the implementation-time pinned 1.6.x patch.

`/device/token` returns an opaque Better Auth session token in `access_token`. Desktop sends it as `Authorization: Bearer <token>`. The same Better Auth session resolver validates browser cookies and desktop bearer sessions.

### 14. Preserve desktop session-validation and E2E seams

Keep the existing renderer/native contract:

```text
valid | invalid | not-configured
```

`validate_session` is retargeted, not redesigned:

- missing/blank desktop API configuration => `not-configured`;
- authenticated `/api/auth/get-session` returns the user => `valid`;
- 401/no session => `invalid`;
- transport/server failure remains fail-closed according to current restore behavior and must not be mislabeled as local configuration absence.

The desktop never receives `BETTER_AUTH_SECRET`; that secret remains server-only.

The existing `e2e + debug_assertions` native auth seam is also retained and reshaped from Supabase's `{ access_token, refresh_token, user }` to Better Auth's `{ sessionToken, user }`.

Retarget:

- `AuthState::for_e2e_user`;
- `SessionData`;
- `e2e_session_matches_user`;
- `src/tests/e2e_tests.rs`;
- renderer E2E local-storage setup.

Do not require a fake Better Auth refresh token. Do not add a production test-auth route.

Feature-gated debug-only native commands/seeding remain acceptable for desktop E2E because that mechanism already exists and cannot ship in release builds.

### 15. Keep API auth user types minimal

After the magic-link mutation is removed, GraphQL/REST authorization only needs the user identifier.

```ts
type ApiAuthUser = {
  id: string;
};
```

Add `email` only at a boundary that actually needs it. Do not re-export or emulate Supabase `User`/`Session` shapes.

The web session model may expose Better Auth user fields needed by UI; that is separate from `dtx-api`'s authorization type.

## Target Runtime Architecture

```text
                               Cloudflare D1
                   app tables + Better Auth tables
                                      ▲
                                      │
                       api.dtx.hapadona.com
              ┌───────────────────────┴───────────────────────┐
              │                                               │
       /api/auth/*                                    /graphql + REST
     Better Auth handler                           resolveAuthSession()
              │                                               │
      ┌───────┴────────┐                                     │
      │                │                                     │
Browser cookie   Desktop device flow ── opaque Bearer ───────┘
      │
dtx.hapadona.com
login/account/
app/desktop-auth
```

On SSR, `dtx-web` calls the same `dtx-api` Worker through the `API` service binding rather than a public Internet subrequest.

## Better Auth Server Boundary

```text
packages/dtx-api/src/auth/options.ts
packages/dtx-api/src/auth/auth.ts
packages/dtx-api/src/auth/auth.cli.ts
packages/dtx-api/src/auth/schema.ts
packages/dtx-api/src/auth/session.ts
packages/dtx-api/src/auth/*.test.ts
packages/dtx-api/drizzle.auth.config.ts
packages/dtx-api/d1-migrations/0008_better_auth.sql
```

`createAuthOptions()` contains provider, cookie-prefix, rate-limit, trusted-web-origin, and plugin settings. Runtime supplies D1 and real secrets. CLI schema generation supplies non-production placeholders.

`packages/dtx-api/src/index.ts` routes requests in this order:

1. CORS preflight;
2. Better Auth `/api/auth/*` GET/POST;
3. existing GraphQL and REST;
4. not-found.

`resolveAuthSession()` normalizes Better Auth to local `ApiAuthUser` and session types. It applies the unsafe-cookie Origin rule before returning cookie-authenticated application sessions.

## Web Authentication

### SvelteKit hook

The hook no longer constructs a Supabase client.

It:

1. uses `event.platform?.env.API` when available, otherwise `PUBLIC_DTX_API_URL`;
2. forwards the incoming Cookie header to `/api/auth/get-session`;
3. captures every returned Set-Cookie value individually;
4. stores neutral user/session data in `event.locals`;
5. appends each raw Set-Cookie header to the SvelteKit response;
6. guards `/app` and preserves a validated `next` destination.

Delete the old desktop-specific branches:

- `redirect=desktop`;
- `desktop_callback` forwarding;
- the `DTXDesktopApp` form-CSRF bypass.

Device Authorization no longer posts forms from the desktop app into the web Worker.

### Login and Google OAuth

Use the Better Auth browser client for password and Google sign-in. Preserve `safeAppRedirectPath()` and sanitized errors from `$lib/auth/google.ts`.

Google callbacks terminate at `dtx-api`'s Better Auth handler. Delete the SvelteKit `/auth/callback` route after its reusable allowlist/error assertions have moved to retained helper/login/account tests.

### Every web API call uses cookies

The cookie cutover is complete only when all browser/SSR API seams are converted before `token.ts` is deleted.

Update together:

- `packages/dtx-web/src/lib/api/transport.ts`;
- `packages/dtx-web/src/lib/api/client.ts`;
- `packages/dtx-web/src/lib/api/download.ts`;
- API wrapper tests that mock `./token`;
- components/tests that consume `bulkDownloadHeaders`.

Browser GraphQL and download fetches use `credentials: 'include'` and no Authorization header.

Service-binding SSR GraphQL forwards `Cookie` and `new URL(DTX_WEB_URL).origin`. No token-shaped `ClientCtx.accessToken` remains.

Only after all token imports/tests are gone is `packages/dtx-web/src/lib/api/token.ts` deleted.

## Desktop Authentication

### Browser approval flow

1. Native code posts to `/api/auth/device/code` with `client_id=dtx-desktop`.
2. Better Auth returns device/user codes, verification URLs, interval, and expiry.
3. Native code keeps `device_code` only in memory and returns display-safe attempt data.
4. Renderer calls existing `open_external_url(verificationUriComplete)`.
5. Browser reaches `/app/desktop-auth?user_code=...`.
6. The `/app` guard requires a Better Auth web session.
7. The page verifies/claims the user code for that session.
8. The page requires explicit Approve or Deny.
9. Native code polls `/api/auth/device/token` at the required interval.
10. On approval, Better Auth returns the opaque session token.
11. Native code calls `/api/auth/get-session` with Bearer auth to obtain the user.
12. Native/renderer state stores one session token plus user data.

The API hostname stays outside Cloudflare Access. `/app/desktop-auth` stays under the protected application surface.

### Native command boundary

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

Keep Device Authorization HTTP protocol code in `device_auth.rs`, independent of Tauri UI APIs, and cover it with WireMock.

### Native DTOs and state

Define renderer-facing DTOs in `packages/dtx-desktop/src-tauri/src/api_contracts.rs` and generate TypeScript through the existing `ts-rs` export target.

Preserve authenticated user ID, session generation, and `AuthSessionEpoch` used by Google Drive reconciliation.

Remove production auth machinery for:

- magic-link parsing/exchange;
- auth deep-link handlers/queues;
- loopback TCP callback server;
- callback URL/port validation;
- JWT parsing;
- Supabase refresh/logout requests;
- refresh single-flight mutex;
- `magic-link-result` and `session-refreshed` events.

Remove the auth deep-link plugin/config only after repository search proves it has no non-auth use. Keep single-instance window focusing.

## Identity Migration

Every imported Better Auth `user.id` equals the existing Supabase UUID. Application ownership rows are not rewritten.

Import:

- user ID;
- email/name;
- verification state;
- timestamps;
- Google account identity;
- credential account only when an explicit replacement password is supplied.

Do not import Supabase sessions/access/refresh tokens.

Do not add bcrypt compatibility. Replacement credential passwords are hashed with Better Auth's own password helper during the one-shot import.

The local-only import tool consumes a sanitized Supabase Admin export and emits reviewed D1 SQL under ignored `tmp/auth-migration/`. It validates UUIDs/emails/providers, generates deterministic account IDs, escapes SQL, excludes sessions, and reconciles every distinct application owner ID.

Local/E2E setup seeds the Better Auth web test user into the same D1 prepared by `prepare-stack.ts`, which already applies every D1 migration lexically.

## Environment Contract

Add to `dtx-api`:

```text
BETTER_AUTH_URL
BETTER_AUTH_SECRET
DTX_WEB_URL
AUTH_COOKIE_DOMAIN
AUTH_COOKIE_PREFIX
GOOGLE_AUTH_CLIENT_ID
GOOGLE_AUTH_CLIENT_SECRET
```

Continue using:

```text
CORS_ALLOWED_ORIGINS
```

for CORS only.

Keep desktop:

```text
VITE_DTX_SERVER_URL
VITE_DTX_API_URL
GOOGLE_DRIVE_OAUTH_CLIENT_ID
```

Remove all Supabase and desktop auth-callback variables after cutover implementation.

## Delivery Strategy

### PR A — additive Better Auth foundation

Land and prove the non-destructive foundation first:

1. select/pin the implementation-time Better Auth 1.6.x patch and matching `auth` CLI;
2. generate Better Auth schema and `0008_better_auth.sql`;
3. mount `/api/auth/*` without changing application authorization;
4. make CORS credential-capable;
5. add cookie prefix/trusted web origin/rate-limit configuration;
6. add `resolveAuthSession()` plus tests but **leave `verifyToken()` wired into GraphQL/REST**;
7. add the production `API -> dtx-api` service binding;
8. deploy the additive foundation to pre-production and smoke-test migration/handler/session primitives.

During PR A, Supabase remains the only authorization source for existing application GraphQL/REST. Better Auth endpoints exist, but there is no compatibility path that accepts both providers for application data.

`0008_better_auth.sql` is additive. If PR A is rolled back, the new tables may remain unused.

### PR B — atomic application cutover

The second PR performs all consumer wiring and deletion together:

1. switch GraphQL/REST authorization to `resolveAuthSession()`;
2. remove custom magic links;
3. move web sessions/sign-in/linking/API traffic to Better Auth cookies;
4. add browser desktop approval;
5. move desktop to Device Authorization/Bearer;
6. retarget native/renderer E2E auth seams;
7. add identity import and D1 E2E seed;
8. remove Supabase dependencies/config/typegen;
9. run web/desktop E2E;
10. write/reconcile the operator runbook and Zero Trust docs;
11. prove the full candidate in pre-production.

PR B is not deployable mid-commit. Its branch may temporarily contain consumer mismatches while individual tasks are developed; merge/deploy happens only after the final full-system gate passes.

Production identity import/deploy remains a separate operator action after PR B review and pre-production proof.

## Risks and Mitigations

### Cross-environment cookie collision

**Risk:** production domain cookies are sent to nested pre-production hosts.  
**Mitigation:** distinct `cookiePrefix` values per environment, plus distinct backing D1/session tables.

### Origin misconfiguration

**Risk:** CORS pre-production localhost entries accidentally become auth/open-redirect trust.  
**Mitigation:** `DTX_WEB_URL` alone defines Better Auth `trustedOrigins` and unsafe cookie mutation Origin.

### SSR auth latency / D1 rate-limit writes

**Risk:** public API round-trip and database limiter write on each session lookup.  
**Mitigation:** production service binding + `/get-session` rate-limit exemption.

### Identity drift

**Risk:** imported auth IDs do not cover application ownership keys.  
**Mitigation:** deterministic import + hard reconciliation query before pre-production/production cutover.

### Desktop E2E drift

**Risk:** existing E2E still requires Supabase refresh-token-shaped storage while production code no longer has refresh tokens.  
**Mitigation:** explicitly retarget native E2E seed/validation and all renderer E2E session setup to `{ sessionToken, user }`.

### OAuth callback/config drift

**Risk:** Google callbacks or environment origins are misconfigured.  
**Mitigation:** exact callback/origin matrix in pre-production proof and production runbook.

### Rollback after foundation migration

**Risk:** D1 contains Better Auth tables after code rollback.  
**Mitigation:** tables are additive and can remain unused; rollback does not require destructive DDL.

## Testing Strategy

### Foundation PR A

Cover:

- exact Better Auth/CLI version agreement;
- generated schema/migration contract;
- all D1 migrations apply to fresh local state;
- auth handler routing;
- credentialed preflight/normal CORS;
- two Set-Cookie values survive `withCors()`;
- environment-specific cookie prefix;
- canonical `DTX_WEB_URL` trusted origin;
- `/get-session` rate-limit exemption;
- neutral cookie/Bearer resolver unit tests;
- `verifyToken()` remains the live GraphQL/REST authorization seam;
- production service-binding config/type surface;
- pre-production anonymous/session/device-handler smoke checks.

### Cutover PR B — API/Web

Cover:

- cookie and Bearer session resolution wired into GraphQL/REST;
- unsafe cookie request with exact DTX web Origin;
- unsafe cookie request with missing/different Origin;
- Bearer request with no Origin;
- neutral `{ id }` user through GraphQL/REST;
- magic-link schema removal;
- session loading/rolling Set-Cookie propagation;
- `/app` guard and safe `next`;
- removal of desktop redirect/callback branches and desktop CSRF bypass;
- password login;
- Google login error mapping;
- explicit Google linking;
- logout;
- browser GraphQL credentials;
- service-binding Cookie + canonical Origin forwarding;
- single/bulk download credentials;
- no remaining `getAccessTokenOrNull` mocks/imports;
- device code claim/approve/deny.

### Cutover PR B — Desktop

Cover:

- code request;
- pending/slow-down/approve/deny/expiry/invalid-grant;
- cancellation/generation races;
- one-token persistence;
- `SessionValidationStatus` valid/invalid/not-configured;
- restore/logout;
- Bearer API requests;
- preserved session epoch/Drive reconciliation;
- E2E `AuthState::for_e2e_user`/`SessionData`/validation shape;
- WDIO/standalone session user injection;
- renderer E2E session storage;
- crash-recovery E2E session storage;
- absence of production magic-link/deep-link/loopback/JWT/refresh behavior.

## Completion Definition

The migration is ready for production operator execution when:

- PR A has been merged/deployed and its additive pre-production smoke proof passes;
- PR B static/type/unit/Rust/E2E checks pass;
- D1 holds Better Auth core, Device Authorization, and rate-limit tables;
- existing application owner UUIDs are preserved by import tooling;
- password and Google web sign-in use Better Auth;
- implicit linking/signup remain disabled;
- `DTX_WEB_URL` is the authentication trust origin and `CORS_ALLOWED_ORIGINS` is CORS-only;
- production/pre-production cookies have distinct prefixes;
- credentialed CORS is enabled on preflight and normal responses;
- `/get-session` does not use the database rate limiter;
- browser GraphQL/REST uses cookie sessions with unsafe-method canonical-Origin validation;
- production SSR uses the API service binding;
- desktop uses Device Authorization and opaque Bearer sessions;
- desktop retains valid/invalid/not-configured and Drive session-epoch semantics;
- desktop E2E no longer requires refresh-token-shaped Supabase storage;
- no production auth magic-link/deep-link/loopback/JWT/refresh-token machinery remains;
- no active package/config/test depends on Supabase;
- obsolete root/turbo Supabase `gen-types` is removed;
- full pre-production acceptance passes;
- the production runbook is ready for separate operator execution.
