# Task 15 report: full verification and pre-production cutover proof

Date: 2026-08-20

Base: `7d9a9cbd`

## Scope

Task 15 ran the repository verification gates, generated-artifact checks,
Better Auth residue audit, and full local web and desktop E2E suites. It also
audited the historical, non-secret Foundation pre-production rehearsal, which
is not current final cutover proof. Production was deliberately out of scope:
no production migration, identity import, secret update, deploy, desktop
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
- The runbook's manual OS-browser Device Authorization handoff remains a
  separate manual evidence item. The automated desktop suite does not claim
  that physical-browser handoff.

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
  `dtx-preprod`. The final reviewed API and web artifacts still require a fresh
  pre-production deployment and live verification.

## Pre-production blockers and go/no-go

Pre-production is not a production go decision, and the current final
cutover has not been deployed or proven in pre-production:

1. Deploy the final reviewed Tasks 4–15 API artifact to pre-production, then
   deploy the matching final web artifact built without Foundation-era
   Supabase public variables. Verify the web `API` service binding and record
   the resulting API and web Worker versions.
2. Execute and record the complete current pre-production acceptance matrix:
   password sign-in, Google sign-in, explicit linking, `/app` guard,
   GraphQL/score, upload/download, logout, invalid sessions, Device
   Authorization approve/deny/expiry, cookie/origin isolation, CORS, and the
   desktop candidate flows. The Foundation rehearsal smoke is not a substitute
   for this matrix.
3. Google Console registration of
   `https://api.pre-prod.dtx.hapadona.com/api/auth/callback/google` could not
   be independently verified from the available local tooling. The deployed
   Google start flow emits that exact callback, but completion must remain
   blocked until the client registration is externally confirmed.
4. No real sanitized Supabase Auth export and complete application owner-ID
   inventory were supplied for this run. No fabricated identity export or
   import SQL was generated/applied, and exact owner reconciliation therefore
   remains a hard gate.
5. The manual OS-browser Device Authorization handoff has not been recorded;
   WDIO coverage is automated evidence only.

Accordingly, local repository and automated E2E verification is GREEN, while
current pre-production acceptance and the production go/no-go status are
BLOCKED on the final API/web deployments, the complete current acceptance
matrix, external callback registration, real owner reconciliation/import
inputs, and manual handoff evidence. The runbook now records the corrected
five-second local E2E expiry override and continues to prohibit that override
in remote environments.

## Production boundary

No production `0008` migration, identity import, Better Auth/Google secret
operation, API or web deploy, desktop publication, or credential removal was
run. Production remains for a separately approved operator change window after
the blockers above and the runbook's backup, rollback, callback, ownership,
Access, and acceptance gates are complete.

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

The remaining desktop E2E Minor was corrected narrowly: the logout lifecycle
test now invokes native `get_current_session` and asserts `null` immediately
after the UI reaches the signed-out shell. The `afterEach` hook no longer makes
that assertion; it only performs cleanup and reseeds the deterministic native
session, so a failed UI logout cannot be hidden by teardown. Desktop E2E
typecheck and Prettier passed. The existing target-e2e executable ran
`auth-session.e2e.ts` successfully with 2/2 scenarios passing in 30.9s; no
rebuild or remote operation was run.
