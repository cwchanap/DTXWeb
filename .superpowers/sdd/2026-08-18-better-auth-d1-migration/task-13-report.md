# Task 13 report: remove Supabase residue and obsolete typegen

Date: 2026-08-20
Base: `d5362f6d`

## Scope

Removed Supabase runtime, configuration, dependency, test, workflow, generated-type,
and obsolete root/Turbo type-generation residue after the Better Auth + D1
migration. The Task 12 importer remains a local-only tool that accepts a Supabase
Admin export as an input format. API GraphQL schema generation, web GraphQL
codegen, and native Rust-to-TypeScript generation remain in place.

## RED evidence

The pre-edit residue gate was:

```text
rg -n -i "@supabase|supabase|PUBLIC_SUPABASE|SUPABASE_" \
  packages package.json turbo.json .env.example CLAUDE.md __mocks__ .github
```

Against the clean base, it reported 154 matches across 47 files. The matches
covered package dependencies and mocks, generated common Supabase types and
exports, API/web/desktop test fixtures, Supabase environment and Wrangler/CI
configuration, and historical auth/type-generation documentation.

Before deleting the login handoff production path, the updated web auth tests
were intentionally RED: 10 passed and 1 failed because the page still rendered
the old `Login to Desktop App` heading and callback handoff. The failure was
resolved by removing the production branch and updating the expectation to the
ordinary login page.

The required Svelte skill's bounded autofixer attempt was also recorded:

```text
npx --no-install @sveltejs/mcp svelte-autofixer \
  'packages/dtx-web/src/routes/(login)/login/+page.svelte' --svelte-version 5
```

It produced no output for approximately 30 seconds and was interrupted at the
bounded fallback. `svelte-check` was used as the available Svelte diagnostics
gate instead.

## Implementation

- Removed `@supabase/ssr` and `@supabase/supabase-js` from web/API/desktop and
  the common peer dependency; `bun install` updated `bun.lock` with 25 deleted
  lines and no added packages.
- Deleted `packages/common/src/lib/types/supabase.types.ts` and its public
  `Database` export.
- Removed Supabase env types, fixtures, mocks, Wrangler vars, workflow vars,
  and example/type-only env values. Removed the obsolete `VITE_DTX_SERVER_URL`
  callback-era variable as well.
- Removed the `/login?redirect=desktop` and `desktop_callback` browser handoff,
  session-storage callback state, stale callback UI, and associated test
  expectations. Better Auth OAuth callback tests remain intact.
- Removed root `gen-types` and Turbo `gen-types`; preserved
  `gen:native-types`, API `gen-schema`, and web `codegen` scripts/configuration.
- Updated current repository guidance/comments to describe Better Auth, D1,
  the API, and native type generation. Historical `docs/superpowers/**`
  material remains an explicit documentation allowlist, as does the Task 12
  importer, its test/fixture, the Better Auth E2E seed, and the historical
  `0001_initial_schema.sql` migration comment.

## GREEN evidence

The post-edit residue gate, using the same scope and excluding only the
allowlisted Task 12 importer/fixture/seed and historical migration comment,
reported exactly one intentional line:

```text
packages/dtx-api/package.json:22:
  "auth:migrate": "bun run src/scripts/migrate-supabase-auth.ts",
```

The broader callback, magic-link, session-event, and legacy env scan was clean
outside those same allowlisted paths. `git diff --check` passed.

Focused and package verification:

- web auth regression set: 4 files, 27 tests passed;
- `bun run --filter=dtx-web test`: 65 files, 876 tests passed;
- `bun run --filter=dtx-api test`: 22 files, 385 tests passed;
- `bun run --filter=dtx-desktop test`: 58 files, 1,010 tests passed;
- common unit suite excluding its network/listener integration file: 44 files,
  1,286 tests passed;
- `bun run --filter=dtx-api check`: passed;
- `bun run --filter=@dtx/common check`: 0 errors and 0 warnings;
- `bun run --filter=dtx-desktop typecheck`: 0 errors and 0 warnings;
- `bun run --filter=dtx-e2e-web check`: passed;
- `bunx svelte-kit sync --mode types-only` followed by
  `bunx svelte-check --tsconfig ./tsconfig.json`: 0 errors and 4 existing CSS
  at-rule warnings;
- `cargo fmt --check`: passed;
- `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`:
  922 passed, 2 ignored, 0 failed;
- `bun run lint`: passed;
- Prettier check over changed supported files: passed.

The full common test command was attempted as required. Its 44 ordinary test
files passed (1,286 tests); the separate Miniflare integration file skipped its
39 tests after its existing `beforeAll` listener failed with sandbox
`listen EPERM`, then timed out in cleanup. The isolated unit command above
passes completely. The ordinary web `check` script also requires the
repository's explicit `types-only` sync mode in this checkout; without that
mode it reports missing static env exports before typechecking. No build,
development server, deployment, or remote operation was run.
