# Better Auth and Cloudflare D1 Migration Design

**Status:** Approved direction, implementation pending  
**Date:** 2026-08-18  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb already stores application data in Cloudflare D1. Supabase remains as the authentication provider and as Supabase-shaped session plumbing across the web app, API, desktop app, tests, environment configuration, and generated types.

This design completes the migration by hosting Better Auth in `dtx-api`, storing Better Auth data in the existing D1 database, moving browser requests to Better Auth cookie sessions, and replacing the desktop magic-link/deep-link protocol with Better Auth Device Authorization plus Bearer sessions.

The cutover is intentionally direct. There is no dual-auth feature flag, long-lived Supabase verifier, custom device protocol, OAuth Provider/JWT layer, or second auth Worker.

## Current State

### Application data

The application data path is already D1-backed:

- `dtx-api` owns the `DB` binding and versioned D1 migrations.
- Shared server queries use the existing D1 schema for simfiles, DTX files, user profiles, chart scores, and scores.
- Runtime code no longer uses Supabase tables or Supabase Storage.

Application ownership is keyed by the current Supabase user UUID stored as text. At minimum, `simfiles.user_id`, `user_profiles.user_id`, and `chart_scores.user_id` depend on that value.

### Remaining Supabase responsibilities

Supabase still owns or shapes:

- Web SSR/browser session creation and validation.
- Password sign-in, Google OAuth, explicit provider linking, and logout.
- API bearer-token validation.
- Desktop magic-link generation and exchange.
- Desktop deep-link and loopback callback handling.
- Desktop JWT expiry parsing and refresh-token rotation.
- E2E user provisioning.
- Environment variables, dependencies, generated Supabase types, and mocks.

The desktop path has the largest migration payoff. Better Auth Device Authorization replaces the custom GraphQL magic-link mutation, callback validation, URI schemes, loopback server, JWT decoding, refresh lock, and session-refresh events.

## Goals

1. Make D1 the only database used by DTXWeb runtime services.
2. Replace Supabase Auth with Better Auth 1.6.25.
3. Preserve every migrated user's existing UUID as the Better Auth user ID.
4. Keep password and Google sign-in for existing users.
5. Keep Google account linking explicit.
6. Use Better Auth Device Authorization for desktop sign-in.
7. Use Better Auth's Bearer plugin for desktop GraphQL and REST requests.
8. Remove runtime Supabase dependencies, variables, callbacks, refresh logic, generated types, and test bootstrap code.
9. Keep the architecture small and first-party-client focused.

## Non-goals

This migration does not add:

- Public registration.
- Password-reset or email-verification delivery.
- Passkeys, two-factor authentication, organizations, roles, or an admin dashboard.
- Better Auth Infrastructure.
- An OAuth 2.1/OIDC provider, JWT/JWKS issuance, scopes, or API keys.
- A second auth Worker or second D1 database.
- KV/Redis session storage.
- Desktop keychain migration.
- Backward compatibility for active Supabase sessions.
- A permanent bcrypt compatibility layer.

Active Supabase sessions are invalidated at cutover. Users sign in again through Better Auth.

## Decisions

### 1. Host Better Auth in `dtx-api`

`dtx-api` already owns D1 and the public API hostname. It mounts Better Auth under `/api/auth/*` before the existing GraphQL and REST router.

This avoids giving the web Worker a D1 binding, running two auth instances, sharing auth internals between Workers, or making desktop polling depend on a Cloudflare Access-protected hostname.

`dtx-web` remains the browser UI and desktop approval surface.

### 2. Use Better Auth's official Drizzle adapter over D1

Better Auth 1.6.25's Cloudflare fixture uses a request-scoped Drizzle client and the official adapter:

```ts
database: drizzleAdapter(drizzle(env.DB, { schema }), {
  provider: "sqlite",
})
```

The generated auth schema lives at `packages/dtx-api/src/auth/schema.ts`. The existing application-data schema remains unchanged.

The pinned Better Auth CLI generates the Drizzle schema. `drizzle-kit export` emits reviewed SQL into the repository's existing Wrangler D1 migration flow. Wrangler remains the only production migration executor.

### 3. Keep auth rate limiting inside Better Auth

Better Auth uses its database-backed rate limiter. Behind Cloudflare it reads `cf-connecting-ip` rather than trusting a client-controlled forwarded chain.

The existing `RATE_LIMIT_API` KV binding remains for downloads and other API features. Only magic-link-specific rate-limit code and variables are removed.

### 4. Use cross-subdomain cookies for web sessions

Better Auth runs on the API hostname while SvelteKit runs on the web hostname.

| Environment | API base URL | Web origin | Cookie domain |
| --- | --- | --- | --- |
| Production | `https://api.dtx.hapadona.com` | `https://dtx.hapadona.com` | `dtx.hapadona.com` |
| Pre-production | `https://api.pre-prod.dtx.hapadona.com` | `https://pre-prod.dtx.hapadona.com` | `pre-prod.dtx.hapadona.com` |
| Local | `http://localhost:8787` | `http://localhost:5173` | omitted |

CORS echoes only configured origins, sets `Access-Control-Allow-Credentials: true`, and includes `Vary: Origin`. Browser auth and GraphQL requests use `credentials: "include"`.

### 5. Disable signup and implicit linking

```ts
emailAndPassword: {
  enabled: true,
  disableSignUp: true,
},
socialProviders: {
  google: {
    clientId: env.GOOGLE_AUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_AUTH_CLIENT_SECRET,
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

Imported Google accounts can sign in. An authenticated user can link Google explicitly with `linkSocial()`.

The Google Auth client is separate from the existing Google Drive OAuth client used by the desktop app.

### 6. Use Device Authorization and Bearer, not OAuth Provider/JWT

DTX Desktop is a first-party client of the same application. It does not need third-party client registration, scopes, resource audiences, refresh tokens, JWT verification, or JWKS.

```ts
plugins: [
  deviceAuthorization({
    verificationUri: `${env.DTX_WEB_URL}/app/desktop-auth`,
    validateClient: (clientId) => clientId === "dtx-desktop",
  }),
  bearer(),
]
```

`/device/token` returns a Better Auth session token in `access_token`. Desktop sends that opaque token as `Authorization: Bearer <token>`. `auth.api.getSession({ headers })` validates both browser cookies and desktop bearer sessions.

## Target Architecture

```text
                                 Cloudflare D1
                    application tables + Better Auth tables
                                        ▲
                                        │
                         api.dtx.hapadona.com
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
          /api/auth/*                                  /graphql + REST
        Better Auth handler                         resolve Better Auth session
                 │                                             │
       ┌─────────┴─────────┐                                   │
       │                   │                                   │
Web browser cookie    Desktop device flow ── Bearer session ───┘
       │
dtx.hapadona.com
login, account, and
/app/desktop-auth UI
```

## Better Auth Server

### File boundary

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

`createAuthOptions(config)` contains shared provider, cookie, rate-limit, and plugin settings. Runtime supplies D1 and real secrets. CLI schema generation supplies non-production placeholders and the pinned Drizzle SQLite adapter metadata.

### Runtime instance

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

The instance is request-scoped because the Cloudflare D1 binding is request-scoped.

### Router order

`packages/dtx-api/src/index.ts` handles requests in this order:

1. CORS preflight.
2. Better Auth `/api/auth/*` GET/POST handler.
3. Existing GraphQL and REST routes.
4. Existing not-found response.

The Worker does not add Hono or another router solely for auth mounting.

### Neutral session resolver

`packages/dtx-api/src/auth/session.ts` exposes one boundary:

```ts
resolveAuthSession(request, env): Promise<{
  user: AuthUser | null;
  session: AuthSession | null;
}>
```

It calls `createAuth(env).api.getSession({ headers: request.headers })` and normalizes missing or invalid sessions to null.

GraphQL context and protected REST routes use the same helper. The current `verifyToken()` function is removed.

### Remove custom magic links

Delete:

- GraphQL `generateMagicLink` mutation and service.
- Generated web GraphQL operation and wrapper.
- Web `/app?redirect=desktop` handoff.
- Magic-link rate-limit configuration.

Device Authorization endpoints become the only desktop authentication protocol.

## Web Authentication

### Server hook

The SvelteKit hook no longer constructs a Supabase client. It calls the API session endpoint with the incoming cookie header, stores neutral user/session data in `event.locals`, and keeps the existing `/app` route guard and safe `next` handling.

When Better Auth rotates a cookie, the hook forwards all returned `Set-Cookie` headers to the browser.

### Browser client

Create one Better Auth Svelte client pointed at `PUBLIC_DTX_API_URL` with `credentials: "include"` and the Device Authorization client plugin.

The root layout stops exposing a Supabase client. Page data contains only neutral session/user data.

### Login and Google OAuth

The login page uses:

```ts
authClient.signIn.email({ email, password })
authClient.signIn.social({ provider: "google", callbackURL })
```

After password sign-in, the page performs a full navigation to the validated `next` route. Google callbacks terminate at the API hostname; the custom SvelteKit `/auth/callback` route is removed.

### GraphQL transport

The generated GraphQL layer remains unchanged.

- Browser requests use `credentials: "include"` and no bearer header.
- SvelteKit service-binding requests forward the incoming `Cookie` header.
- Desktop requests keep `Authorization: Bearer`, now carrying a Better Auth session token.

`packages/dtx-web/src/lib/api/token.ts` is removed.

### Logout and account linking

Logout calls `authClient.signOut()` and navigates to `/login`.

The account page uses Better Auth account APIs and explicit `linkSocial({ provider: "google" })`. Supabase identity objects disappear from the UI contract.

## Desktop Authentication

### Browser approval flow

1. Rust posts to `/api/auth/device/code` with `client_id=dtx-desktop`.
2. Better Auth returns device/user codes, verification URLs, interval, and expiry.
3. Rust stores only the opaque `device_code` in native memory and returns display-safe attempt data.
4. The renderer calls the existing `open_external_url` command with `verification_uri_complete` and shows `user_code`.
5. The browser reaches `/app/desktop-auth?user_code=...`.
6. The web auth guard requires a Better Auth browser session.
7. The page calls the Device Authorization verification endpoint to claim the code for that session.
8. The page shows the code/client and requires explicit Approve or Deny.
9. Rust polls `/api/auth/device/token` at the server interval.
10. On approval, Better Auth returns the opaque session token.
11. Rust calls `/api/auth/get-session` with Bearer auth to obtain the user.
12. Native and renderer state persist one session token plus user data.

The API hostname stays outside Cloudflare Access so issuance and polling work. The approval route remains under `/app`, preserving PR #221's operator-only production gate.

### Native command boundary

```text
begin_device_authorization
poll_device_authorization
cancel_device_authorization
validate_session
get_current_session
logout_session
open_external_url
```

The migration preserves the existing `validate_session`, `get_current_session`, `logout_session`, and `open_external_url` names. Only their Supabase-shaped payloads change.

`begin_device_authorization` returns `userCode`, `verificationUri`, `verificationUriComplete`, and `expiresAt`. It never exposes `device_code`.

`poll_device_authorization` handles:

- `authorization_pending`: continue.
- `slow_down`: add five seconds.
- `access_denied`: stop with denial.
- `expired_token`: stop and require restart.
- `invalid_grant`: clear the attempt.
- Network failure: return a retryable error.

Only one pending attempt exists. A generation counter or cancellation token prevents an older poll from committing after cancel/restart.

### Native state and persistence

Replace arbitrary Supabase JSON with typed `DesktopAuthUser`, `DesktopAuthSession`, and `DeviceAuthorizationAttempt` contracts generated from `src-tauri/src/api_contracts.rs` into `src/renderer/src/lib/generated/native-api-contracts.ts`.

Renderer persistence stores only:

```ts
interface StoredDesktopAuthSession {
  sessionToken: string;
  user: DesktopAuthUser;
}
```

Keep the existing local-storage mechanism for this migration. Moving the token to the OS keychain is a separate hardening task.

Preserve the current authenticated user ID, session generation, and session epoch used by Google Drive state reconciliation.

### Remove callback machinery

Delete:

- Magic-link parsing/exchange.
- Auth deep-link handlers and queues.
- Loopback TCP callback server.
- Callback URL/port validation.
- JWT payload parsing.
- Supabase refresh/logout REST calls.
- Refresh single-flight mutex.
- `magic-link-result` and `session-refreshed` events.

Remove `tauri-plugin-deep-link` after no non-test use remains. Keep `tauri-plugin-single-instance` for window focusing, without auth URL extraction.

## Identity Migration

### Preserve IDs

Every Better Auth `user.id` must equal the existing Supabase UUID. Application ownership rows are not rewritten.

The migration imports:

- User ID.
- Email and name.
- Email verification state.
- Created/updated timestamps.
- Google provider/account identity.
- Credential account only when a replacement password is supplied.

Do not import Supabase sessions, access tokens, or refresh tokens.

### Password policy

Supabase password hashes are bcrypt while Better Auth defaults to scrypt. There are no external users and backward compatibility is not required, so do not add permanent bcrypt verification.

For each credential user, provide a replacement password during the one-shot import and hash it with Better Auth's own password helper. Users without a replacement password use an imported Google account or are reset manually before cutover.

### One-shot import tool

Create a local-only script that consumes a sanitized Supabase Admin export and emits reviewed D1 SQL. It must:

- Validate UUIDs and unique emails.
- Reject unsupported providers instead of guessing.
- Generate deterministic account IDs.
- Escape SQL values safely.
- Exclude sessions.
- Reconcile every distinct application owner ID against imported users.
- Write only under `tmp/auth-migration/`, which remains ignored.
- Never send Supabase secrets to a Worker.

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

Secrets are Wrangler secrets. URL/domain/client-ID values are environment vars.

Keep desktop:

```text
VITE_DTX_SERVER_URL
VITE_DTX_API_URL
GOOGLE_DRIVE_OAUTH_CLIENT_ID
```

Remove Supabase and desktop auth-callback variables after cutover.

## Error Handling

### Web

- Invalid credentials remain on login with a sanitized message.
- `account_not_linked` instructs the user to sign in with the existing method and link Google explicitly.
- Invalid/expired device codes show a restart message.
- Approval/denial controls disable while in flight.

### Desktop

- Pending and slow-down are internal polling states.
- Denial and expiry are distinct user-facing outcomes.
- Invalid stored sessions clear local/native state.
- Logout clears local state even when server revocation fails.
- Browser-opening failure shows the plain verification URL and code.

### API

- Better Auth owns auth endpoint errors.
- GraphQL and REST preserve current unauthorized semantics.
- Public download behavior remains controlled by the existing flag.
- Credentialed CORS never uses `*`.

## Security Boundary

Better Auth owns password hashing, OAuth state/callback validation, signed cookies, session storage/expiry, CSRF/origin checks, device-code generation/claiming/approval/polling/expiry, Bearer validation/revocation, and auth rate limiting.

DTXWeb owns exact origins/cookie domains, secret storage, Access placement, approval UI, ownership-ID preservation, and local desktop cleanup.

## Deployment and Cutover

The implementation ships as one code PR but is proved in stages.

### Pre-production

1. Apply `0008_better_auth.sql`.
2. Configure Better Auth and Google secrets.
3. Import pre-production identities.
4. Deploy API and web.
5. Build desktop against pre-production.
6. Prove password, Google, linking, logout, GraphQL, REST, device approval/denial/expiry/restore/logout.
7. Confirm API auth endpoints remain outside Access and `/app/desktop-auth` remains protected.

### Production

1. Export and back up Supabase Auth data.
2. Apply the D1 auth migration.
3. Generate, review, and apply identity-import SQL.
4. Deploy API and web in the same cutover window.
5. Release the Better Auth desktop build.
6. Require users to sign in again.
7. Run ownership and end-to-end checks.
8. Remove/revoke Supabase credentials only after acceptance.

A short coordinated cutover is simpler than a dual verifier.

## Coordination with PR #221

After PR #221 lands, update its Zero Trust design, plan, and runbook to state:

- Better Auth is the inner application-authentication gate.
- `/app/desktop-auth` is the desktop approval route.
- API device-code/polling endpoints remain outside Access.
- Production desktop authorization remains operator-only because approval is under `/app`.
- `/login?redirect=desktop`, auth deep links, and loopback verification are removed.

Implementation can begin before PR #221 merges, but production rollout must reconcile both document sets.

## Testing Strategy

### API

- Generated schema/migration parity.
- Better Auth GET/POST handler mounting.
- Cookie and Bearer session resolution.
- Missing/invalid session normalization.
- Existing GraphQL scopes and REST authorization.
- Credentialed CORS.

### Web

- Server hook and safe redirects.
- Password and Google sign-in.
- Explicit linking and logout.
- Browser cookie transport and service-binding cookie forwarding.
- Device code claim, approve, deny, invalid, and expired UI.

### Desktop

- Code request parsing.
- Pending/slow-down polling.
- Approval, denial, expiry, invalid grant, and network failure.
- Stored-session validation and logout.
- Renderer persistence and restore.
- Google Drive session-generation invariants.
- No callback listener or auth deep-link remains.

### End-to-end

- Local D1 Better Auth user provisioning.
- Web authenticated score flow.
- Desktop Device Authorization, restore, and logout.
- Pre-production production-like flow with Cloudflare Access.

## Rejected Alternatives

- **Keep Supabase only for auth:** leaves the most complex cross-runtime dependency.
- **Handcraft a device protocol:** Better Auth already owns the protocol and security rules.
- **Keep magic links:** retains callback, deep-link, refresh, and JWT machinery.
- **Use OAuth Provider/JWT:** unnecessary for one first-party desktop client and one resource server.
- **Use Better Auth Electron plugin:** DTX Desktop is Tauri; Device Authorization is framework-neutral.
- **Put Better Auth in `dtx-web`:** web has no D1 binding and desktop polling must stay outside Access.
- **Create a dedicated auth Worker:** extra deployment boundary without another consumer.
- **Keep bcrypt compatibility:** replacement passwords are cheaper than permanent legacy hashing.

## Acceptance Criteria

The migration is complete when:

1. D1 contains Better Auth core, device-code, and rate-limit tables.
2. Password and Google web sign-in create valid Better Auth sessions.
3. Browser GraphQL/REST authenticate through cookies.
4. Desktop uses Device Authorization and an opaque Better Auth Bearer session.
5. Existing ownership remains valid because user IDs are preserved.
6. Google linking is explicit and implicit linking remains disabled.
7. Public signup remains disabled.
8. Desktop has no magic link, auth deep link, loopback callback, JWT decoder, or refresh-token rotation.
9. No runtime package or active environment contract depends on Supabase.
10. Unit, integration, Rust, web E2E, and desktop E2E checks pass.
11. PR #221 documentation identifies Better Auth and `/app/desktop-auth`.
12. Disabling Supabase causes no DTXWeb runtime failure.

## References

- Better Auth Cloudflare fixture v1.6.25: https://github.com/better-auth/better-auth/tree/v1.6.25/e2e/smoke/test/fixtures/cloudflare
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Drizzle Kit export: https://orm.drizzle.team/docs/drizzle-kit-export
- Better Auth Device Authorization: https://better-auth.com/docs/plugins/device-authorization
- Better Auth Bearer plugin: https://better-auth.com/docs/plugins/bearer
- Better Auth cookies: https://better-auth.com/docs/concepts/cookies
- Better Auth Supabase migration guide: https://better-auth.com/docs/guides/supabase-migration-guide
- Better Auth CLI: https://better-auth.com/docs/concepts/cli
- Better Auth 1.6.25: https://github.com/better-auth/better-auth/releases/tag/v1.6.25
