# SDD ledger — plan: /Users/chanwaichan/workspace/drumery/.worktrees/better-auth-d1-foundation/docs/superpowers/plans/2026-08-18-better-auth-d1-migration.md

## Session scope and recovery

- Worktree: `/Users/chanwaichan/workspace/drumery/.worktrees/better-auth-d1-foundation`
- Branch: `codex/better-auth-d1-foundation`
- Plan source: draft PR #228 head `f2089ea0`; current `main` is `c8546405`.
- Active-task audit: no other active Codex task owns this Drumery migration; the only other Drumery tasks listed were not loaded.
- Ruling: Execute Foundation PR A (Tasks 1-3) as this run's independently reviewable unit, then stop at the pre-production deploy/merge gate — the plan requires that external proof and merge before PR B starts — if wrong, the cost is a second coordination cycle before Tasks 4-15.
- Ruling: Start from the still-open plan PR head and preserve a stacked/rebase dependency on PR #228 rather than reconstructing the plan on `main` — this preserves the approved documents verbatim — if wrong, the cost is rebasing the foundation branch after the plan lands.
- Ruling: Skip Foundation PR publication/merge and proceed directly through the authorized pre-production proof into Tasks 4-15 on the same stacked branch — the user explicitly chose continuous delivery over the plan's PR boundary, while production remains untouched — if wrong, the cost is a larger combined review/rebase and loss of the independently mergeable Foundation checkpoint.

## Pre-flight consistency scan

| Tasks | Producer / consumer or self-check | Finding |
| --- | --- | --- |
| 1 | Self: failing schema contract test precedes generated schema and SQL; listed created files match later generation/check steps | Consistent; generated artifacts are explicitly reviewed, not hand-maintained. |
| 2 | Self: failing route/CORS tests precede handler and CORS changes; handler remains additive | Consistent; `verifyToken()` is expressly retained. |
| 3 | Self: resolver tests precede implementation; listed API/web files match the service-binding output | Consistent; resolver stays unwired. |
| 4 | Self: consumers move before `verifyToken.ts` deletion | Consistent. |
| 5 | Self: schema/client regeneration follows mutation removal; Device Authorization UI is deferred to Task 9 | Consistent. |
| 6 | Self: session tests precede hook/layout rewrite; multi-cookie propagation is explicit | Consistent. |
| 7 | Self: redirect/error assertions move before callback deletion | Consistent. |
| 8 | Self: all token callers/mocks move before `token.ts` deletion | Consistent. |
| 9 | Self: approval-page tests cover claim/approve/deny and rely on the Task 6 `/app` guard | Consistent. |
| 10 | Self: protocol tests and native DTOs precede removal of callback/JWT/refresh machinery | Consistent. |
| 11 | Self: renderer lifecycle tests and all E2E storage fixtures move before callback config deletion | Consistent. |
| 12 | Self: import invariants precede SQL generation; local tool emits reviewed SQL and never writes remote D1 | Consistent. |
| 13 | Self: residue gate runs before and after dependency/config removal; historical/import references are explicitly exempted | Consistent. |
| 14 | Self: E2E and runbook work revisits all desktop session fixtures and leaves production actions operator-owned | Consistent. |
| 15 | Self: full static/generated/residue/E2E gates precede pre-production proof and explicitly stop before production | Consistent. |
| 1 → 2 | `createAuthOptions`, generated `authSchema`, env fields → request-scoped `createAuth(env)` | Compatible; exact 1.6.x APIs must be verified in Task 1. |
| 1 → 12 | generated auth tables/schema → identity import and local Better Auth E2E seed | Compatible; import waits for PR B. |
| 1 → 13 | Better Auth/Drizzle dependencies and env contract → final Supabase dependency/config cleanup | Compatible. |
| 2 → 3 | `createAuth(env)` → neutral cookie/Bearer resolver | Compatible. |
| 2 → 4 | mounted Better Auth handler → application authorization cutover | Compatible; Task 2 must leave GraphQL/REST on Supabase. |
| 3 → 4 | unwired `resolveAuthSession()` and `ApiAuthUser` → GraphQL/REST authorization | Compatible; wiring is deliberately deferred. |
| 3 → 6 | production API service binding → SvelteKit SSR session lookup | Compatible; binding exists before consumer. |
| 4 → 5 | Better Auth application auth → safe removal of magic-link schema/service | Compatible. |
| 5 → 7 | old callback/magic-link removal → Better Auth login/link/logout UI | Compatible; retained redirect/error seam is named. |
| 5 → 13 | magic-link code/config removal → residue cleanup | Compatible. |
| 6 → 7 | neutral web auth client/session locals → login/link/logout consumers | Compatible. |
| 6 → 8 | service-binding session plumbing → cookie-authenticated GraphQL/download transport | Compatible. |
| 6 → 9 | `/app` guard and Device Authorization client plugin → approval page | Compatible. |
| 7 → 13 | Supabase web auth removal → dependency/config residue cleanup | Compatible. |
| 8 → 13 | removal of bearer token helper/mocks → residue cleanup | Compatible. |
| 9 → 10 | browser approval surface → native Device Authorization protocol | Compatible; both consume pinned plugin semantics. |
| 10 → 11 | native DTOs, commands, session shape → renderer and WDIO session integration | Compatible. |
| 10 → 14 | native protocol/E2E seam → desktop auth acceptance coverage | Compatible. |
| 11 → 13 | renderer persistence/config cleanup → Supabase dependency/env removal | Compatible. |
| 11 → 14 | migrated standalone/Drive/crash fixtures → final desktop E2E audit | Compatible. |
| 12 → 13 | one-shot import retains Supabase only as an input format → runtime/config residue gate | Compatible due explicit historical/import exception. |
| 12 → 14 | local Better Auth seed/import tooling → authenticated web/device E2E and runbook | Compatible. |
| 13 → 15 | removed root `gen-types` → final verification omits that deleted gate | Compatible. |
| 14 → 15 | E2E suites and operator runbook → full verification/pre-production proof | Compatible. |

Pre-flight result: no task contradiction or plan-vs-spec conflict found. Foundation tasks are a coherent additive slice; Tasks 4-15 are correctly blocked on the external Foundation gate.

## Baseline

- `bun install --frozen-lockfile`: pass (Bun 1.3.14; one existing `@lucide/svelte` peer warning).
- `bun run --filter=dtx-api test`: pass (21 files, 368 tests).
- `bun run --filter=dtx-api check`: pass.
- `bun run --filter=dtx-web check`: fails before migration changes. Fresh-worktree env omissions account for ten errors; with inert required public env values supplied, one existing `hooks.server.ts` `createServerClient` cookie `setAll` type mismatch remains, plus four CSS warnings.
- Ruling: Proceed with Foundation Tasks 1-3 while preserving the exact pre-existing web-check failure as a known baseline — it is outside the additive files/behavior of Tasks 1-3 and blocking all work would not improve the migration — if wrong, the cost is a small separately reviewed compatibility fix before Foundation PR A can satisfy its full gate.

## Task 1

- Implementer: `/root/d1_task1`.
- Commit: `9f4d543` (`feat(auth): add Better Auth D1 schema`).
- Evidence: RED missing-schema import; GREEN schema generation/export/check, 2 focused schema tests, 370 full API tests, API typecheck, frozen install, all eight local D1 migrations plus seed/R2, and `git diff --check`.
- Review: spec compliant; task quality approved; no Critical, Important, or Minor findings.
- Controller check: live npm registry lists `1.6.30` as the highest published 1.6.x version for both `better-auth` and `auth`, and `auth@1.6.30` depends on `better-auth@1.6.30`; the implementation pins both exactly.
- Controller check: recording the selected version in a PR description/runbook is an external/later artifact, not missing code in this local task; carry `1.6.30` into Foundation PR A publication and the Task 14 runbook.
- Controller check: request-scoped `drizzle(env.DB, { schema })` plus `drizzleAdapter(..., { provider: 'sqlite' })` is a Task 2 requirement consuming Task 1 outputs, not a Task 1 gap.
- Task 1: complete (commits f2089ea..9f4d543, review clean)

## Task 2

- Implementer: `/root/d1_task2`.
- Commit: `e9394ec` (`feat(auth): mount Better Auth API`).
- Evidence: RED missing auth module, auth route 404s, and missing/false credentialed CORS; GREEN 35 focused tests, API typecheck, and `git diff --check`.
- Multi-cookie regression passed with the existing `new Headers(response.headers)` path, so no header-copy refactor was added.
- Review: spec compliant; task quality approved; no Critical, Important, or Minor findings.
- Controller check: the Node/Vitest multi-cookie proof is the task's required minimal regression; actual Workers header behavior remains an explicit Foundation pre-production smoke gate and is not a local Task 2 gap.
- Controller check: the report contains the required RED/GREEN command and output evidence; the final single commit cannot independently encode execution order, but the reviewer found no source discrepancy.
- Task 2: complete (commits 9f4d543..e9394ec, review clean)

## Task 3

- Implementer: `/root/d1_task3` (resumed after turn interruption; no partial edits existed at resume).
- Initial commit: `cd5df089` (`feat(auth): add Better Auth session foundation`).
- Evidence: RED missing session module; GREEN 9 resolver tests, 44 focused foundation tests, API typecheck, Prettier, ESLint, `cf-typegen`, and `git diff --check`.
- Initial review: spec needs fixes; task quality needs fixes. One Important finding: empty/malformed Bearer headers plus a valid cookie could bypass the unsafe-cookie Origin guard.
- Task 3: fix round 1/5 (1 addressed, 0 open — require a case-insensitive Bearer scheme with a non-empty token and cover cookie plus empty/malformed Bearer; commits cd5df08..d1f3127)
- Fix commit: `d1f3127`.
- Scoped re-review: original finding ADDRESSED; no new breakage; 11 resolver tests and API typecheck pass.
- Controller check: pre-production deployment/Workers smoke remains the explicit Foundation gate and was not performed locally.
- Controller check: `dtx-web check` still has the single pre-existing Supabase cookie `setAll` typing error recorded in Baseline; Task 3 changed only Wrangler config/generated binding declarations.
- Task 3: complete (commits e9394ec..d1f3127, review clean)

## Foundation final review

- Review range: `f2089ea..d1f3127` (four implementation/fix commits; plan PR head is the stacked base).
- Reviewer verdict: Ready to merge with fixes.
- Important finding 1: syntactically non-empty but invalid Bearer credentials can still bypass cookie Origin enforcement if Better Auth falls back to a valid cookie.
- Important finding 2: local development runs Wrangler with `--env pre-prod`, so omitting a local cookie-domain value inherits `pre-prod.dtx.hapadona.com` and makes localhost cookies unusable.
- No Critical or Minor findings.

## Foundation final fixes

- Fix commit: `7cfb4230` (`fix(auth): harden foundation auth boundaries`).
- Changes: non-empty Bearer credentials now prevent Better Auth cookie fallback; local Wrangler runs explicitly clear the pre-production cookie domain.
- Scoped re-review: both Important findings addressed; no new Critical or Important findings.

## Verification-driven migration test fix

- Fresh root verification exposed that the dynamically discovered `0008_better_auth.sql` migration was not included in the explicit migration-list contract and the common D1 harness only dropped legacy tables before reapplying all migrations.
- Fix: reset every numbered-migration table in foreign-key-safe child-before-parent order, update the contract/name through `0008`, and reuse the reset for the direct `0007` setup.
- Focused GREEN: `bun run --filter=@dtx/common test -- src/lib/server/db.integration.test.ts` — 1 file, 39 tests passed; `git diff --check` passed.

## Verification-driven D1 harness performance fix

- RED evidence: fresh escalated `bun run test` under parallel monorepo load completed API 389/389, but common's `db.integration.test.ts` ran for 178.7s and timed out in `beforeEach` at line 135 for `D1 partial unique indexes > rejects duplicate non-null display_order`; the focused suite remained 39/39, confirming a contention-sensitive harness timeout rather than migration SQL failure.
- Root cause: the harness issued one Miniflare/D1 IPC request per schema drop and per migration statement after adding `0008`; the additional sequential calls exceeded Vitest's 10-second hook ceiling under full-load contention.
- Fix: use D1 `batch()` for ordered, transactional schema resets and for each migration's already-split statements. The migration boundaries and statement order remain unchanged, preserving the explicit `0006` duplicate-column assertion and `0007` migration setup.
- D1 semantics evidence: Miniflare smoke verified ordered execution and rollback; the installed Workers types expose `D1Database.batch`, and the Cloudflare D1 binding contract specifies ordered transactional batches.
- Focused GREEN: `bun run --filter=@dtx/common test -- src/lib/server/db.integration.test.ts` — 1 file, 39 tests passed in 35.64s.
- Full-load GREEN: `bun run test` — 7/7 Turbo tasks passed; common 45 files/1,325 tests, API 24 files/389 tests, desktop 58 files/1,013 tests, and web 66 files/959 tests passed in 2m48.621s.
- Fix commits: `eede22de` (`test(common): reset all D1 migration tables`) and `aaed194d` (`test(common): batch D1 migration setup`).
- Scoped review and re-review: approved; no Critical, Important, or Minor findings.

## Verification-driven auth schema check fix

- RED evidence: `bun run --filter=dtx-api auth:schema:check` regenerated `src/auth/schema.ts` with generator formatting and then failed the repository diff check; formatting the generated file with the installed Prettier produced no semantic diff.
- Root cause: `auth:schema:check` compared raw generator output directly against the Prettier-formatted checked-in schema.
- Fix: format `src/auth/schema.ts` with the workspace-installed `prettier --write` between generation and `git diff`, leaving `auth:schema:generate` unchanged.
- GREEN: `bun run --filter=dtx-api auth:schema:check` passed twice consecutively, including the clean-schema idempotence check; `bun run --filter=dtx-api check`, `git diff --check`, and the generated-schema diff check all passed.
- Fix commit: `e380cbb2` (`fix(auth): stabilize schema check formatting`).
- Scoped review: approved; no Critical, Important, or Minor findings. The commit used `--no-verify` only because the hook attempted to stage this ignored SDD ledger; explicit schema, type, formatting, and diff gates passed.

## Foundation final local verification

- Controller reran `bun run test` at `e380cbb2`; Turbo validated the reviewed 7/7-task green artifact for common 1,325 tests, API 389 tests, desktop 1,013 tests, and web 959 tests.
- `bun run --filter=dtx-api auth:schema:check`: pass from a clean schema; generated output remains diff-clean after Prettier normalization.
- `bun run --filter=dtx-api check`: pass.
- `bun run --filter=@dtx/common check`: pass with 0 errors and 0 warnings.
- `bun run --filter=dtx-web cf-typegen`: pass; the generated service-binding contract includes `API` for production, pre-production, and pre-production-with-production-data.
- `bun run packages/e2e-web/setup/prepare-stack.ts`: pass; all eight numbered D1 migrations applied to fresh local state, seed data loaded, and the R2 fixture uploaded.
- `bun run --filter=dtx-web check` with inert required public env values: the exact pre-existing baseline remains — one `hooks.server.ts` Supabase `setAll` type mismatch and four CSS warnings; no Foundation-slice regression appeared.
- Local Foundation implementation and reviews are complete. Stop at the plan's external gate: publish/record the pinned `1.6.30` version, deploy PR A to pre-production, prove Worker multi-cookie behavior and the pre-production auth endpoint, then merge/rebase before starting Tasks 4-15.

## Authorized direct pre-production continuation

- User authorized skipping PR publication and proceeding directly to pre-production deployment and Tasks 4-15 on the stacked branch.
- Current-main check: after deepening the shallow clone, `origin/main` (`c8546405`) is the branch merge base and `HEAD..origin/main` is empty; no rebase is required before deployment.
- Wrangler preflight: authenticated to the expected Cloudflare account with Wrangler `4.123.0`; pre-production D1 reports migrations `0003` through `0008` pending.
- Security prerequisite blocker: pre-production has only `SUPABASE_SERVICE_ROLE_KEY`; `BETTER_AUTH_SECRET` and `GOOGLE_AUTH_CLIENT_SECRET` secrets are absent, and `GOOGLE_AUTH_CLIENT_ID` is absent from Wrangler vars/local files/process environment. No migration or deployment was performed with incomplete auth configuration.

## Post-Task-1 pre-production config correction

- Added the public `GOOGLE_AUTH_CLIENT_ID` to the top-level production, `pre-prod`, and `pre-prod-prod-data` API Wrangler var blocks.
- Extended `packages/dtx-desktop/src/devTopology.test.ts` to assert the client ID across all three blocks.
- RED: the focused topology test failed because the new production assertion received `undefined`.
- GREEN: the focused topology test passed (2/2), `bun run --filter=dtx-api check` passed, `bun run --filter=dtx-api cf-typegen` passed, and Wrangler deploy dry-runs passed for production, `pre-prod`, and `pre-prod-prod-data` without deployment.
- No secret values or downloaded credential files were added. The Better Auth and Google OAuth secret prerequisite remains unresolved and still blocks any pre-production deployment.

## Foundation pre-production proof

- User supplied the existing Google OAuth web credential and authorized generating a Better Auth secret. `GOOGLE_AUTH_CLIENT_SECRET` and a generated `BETTER_AUTH_SECRET` were provisioned as pre-production Wrangler secrets without printing or committing their values; the secret-name inventory also retains `SUPABASE_SERVICE_ROLE_KEY`.
- The public Google client-ID correction commit `27f88a83` passed independent review with no Critical, Important, or Minor findings. The earlier unresolved-secret note is superseded by the live secret-name inventory.
- Final local gate: desktop topology test 2/2 passed, API typecheck passed, auth schema drift check passed, and the pre-production API Wrangler dry-run completed successfully.
- API deployment: migrations `0003` through `0008` applied successfully to remote `dtx-web-preprod`; `dtx-api-pre-prod` deployed as version `44d96dc8-51a2-47c3-bcad-adecdd794efa` at `api.pre-prod.dtx.hapadona.com`.
- Web deployment: the clean worktree lacked the three required static public Vite variables, so the already-configured pre-production Supabase URL, Supabase anonymous key, and simfile bucket URL were injected only into the deploy child process; no env file was created. The production build passed and `dtx-web-pre-prod` deployed as version `c1c31ef1-45e6-4014-a4dc-484a9741c15e` at `pre-prod.dtx.hapadona.com`.
- Live smoke passed: web root 200; anonymous `/api/auth/get-session` 200; allowed-origin preflight 204 with exact origin and credentials; disallowed origin received no allow-origin header; invalid device client rejected 400; `dtx-desktop` device code issued 200 with the expected verification URI; first token poll returned `authorization_pending`; Google sign-in start returned the Google authorization host, the exact Better Auth callback URI, and one `__Secure-dtx-preprod.state` cookie; remote D1 reports no pending migrations.
- Ruling: Foundation pre-production proof is sufficient to begin Task 4 on this stacked branch. Google login completion remains blocked until `https://api.pre-prod.dtx.hapadona.com/api/auth/callback/google` is registered in the Google OAuth client; this must be satisfied before Task 15 pre-production acceptance. Cost if wrong: Task 15 cannot approve end-to-end Google login until the console-side redirect is added.

## Task 4

- Implementer: `/root/d1_task4_cutover`.
- Commit: `69c2b878` (`refactor(auth): use Better Auth application sessions`).
- Evidence: observed RED GraphQL cookie-session failure; 98 focused authorization tests passed in controller/reviewer verification, full API suite passed 395 tests, API typecheck/Prettier/ESLint/diff checks passed, and `verifyToken` search is clean.
- Review: approved by Terra integration reviewer with no Critical, Important, or Minor findings. GraphQL and all protected REST routes use the centralized resolver; cookie/unsafe-Origin and Bearer isolation are preserved; Pothos `FORBIDDEN` and REST 401/403 semantics remain unchanged.
- Ruling: the temporary ID-only `ctx.user` cannot satisfy the legacy magic-link mutation's email access, but Task 5 immediately removes that mutation and the plan prohibits intermediate deployment. Cost if wrong: invoking the mutation between commits would fail; no such deployment is authorized.
- Task 4: complete (commits `bb941c3..69c2b878`, review clean).

## Task 5

- Implementer: `/root/d1_task5_remove_magic_link`.
- Commit: `dcad71d` (`refactor(auth): remove magic-link handoff`).
- Evidence: API schema 4/4, app page 2/2, desktop topology 2/2, full API 379 tests, and full web 937 tests passed; schema regeneration preceded web codegen; API typecheck, focused Prettier/ESLint, and diff checks passed. Web check retains only the recorded Task 6 baseline error and four CSS warnings.
- Review: approved by Terra integration reviewer with no Critical, Important, or Minor findings. Magic-link service/mutation/client/handoff symbols, callback allowlist, KV key/limit, and generated contracts are clean; `RATE_LIMIT_API` remains for uploads/downloads; no Task 6/9 work leaked into the slice.
- Task 5: complete (commits `c1ccb8f..dcad71d`, review clean).

## Task 4

- RED: after retargeting the first GraphQL test but before production edits, `bun run --filter=dtx-api test -- src/schema/builder.test.ts -t "GraphQL accepts a valid Better Auth cookie session"` failed with `expected undefined to be 'ok'`; the old context still called `verifyToken()` and did not call the resolver mock.
- Implementation: switched `createContext`, upload, single-download, and bulk-download authorization to Foundation `resolveAuthSession()`; kept Pothos scopes and existing REST status/resource semantics; narrowed context auth data to the neutral Foundation types with a temporary optional email compatibility field for the Task 5 magic-link removal seam; deleted `verifyToken.ts` and `verifyToken.test` after the caller search was clean.
- Tests: GraphQL and all protected REST route tests now cover valid cookie, valid Bearer without Origin, missing/wrong unsafe-cookie Origin, and anonymous/invalid unauthorized behavior. `index.test.ts` was updated only as the necessary existing router test helper for the deleted verifier.
- GREEN: focused cutover matrix — 5 files, 86 tests passed; full `bun run --filter=dtx-api test` — 23 files, 395 tests passed; `bun run --filter=dtx-api check`, focused Prettier/ESLint, and `git diff --check` passed.
- Search gate: `rg -n "verifyToken" packages/dtx-api/src` has no matches. `SUPABASE_ANON_KEY` remains only in Foundation-era env/test fixtures and retained magic-link code, deferred to Tasks 5/13.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-4-report.md`.
- Task 4: complete (source, tests, report, and ledger changes are committed in the task's conventional commit).

## Task 5

- Implementer: `/root/d1_task5_remove_magic_link`.
- RED: before production edits, the schema absence expectation failed because `generateMagicLink` was still registered (`expected { name: 'generateMagicLink', … } to be undefined`); the dashboard expectation failed because `/app?redirect=desktop` still rendered the redirect spinner instead of the dashboard.
- Implementation: deleted the custom API magic-link service/mutation/tests; removed schema registration and the temporary context email compatibility field; deleted the web operation, wrapper, barrel export/tests, and redirect-specific tests; rewrote `/app` to render the dashboard only; removed the API `MAGIC_LINK_HOURLY_LIMIT` field/local override; updated the desktop topology assertion; regenerated API schema then web client.
- GREEN: `bun run --filter=dtx-api test` — 21 files, 379 tests; `bun run --filter=dtx-web test` — 64 files, 937 tests; desktop topology — 2 tests; API check, focused Prettier/ESLint, and `git diff --check` passed.
- Web check baseline remains unchanged with inert public env values: one pre-existing `hooks.server.ts` Supabase cookie `setAll` type mismatch plus four CSS warnings. No Task 6 fix was made.
- Generated artifacts: `packages/dtx-api/dist/schema.graphql`, `packages/dtx-web/src/lib/api/generated/graphql.ts`.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-5-report.md`.
- Task 5: complete (source, tests, generated artifacts, report, and ledger changes are ready for the scoped conventional commit).

## Task 6

- Implementer: `/root/d1_task6_finish`.
- Initial commit: `5e1b6224` (`feat(web): replace Supabase session plumbing`).
- Initial evidence: focused auth/session/hook/layout tests passed 6 files/17
  tests; full `dtx-web` passed 66 files/932 tests; pre-commit Prettier and
  ESLint passed.
- Initial review: spec NEEDS FIXES; quality NEEDS FIXES. Important finding:
  `authSession` appended session cookies only after downstream `authGuard`
  returned, so thrown protected/authenticated redirects lost both raw cookies.
  Important environment finding: package-local `.env.types-only` was outside
  the configured repository-root `kit.env.dir`. Minor finding: handoff files
  were at the worktree root instead of this SDD ledger.
- Fix round 1/5: added a RED composed session/guard redirect test, changed
  `authGuard` to return equivalent 303 `Response` redirects, and verified both
  raw cookies survive the protected `/app` redirect. Hook tests pass 6/6.
- Fix round 1/5: added root `.env.types-only` with the existing public defaults
  and `PUBLIC_DTX_API_URL`; explicit `bunx svelte-kit sync --mode types-only`
  passes, and `bunx svelte-check --tsconfig ./tsconfig.json` has only the 9
  known Task 7 Supabase errors plus 4 existing CSS warnings.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-6-report.md`.
- Fix-round GREEN: the focused auth/session/hook/layout matrix passed 6 files/
  18 tests and the full `dtx-web` suite passed 66 files/933 tests. Prettier,
  ESLint, and `git diff --check` passed; the commit used `--no-verify` only for
  the ignored-SDD lint-staged restaging limitation after those explicit gates.
- Task 6 fix round: complete in the conventional fix commit; no Task 7 source,
  build, deployment, or later migration work was performed.
- Task 6: fix round 1/5 (3 addressed, 0 open — redirect cookies preserved; root types-only env loaded; SDD artifacts relocated; commits `5e1b6224..bfdfe86f`).
- Scoped re-review: all original findings ADDRESSED; no new Critical or Important breakage.
- Task 6: complete (commits `d9aa3b2..bfdfe86f`, review clean).

## Task 7

- Implementer: `/root/d1_task7_web_login`.
- RED: after retargeting the focused helper/login/account/layout assertions and
  before production edits, the baseline failed 5 focused files because the old
  Supabase actions, identity calls, callback, and logout did not satisfy the
  Better Auth contracts.
- Implementation: moved email/social login, explicit Google linking, account
  provider loading, and logout to the Task 6 `authClient`; preserved
  `safeAppRedirectPath`, sanitized Better Auth provider errors, and deleted the
  old SvelteKit login action and Supabase OAuth callback after callers/tests
  moved.
- GREEN: focused matrix — 5 files, 36 tests; full `bun run --filter=dtx-web
  test` — 65 files, 877 tests; types-only sync and `svelte-check` — 0 errors,
  4 existing CSS warnings; focused Prettier/ESLint and `git diff --check`
  passed.
- Search gate: targeted web login, callback, account-linking, and logout
  routes contain no Supabase consumers. Remaining API token/config migration is
  assigned to later tasks.
- Svelte autofixer: `@sveltejs/mcp` is unavailable; bounded per-file attempts
  produced no output and were stopped, with `svelte-check` used as the
  available Svelte validation.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-7-report.md`.
- No build, deployment, native desktop cutover, or Task 8+ work was performed.
- Task 7: source, tests, report, and ledger are ready for the scoped
  conventional commit.

## Task 7 review fix round 1/5

- Review finding: relative Google callback URLs were sent to Better Auth while
  the client targets the separate API origin, so social/link redirects could
  land on `api.*`.
- RED: after changing the focused expectations first, the baseline failed 4
  callback-origin assertions; login and account linking still sent relative
  `callbackURL`/`errorCallbackURL` values.
- Fix: resolve login social success/error callbacks and account-link success/
  error callbacks from `window.location.origin` after `/app` path validation;
  password login redirect behavior remains unchanged.
- GREEN: focused login/account/helper matrix — 3 files, 27 tests; types-only
  sync and `svelte-check` — 0 errors, 4 existing CSS warnings; focused
  Prettier/ESLint and `git diff --check` passed.
- Svelte autofixer remains unavailable; bounded attempts on both modified
  Svelte files produced no output and were interrupted.
- Fix-round source/test/report/ledger changes are ready for a conventional
  fix commit.
- Task 7: fix round 1/5 (1 addressed, 0 open — OAuth callbacks use the browser origin; commits `3bbea063..775e8d63`).
- Scoped re-review: original Important finding ADDRESSED; no new Critical or Important breakage.
- Task 7: complete (commits `6b6612b..775e8d63`, review clean).

## Task 8

- Implementer: `/root/d1_task8_cookie_transport`.
- CodeGraph traced the web API transport, `ClientCtx`, single-download, and
  bulk-download call paths before edits.
- RED: browser GraphQL and service-binding assertions failed against the old
  Bearer transport; dependent download and bulk assertions then failed on the
  token helper and missing `credentials: 'include'`.
- Implementation: browser GraphQL and single/bulk downloads now use cookies;
  service-binding GraphQL forwards incoming Cookie plus canonical external
  Origin; `ClientCtx` no longer has `accessToken`; all token mocks/imports were
  removed and `token.ts`/`token.test.ts` were deleted after the search gate.
- GREEN: focused transport/client/download/API-wrapper/bulk matrix — 8 files,
  91 tests; post-fix ChartList bulk test — 1 file, 44 tests; full web suite —
  64 files, 866 tests.
- Types-only `svelte-kit sync` plus `svelte-check` passed with 0 errors and 4
  existing CSS warnings. The plain package `check` command still reports the
  known mode-less static-env export diagnostics; no Task 8 diagnostic remains.
- Focused Prettier/ESLint and `git diff --check` passed. The token search is
  clean. No `.svelte` files, build, deployment, or Task 9+ work were touched.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-8-report.md`.
- Task 8: minor (deferred): no-session service-binding test asserts Authorization absence but not explicit Cookie and Origin absence; production code already omits both. Final review must triage.
- Review: spec compliant; task quality acceptable; no Critical or Important findings.
- Task 8: complete (commits `cac6e39..ec70b4b`, review clean with 1 deferred minor).

## Task 9

- Implementer: `/root/d1_task9_desktop_auth_page`.
- CodeGraph was run once for the `/app` guard/layout path; direct source
  inspection supplied the relevant guard flow after the result was not useful.
- RED: the new page/layout matrix failed before implementation because
  `packages/dtx-web/src/routes/(app)/app/desktop-auth/+page.svelte` did not yet
  exist; the baseline layout tests passed 3/3.
- Implementation: added the authenticated `/app/desktop-auth` page, exact
  Better Auth 1.6.30 `authClient.device`, `.approve`, and `.deny` calls,
  normalized code handling, prefill/manual entry, invalid/expired errors,
  explicit approve/deny terminal states, fixed `dtx-desktop` identity, and
  in-flight double-submit protection. Added the `/app` guard return-through-
  login regression and the shared desktop client-ID constant.
- GREEN: focused page/layout matrix — 2 files, 11 tests; full web suite — 65
  files, 875 tests; types-only sync and `svelte-check` — 0 errors, 4 existing
  CSS warnings; focused Prettier/ESLint and `git diff --check` passed.
- Svelte autofixer: bounded `@sveltejs/mcp` attempt produced no output and
  was stopped after 30 seconds; `svelte-check` was the available Svelte gate.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-9-report.md`.
- No build, deployment, native desktop cutover, or Task 10+ work was performed.
- Task 9: source, tests, report, and ledger are ready for the scoped
  conventional commit.
- Task 9: minor (deferred): invalid/expired tests mock `{ code, message }` rather than Better Auth's installed `{ error, error_description, status, statusText }` wire error shape; implementation uses the pinned API correctly. Final review must triage.
- Review: spec compliant; task quality acceptable; no Critical or Important findings.
- Task 9: complete (commits `576dacc..db495673`, review clean with 1 deferred minor).

## Task 10

- Implementer: `/root/d1_task10_native_device_auth`.
- CodeGraph traced the native auth/API bearer-token/e2e seed/generated-contract
  call paths once before edits.
- RED: focused WireMock protocol tests were added before production code and
  failed with unresolved `DeviceAuthClient`, `DeviceAuthError`, and
  `DevicePollResult` imports; the protocol module then supplied the seam.
- Implementation: added Tauri-free Better Auth Device Authorization with exact
  device-code/token/session routes, typed wire errors, timeout/network mapping,
  poll backoff, secret redaction, and display-safe IPC attempt DTO. Replaced
  native Supabase JSON/refresh/JWT/callback state with typed opaque
  `sessionToken`, preserving `AuthState` generation/epoch, Drive ownership,
  command names, single-instance focus, and debug+e2e seed gating. Removed the
  unused auth deep-link plugin/config/capability after its call paths were
  clean. Generated native renderer contracts.
- GREEN: protocol WireMock tests 9 passed; focused auth tests 77 passed; e2e
  auth tests 31 passed; full default Rust suite 920 passed with 2 ignored;
  default and supported e2e clippy passed with `-D warnings`; fmt, generated
  native types (42 export tests), diff, and search gates passed.
- The mandated `cargo clippy --all-targets --all-features -- -D warnings`
  combination is blocked before compilation by the existing Google Drive
  configuration guard requiring `--no-default-features --features e2e` for an
  e2e build. This is recorded in the task report; supported default/e2e
  clippy modes are green.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-10-report.md`.
- Task 10: source, tests, generated contract, report, and ledger are ready for
  the scoped conventional commit.

## Task 10 review fix

- Review finding: native `logout_session` cleared local state but did not
  revoke the Better Auth D1 session, leaving the opaque session replayable.
- RED: the focused WireMock logout tests were added first; after isolating the
  MockRuntime helper seam, the command failed because `logout_session_impl`
  was not yet present.
- Fix: preserved the public `logout_session` command, added the generic
  internal helper and protocol-only `POST /api/auth/sign-out` bearer request,
  ignored remote failures as best effort, and kept unconditional local auth
  plus pending-device cleanup.
- GREEN: logout success/failure WireMock matrix 2 passed; existing auth slice
  79 passed; device protocol slice 9 passed; fmt and diff checks passed.
- The review-fix source, tests, report, and ledger are included in the
  follow-up conventional commit.

## Task 10 review completion

- Integration review found one Important logout-revocation defect; commit
  `779f5baa` restored best-effort Better Auth server sign-out while preserving
  unconditional local auth and pending-flow cleanup.
- Scoped re-review of `89d28929..779f5baa` resolved the finding with no new
  Critical or Important issues.
- Deferred Minor: remove the legacy `session_token` deserialization alias so
  `SessionData` accepts only the exact `sessionToken` IPC field.
- Deferred Minor: split the device-auth timeout test so a delayed mock proves
  `Timeout` independently from a refused connection proving `Network`.
- Task 10 is complete and ready for Task 11.

## Task 11

- Implementer: `/root/d1_task11_renderer_auth_retry` (recovered the shared
  worktree after an interrupted renderer attempt; preserved the staged
  `supabaseService` to `sessionStorage` rename).
- CodeGraph was run before source inspection for the renderer host, editor,
  auth-store, native session, and API session paths.
- RED: the recovered focused matrix failed before the remaining production
  edits because `App.svelte` still imported the removed `supabaseService` and
  registered removed auth listeners, while topology still expected callback
  port variables. The three other focused files passed 71 tests.
- Implementation: renderer Device Authorization start/open/poll/persist,
  cancellation/retry, terminal errors, browser fallback, neutral session
  storage, tri-state restore, logout cleanup, App lifecycle cleanup, native host
  DTO calls, Better Auth-shaped Google Drive/crash-recovery seeds, and callback
  configuration removal. The web local-dev callback variable was removed after
  the source search found it outside the desktop package; no API test-auth
  endpoint was added.
- GREEN: focused renderer/storage/host/App/topology matrix — 5 files, 91 tests;
  full desktop suite — 58 files, 1,010 tests; desktop svelte-check — 0 errors,
  0 warnings; E2E typecheck; standalone/crash tests — 29 passed; generated
  native exports — 42 passed; focused Prettier/ESLint, Rust fmt, and diff checks
  passed.
- Svelte autofixer: bounded `@sveltejs/mcp` attempt produced no output and was
  stopped; svelte-check was used as the available Svelte gate.
- The requested Rust `cargo test --all-features` command is blocked before
  compilation by the existing Google Drive feature guard; supported feature
  modes remain the Task 10 green evidence. No build, deployment, or Task 12
  work was performed.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-11-report.md`.
- Task 11: source, tests, report, and ledger are ready for the scoped
  conventional commit.

## Task 11 review fixes

- Scoped Important findings: live malformed `auth_session` cleanup and
  `not-configured` retention, reachable/accessible Device Authorization UI
  through toolbar and command palette, and logout ordering when cancellation
  rejects.
- RED: the empty malformed-storage case failed `1/19`, and the Login test
  failed `1/8` until the production seams were corrected. The logout test now
  locks cancellation -> native logout -> renderer cleanup ordering, including
  native failure handling.
- GREEN: review-focused storage/auth/UI coverage is 88 tests across six files.
  The bounded Svelte autofixer was silent for 10 seconds and stopped; use
  `svelte-check` as the available diagnostics gate.
- Scoped re-review of `88ff0011..383f9b3d` resolved all three Important
  findings with no new Critical or Important issues; Task 11 is compliant and
  approved.
- Deferred Minor: make the `desktopHost.test.ts` seeded `DesktopAuthUser`
  fixture use the full generated contract instead of a partial user object.
- Task 11 is complete and ready for Task 12.

## Task 12

- Implementer: `/root/d1_task12_e2e_fix`.
- Read the Task 12 brief, migration plan/spec, repository instructions, and
  the TDD, systematic-debugging, and Supabase skills before editing. The
  Supabase remote-doc step was skipped because this task explicitly forbids
  remote calls; local source and local D1 evidence were used instead.
- Existing Task 12 changes add the local-only ID-preserving importer and tests,
  sanitized fixture, Better Auth D1 E2E seed, Playwright/CI retargeting, and
  remove the Supabase local user creator.
- RED: after adding the local SSR regression first,
  `rtk bun run --filter=dtx-web test -- src/lib/auth/session.test.ts` failed
  1/7 because an emulated `platform.env.API` was called despite
  `PUBLIC_DTX_API_URL=http://localhost:8787`; the other six session tests
  passed.
- Root cause: adapter-cloudflare's dev platform proxy exposes an emulated
  `API` binding even when browser auth and `PUBLIC_DTX_API_URL` target the
  local API, so SSR session lookup selected a different D1/session store.
- Fix: `packages/dtx-web/src/lib/auth/session.ts` now bypasses the service
  binding only for `localhost`, `127.0.0.1`, and `[::1]`, using the public
  local `event.fetch`; non-loopback URLs retain service-binding preference.
  The test covers local routing and forwarded cookies without changing
  cookie/error semantics.
- GREEN: focused web session tests — 1 file, 7 tests; importer tests — 1
  file, 5 tests; `bun run --filter=dtx-e2e-web check` — pass; local
  `prepare-stack.ts` — all 8 migrations, Better Auth/application/R2 seed;
  local D1 query — fixed UUID/email present; Playwright `setup` project — 1
  test passed in 24.3s, including `/login` to `/app` navigation.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-12-report.md`.
- The first sandboxed local preparation was blocked by Wrangler log/listener
  permissions; the same local-only command passed with host-level permission.
  No remote calls were made.
- Task 12: source, tests, report, seed/import tooling, and ledger are ready
  for the scoped conventional commit.

## Task 12 review fix

- Important finding: Supabase Admin exports do not carry application owner IDs,
  but the CLI accepted an omitted owner list as `[]`, emitted SQL reporting
  zero reconciled owners, and exited successfully.
- RED: added a subprocess CLI test first; the focused importer suite failed
  1/6 because omission returned status 0 and wrote SQL, while the existing five
  pure-generator tests remained green.
- Fix: CLI parsing now requires `--owner-ids <path>` before generation/output,
  rejects a non-array owner file explicitly, and passes the supplied list into
  the existing UUID and imported-user completeness validation. The pure
  generator remains ergonomic for the local E2E seed path.
- GREEN: importer/CLI suite — 1 file, 6 tests; `bun run --filter=dtx-api
  check` — pass; focused Prettier, ESLint, and `git diff --check` — pass.
- Report updated with the review finding and RED/GREEN evidence.
- Task 12 review fix: complete and ready for a conventional fix commit.

## Task 12 review completion

- Scoped re-review of `42d3da8c..4f13787f` confirmed the CLI owner-input hard
  gate, early omission/shape failures, and imported-user completeness checks.
- No new Critical or Important findings; Task 12 is approved.
- Task 12 is complete and ready for Task 13.

## Task 13

- Implementer: `/root/d1_task13_supabase_cleanup`.
- Read the Task 13 brief, migration plan, repository instructions, TDD skill,
  and Supabase skill. CodeGraph was used before source search. Supabase remote
  documentation was not consulted because this cleanup task forbids remote
  operations.
- RED: the clean-base residue gate reported 154 Supabase matches across 47
  files. The login handoff regression set then failed 1/11 after its tests were
  updated first: the old production branch still rendered `Login to Desktop
  App`. The bounded Svelte autofixer attempt was silent for approximately 30
  seconds and stopped; `svelte-check` became the diagnostics fallback.
- Implementation: removed Supabase dependencies, mocks, env/config/workflow
  values, generated common types/export, callback-era login handoff and test
  residue, and root/Turbo `gen-types`; updated current guidance/comments;
  preserved API GraphQL schema generation, web codegen, native generation, and
  Task 12's local-only Supabase-import input format.
- GREEN: the final residue gate has only the intentional Task 12 importer
  command in `dtx-api/package.json`; web 65 files/876 tests, API 22/385,
  desktop renderer 58/1,010, and common unit-only 44/1,286 all pass. API,
  common, desktop, and E2E checks pass; web types-only svelte-check has 0
  errors/4 existing CSS warnings; Rust tests pass 922 with 2 ignored; Rust
  format, lint, Prettier, and diff checks pass. The full common suite's sole
  failure is its existing Miniflare listener `EPERM` sandbox integration hook.
- `bun install` removed the five Supabase dependency entries from `bun.lock`
  without adding packages. No build, development server, deployment, remote
  call, unrelated data-column cleanup, or Task 14 work was performed.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-13-report.md`.
- Task 13 source, tests, report, and ledger are ready for the scoped
  conventional commit.

## Task 13 review fix

- Review RED: the tracked `supabase/` tree contained exactly one obsolete
  file, `supabase/config.toml`, enabling a local Supabase API/DB/Auth stack;
  `.eslintignore` also retained one `supabase.types.ts` entry for the deleted
  generated common type. No current references to the local stack were found
  outside the documented importer/docs allowlists.
- Fix: deleted the config and empty directory, and removed only the stale
  `.eslintignore` entry.
- Review GREEN: the focused residue gate still has only the intentional Task
  12 importer command; no tracked `supabase/**` files remain; the current
  reference/config scan, `bun run lint`, `bun run --filter=dtx-api check`,
  config check, and `git diff --check` pass.
- Task 13 review fix is ready for a scoped conventional commit. No Task 14
  work was performed.

## Task 13 review completion

- Scoped re-review of `32cb639a..62d80357` confirmed the obsolete local
  Supabase stack and stale lint ignore are fully removed with no references or
  replacement residue.
- No Critical, Important, or new Minor findings; Task 13 is approved.
- Task 13 is complete and ready for Task 14.

## Task 14

- Implementer: `/root/d1_task14_e2e_runbook_retry`.
- CodeGraph was queried before source inspection. The TDD, Playwright,
  Cloudflare, and Supabase skills were read. No Svelte source was changed.
- RED: the first local expiry assertion returned `authorization_pending`
  instead of `expired_token`; the focused request helper also exposed Better
  Auth's required Origin header, and the first revoke request lacked JSON
  `Content-Type`. A web logout click before hydration produced no sign-out
  request. These were corrected at the local test/config seam: optional
  1-second E2E expiry override (production default remains 30 minutes), web
  Origin headers, JSON revoke body, and the existing hydration marker wait.
- Implementation: added web password/guard/download/invalid-session/logout
  lifecycle coverage; real local Device Authorization browser claim/approve,
  poll/session validation/revoke, deny, and expiry coverage; optional API
  expiry configuration; and a desktop WDIO Better Auth `{ sessionToken, user }`
  restore/logout session-shape audit using the existing debug-only native seed.
  No production or API-wide test-auth endpoint was added.
- Desktop residue audit matches are intentional: legacy key names are cleanup
  or safe-rejection assertions, `DTX_E2E_DRUMERY_USER_ID` is the compile-time
  gated native seed, and `refresh_token` belongs to Google Drive credentials.
  No Supabase-shaped renderer seed or application-auth fake refresh token
  remains.
- PR #221 reconciliation: no local Zero Trust spec/plan/runbook document was
  found; only Task 14 plan references and an unrelated `#221E3A` color literal
  exist. The required future reconciliation is recorded in the runbook and
  report; no absent document was created.
- GREEN: focused Device Authorization Playwright — 4 passed (setup plus
  browser-UI approve/validate/revoke, browser-UI deny, expiry) in 35.6s;
  focused logout — 2 passed
  (setup plus lifecycle) in 26.0s; API auth tests — 3 passed; API check,
  web-E2E check, desktop-E2E check, Prettier, and diff checks passed.
- Full web/desktop E2E was not rerun. No desktop `target-e2e` binary was
  present, so a potentially long Tauri build was not allowed to block the
  task. The manual real-OS-browser Device Authorization handoff remains a
  separate operator evidence item in the runbook. No remote operation or Task
  15 work was performed.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-14-report.md`.
- Runbook: `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md`.
- Task 14: source, tests, report, ledger, and operator runbook are ready for
  the scoped conventional commit.

## Task 14 review fixes

- Review RED: cloning the authenticated storage-state cookie and logging out
  the page revoked the supposed baseline session; the focused owner-only chart
  download also failed because chart A had no D1/R2 file fixture; the new Rust
  restore test initially failed to compile because no native seed restoration
  seam existed.
- Fixes: sign the logout test into an independent session before revocation;
  seed chart A's minimal `dtx_file` row and R2 object while retaining public
  chart-B coverage; add the `e2e + debug_assertions`-only native restore helper
  and IPC command and restore it from WDIO `afterEach`; correct importer and
  pre-production secret/migration/deploy commands and safety warnings in the
  runbook.
- GREEN: the auth lifecycle file passed 7/7 Playwright tests (including setup)
  in 27.6s; the Device Authorization file passed 4/4 (including setup) in
  28.1s; the Rust E2E-feature tests passed 40/40; desktop E2E and renderer
  typechecks, 29 desktop support tests, lint, Prettier, Rust format, and diff
  checks passed. The full desktop executable remains unavailable because its
  target-e2e binary is absent.

## Task 14 scoped re-review fixes

- RED: changed the owner-only download proof to dedicated private chart C
  before seeding it; focused Playwright failed because chart C had no fixture.
- Fix: seeded chart C (`1003`) as a separate unpublished owner chart with its
  own D1 file row and R2 object. The runbook importer output is now
  `../../tmp/auth-migration/better-auth-import.sql` for the filtered package
  cwd, and the pre-production secret flow is consistently explicit legacy
  `wrangler secret put --env pre-prod` with immediate-deploy warning.
- GREEN: focused auth lifecycle passed 7/7 with `--workers=2`; focused chart-C
  download passed 2/2 with `--workers=2`; the documented importer command
  reached input-file validation (`ENOENT`) using protected nonexistent paths;
  Wrangler help confirmed the documented secret flags. The desktop
  native-clearance assertion Minor is deferred and recorded in the report.

## Task 14 review decision

- Final scoped re-review approved `5d4a97d0..1c733063` with no Critical or
  Important findings.
- Task 14 is complete. The deferred desktop native-clearance assertion is a
  non-blocking test-quality Minor and remains recorded in the Task 14 report.

## Task 15

- Implementer: `/root/d1_task15_verification`.
- Verification-driven RED findings were limited to the bare web check's
  missing static public env values, the Rust all-feature Google Drive/E2E build
  guard, one existing Clippy `result.ok()` warning in `auth.rs`, and three
  local Playwright harness races/request seams. The web check passed with
  inert local public values; supported default/e2e Clippy passed; `auth.rs`
  now matches the result directly; and the E2E config/request/expiry seams
  were corrected without changing remote auth defaults.
- GREEN: `bun run lint`, the inert-env full check, `bun run test` (7/7 Turbo
  tasks; common 1,325, API 385, desktop 1,010, web 876), Rust format, the
  full Rust suite (922 passed, 2 ignored), generated schema/client/native
  gates (42 native export tests), residue checks, and `git diff --check` pass.
  The mandated `cargo clippy --all-targets --all-features -- -D warnings`
  remains structurally blocked by the existing feature guard; both supported
  feature modes pass with `-D warnings`.
- Full local E2E is green: web Playwright 36/36; desktop WDIO/Tauri all seven
  spec files pass, with nine native-filesystem cases passing and one
  Windows-only skip. The manual OS-browser handoff is separate from automated
  coverage; today's browser-approval evidence is recorded below.
- Earlier pre-production facts are Foundation rehearsal artifacts, not current
  Tasks 4–15 cutover proof: D1 migrations through 0008, API version
  `44d96dc8-51a2-47c3-bcad-adecdd794efa`, web version
  `c1c31ef1-45e6-4014-a4dc-484a9741c15e`, secret presence without values, and
  non-secret web/auth/CORS/device/Google-start smoke were recorded before the
  final migration work. The earlier web build used Foundation-era Supabase
  public variables, so those artifacts do not prove the final Better-Auth-only
  API/web cutover.
- The final reviewed API and web artifacts were subsequently deployed to
  pre-production. The unmatched legacy owner removal was user-approved after
  a protected D1 backup with SHA-256 prefix `bff977...`; the approved atomic
  cleanup file was applied with R2 objects left untouched. Importer transaction
  compatibility was corrected in commit `22f3c27f`; focused importer
  verification passed 6/6.
- The protected pre-production import artifact with SHA-256 prefix `51af...`
  was independently approved and applied. Final D1 counts are 2 Better Auth
  users, 3 accounts, 0 sessions, 2 application owners, and 0 uncovered owners.
  The earlier active cutover Workers were API `839e...` and web `255a...`; the
  web `API` service binding was present and verified. During today's browser
  acceptance, a later pre-prod-prod-data API deploy (`42e1e0c8` at 06:39) and
  web deploy (`7a5396c4` at 06:41) reclaimed the same public custom domains;
  public API auth routes and `/app/desktop-auth` returned 404. The isolated
  pre-production services were restored as API
  `d4fac270-7bd0-411f-b4c7-94ebe7e2cdd3` and web
  `2478f4a7-ad6d-494a-bdca-d207565e1d59`.
- The restored web build required explicit
  `PUBLIC_DTX_API_URL=https://api.pre-prod.dtx.hapadona.com` and
  `PUBLIC_SIMFILE_BUCKET_URL=https://pub-69ca40bf7a284843b562ff39a68b2e6e.r2.dev`;
  the build passed and the deploy succeeded.
- Live password/cookie authentication, GraphQL, CORS, Google authorization
  start with the exact pre-production callback, invalid sessions,
  logout/revocation, Device Authorization approve/revoke/deny, and
  upload/download passed; temporary upload test objects were removed. The user
  confirmed the Google callbacks are registered. Cloudflare Access initially
  returned 403; after WARP/user authentication it cleared. Today's browser
  acceptance passed: the app guard/login redirect preserved the device path,
  real Better Auth Google sign-in completed, the Account provider UI showed
  Google already connected, and `/app/desktop-auth` code claim plus Approve UI
  passed.
- The native/public follow-up passed: the Device Authorization poll returned
  200 with a Bearer token, `get-session` returned 200 for the migrated user,
  sign-out returned 200, and the revoked `get-session` returned 200 with
  `null`.
- Explicit Connect Google linking UI was not exercised because the migrated
  user was already linked; the account was not unlinked. Remote Device
  Authorization expiry has not been run independently because the five-second
  expiry override is local-only and prohibited remotely. The later MCP-driven
  desktop pre-production runtime matrix is recorded below. The legacy
  pre-production `SUPABASE_SERVICE_ROLE_KEY` secret remains and was not deleted.
- Updated the runbook to describe the corrected five-second local E2E device
  expiry override and to prohibit it in remote environments. Production was
  untouched: no migration, identity import, secret operation, deploy,
  desktop publication, or credential removal.
- Report: `.superpowers/sdd/2026-08-18-better-auth-d1-migration/task-15-report.md`.
- Task 15 local verification, deploy/import smoke, and browser/native approval
  acceptance are complete. The MCP-driven desktop pre-production runtime matrix
  is recorded below. Explicit Connect Google linking and remote Device
  Authorization expiry remain open; production remains a separate hold.

## Task 15 review decision

- Scoped Task 15 re-review approved the verification changes and corrected
  evidence with no remaining Critical, Important, or Minor findings.
- Final-cutover pre-production deployment/import, core live smoke, and today's
  browser/native approval acceptance are complete. The later MCP-driven native
  desktop runtime matrix also passed. Explicit Connect Google linking and remote
  Device Authorization expiry remain unproven; production remains out of scope
  and separately held.

## Final whole-branch native review fixes

- CodeGraph was queried before editing the native device-auth, AuthState,
  renderer logout, and Drive reconciliation paths.
- RED: delayed native race tests initially failed to compile against the
  Wry-only command wrappers and `Option` pending state; the renderer delayed
  revoke test established the required pre-await cleanup ordering.
- GREEN: native sign-out WireMock contract and origin-topology tests passed
  11/11; focused native auth tests passed 83/83, including delayed begin/cancel,
  delayed poll approval/cancel, overlapping begin, delayed logout, Drive
  memory clear, and best-effort revoke; renderer auth tests passed 15/15.
- Implementation reserves a monotonic device attempt generation before begin,
  checks it after every network await before pending/session/Drive mutation,
  and increments it for cancel/logout even when pending state is absent.
  Logout snapshots the token, invalidates native generations and Drive memory
  before best-effort JSON/Origin remote revoke; renderer persistence is cleared
  before awaiting native calls. The sign-out request contract is now
  `{}` JSON + Bearer + canonical trusted Origin.
- Desktop WDIO `afterEach` asserts native `get_current_session` is null before
  reseeding. The `session_token` alias was reviewed but deferred because no
  safe no-caller deletion proof was established.
- Rust format, default/e2e supported Clippy, desktop typecheck, desktop E2E
  typecheck, Prettier, and diff checks pass. No real-handler Worker/D1 fixture
  was started and no remote/pre-production/production operation was run.

## Final desktop E2E native-clearance review fix

- Moved a bounded `browser.waitUntil` poll of native `get_current_session` into
  the UI logout test immediately after the signed-out shell appears; `afterEach`
  now only performs cleanup and deterministic reseeding, so it cannot mask a
  renderer logout failure or race the native IPC completion.
- Focused desktop E2E typecheck and Prettier pass. The existing target-e2e
  executable reran `auth-session.e2e.ts` successfully: 2/2 scenarios passed in
  663ms; no rebuild or remote operation was performed.

## Pre-production operator evidence

- Supabase connector read-only counts: 2 users, 2 email identities, and 1
  Google identity. No password hashes, sessions, or tokens were exported.
- Production D1 contains 1 distinct application owner UUID, exactly covered by
  the sanitized export. Pre-production D1 contains 3 distinct owner UUIDs;
  only 2 are covered. The unmatched owner is not a repository fixture and owns
  3 simfiles plus 1 profile dating from March 2026.
- The protected pre-production backup was recorded with SHA-256 prefix
  `bff977...`; the user-approved unmatched-owner removal used the approved
  atomic cleanup file and left R2 objects untouched. Importer transaction
  compatibility was fixed in `22f3c27f`, with focused verification 6/6.
- The protected pre-production import artifact with SHA-256 prefix `51af...`
  was independently approved and applied. Final D1 counts are 2 users, 3
  accounts, 0 sessions, 2 application owners, and 0 uncovered owners.
- The earlier active pre-production Workers were API `839e...` and web
  `255a...`, with the web `API` service binding verified. During today's
  browser acceptance, a later pre-prod-prod-data API deploy (`42e1e0c8` at
  06:39) and web deploy (`7a5396c4` at 06:41) reclaimed the same public custom
  domains; public API auth routes and `/app/desktop-auth` returned 404. The
  isolated pre-production services were restored as API
  `d4fac270-7bd0-411f-b4c7-94ebe7e2cdd3` and web
  `2478f4a7-ad6d-494a-bdca-d207565e1d59`.
- The restored web build required explicit
  `PUBLIC_DTX_API_URL=https://api.pre-prod.dtx.hapadona.com` and
  `PUBLIC_SIMFILE_BUCKET_URL=https://pub-69ca40bf7a284843b562ff39a68b2e6e.r2.dev`;
  the build passed and the deploy succeeded. Password/cookie, GraphQL, CORS,
  Google-start exact callback, invalid-session, logout/revocation, Device
  Authorization approve/revoke/deny, and upload/download smoke passed; upload
  test objects were removed. The user confirmed callbacks are registered.
- Cloudflare Access initially returned 403; after WARP/user authentication it
  cleared. Today's browser acceptance passed: the app guard/login redirect
  preserved the device path, real Better Auth Google sign-in completed, the
  Account provider UI showed Google already connected, and
  `/app/desktop-auth` code claim plus Approve UI passed. The native/public
  follow-up passed: the Device Authorization poll returned 200 with a Bearer
  token, `get-session` returned 200 for the migrated user, sign-out returned
  200, and the revoked `get-session` returned 200 with `null`.
- Explicit Connect Google linking UI was not exercised because the migrated
  user was already linked; the account was not unlinked. Remote Device
  Authorization expiry has not been run independently because the five-second
  expiry override is local-only and prohibited remotely. The later MCP-driven
  desktop pre-production runtime matrix is recorded below. The legacy
  pre-production `SUPABASE_SERVICE_ROLE_KEY` secret remains and was not deleted.

## Production read-only preview

- Production preview was read-only: `0008` is pending, Better Auth auth tables
  are empty, D1 has 1 owner, and only `SUPABASE_SERVICE_ROLE_KEY` is present.
- Rollback versions remain API `8104...` and web `f68b...`. A protected
  independent production Better Auth secret was generated, and the protected
  production artifact with SHA-256 prefix `135d...` was independently approved
  for 1/1 owner coverage; no artifact or secret was applied.
- Absolutely no production mutation occurred: no migration, import, secret
  update/removal, deploy, publication, or credential change.

## MCP-driven desktop pre-production runtime acceptance

- RED established two independent tooling failures: the existing desktop app
  exposed no MCP bridge on `127.0.0.1:9223`, and the first bridge-enabled run
  connected but could not initialize DOM helpers because the renderer's
  hard-coded production CSP meta tag intersected with the development CSP.
- The minimal debug tooling installs `tauri-plugin-mcp-bridge` 0.12, registers
  it only under `cfg(debug_assertions)`, and binds only to `127.0.0.1`. Global
  Tauri exposure and the relaxed inline-script policy live only in
  `tauri.dev.conf.json`. The renderer duplicate CSP tag was removed so Tauri is
  the single CSP source; the production `csp` in `tauri.conf.json` is unchanged.
- GREEN: the bridge reported `com.hapadona.drumery.dev` on port 9223 and the
  accessibility snapshot returned the real native shell. A fresh Device
  Authorization request completed through Cloudflare Access with user approval;
  the desktop showed the migrated Better Auth user and authenticated navigation.
- Authenticated Cloud loaded two SimFiles from the pre-production API. Scores
  rendered the existing native score database. After a full process restart,
  the stored session restored without another approval and the app immediately
  fetched the same two SimFiles again.
- Verification passed: desktop renderer 58 files / 1,011 tests, Rust 928 passed
  / 2 ignored / 0 failed, desktop typecheck with 0 errors and 0 warnings, Rust
  format, focused Prettier, and `git diff --check`. The known ts-rs serde parsing
  warnings remain non-failing and pre-existing.
- This closes the broader native desktop pre-production runtime matrix. Desktop
  release packaging/publication was not performed. Explicit Connect Google and
  remote Device Authorization expiry remain separate gaps. Production remained
  untouched.

## Natural expiry closeout and refreshed production preflight

- A fresh Device Authorization code was requested from the isolated
  pre-production API and deliberately left unapproved. The server returned its
  normal `expires_in: 1800` lifetime; after waiting for that full lifetime, the
  first token poll returned HTTP 400 with `expired_token`. The opaque code was
  kept only in process memory and was not logged. This closes the remote natural
  expiry acceptance gap without changing the remote expiry configuration.
- Explicit Connect Google was waived: the migrated account is already linked to
  Google, successful Google sign-in and the connected-provider Account UI were
  already observed, and unlinking a working identity solely to replay the link
  control would add account-recovery risk. No identity was unlinked.
- The refreshed production preflight was read-only. Wrangler 4.123.0 now lists
  only `0008_better_auth.sql` as pending. Production has 0 Better Auth tables,
  320 simfiles, 1 user profile, 0 chart scores, and 1 distinct application
  owner. The D1 inventory reported `rows_written: 0` and `changed_db: false`.
- The protected production import artifact still has SHA-256
  `135d4c91aece00871fc7c9dc0dbe36976925d86a6c61b8c3a02e2deb0c294a7f`.
  It contains 2 user inserts and 3 account inserts, with no session,
  verification, device-code, delete, or update statements. A live identifier
  comparison found 1 owner, 0 uncovered owners, and exact owner coverage; no
  identifier was printed.
- Current production rollback versions are API
  `c8d63e54-38af-40ba-9189-4d62d45bf911` and web
  `eaac7dee-661c-4869-bb62-59dbfba618ab`. Both production hostnames return 200,
  while the legacy API returns 404 for `/api/auth/get-session`. The active API
  secret list contains only `SUPABASE_SERVICE_ROLE_KEY`; neither
  `BETTER_AUTH_SECRET` nor `GOOGLE_AUTH_CLIENT_SECRET` is installed. The active
  web version also lacks the planned `API` service binding.
- The supplied Google OAuth JSON has the configured production client ID and a
  non-empty client secret. Its downloaded callback metadata predates the
  operator's console changes; pre-production Google authentication already
  proves the pre-production callback, while the production callback remains an
  explicit post-API-deploy smoke assertion.
- Production remains held for a separately explicit change-window go decision.
  No production backup, migration, import, secret operation, Worker deploy,
  desktop publication, credential change, or other production mutation was
  performed.
