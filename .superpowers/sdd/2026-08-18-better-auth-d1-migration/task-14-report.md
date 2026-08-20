# Task 14 report: Better Auth E2E coverage and production cutover runbook

Date: 2026-08-20

## Scope

Task 14 only: add web Better Auth lifecycle coverage, exercise the real local
Better Auth Device Authorization API/browser approval flow, audit and update
desktop session-shape E2E coverage, and write the operator-only production
cutover runbook. No production deployment, remote data operation, credential
change, or Task 15 work was performed.

The TDD, Playwright, Cloudflare, and Supabase skills were read before the
changes. CodeGraph was queried before source inspection. No Svelte source was
changed, so the Svelte writer skill was not needed.

## RED evidence

The first new expiry assertion was added before implementation/configuration.
The focused local Device Authorization run returned `authorization_pending`
instead of `expired_token` after the test waited past its intended expiry:

```text
Expected "expired_token", Received "authorization_pending"
```

The implementation then supplied an optional `BETTER_AUTH_DEVICE_CODE_EXPIRES_IN`
API setting, kept the production default at `30m`, and configured only the
Playwright local Wrangler process with `1s`. This makes expiry deterministic
without changing production behavior.

The first API helper request also exposed Better Auth's Origin requirement:

```text
403 {"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}
```

That was a test-request defect, corrected by sending the local web Origin. The
first revoke request then returned 415 because the test POST lacked a JSON
`Content-Type`; sending an empty JSON body fixed the request without changing
API code.

The web logout test initially clicked before Svelte hydration and produced no
sign-out request, so waiting for the existing `html[data-e2e-hydrated="true"]`
marker was added before the click. The isolated test then passed.

## Implementation

- Extended `packages/e2e-web/auth-lifecycle.spec.ts` with password login,
  anonymous `/app` guard, invalid-session redirect, authenticated download,
  logout/revocation, and post-logout `/get-session` validation. It continues
  to use the seeded Better Auth credentials and no Supabase credentials.
- Added `packages/e2e-web/device-authorization.spec.ts`. Against the local
  Wrangler API/D1 stack it requests a real code, opens the real authenticated
  `/app/desktop-auth` approval page, claims it through the browser UI, approves
  it, polls the token, validates the returned user through `/get-session`,
  revokes the session, and confirms the session is gone. The deny path also
  uses the browser UI; a separate test covers expiry.
- Added the optional API expiry environment field and threaded it into the
  Better Auth Device Authorization plugin. The only short expiry is the local
  Playwright server override; no production/API test-auth endpoint was added.
- Added `packages/e2e-desktop/specs/auth-session.e2e.ts`. It verifies the
  existing debug-only native seed, restores the Better Auth-shaped
  `{ sessionToken, user }` renderer storage, checks the authenticated shell,
  asserts legacy renderer keys are absent, and verifies logout clears the
  session. It uses Tauri IPC/native seed state and no test-auth HTTP endpoint.
- Added the production runbook at
  `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md` with every
  required operator section: backup/export, pinned version, cookie
  prefixes/domains, trusted origins, service binding, Google callbacks,
  Wrangler secrets, Supabase Admin export, generated import SQL review, D1
  order, owner reconciliation, deployment order, web/desktop/Access matrices,
  go/no-go, production cutover, Supabase-disable proof, and rollback.

## Desktop session-shape audit

The required audit command was run:

```bash
rg -n "auth_access_token|auth_refresh_token|auth_user_data|e2e-supabase|refresh_token|DTX_E2E_DRUMERY_USER_ID" \
  packages/e2e-desktop packages/dtx-desktop/src-tauri/src
```

All matches are accounted for: the three legacy key names are the intentional
renderer cleanup assertion and native safe-rejection test; `DTX_E2E_DRUMERY_USER_ID`
is the existing `e2e + debug_assertions` native seed; and `refresh_token`
matches belong to Google Drive credential storage/tests. No Supabase-shaped
renderer session seed or application-auth fake refresh token remains.

## PR #221 documentation status

The bounded local search found no PR #221 Zero Trust specification, plan, or
runbook document to reconcile. It found only Task 14 plan references and an
unrelated `#221E3A` color literal. No absent PR #221 document was created or
modified. The runbook records the required future reconciliation: replace the
Supabase inner gate with Better Auth and replace `/login?redirect=desktop`
callbacks with `/app/desktop-auth` Device Authorization while preserving
production `/app` operator policy, pre-production Access behavior, and public
API hostnames.

## GREEN evidence

Focused web/API and type gates already passed:

- Device Authorization focused Playwright run: setup plus browser-UI
  approve/validate/revoke, browser-UI deny, and expiry — 4 passed in 35.6s.
- Focused logout Playwright run with setup: 2 passed in 26.0s.
- `bun run --filter=dtx-api test -- src/auth/auth.test.ts`: 3 passed.
- `bun run --filter=dtx-api check`: passed.
- `bun run --filter=dtx-e2e-web check`: passed.
- `bun run --filter=dtx-e2e-desktop check`: passed.
- Focused changed-file Prettier and `git diff --check`: passed before final
  verification.

The full web and desktop suites were not rerun in this task. A desktop E2E
binary was not present at
`packages/dtx-desktop/src-tauri/target-e2e/debug/dtx-desktop`; building the
Tauri candidate is a separate potentially long/hardware-bound operation. The
automated WDIO spec is typechecked and the existing native debug seed remains
compile-time excluded from release builds. The real OS-browser Device
Authorization handoff is intentionally manual evidence and is described as
such in the runbook; it was not claimed as automated GREEN here.

No remote operation was run.

## Task 14 review fixes

The scoped review identified five Important findings; all five were fixed
without broadening Task 14:

1. Web shared-session race: RED reproduced that cloning `.auth/user.json`
   cookies into another context shared the server session; logging out the
   page made the baseline `/get-session` user null. The logout coverage now
   clears the page context and signs in with the seeded credentials to create a
   distinct session before revocation, then asserts the baseline session still
   resolves to `TEST_USER_ID`. Focused Playwright GREEN: setup plus regression,
   2 passed in 32.6s.
2. Desktop native seed: RED was a focused Rust compile failure for the absent
   restore helper. A debug-only `restore_seeded_auth_session` helper and
   `restore_e2e_auth_session` IPC command now reuse the existing native seed;
   the handler is registered only under `feature="e2e"` and
   `debug_assertions`. WDIO `afterEach` restores native state even after a
   renderer assertion failure. Focused Rust GREEN: 1 test passed. No release
   test endpoint was added.
3. Authenticated download: RED occurred because owner-only chart A had no
   file. Chart A now has a minimal D1 `dtx_file` row and local R2 fixture; the
   authenticated request succeeds while an empty-storage anonymous context is
   rejected with 401. The existing public blog chart-B coverage remains
   separate. Focused Playwright GREEN: setup plus owner-only download, 2
   passed in 32.8s.
4. Import command: the runbook now uses the positional export argument,
   mandatory `--owner-ids`, optional replacement-password input, and the exact
   repository-local `tmp/auth-migration/better-auth-import.sql` output path,
   followed by a second-operator review and explicit pre-production D1 apply.
5. Pre-production safety: the runbook now has explicit `--env pre-prod`
   `versions secret put` and legacy `secret put` forms, warns that legacy
   `wrangler secret put` immediately creates and deploys a Worker version, and
   separates pre-production migration/deploy scripts from gated production-only
   commands. Secret values remain interactive and undocumented.

Review-fix verification: the focused auth lifecycle Playwright file passed 7/7
(including setup) in 27.6s; the focused Device Authorization file passed 4/4
(including setup) in 28.1s; `bun run --filter=dtx-e2e-desktop check`,
`bun run --filter=dtx-desktop typecheck`, focused desktop support/unit checks
(29 passed), and the Rust E2E-feature test set (40 passed) passed. Lint,
Prettier, Rust format, and `git diff --check` also passed. The full desktop
executable suite remains unrun
because `packages/dtx-desktop/src-tauri/target-e2e/debug/dtx-desktop` is absent;
that build is potentially longer and hardware-bound. No remote operation or
Task 15 work was performed.
