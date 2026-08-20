# Task 5 report: remove the custom magic-link and desktop web handoff

## Scope

Task 5 only: remove the custom API magic-link mutation/service, unregister it from the GraphQL schema, remove the matching web operation/API wrapper and tests, and make `/app` render the dashboard without the legacy `redirect=desktop` magic-link handoff. Better Auth session plumbing, the Device Authorization approval page, native desktop authentication, and broader Supabase residue cleanup remain assigned to later tasks.

## RED evidence

The schema expectation was written before removing the resolver registration:

```text
bun run --filter=dtx-api test -- src/schema/auth.test.ts
...
× Mutation.generateMagicLink > is removed from the GraphQL schema
  AssertionError: expected { name: 'generateMagicLink', … } to be undefined
Tests 1 failed | 5 passed (6)
```

The dashboard expectation was written before removing the redirect implementation:

```text
bun run --filter=dtx-web test -- src/routes/'(app)'/app/app-page.test.ts --reporter=verbose
...
× ... > ignores the removed desktop redirect handoff
  Unable to find an element with the text: Welcome to Drumery
  The rendered state was "Redirecting to desktop app..."
Tests 2 failed (2)
```

These failures exercised the old production behavior, rather than merely testing deleted files.

## Implementation

- Deleted the magic-link service, service tests, GraphQL mutation module, and mutation tests.
- Removed the schema registration from `src/schema/index.ts`.
- Removed the temporary optional email compatibility field from the neutral GraphQL context now that no magic-link resolver consumes it.
- Removed the unused `MAGIC_LINK_HOURLY_LIMIT` API environment field and the local Wrangler override; the existing `RATE_LIMIT_API` binding and download callers remain unchanged.
- Deleted the web `GenerateMagicLink` operation, API wrapper/tests, and redirect-specific page tests; removed the API barrel export and its barrel assertion.
- Replaced the app page with the existing dashboard content so query parameters cannot trigger magic-link generation or callback forwarding.
- Updated the desktop local-dev topology assertion for the removed API override.
- Regenerated the API schema first, then the web GraphQL client. The generated artifacts no longer contain `MagicLinkResult`, `generateMagicLink`, or `GenerateMagicLinkDocument`.

## GREEN evidence

- Temporary schema absence expectation after unregistering `./auth`: `bun run --filter=dtx-api test -- src/schema/auth.test.ts` — 1 test passed; the temporary test was then removed with the obsolete mutation tests.
- `bun run --filter=dtx-web test -- src/routes/'(app)'/app/app-page.test.ts` — 1 file, 2 tests passed.
- `bun run --filter=dtx-api gen-schema` — passed; `packages/dtx-api/dist/schema.graphql` regenerated.
- `bun run --filter=dtx-web codegen` — passed after schema generation; `packages/dtx-web/src/lib/api/generated/graphql.ts` regenerated.
- `bun run --filter=dtx-api test` — 21 files, 379 tests passed.
- `bun run --filter=dtx-web test` — 64 files, 937 tests passed.
- `bun run --filter=dtx-desktop test -- src/devTopology.test.ts` — 2 tests passed.
- `bun run --filter=dtx-api check` — passed.
- Focused Prettier check over changed source/generated files — passed.
- Focused ESLint over changed TypeScript/Svelte files — passed.
- `git diff --check` — passed.

## Known limitation / baseline

`bun run --filter=dtx-web check` was run with inert required public environment values. It retains the documented pre-existing result: one `hooks.server.ts` Supabase cookie `setAll` type mismatch and four CSS warnings. No Task 5 source is involved; fixing it would begin Task 6 session plumbing early, so it remains unchanged.

The repository still contains desktop magic-link callback machinery and web login/hooks `redirect=desktop` handling for Tasks 6, 7, 10, and 11. Broader Supabase environment/config and E2E cleanup remains Task 13. No deployment or Google secret/config changes were made.

## Changed and deleted files

Changed:

- `packages/dtx-api/dist/schema.graphql` (generated)
- `packages/dtx-api/package.json`
- `packages/dtx-api/src/context.ts`
- `packages/dtx-api/src/env.ts`
- `packages/dtx-api/src/schema/index.ts`
- `packages/dtx-desktop/src/devTopology.test.ts`
- `packages/dtx-web/src/lib/api/generated/graphql.ts` (generated)
- `packages/dtx-web/src/lib/api/index.test.ts`
- `packages/dtx-web/src/lib/api/index.ts`
- `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- `packages/dtx-web/src/routes/(app)/app/app-page.test.ts`

Deleted:

- `packages/dtx-api/src/schema/auth.test.ts`
- `packages/dtx-api/src/schema/auth.ts`
- `packages/dtx-api/src/services/magicLink.test.ts`
- `packages/dtx-api/src/services/magicLink.ts`
- `packages/dtx-web/src/lib/api/auth.test.ts`
- `packages/dtx-web/src/lib/api/auth.ts`
- `packages/dtx-web/src/lib/api/operations/auth.graphql`
- `packages/dtx-web/src/routes/(app)/app/app-page-redirect.test.ts`
