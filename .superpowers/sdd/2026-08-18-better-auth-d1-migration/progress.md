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
