# Better Auth and Cloudflare D1 Migration Design

**Status:** Approved direction, implementation pending  
**Date:** 2026-08-18  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb already stores application data in Cloudflare D1. Supabase remains as the authentication provider and as Supabase-shaped session plumbing across the web app, API, desktop app, E2E setup, dependencies, generated types, and environment configuration.

Complete the migration by hosting Better Auth 1.6.25 in `dtx-api`, storing Better Auth tables in the existing D1 database, using cookies for web authentication, and replacing the desktop magic-link/deep-link protocol with Better Auth Device Authorization plus opaque Bearer sessions.

The cutover stays intentionally small:

- one auth runtime in `dtx-api`;
- one D1 database;
- the official Better Auth Drizzle adapter;
- no dual-auth compatibility mode;
- no OAuth Provider/JWT/JWKS layer;
- no second Worker;
- no custom device protocol;
- no permanent bcrypt compatibility.

The migration invalidates active Supabase sessions. Existing application ownership identifiers are preserved exactly.

## Current State

### Application data is already D1-backed

`dtx-api` owns the `DB` binding and versioned Wrangler D1 migrations. Shared application queries use the existing D1 schema for simfiles, DTX files, user profiles, chart scores, and scores.

Runtime application data no longer depends on Supabase tables or Supabase Storage.

Application ownership is keyed by Supabase UUIDs stored as text, including `simfiles.user_id`, `user_profiles.user_id`, and `chart_scores.user_id`. Those columns do not need to become foreign keys to Better Auth.

### Remaining Supabase responsibilities

Supabase still owns or shapes:

- SvelteKit SSR/browser session creation and validation;
- password sign-in, Google sign-in, explicit provider linking, and logout;
- API Bearer-token validation;
- desktop magic-link generation and exchange;
- desktop deep-link and loopback callback handling;
- desktop JWT expiry parsing and refresh-token rotation;
- E2E user provisioning;
- environment variables, dependencies, generated Supabase types, and mocks.

The desktop path has the largest simplification opportunity. Device Authorization removes the custom magic-link mutation, callback allowlists, auth URI schemes, loopback HTTP server, JWT decoder, refresh lock, and session-refresh events.

## Goals

1. Make D1 the only database used by DTXWeb runtime services.
2. Replace Supabase Auth with Better Auth 1.6.25.
3. Preserve every migrated Supabase UUID as the matching Better Auth `user.id`.
4. Keep password and Google sign-in for existing users.
5. Keep Google linking explicit and signup disabled.
6. Authenticate browser API traffic with Better Auth cookies.
7. Authenticate desktop API traffic with Device Authorization plus opaque Bearer sessions.
8. Remove all runtime Supabase dependencies, variables, callbacks, refresh logic, generated types, and E2E bootstrap code.
9. Keep production cutover operations in an operator runbook, not in the implementation task list.

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

`dtx-web` does not receive a D1 binding. Production web also has no API service binding today, so browser production traffic continues to call `PUBLIC_DTX_API_URL` directly.

This avoids two auth instances, another Worker, or a new internal auth service.

### 2. Use the official Drizzle-on-D1 adapter

Follow Better Auth 1.6.25's Cloudflare pattern:

```ts
const db = drizzle(env.DB, { schema: authSchema });

database: drizzleAdapter(db, {
  provider: 'sqlite',
});
```

This mirrors the existing `createDrizzleDb()` shape in `@dtx/common/server`, but the Better Auth schema remains owned by `dtx-api` because it is auth-runtime data, not application-domain data.

The pinned Better Auth CLI generates `packages/dtx-api/src/auth/schema.ts`. `drizzle-kit export` produces reviewed flat SQL for `packages/dtx-api/d1-migrations/0008_better_auth.sql`. Wrangler remains the only production migration executor.

### 3. Keep one origin allowlist

`CORS_ALLOWED_ORIGINS` is the single configured list of browser origins trusted to call `dtx-api`.

Export the parser/read helper from `packages/dtx-api/src/lib/cors.ts` and reuse the same set for:

- CORS response headers;
- Better Auth `trustedOrigins`;
- cookie-authenticated unsafe API request validation.

Do not introduce a second `TRUSTED_ORIGINS` setting.

`DTX_WEB_URL` remains because Device Authorization needs one canonical web URL for `verificationUri`.

### 4. Use cross-subdomain cookies for web sessions

| Environment | API base URL | Web origin | Cookie domain |
| --- | --- | --- | --- |
| Production | `https://api.dtx.hapadona.com` | `https://dtx.hapadona.com` | `dtx.hapadona.com` |
| Pre-production | `https://api.pre-prod.dtx.hapadona.com` | `https://pre-prod.dtx.hapadona.com` | `pre-prod.dtx.hapadona.com` |
| Local | `http://localhost:8787` | `http://localhost:5173` | omitted |

CORS echoes only allow-listed origins, sets `Access-Control-Allow-Credentials: true`, and includes `Vary: Origin`. Browser auth, GraphQL, and authenticated REST requests use `credentials: 'include'`.

Because the production cookie domain is a parent of pre-production hostnames, cookie authentication must not rely on CORS alone as its CSRF boundary.

### 5. Enforce Origin on unsafe cookie-authenticated API requests

`resolveAuthSession()` distinguishes authentication transport:

- If a valid `Authorization: Bearer` header is present, validate it with Better Auth and do not require `Origin`. This is the desktop/native path.
- If authentication comes from cookies and the method is `POST`, `PUT`, `PATCH`, or `DELETE`, require `Origin` to be present and contained in `CORS_ALLOWED_ORIGINS` before accepting the session.
- Cookie-authenticated `GET`/`HEAD` stays usable without `Origin` so normal authenticated reads and navigation/download paths are not broken.

An unsafe request with a cookie but an absent/disallowed Origin is treated as unauthenticated at the shared session boundary. Protected GraphQL/REST code then returns its existing forbidden/unauthorized result.

SvelteKit service-binding GraphQL calls explicitly forward both the incoming cookie and the trusted web origin so they satisfy the same rule. Production, which has no service binding, uses normal browser `Origin` headers.

Better Auth's own `/api/auth/*` handler keeps Better Auth's built-in origin/CSRF checks enabled.

### 6. Preserve multiple `Set-Cookie` headers

Cloudflare Workers exposes multiple `Set-Cookie` values separately. Any wrapper that reconstructs a `Response` must preserve their cardinality.

`withCors()` gets a regression test with two `Set-Cookie` values. When copying a response, preserve the array returned by the Workers `Headers` cookie API rather than flattening cookies through `headers.get('set-cookie')`.

The SvelteKit session hook also reads all returned Set-Cookie values and appends each raw header to the eventual web response. It does not parse and reserialize Better Auth cookies.

This keeps login/session rotation correct without adding a cookie-parsing dependency.

### 7. Disable signup and implicit linking

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

### 8. Reuse the existing web redirect/error allowlist

Do not create a second redirect helper.

Keep `packages/dtx-web/src/lib/auth/google.ts` as the application-auth redirect/error seam:

- retain `safeAppRedirectPath()`;
- retain sanitized Google/auth error messages;
- retain explicit-linking messages;
- delete only the Supabase-specific `/auth/callback` URL builders and desktop redirect intent after callers are migrated.

Existing login and callback tests are retargeted so the current allowlist/error cases remain covered instead of being replaced by thinner tests.

### 9. Use Device Authorization and Bearer for desktop

DTX Desktop is a first-party client of the same application. It does not need OAuth Provider, scopes, JWT access tokens, JWKS, or refresh-token rotation.

Configure:

```ts
plugins: [
  deviceAuthorization({
    verificationUri: `${config.webURL}/app/desktop-auth`,
    validateClient: (clientId) => clientId === 'dtx-desktop',
  }),
  bearer(),
]
```

`/device/token` returns a Better Auth session token in `access_token`. Desktop sends it as `Authorization: Bearer <token>`. The same Better Auth `getSession` path validates browser cookies and desktop bearer sessions.

### 10. Preserve desktop session-validation semantics

Keep the existing renderer/native contract:

```text
valid | invalid | not-configured
```

`validate_session` is retargeted, not redesigned:

- missing/blank desktop API configuration => `not-configured`;
- authenticated `/api/auth/get-session` returns the user => `valid`;
- 401/no session => `invalid`;
- transport/server failure remains fail-closed according to the current restore behavior and must not be mislabeled as local configuration absence.

The desktop never receives `BETTER_AUTH_SECRET`; that secret remains server-only.

### 11. Keep API auth user types minimal

After the magic-link mutation is removed, GraphQL/REST authorization only needs the user identifier.

Use a neutral API type such as:

```ts
type ApiAuthUser = {
  id: string;
};
```

Add `email` only at a boundary that actually renders or needs it. Do not re-export or emulate Supabase `User`/`Session` shapes.

The web session model may expose Better Auth user fields needed by the UI; that is separate from `dtx-api`'s authorization type.

## Better Auth Server

### File boundary

```text
packages/dtx-api/src/auth/options.ts
packages/dtx-api/src/auth/auth.ts
packages/dtx-api/src/auth/auth.cli.ts
packages/dtx-api/src/auth/schema.ts
packages/dtx-api/src/auth/session.ts   # rename/rewrite of the current verifier seam
packages/dtx-api/src/auth/*.test.ts
packages/dtx-api/drizzle.auth.config.ts
packages/dtx-api/d1-migrations/0008_better_auth.sql
```

`createAuthOptions()` contains provider, cookie, rate-limit, origin, and plugin settings. Runtime supplies D1 and real secrets. CLI schema generation supplies non-production placeholders.

### Router order

`packages/dtx-api/src/index.ts` handles:

1. CORS preflight;
2. Better Auth `/api/auth/*` GET/POST;
3. GraphQL and REST;
4. not-found.

Do not add Hono solely to mount auth.

### Neutral session resolver

Rename/rewrite the current verifier seam into `packages/dtx-api/src/auth/session.ts`:

```ts
type ResolvedAuthSession = {
  user: ApiAuthUser;
  session: { id: string };
};

resolveAuthSession(request, env): Promise<ResolvedAuthSession | null>
```

The implementation:

1. classifies Bearer versus cookie transport;
2. applies the unsafe-cookie Origin rule;
3. calls `createAuth(env).api.getSession({ headers: request.headers })`;
4. normalizes provider-specific data to the local type;
5. returns null for missing/invalid credentials.

GraphQL context and protected REST routes use this one helper.

### Auth rate limiting

Use Better Auth's database-backed rate limiter with `cf-connecting-ip`.

Keep `RATE_LIMIT_API` for downloads and other existing API rate limits. Delete only magic-link-specific keys/configuration.

## Web Authentication

### SvelteKit hook

The hook no longer constructs a Supabase client.

It:

1. forwards the incoming `Cookie` header to `/api/auth/get-session`;
2. captures all returned Set-Cookie headers;
3. stores neutral user/session data in `event.locals`;
4. appends each raw Set-Cookie header to the SvelteKit response;
5. guards `/app` and preserves a validated `next` destination.

Delete the old desktop-specific branches:

- `redirect=desktop`;
- `desktop_callback` forwarding;
- the `DTXDesktopApp` form-CSRF bypass.

Device Authorization no longer posts forms from the desktop app into the web Worker.

### Login and Google OAuth

Use the Better Auth browser client for password and Google sign-in. Preserve `safeAppRedirectPath()` and sanitized errors from `$lib/auth/google.ts`.

Google callbacks terminate at `dtx-api`'s Better Auth handler. Delete the SvelteKit `/auth/callback` route after its reusable allowlist/error assertions have been moved to the retained helper/login/account tests.

### Every web API call uses cookies

The cookie cutover is complete only when all browser/SSR API seams are converted before `token.ts` is deleted.

Update together:

- `packages/dtx-web/src/lib/api/transport.ts`;
- `packages/dtx-web/src/lib/api/client.ts`;
- `packages/dtx-web/src/lib/api/download.ts`;
- API wrapper tests that mock `./token`;
- components/tests that consume `bulkDownloadHeaders`.

Browser GraphQL and download fetches use `credentials: 'include'` and no Authorization header.

Service-binding SSR GraphQL forwards `Cookie` and the trusted web `Origin`. No token-shaped `ClientCtx.accessToken` remains.

Only after those imports/tests are gone is `packages/dtx-web/src/lib/api/token.ts` deleted.

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

Preserve the current authenticated user ID, session generation, and session epoch used by Google Drive reconciliation.

Remove:

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

### Preserve IDs

Every imported Better Auth `user.id` equals the existing Supabase UUID. Application ownership rows are not rewritten.

Import:

- user ID;
- email/name;
- verification state;
- timestamps;
- Google account identity;
- credential account only when an explicit replacement password is supplied.

Do not import Supabase sessions/access/refresh tokens.

### Password policy

Do not add bcrypt compatibility. Replacement credential passwords are hashed with Better Auth's own password helper during the one-shot import.

### Import tooling

Create a local-only script that consumes a sanitized Supabase Admin export and emits reviewed D1 SQL under `tmp/auth-migration/`.

It must:

- validate UUIDs and unique emails;
- reject unsupported providers;
- generate deterministic account IDs;
- escape SQL values safely;
- exclude sessions;
- reconcile every distinct application owner ID;
- never send Supabase secrets to a Worker.

Local/E2E setup seeds the Better Auth test user into the same D1 prepared by `prepare-stack.ts`, which already applies every D1 migration in lexical order.

## Environment Contract

Add to `dtx-api`:

```text
BETTER_AUTH_URL
BETTER_AUTH_SECRET
DTX_WEB_URL
AUTH_COOKIE_DOMAIN
GOOGLE_AUTH_CLIENT_ID
GOOGLE_AUTH_CLIENT_SECRET
```

Continue using:

```text
CORS_ALLOWED_ORIGINS
```

as the single browser-origin trust list.

Keep desktop:

```text
VITE_DTX_SERVER_URL
VITE_DTX_API_URL
GOOGLE_DRIVE_OAUTH_CLIENT_ID
```

Remove all Supabase and desktop auth-callback variables after the cutover implementation is complete.

## Cutover Strategy

### Code PR

The implementation PR ends when:

- static/type/unit/Rust checks pass;
- generated auth/GraphQL/native artifacts are clean;
- Supabase residue gates pass;
- web and desktop E2E pass without Supabase credentials;
- pre-production migration/deployment/acceptance has been proven;
- the production runbook is complete.

Do not execute production D1 identity import, production deployment, desktop publication, or credential removal as an implementation-plan task.

### Operator runbook

The runbook owns production actions:

1. backup/export;
2. configure Better Auth/Google secrets and callbacks;
3. apply `0008_better_auth.sql`;
4. apply reviewed identity-import SQL;
5. reconcile owner IDs;
6. deploy API then web;
7. publish/install the desktop build;
8. run web/desktop/Access smoke matrices;
9. prove Supabase can be disabled;
10. retain rollback artifacts for the cutover window.

Rollback redeploys the previous API/web/desktop versions. Additive Better Auth tables may remain during rollback.

## Testing Strategy

### API

Cover:

- generated schema/migration contract;
- auth handler routing;
- credentialed CORS;
- two Set-Cookie values survive `withCors`;
- cookie and Bearer session resolution;
- unsafe cookie request with allowed Origin;
- unsafe cookie request with missing/disallowed Origin;
- Bearer request with no Origin;
- neutral `{ id }` user type through GraphQL/REST;
- magic-link schema removal.

### Web

Cover:

- session loading/rolling Set-Cookie propagation;
- `/app` guard and safe `next`;
- removal of desktop redirect/callback branches and desktop CSRF bypass;
- password login;
- Google login error mapping;
- explicit Google linking;
- logout;
- browser GraphQL credentials;
- service-binding Cookie + Origin forwarding;
- single/bulk download credentials;
- no remaining `getAccessTokenOrNull` mocks/imports;
- device code claim/approve/deny.

### Desktop

Cover:

- code request;
- pending/slow-down/approve/deny/expiry/invalid-grant;
- cancellation/generation races;
- one-token persistence;
- `SessionValidationStatus` valid/invalid/not-configured;
- restore/logout;
- Bearer API requests;
- preserved session epoch/Drive reconciliation;
- absence of magic-link/deep-link/loopback/JWT/refresh behavior.

### E2E

Web E2E uses a D1-seeded Better Auth user. Desktop integration uses the supported Device Authorization flow or seeded Better Auth session setup, without test-only auth protocols.

## Completion Definition

The migration is complete when:

- D1 holds Better Auth core, Device Authorization, and rate-limit tables;
- existing application owner UUIDs are preserved;
- password and Google web sign-in use Better Auth;
- implicit linking/signup remain disabled;
- browser GraphQL/REST uses cookie sessions with unsafe-method Origin validation;
- desktop uses Device Authorization and opaque Bearer sessions;
- desktop retains the valid/invalid/not-configured restore contract;
- no auth magic-link/deep-link/loopback/JWT/refresh-token machinery remains;
- no active package/config/test depends on Supabase;
- the obsolete root/turbo Supabase `gen-types` task is removed;
- unit, integration, Rust, web E2E, and desktop E2E checks pass;
- pre-production acceptance passes;
- the production runbook is ready for operator execution.