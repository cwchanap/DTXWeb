# HPA-1039 — Repository hygiene: single-PR implementation plan

**Status:** Design/plan draft only. Perform the implementation, tests, MCP acceptance and review fixes on **this same PR**; do not open a second implementation PR.  
**Linear:** https://linear.app/cwchanap/issue/HPA-1039/dtxwebmaintenance-repo-hygiene-shared-packages-from-source-ci-type  
**Design:** [2026-11-20-hpa-1039-repo-hygiene-design.md](../specs/2026-11-20-hpa-1039-repo-hygiene-design.md)  
**Inspected main:** `59edbe86079a7dab8273a00126dbbbf16d41badf`. Rebase/inspect again before implementation; PR #364 fixes overlapping type errors, PR #365 (HPA-1037) overlaps mechanical renames.  
**Dependencies:** None. HPA-1042 is blocked by this issue and HPA-1037.  
**PR strategy:** One PR/branch, incremental commits for reviewability. No art/SFX work.

## Proposed work and targeted files

| Phase | Files/areas | Observable exit condition |
| --- | --- | --- |
| A. Workspace exports | `packages/common/package.json`, `packages/common/src/lib/{index,components,game,audio,encoding}.ts`, `scripts/fix-extensions.js`, `turbo.json`, root `package.json`/`bun.lock` | Web/API/desktop resolve common without `dist` or shared build |
| B. UI package merge | `packages/ui-components/**`, `packages/common/src/lib/components/{Button,Modal}.svelte`, `components.ts`, all UI imports and tests/mocks | Same components rendered through `@dtx/common/components`; old package fully gone |
| C. Config/CI gates | Web/desktop Vite, Vitest, Svelte and TS config; API TS/Vitest; `.github/workflows/{lint-and-format,unit-test,e2e-test,desktop-e2e-test,desktop-build-deploy}.yml` plus other scripts referring to old builds; `.github/scripts/ci-affected-scope.{sh,test.sh}` | `bun run check` genuinely gates all four production packages, including desktop |
| D. Dead code | `packages/dtx-web/src/routes/(game)/game`, `(app)/+layout.svelte`, common `game/scenes/MainMenu.ts`, `game.ts`, `game/main.svelte`, `Editor.ts`; obsolete scripts, mocks and utils | Editor/Preview work, no dead route/nav/timer or stale references |
| E. Dependencies/UX/docs | Root/web/desktop/API `package.json`, `bun.lock`, `CLAUDE.md`, `.cursor/`, finished plans/specs, web inline SVG sites, misspelled symbols | Clean dependency graph, current instructions, visually consistent icons |
| F. Test policy | `codecov.yml`, `packages/e2e-desktop/**/*.test.mjs`, e2e-desktop `package.json`, CI, `CLAUDE.md` | Informational patch coverage, 80% project target, integration tests stay |

## Task 0 — Rebase and constrain the diff

1. At implementation time inspect latest `main`, open PRs #364/#365, and HPA-1037 state. If #364 has landed, reuse its zero-error Svelte fixes; if not, coordinate the remaining type error fixes on this PR without replacing its scoped changes. Do not overwrite HPA-1037's modified tests/symbols when renaming `Mesaure`/`Offest`.
2. Search every deletion target with `rg` (both source and CI/scripts), and capture short before-state screenshots of the web expanded/collapsed nav and a Button/Modal/editor icon. The Linear issue has no mockup.
3. Verify live `backfill-bgm-m4a.ts` execution status only if it can be established from existing artifacts/operations. Otherwise retain the script; its optional deletion is **not** an acceptance blocker.
4. Avoid broad dependency refreshes and unrelated refactors. Lockfile updates use Bun 1.3.9.

**Exit:** one scope checklist, baseline screenshots and no duplicated pending PR fixes.

## Task 1 — Convert common to workspace source exports

1. Update all existing common package export entries (root, components, game, audio, encoding) to actual `src/lib/*.ts` sources with conditions suitable for Svelte/Vite/Bun/Workers. Drop `dist`-only `types`/`svelte` and `files` metadata. Do **not** add `./audio` to root imports: it currently causes eager browser `XAaudioContext` construction and risks SSR.
2. Remove common's `build`, `prepack`, publint and `fix-extensions.js` scripts and dependencies that no longer have a consumer; retain the existing source Svelte checks and Vitest. If a package/dev entry is still used for local development, leave it alone.
3. Remove only redundant `@dtx/common` aliases and API tsconfig paths proven unnecessary with package exports. Preserve legitimate `@`/`$lib`, test-only dependency stubs, environment aliases, and export boundaries. Resolve any Svelte component/Worker SSR import failures at the package boundary rather than adding a second built artifact.
4. Update `turbo.json` to remove `^build` from `test` and `test:coverage` (not unrelated application build dependencies). Check that `bun run --filter=@dtx/common test`, `check`, and consumer test builds work after deleting common `dist`.

**Exit:** a clean checkout can typecheck/test web, desktop, common and API without a common package build; preview Worker import avoids browser-only initialization.

## Task 2 — Fold UI package and remove alias/mocks

1. Move `Button.svelte` and `Modal.svelte` into `packages/common/src/lib/components/` and export them from `components.ts`. Take the current behavior/props from whichever of `main` or #364 is newest, especially optional modal open and typed `$props`.
2. Switch web and desktop imports to `@dtx/common/components`, and switch tests to real components where feasible. Drop exact-path UI mocks only when they no longer serve a test; preserve useful tests of modal portal/ESC/confirm and button classes/disabled behavior without testing private members.
3. Search for external `cn` imports; move it only if real consumers need it, otherwise delete it and its dependencies. Remove the entire UI package, workspace entry, stale Vite/Vitest aliases, TS includes, `__mocks__/@dtx/ui-components`, CI labels/path filters, docs and package-specific install hooks.
4. Update `bun.lock` in one frozen-install-safe change. Catch unreferenced `shadcn-svelte`, `tailwind-variants`, `tailwind-merge`, etc. **Only** remove dependencies after a usage check.

**Exit:** no references to `@dtx/ui-components` anywhere in runtime/tooling; web and desktop buttons/modals still function and look the same.

## Task 3 — Make typechecking and CI accurate

1. Add `"check": "bun run typecheck"` (or equivalent) to desktop. Ensure common, web, desktop and API all execute via root `bun run check`; the existing e2e and infrastructure checks may continue to run.
2. In `.github/workflows/lint-and-format.yml`, replace the redundant shared build step with `bun run check` **when any production code/package/lockfile/CI config is affected**, keeping SvelteKit generation and existing schema/codegen verification in proper order. Do not allow the affected-scope detector to report a code PR as docs-only. An uncertain detector result must run checks rather than skip them.
3. In `unit-test.yml`, `e2e-test.yml`, `desktop-e2e-test.yml` and any other workflows/scripts with `bun run --filter=@dtx/common build` or `@dtx/ui-components build`, remove the stale step. Update `desktop-build-deploy.yml` and all workflow `paths` filters as necessary. Keep real web/desktop/API application builds.
4. Update `.github/scripts/ci-affected-scope.sh` package enumeration (remove `@dtx/ui-components`), update its tests, and review root `package.json`, `.cursor/install.sh` and any CI helper. Do not accidentally skip changed common/UI code.
5. Run `check` on a clean checkout; fix current production/test errors with meaningful types, including the API Worker `ExecutionContext` mismatch if still present. Preserve #364's already-scoped Svelte fixes; do not silence diagnostics.
6. In a disposable worktree, introduce and then revert one simple type error per production package; confirm the exact root/CI check command returns nonzero each time. No intentional errors are committed.

**Exit:** all four production packages are gated and code changes cannot bypass type checks; CI script/scope regression tests pass.

## Task 4 — Delete genuinely dead runtime paths

1. Remove `/game` page and `MainMenu` Phaser scene. Delete **both** normal and collapsed Play Game nav links; remove any `MainMenu` registration/import in game entry points and dependent unit fixtures. Keep `/editor`, game Preview, and genuine navigation intact.
2. Remove no-op `autoSaveChart`, `autoLoadChart`, `clearTempStorage` and the two-second delayed callback in common `Editor.ts`, including its timer teardown, placeholder comments and awaited no-op call. Check shutdown/liveness behavior after removing the `await` boundary. Keep actual dirty state, chart load, editor restart, explicit save and export behavior; do not remove legitimate persistence.
3. After rechecking usage, delete `common/utils/path.ts`, web `constant.ts`, root `__mocks__/winston.ts`/`node-fetch.ts`. Delete obsolete Supabase auth migration script, its test/fixtures, the API `./auth-migration` export and `auth:migrate`; retain Better Auth runtime and schema generation.
4. Keep `backfill-bgm-m4a.ts` unless verified executed. Update any app/CI/docs references when files are deleted.

**Exit:** no reachable dead route or placeholder auto-save, while editor and preview still load/save and current auth/API works.

## Task 5 — Dependency/docs/symbol/icon hygiene

1. Confirm and remove root `@wdio/native-utils` + override and `@types/eslint`; web `@iconify/svelte`, `tslib`, `vite-tsconfig-paths`; desktop JS plugin-dialog/opener/updater package declarations **only if there are no JS imports**. Leave Tauri Rust plugin declarations. Regenerate `bun.lock` once and check frozen install; allow no unrelated version bump.
2. Remove finished historical specs/plans (including `docs/plans/` and obsolete May requirements) **only after checking issue/PR completion**; preserve runbooks, linked active design plans (#365/HPA-1037 and this ticket), and any necessary architecture reference. Update links from readmes/CLAUDE. Do not wipe this PR's own spec/plan while HPA-1039 is open.
3. Refresh `CLAUDE.md` (8→7 package inventory, no build-first instructions, revised E2E/test mocks, latest scene list); `AGENTS.md` is a symlink, so do not duplicate edits. Remove obsolete `.cursor/` bootstrap leftovers and any references to them.
4. Rename `Mesaure`/`Offest` identifiers and references across source/tests in one mechanical pass, after reconciling HPA-1037's concurrent changes. There is no requirement to preserve the misspelling for compatibility; keep serialized DTX data formats unchanged.
5. Convert web's inline SVG icons to the **already installed** `@lucide/svelte` where an equivalent icon exists. Keep size/stroke, accessible labels and spacing. Don't replace non-equivalent bespoke visuals just to reach a target count; note exceptions in the PR. No new image assets.

**Exit:** clean usage search/lockfile, no stale docs/scripts, visual identity stable.

## Task 6 — Coverage and lightweight testing rules

1. In `codecov.yml`, make **patch** `informational: true`, lower **project** target to `80%` and verify actual reports. Keep project coverage visible; do not add another service or invented branch-protection policy.
2. Remove e2e-desktop harness self-test `*.test.mjs` files and `test:harness` script/workflow calls, **not** the underlying E2E harness implementation or integration tests. Ensure e2e-desktop's actual `e2e:build`/`e2e:run` still work.
3. Add to `CLAUDE.md`: test behavior through public APIs and avoid private-member assertions. Do not mass-prune old unit suites. Add only targeted tests for moved components, removed navigation and changed visible behavior.

**Exit:** coverage policy matches the ticket; no harness self-test CI; real E2E remains a gate.

## Task 7 — Run end-to-end verification and finish **this PR**

Use Bun `1.3.9` and the current repo scripts on the implementation SHA:

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/common test
bun run --filter=dtx-web test
bun run --filter=dtx-desktop test
bun run --filter=dtx-api test
bun run check
bun run test:coverage
bun run --filter=dtx-web build
bun run --filter=dtx-api build
bun run --filter=dtx-desktop build:renderer
bun run --filter=dtx-e2e-web e2e
.github/scripts/ci-affected-scope.test.sh
bun run lint
bunx prettier --check .
```

Existing CI also runs the desktop Tauri macOS/Windows build, WebdriverIO desktop E2E, native Rust tests and Codecov. Do not silently call a draft PR green: `lint-and-format`, `unit-test`, `e2e-test`, and `desktop-e2e-test` jobs currently skip drafts. After implementation and self-checks, mark **this same PR** ready to trigger real CI, verify the checks, and address review comments in the same branch. A separate implementation PR is prohibited.

**MCP-driven UI E2E (one web platform is sufficient for shared UI; desktop E2E covers moved renderer components):**
1. Start the existing seeded Playwright web/API environment using `packages/e2e-web/playwright.config.ts`. Through **Playwright MCP**, visit the authenticated `/app/chart`, editor, and preview; assert real chart list and editing workflow, chart download/export, and absence of Play Game in both sidebar modes.
2. Open and close a Modal via button and Escape/backdrop; exercise enabled and disabled Button behavior. Check no regressions in chart management and editor preview. Prefer extending existing Playwright tests instead of inventing a duplicate framework.
3. Capture desktop-width and narrow-width screenshots of expanded/collapsed navigation, editor toolbar and modal. Compare against pre-change screenshots (there is **no Linear UI mockup**): icon meaning, size, colors, alignment, contrast, text wrapping, click targets and clipping. Add screenshots/observations to this PR as evidence; no human acceptance criterion.
4. Run one operating system's desktop integration E2E with the actual Tauri app to check shared Modal/Button components; existing OS build CI still validates macOS/Windows compilation. No extra native manual sign-off is required since the change is not OS-specific.

**MCP-driven backend E2E (required because API package/config changes):**
1. Boot the actual `dtx-api` Worker with the existing seeded local D1 stack (reuse web E2E setup, not mocks). Via MCP HTTP/browser, `GET /healthz` and `GET /graphql?query=%7B__typename%7D`; both must return successful real Worker responses without common `dist`.
2. Exercise at least one existing D1-backed chart query through the seeded GraphQL endpoint (or the authenticated web chart-list flow that calls it), checking response schema/content and no regression in Better Auth. Record request/response evidence in this PR. Unit tests alone do not satisfy backend acceptance.

## End-to-end acceptance checklist

- [ ] Root `bun run check` runs (and fails appropriately for type errors in) common, web, desktop and API; affected-scope tests guard code changes, and no CI check is silently skipped for a code PR.
- [ ] From a **clean checkout with no common dist**, `bun install --frozen-lockfile`, tests/coverage/check, lint/format and web/API/desktop builds pass; no common/UI-package build steps remain in scripts/workflows.
- [ ] No UI package, obsolete UI mocks, stale package aliases, unused checked dependencies or dead `/game` + `MainMenu` remain; both nav modes hide Play Game. Editor/Preview, button/modal and actual save/export continue to work.
- [ ] No no-op editor auto-save timer remains; actual chart workflow does not lose data or crash during editor restart/teardown.
- [ ] Existing web/desktop/common/API unit tests, web E2E and at least one platform's desktop E2E pass. Current macOS/Windows desktop CI builds remain valid.
- [ ] **MCP web end-to-end** demonstrates chart list → editor → preview, opens/closes a modal and exports a chart, with pre/post screenshot comparison for sidebar and icons; no visual regressions or inaccessible labels.
- [ ] **MCP backend end-to-end** sends real requests to seeded local Worker `/healthz`, `/graphql` and a D1-backed chart operation; responses are correct after package changes.
- [ ] Codecov patch status is informational and project target is 80%; legacy harness self-tests are gone but real integration tests remain; new tests exercise public APIs rather than private internals.
- [ ] Historical docs deletions are verified-complete only; active HPA-1037/1039 specs and operational runbooks remain. Optional M4A backfill script is retained if execution is unverified. Mechanical renames are reconciled with PR #365.
- [ ] All evidence is posted on **this PR** and required CI passes after marking the *same* PR ready; no second PR and no human approval/test requirement.

**Planning note:** None of these tests or E2E checks is claimed as executed by this documentation-only draft.
