# Task 8 report: convert web API transport to cookies

## Scope

Task 8 only: remove web Bearer-token API transport after Tasks 6-7 established
Better Auth cookie sessions. No desktop authentication, deployment, or later
migration work was included.

## CodeGraph and RED evidence

CodeGraph was used once before source edits to trace `ClientCtx`, browser and
service-binding GraphQL clients, single downloads, and the bulk-download helper
path. It identified the transport/client/download seam and the `ChartList`
helper as the relevant callers.

The browser GraphQL and service-binding assertions were changed before
production code. Against the Bearer implementation, the focused transport run
failed two tests: browser requests had no `credentials: 'include'`, and the
service binding still converted the incoming cookie fixture into an
`Authorization: Bearer` header. After the dependent tests were retargeted, the
old token helper also failed the cookie download/header expectations and bulk
requests had no credentials option.

## Implementation

- Replaced the token-shaped `ClientCtx` with the exact `fetch`, `platform`,
  `cookieHeader`, and `origin` contract.
- Browser GraphQL clients use `credentials: 'include'`, optionally use the
  context fetch implementation, and never configure `Authorization`.
- Service-binding GraphQL forwards JSON content type, the incoming `Cookie`,
  and the canonical external web origin (`new URL(origin).origin`) without a
  Bearer header. The internal binding URL remains only the service request
  destination.
- `downloadSimfile()` uses `credentials: 'include'`. Bulk-download headers
  now contain only JSON content type, and both validation and streaming bulk
  fetches use `credentials: 'include'`.
- Removed all web token mocks/imports, then deleted `token.ts` and
  `token.test.ts` only after the required search was clean. Existing GraphQL,
  download, and bulk-download error messages/semantics remain unchanged.

## Changed and deleted files

Changed:

- `packages/dtx-web/src/lib/api/chart.test.ts`
- `packages/dtx-web/src/lib/api/client.test.ts`
- `packages/dtx-web/src/lib/api/client.ts`
- `packages/dtx-web/src/lib/api/download.test.ts`
- `packages/dtx-web/src/lib/api/download.ts`
- `packages/dtx-web/src/lib/api/index.test.ts`
- `packages/dtx-web/src/lib/api/score.test.ts`
- `packages/dtx-web/src/lib/api/transport.test.ts`
- `packages/dtx-web/src/lib/api/transport.ts`
- `packages/dtx-web/src/lib/api/user.test.ts`
- `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
- `packages/dtx-web/src/lib/components/ChartList.test.ts`

Deleted:

- `packages/dtx-web/src/lib/api/token.ts`
- `packages/dtx-web/src/lib/api/token.test.ts`

## Validation

- Focused transport/client/download/API-wrapper/bulk matrix: 8 files, 91 tests
  passed.
- Post-fix focused bulk helper/component test: 1 file, 44 tests passed.
- Full `bun run --filter=dtx-web test`: 64 files, 866 tests passed.
- `bunx svelte-kit sync --mode types-only` and
  `bunx svelte-check --tsconfig ./tsconfig.json`: 0 errors, 4 existing CSS
  warnings (`@reference`/`@apply` in `ImageAudio.svelte` and the account page).
- The plain `bun run --filter=dtx-web check` command exits with the checkout's
  mode-less static-env generation and reports six missing `$env/static/public`
  exports plus the same four CSS warnings; the explicit types-only check above
  is clean. No Task 8 source causes a diagnostic.
- Focused Prettier, ESLint, and `git diff --check`: passed.
- `rg -n "getAccessTokenOrNull|getAccessToken|tokenFromSession|from './token'|mock.*token" packages/dtx-web/src`: no matches.
- No `.svelte` files were modified; Svelte autofixer was not needed.

No build, development server, deployment, or Task 9+ work was performed.
