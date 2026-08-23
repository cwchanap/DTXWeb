# Task 15 report: full verification and pre-production cutover proof

Date: 2026-08-22

Base: `7d9a9cbd`

## Scope

Task 15 ran the repository verification gates, generated-artifact checks,
Better Auth residue audit, and full local web and desktop E2E suites. The
operator then completed the pre-production import/deploy and live smoke
evidence recorded below. Production was limited to a read-only preview: no
production migration, identity import, secret update, deploy, desktop
publication, or Supabase credential change was run.

## RED evidence and verification-driven corrections

- The bare `bun run check` invocation stopped in `dtx-web` because SvelteKit's
  static public variables were not present in the shell. Re-running the exact
  check with inert local values for `PUBLIC_DTX_API_URL` and
  `PUBLIC_SIMFILE_BUCKET_URL` passed with zero type errors; the four existing
  CSS warnings remained unchanged.
- The prescribed Rust all-feature Clippy command is structurally incompatible
  with the crate's build guard: `--all-features` enables the default Google
  Drive feature and the E2E feature together, which the build script rejects.
  The supported default-feature and `--no-default-features --features e2e`
  Clippy commands both pass with `-D warnings`.
- Default-feature Clippy found an existing `if let Some(...)=result.ok()`
  warning in `auth.rs`. The narrow correction uses `if let Ok(...)` and does
  not change logout behavior. The focused logout test and the full Rust suite
  pass after the correction.
- The full web E2E run exposed three local harness issues: the unauthenticated
  project also scheduled Device Authorization tests, score GraphQL requests
  lacked the canonical local Origin, and a one-second expiry raced the
  parallel suite. The test project now isolates Device Authorization to the
  authenticated project, score requests send the Origin, and the local-only
  expiry is five seconds with the expiry test waiting from the returned value.
  Production and pre-production keep the Better Auth default lifetime.

## Static, unit, and Rust GREEN evidence

- `bun run format`: passed.
- `bun run lint`: passed.
- `bun run check` with inert local public values: passed; all packages had zero
  type errors. `dtx-web` retained only its existing CSS warnings.
- `bun run test`: 7/7 Turbo tasks passed — common 1,325 tests, API 385,
  desktop 1,010, and web 876.
- `git diff --check`: passed.
- `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
  --check`: passed.
- `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`:
  922 passed, 0 failed, 2 ignored. The ts-rs serde-attribute messages are
  existing warnings.
- Supported default-feature and E2E-feature Clippy gates passed with
  `-D warnings`; the all-feature command remains blocked only by the explicit
  Google Drive/E2E build configuration guard described above.

## Generated-artifact GREEN evidence

- `bun run --filter=dtx-api auth:schema:check`: passed.
- `bun run --filter=dtx-api gen-schema`: passed.
- `bun run --filter=dtx-web codegen`: passed.
- `bun run gen:native-types`: 42 export tests passed.
- Generated schema, web GraphQL client, and native TypeScript artifacts are
  diff-clean apart from the intentional verification changes recorded here.

## Auth and trust residue GREEN evidence

- No Supabase runtime import or configuration remains in API/web/desktop
  runtime source outside the documented local-only migration importer and its
  fixtures/tests.
- No `getAccessTokenOrNull` or `token.ts` remains. No legacy desktop
  application callback variable or `/login?redirect=desktop` handoff remains.
- The desktop application-auth path contains no JWT, refresh-token,
  deep-link, loopback, or callback flow. The remaining legacy local-storage
  key removal is one-time cleanup, and refresh-token/loopback matches belong to
  the independent Google Drive integration and tests.
- Better Auth derives `trustedOrigins` from `DTX_WEB_URL`; CORS parsing remains
  in the separate CORS helper. The production/pre-production Wrangler values
  use distinct `dtx` and `dtx-preprod` cookie prefixes.
- `withCors` and preflight both echo only an allowed Origin and set
  `Access-Control-Allow-Credentials: true`; disallowed origins receive no
  allow-origin header.
- The web Wrangler config binds production SSR to `API -> dtx-api` (and the
  pre-production variants bind to their matching API Worker). Better Auth
  disables database rate limiting for `/get-session`.
- The obsolete root/Turbo Supabase `gen-types` path is absent.

## E2E GREEN evidence

- Full web Playwright suite: 36/36 passed with the local Better Auth/D1 stack;
  no Supabase credentials were used.
- Full desktop WDIO/Tauri suite: all seven spec files passed. The native
  filesystem spec recorded nine passing cases and one Windows-only skip. The
  Tauri candidate built successfully and the relaunch smoke passed.
- The runbook's manual OS-browser Device Authorization handoff is separate
  from automated coverage; today's browser-approval evidence is recorded
  below. The automated desktop suite does not claim that physical-browser
  handoff.

## Pre-production evidence boundary

The branch's earlier authorized pre-production rehearsal is recorded in the
ledger, but it is not current Tasks 4–15 cutover proof:

- The API version `44d96dc8-51a2-47c3-bcad-adecdd794efa` and web version
  `c1c31ef1-45e6-4014-a4dc-484a9741c15e` are Foundation rehearsal artifacts,
  deployed before the final Tasks 4–15 migration work. They must not be used
  as the final API/web deployment evidence.
- The earlier web build used Foundation-era Supabase public variables. Its
  successful build and smoke results therefore do not prove the final
  Better-Auth-only web artifact or its current service-binding behavior.
- The recorded Foundation smoke passed non-secret checks including web root,
  anonymous `/api/auth/get-session`, allowed/disallowed CORS, invalid and valid
  Device Authorization starts, a pending poll, and Google authorization start
  with the expected callback. These results are historical rehearsal evidence,
  not current final acceptance.
- The remote rehearsal state also recorded D1 migrations through
  `0008_better_auth.sql`, pre-production secret presence without values,
  `DTX_WEB_URL=https://pre-prod.dtx.hapadona.com`, and cookie prefix
  `dtx-preprod`. Those results are historical only; the current final
  deployment and acceptance evidence is recorded below.

## Pre-production operator evidence and remaining gaps

The current final API/web cutover and identity import are deployed in
pre-production. This is not a production go decision.

- The unmatched pre-production owner removal was user-approved after a
  protected D1 backup with SHA-256 prefix `bff977...`; the approved atomic
  cleanup file was applied. R2 objects were left untouched.
- Importer transaction compatibility was corrected in commit `22f3c27f`;
  focused importer verification passed 6/6.
- The pre-production import artifact with SHA-256 prefix `51af...` was
  independently approved and applied. Final D1 counts are 2 Better Auth users,
  3 accounts, 0 sessions, 2 application owners, and 0 uncovered owners.
- The earlier active pre-production cutover versions were API `839e...` and web
  `255a...`, with the web `API` service binding verified. During today's
  browser acceptance, a later pre-prod-prod-data API deploy (`42e1e0c8` at
  06:39) and web deploy (`7a5396c4` at 06:41) reclaimed the same public custom
  domains; public API auth routes and `/app/desktop-auth` on the web returned
  404. The isolated pre-production services were restored as API
  `d4fac270-7bd0-411f-b4c7-94ebe7e2cdd3` and web
  `2478f4a7-ad6d-494a-bdca-d207565e1d59`.
- The restored web build required explicit
  `PUBLIC_DTX_API_URL=https://api.pre-prod.dtx.hapadona.com` and
  `PUBLIC_SIMFILE_BUCKET_URL=https://pub-69ca40bf7a284843b562ff39a68b2e6e.r2.dev`;
  the build passed and the deploy succeeded.
- Live password/cookie authentication, GraphQL, CORS, Google authorization
  start with the exact callback
  `https://api.pre-prod.dtx.hapadona.com/api/auth/callback/google`, invalid
  session handling, logout/revocation, Device Authorization approve/revoke/
  deny, and upload/download all passed. Temporary upload test objects were
  removed.
- Cloudflare Access initially returned 403; after WARP/user authentication it
  cleared. Today's browser acceptance then passed: the app guard/login redirect
  preserved the device path, real Better Auth Google sign-in completed, the
  Account provider UI showed Google already connected, and `/app/desktop-auth`
  code claim plus Approve UI passed.
- The native/public follow-up passed: the Device Authorization poll returned
  200 with a Bearer token, `get-session` returned 200 for the migrated user,
  sign-out returned 200, and the revoked `get-session` returned 200 with
  `null`.
- Explicit Connect Google linking UI was not exercised because the migrated
  user was already linked; the account was not unlinked. Remote Device
  Authorization expiry has not been run independently because the five-second
  expiry override is local-only and prohibited remotely. The later MCP-driven
  desktop pre-production runtime matrix is recorded below. WDIO coverage remains
  separate automated evidence.
- The pre-production legacy `SUPABASE_SERVICE_ROLE_KEY` secret remains and was
  not deleted.

Accordingly, pre-production deployment, import, the listed live smoke checks,
today's browser/native approval acceptance, and the later MCP-driven native
desktop runtime matrix are GREEN. The distinct remaining gaps are explicit
Connect Google linking and remote Device Authorization expiry. This does not
authorize production mutation. The runbook's five-second expiry override
remains local-only and is prohibited in remote environments.

## Production read-only preview and boundary

- Read-only production preview: migration `0008` is pending; Better Auth user,
  account, and session tables are empty; D1 has 1 application owner; and the
  only Wrangler secret is `SUPABASE_SERVICE_ROLE_KEY`.
- The active rollback versions are API `8104...` and web `f68b...`. A protected
  independent production Better Auth secret was generated, and the protected
  production import artifact with SHA-256 prefix `135d...` was independently
  approved for 1/1 owner coverage; neither was applied.
- Absolutely no production mutation was performed: no migration, identity
  import, secret update/removal, API or web deploy, desktop publication, or
  credential change. Production remains held for a separately approved change
  window.

## Final whole-branch native review fixes

The final review identified three native auth correctness gaps and one desktop
E2E assertion gap. CodeGraph was queried first for the device-auth, AuthState,
renderer logout, and Drive reconciliation paths. The fixes remain limited to
the native/renderer auth seam and its focused tests:

- `DeviceAuthClient::sign_out` now sends an empty JSON object with
  `Content-Type: application/json`, the captured Bearer credential, and the
  canonical trusted web Origin. The client derives the Origin from an explicit
  `VITE_DTX_WEB_URL` when present and otherwise maps the existing production,
  pre-production, and local API topology. WireMock asserts the complete
  request contract, including production/pre-production/local/IPv6 origin
  normalization. A separate live Better Auth handler fixture was not
  available without starting a Worker/D1 stack; the existing API auth options
  tests continue to cover the trusted-origin configuration.
- Device Authorization now reserves one monotonic attempt generation before
  every begin request. Begin, poll, retry reinsertion, approval/session
  installation, and Drive reconciliation are all checked against the current
  generation after awaits. Cancel increments the generation even when no
  pending flow is present; overlapping begin, delayed begin/cancel, and
  delayed approval/cancel tests prove stale work cannot restore state.
- Native logout snapshots the session token/user, invalidates the pending-flow
  and session generations, clears Drive memory, then performs best-effort
  remote revocation with the captured token. Renderer persistence/cache/Drive
  state is cleared before awaiting native cancellation or revoke. The delayed
  revocation proof observes native session, pending generation, and Drive
  access-token memory cleared while the HTTP request is still delayed. No
  credential is logged.
- Desktop WDIO `afterEach` now asserts native `get_current_session` is null
  after logout before reseeding the deterministic E2E session. The
  `session_token` compatibility alias remains deferred because this review
  did not establish a safe no-caller deletion boundary.

TDD and GREEN evidence:

- Initial RED: delayed native race tests failed at compile time against the
  old Wry-only command wrappers and `Option` pending state, demonstrating the
  missing generic test seam and attempt identity before implementation.
- `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
  device_auth_tests -- --nocapture`: 11 passed.
- `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
  auth::tests:: -- --nocapture`: 83 passed, including delayed begin/poll,
  cancel, overlapping begin, delayed native logout, and Drive-clear proofs.
- `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --
  --check`, default-feature Clippy, and supported E2E-feature Clippy with
  `-D warnings`: passed. The all-feature command remains the existing
  unsupported Google Drive + E2E build-guard combination.
- Renderer `authService.test.ts`: 15 passed; desktop typecheck reported zero
  errors/warnings; desktop E2E typecheck and focused Prettier/diff checks
  passed. No remote, pre-production, or production operation was run.

## Final desktop E2E native-clearance review fix

The remaining desktop E2E Minor was corrected narrowly: after the UI reaches
the signed-out shell, the logout lifecycle test uses a bounded `browser.waitUntil`
poll (5-second timeout, 100ms interval) until native `get_current_session`
returns `null`. The `afterEach` hook only performs cleanup and reseeds the
deterministic native session, so a failed UI logout cannot be hidden by teardown
or race native IPC completion. Desktop E2E typecheck and Prettier passed. The
existing target-e2e executable ran `auth-session.e2e.ts` successfully with 2/2
scenarios passing in 663ms; no rebuild or remote operation was run.

## MCP-driven desktop pre-production runtime acceptance

- RED: the existing app exposed no MCP endpoint; after adding the bridge, DOM
  automation remained blocked by the renderer's duplicate hard-coded
  production CSP meta tag.
- The debug-only bridge uses `tauri-plugin-mcp-bridge` 0.12, registers only for
  debug assertions, and binds only to `127.0.0.1`. `withGlobalTauri` and the
  inline-script development CSP are confined to `tauri.dev.conf.json`. Removing
  the duplicate renderer CSP makes Tauri the single policy source; the release
  `csp` remains unchanged.
- GREEN: MCP connected to `com.hapadona.drumery.dev`, returned the live
  accessibility tree, and drove the real Login control. Cloudflare Access and
  the fresh Device Authorization approval completed, the desktop displayed the
  migrated Better Auth user, Cloud read two pre-production SimFiles, and Scores
  rendered existing native data.
- A full app restart restored the authenticated session without browser
  approval and fetched the same two pre-production SimFiles immediately.
- Verification passed: 58 desktop renderer test files / 1,011 tests; 928 Rust
  tests passed, 2 ignored, 0 failed; desktop typecheck reported zero errors and
  warnings; Rust format, focused Prettier, and diff checks passed. The existing
  ts-rs serde warnings remain non-failing.
- Desktop packaging/publication and production mutation were not performed.
  Explicit Connect Google linking and remote Device Authorization expiry remain
  open.

## Follow-up acceptance and production hold

- Remote natural expiry is GREEN. A fresh, never-approved pre-production device
  code advertised `expires_in: 1800`; after the full lifetime, its first token
  poll returned HTTP 400 with `expired_token`. No remote expiry override was
  configured and the opaque code was not logged.
- Explicit Connect Google is waived because the migrated user is already linked,
  Google sign-in and the connected-provider Account UI passed, and unlinking a
  working identity only to replay the control would introduce avoidable recovery
  risk.
- The production preflight was refreshed without writes. Wrangler lists only
  `0008_better_auth.sql` pending; Better Auth tables are absent; D1 contains 320
  simfiles, 1 user profile, 0 chart scores, and 1 owner. The protected production
  SQL still has SHA-256 `135d4c91aece00871fc7c9dc0dbe36976925d86a6c61b8c3a02e2deb0c294a7f`,
  contains only 2 user and 3 account inserts, and covers the live owner exactly.
- Active rollback versions are API `c8d63e54-38af-40ba-9189-4d62d45bf911`
  and web `eaac7dee-661c-4869-bb62-59dbfba618ab`. Production health is 200,
  the legacy `/api/auth/get-session` is 404, only the legacy Supabase service
  secret is present, and the active web version lacks the planned API service
  binding.
- The supplied Google JSON contains the expected client ID and a non-empty
  secret. Its downloaded callback list predates the user's console update;
  production callback acceptance remains a post-API-deploy smoke check.
- Production is not changed or implicitly approved. The final backup, new
  Better Auth and Google secret installation, migration/import, API deployment
  and smoke, then web deployment and smoke require a separate explicit go.

## Production cutover execution

- The user explicitly approved the production change window on 2026-08-23.
  Production D1 was backed up before mutation to the protected local backup at
  `/Users/chanwaichan/.drumery/backups/2026-08-23-better-auth-cutover/dtx-web-pre-cutover.sql`.
  Its SHA-256 is
  `d6d64f30c90e4e9d026acb71e25ca4ba62d40dc1128dc0014e6156d55add12ed`,
  and an in-memory restore reproduced the expected pre-cutover table counts.
- Fresh production Better Auth and Google client secrets were installed without
  exposing their values. Migration `0008_better_auth.sql` applied once; the
  API deploy's repeated migration check reported `No migrations to apply!`.
- The exact approved import artifact, SHA-256
  `135d4c91aece00871fc7c9dc0dbe36976925d86a6c61b8c3a02e2deb0c294a7f`,
  imported 2 users and 3 accounts. All application owners remain covered.
- API version `862d9119-937c-4ee3-a492-0083d203def6` and web version
  `c96ea66d-4e66-4654-a8a3-c2dbec0afc3f` are active. API health, GraphQL,
  anonymous session, exact-origin CORS, Google authorization start/callback,
  web routes, service binding, and sampled error-tail checks passed.
- Production Google sign-in succeeded and created a valid Better Auth session.
  Full authenticated app, Device Authorization, bearer-session/revoke, and
  logout acceptance remain pending Cloudflare Access sign-in. Password
  acceptance also remains pending because no replacement plaintext password is
  available; no reset was attempted.
- Rollback anchors are API `c8d63e54-38af-40ba-9189-4d62d45bf911` and web
  `eaac7dee-661c-4869-bb62-59dbfba618ab`. The legacy Supabase credential remains
  installed for observation/rollback. No D1 down-migration, desktop publication,
  pull-request publication, or merge was performed.
