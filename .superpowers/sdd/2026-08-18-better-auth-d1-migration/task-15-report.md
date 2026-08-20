# Task 15 report: full verification and pre-production cutover proof

Date: 2026-08-20

Base: `7d9a9cbd`

## Scope

Task 15 ran the repository verification gates, generated-artifact checks,
Better Auth residue audit, full local web and desktop E2E suites, and the
non-secret pre-production proof already established on this branch. Production
was deliberately out of scope: no production migration, identity import,
secret update, deploy, desktop publication, or Supabase credential change was
run.

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

## Pre-production proof

The branch's authorized pre-production rehearsal is recorded in the ledger and
was not repeated with a production target:

- Pre-production Better Auth and Google secret names are present without
  exposing values; `DTX_WEB_URL` is
  `https://pre-prod.dtx.hapadona.com`, and the cookie prefix is
  `dtx-preprod`.
- Remote pre-production D1 has migrations through `0008_better_auth.sql` and
  no pending migrations. API version
  `44d96dc8-51a2-47c3-bcad-adecdd794efa` and web version
  `c1c31ef1-45e6-4014-a4dc-484a9741c15e` are deployed at the pre-production
  hostnames.
- Non-secret live smoke passed: web root 200, anonymous
  `/api/auth/get-session` 200, allowed-origin credentialed preflight 204 with
  exact origin, disallowed-origin response without allow-origin, invalid
  device client rejection, valid device-code issuance with the expected
  `/app/desktop-auth` verification URI, pending poll, and Google authorization
  start with the exact Better Auth callback URI and pre-production state-cookie
  prefix.
- Static configuration confirms the pre-production web `API` service binding,
  trusted-origin source, cookie isolation, credentialed CORS, and
  `/get-session` rate-limit exemption.

## Pre-production blockers and go/no-go

Pre-production is not a production go decision yet:

1. Google Console registration of
   `https://api.pre-prod.dtx.hapadona.com/api/auth/callback/google` could not
   be independently verified from the available local tooling. The deployed
   Google start flow emits that exact callback, but completion must remain
   blocked until the client registration is externally confirmed.
2. No real sanitized Supabase Auth export and complete application owner-ID
   inventory were supplied for this run. No fabricated identity export or
   import SQL was generated/applied, and exact owner reconciliation therefore
   remains a hard gate.
3. The manual OS-browser Device Authorization handoff has not been recorded;
   WDIO coverage is automated evidence only.

Accordingly, local repository and automated E2E verification is GREEN, while
the pre-production acceptance/production go-no-go status is BLOCKED on the
external callback registration, real owner reconciliation/import inputs, and
manual handoff evidence. The runbook now records the corrected five-second
local E2E expiry override and continues to prohibit that override in remote
environments.

## Production boundary

No production `0008` migration, identity import, Better Auth/Google secret
operation, API or web deploy, desktop publication, or credential removal was
run. Production remains for a separately approved operator change window after
the blockers above and the runbook's backup, rollback, callback, ownership,
Access, and acceptance gates are complete.
