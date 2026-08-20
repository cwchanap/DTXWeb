# Task 12 report: add ID-preserving identity import and Better Auth web E2E seed

## Scope

Task 12 only: add the local-only ID-preserving Supabase export importer, seed
the Better Auth web E2E user into the same local D1 prepared by Playwright,
and retarget web E2E setup from Supabase credentials to Better Auth
credentials. No production import, remote D1 write, deployment, or Task 13+
work was performed.

## Source and plan evidence

- Read the Task 12 brief, migration plan/spec, repository instructions, and
  the existing SDD ledger before editing.
- The importer emits reviewed SQL only for Better Auth `user` and `account`
  rows, preserves source UUIDs/timestamps/identity data, requires explicit
  replacement passwords for credential accounts, excludes sessions/tokens,
  and reconciles application owner IDs.
- `prepare-stack.ts` applies all eight local D1 migrations before seeding the
  fixed Better Auth test UUID and application/R2 fixtures. It never uses a
  remote flag.

## RED

The SSR routing regression was added before changing production code. With a
loopback public API URL and an emulated Wrangler `platform.env.API`, the
focused session test failed because the service binding was selected:

```text
rtk bun run --filter=dtx-web test -- src/lib/auth/session.test.ts
FAIL — fetchAuthSession > uses the public local API when a loopback URL has an emulated service binding
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
Tests: 1 failed, 6 passed
```

This reproduced the confirmed local SSR split: browser authentication used the
local API while SvelteKit SSR routed session lookup to Wrangler's emulated
service binding.

## Implementation

- Added the ID-preserving local importer, sanitized fixture, invariant tests,
  and `dtx-api` `auth:migrate` script.
- Replaced the Supabase E2E user creator with Better Auth SQL generation and
  same-D1 seeding; removed Supabase E2E URL/key requirements.
- Retargeted Playwright web-server environment, auth setup, score requests,
  and CI guards to local Better Auth credentials.
- Added the narrow `isLoopbackApiUrl()` predicate in the web session helper.
  `localhost`, `127.0.0.1`, and `[::1]` use the configured public local
  `event.fetch`; non-loopback URLs retain service-binding preference. Cookie
  forwarding, Set-Cookie propagation, and API error handling are unchanged.

## GREEN and validation

- `rtk bun run --filter=dtx-web test -- src/lib/auth/session.test.ts`: 1 file,
  7 tests passed.
- `rtk bun run --filter=dtx-api test -- src/scripts/migrate-supabase-auth.test.ts`:
  1 file, 5 tests passed.
- `rtk bun run --filter=dtx-e2e-web check`: passed.
- `E2E_USER_EMAIL=e2e@drumery.test E2E_USER_PASSWORD=e2e-password rtk bun run packages/e2e-web/setup/prepare-stack.ts`:
  all 8 migrations applied locally, Better Auth/application/R2 fixtures
  seeded, and no remote execution requested.
- Local Wrangler query confirmed the seeded Better Auth row:
  `00000000-0000-0000-0000-000000000001 / e2e@drumery.test`.
- `E2E_USER_EMAIL=e2e@drumery.test E2E_USER_PASSWORD=e2e-password rtk bun run --filter=dtx-e2e-web playwright test --project=setup`:
  1 setup test passed in 24.3s, including login and `/app` navigation.

The first sandboxed prepare-stack attempt was blocked by host restrictions on
Wrangler's local log path and loopback listener; the same local-only command
passed with host-level permission. No remote calls were made.

