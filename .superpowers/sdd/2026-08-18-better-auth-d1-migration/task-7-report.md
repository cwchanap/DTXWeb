# Task 7 report: move web login, logout, and Google linking to Better Auth

## Scope

Task 7 only: replace the remaining web login, logout, Google sign-in, and
account-linking Supabase consumers with the Task 6 `authClient`; preserve the
safe `/app` redirect policy and sanitized existing-account/link-conflict copy;
remove the obsolete SvelteKit Supabase OAuth callback after its callers and
tests moved. The native desktop authentication cutover, token consumers, and
later migration tasks remain out of scope.

## CodeGraph and RED evidence

CodeGraph was used once before source edits to trace the current login,
callback, logout, and account-linking paths across the web route files and the
Google helper. It identified the SvelteKit login action, old `/auth/callback`,
app layout logout, and account identity calls as the Supabase consumers to
replace.

The focused assertions were retargeted before deleting the old production
routes or adding the Better Auth calls. Against the baseline implementation,
the required RED was observed:

```text
bun run --filter=dtx-web test -- src/lib/auth/google.test.ts \
  src/routes/'(login)'/login/page.server.test.ts \
  src/routes/'(login)'/login/login-page.test.ts \
  src/routes/'(app)'/app/account/account-page.test.ts \
  src/routes/'(app)'/layout.svelte.test.ts

FAIL — 5 files; old Supabase behavior failed the new sanitizer, account,
login, and logout expectations (including missing authClient calls and
undefined Supabase auth clients).
```

## Implementation

- Retained `safeAppRedirectPath` semantics, including `/app` prefix checks,
  external/protocol-relative rejection, traversal normalization, and query
  preservation. Expanded Google error sanitization for Better Auth callback
  codes: existing-account-only, provider cancellation/failure, linking
  configuration, and explicit provider-conflict messages.
- Replaced the login server actions with client-side `authClient.signIn.email`
  and `authClient.signIn.social` calls. Password success uses
  `window.location.assign` with the validated destination and `/app` default;
  Google receives safe success/error callback paths and leaves provider
  navigation to Better Auth.
- Replaced Supabase identity loading/linking with `authClient.listAccounts` and
  `authClient.linkSocial`, preserving the connected-provider UI and sanitized
  callback banners.
- Replaced app logout with `authClient.signOut()` followed by a full
  navigation to `/login`.
- Deleted the obsolete SvelteKit login action and `/auth/callback` route and
  their Supabase callback test; Better Auth `/api/auth/callback/google` is now
  authoritative.
- Retargeted the focused route/helper tests to verify redirect safety,
  cancellation/failure sanitization, existing-account-only behavior, explicit
  link conflict copy, Better Auth call arguments, and logout navigation.

## GREEN and validation

- Focused auth/login/account/layout matrix: 5 files, 36 tests passed.
- Full `bun run --filter=dtx-web test`: 65 files, 877 tests passed.
- `bunx svelte-kit sync --mode types-only`: passed.
- `bunx svelte-check --tsconfig ./tsconfig.json`: 0 errors, 4 existing CSS
  warnings (`@reference`/`@apply` in `ImageAudio.svelte` and the account
  page).
- Focused Prettier check: passed.
- Focused ESLint over all changed web source/tests: passed.
- `git diff --check`: passed.
- The targeted web auth/account routes no longer reference Supabase login,
  callback, identity-linking, or logout consumers. Remaining Supabase API token
  consumers are assigned to the later token/config cleanup task.

## Svelte autofixer limitation

The checkout does not contain `@sveltejs/mcp`. Bounded attempts for each
modified Svelte file using `npx --no-install @sveltejs/mcp svelte-autofixer ...`
produced no output and were stopped at the 30-second boundary (follow-up
processes were interrupted explicitly). `svelte-check` supplied the available
Svelte validation; no autofixer changes were applied.

No build, development server, deployment, native desktop cutover, or Task 8+
work was performed.

## Changed and deleted files

Changed:

- `packages/dtx-web/src/lib/auth/google.ts`
- `packages/dtx-web/src/lib/auth/google.test.ts`
- `packages/dtx-web/src/routes/(login)/login/+page.svelte`
- `packages/dtx-web/src/routes/(login)/login/login-page.test.ts`
- `packages/dtx-web/src/routes/(login)/login/page.server.test.ts`
- `packages/dtx-web/src/routes/(app)/+layout.svelte`
- `packages/dtx-web/src/routes/(app)/layout.svelte.test.ts`
- `packages/dtx-web/src/routes/(app)/app/account/+page.svelte`
- `packages/dtx-web/src/routes/(app)/app/account/account-page.test.ts`

Deleted:

- `packages/dtx-web/src/routes/(login)/login/+page.server.ts`
- `packages/dtx-web/src/routes/auth/callback/+server.ts`
- `packages/dtx-web/src/routes/auth/callback/server.test.ts`
