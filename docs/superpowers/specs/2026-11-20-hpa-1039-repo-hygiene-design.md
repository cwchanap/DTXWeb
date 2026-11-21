# HPA-1039 — Source-workspace packages, CI gates and repository hygiene: design

**Status:** Proposed design in a documentation-only draft PR. Implement, verify and address review comments on **this same PR**; do not open a separate implementation PR.  
**Linear:** https://linear.app/cwchanap/issue/HPA-1039/dtxwebmaintenance-repo-hygiene-shared-packages-from-source-ci-type  
**Plan:** [2026-11-20-hpa-1039-repo-hygiene.md](../plans/2026-11-20-hpa-1039-repo-hygiene.md)  
**Reviewed baseline:** `main` at `59edbe86079a7dab8273a00126dbbbf16d41badf` on 2026-11-20; recheck after rebasing.

## Goal

Make this Bun/Turborepo hobby monorepo faster to change without disrupting the DTX editor or delivery pipeline. One PR covers the original ticket's three related areas: (1) consume shared code from source with real type checks in CI; (2) remove confirmed dead code, dependencies and stale documentation; (3) simplify test/coverage policy. Favor fewer moving parts, not new infrastructure.

## Verified state and constraints

- `@dtx/common` currently advertises `dist/*.js` and `dist/*.d.ts` in `packages/common/package.json`; it also has build/prepack/publint/extension rewrite scripts. However web and desktop Vite/Svelte/Vitest configs and API TypeScript paths point to `common/src/lib` directly. `turbo.json` still makes `test` and `test:coverage` depend on `^build`. At least the lint, unit, web E2E and desktop E2E workflows explicitly build common before use.
- `@dtx/ui-components` is private, includes Button, Modal, `cn`, and otherwise unused UI-package scaffolding. Its components are already source-aliased and mocked in consumer tests. Its package adds an extra build and dependencies. `common/src/lib/components.ts` is an existing Svelte-only export seam; use it.
- `packages/dtx-desktop/package.json` provides `typecheck`, **not** `check`. Root `bun run check` runs Turborepo's `check` task and thus cannot gate desktop until a `check` alias is added. Web/common/API already have `check` scripts.
- `.github/workflows/lint-and-format.yml` checks E2E/infrastructure types only and uses `.github/scripts/ci-affected-scope.sh` to skip expensive jobs. The scope script recognizes `@dtx/ui-components`, so it must be updated with the package removal. `unit-test.yml`, `e2e-test.yml` and `desktop-e2e-test.yml` include old shared-build steps or path filters.
- `codecov.yml` presently sets project and patch to 90%, `informational: false`; its header says coverage status is not a branch-protection gate. Change the policy as requested, but verify actual statuses rather than asserting that GitHub branch protection blocks merges.
- The sidebar links to `/game`; that route uses the Phaser `MainMenu` whose Start button only alerts "Under construction". The editor has no-op `autoSaveChart`/`autoLoadChart`/temporary-storage methods, along with a delayed auto-save timer. Do not confuse these with real editor save/export or state updates.
- `CLAUDE.md` documents eight packages, old mock/build instructions, and stale scenes; `.cursor/install.sh` still builds both shared packages. Finished plans/specs remain in `docs/superpowers/` alongside actively planned work.
- **Concurrency:** open PR #364 already addresses pre-existing Svelte type errors in common, UI components and web; cherry-pick/merge/rebase its fixes rather than reimplementing or reverting them. Draft PR #365 plans HPA-1037 and touches overlapping `Mesaure`/`Offest` names. Rebase whichever work lands second and update any impacted tests. Do not coalesce the two tickets into a second PR.

## 1. One source-workspace package

Retain the existing `@dtx/common` package name and subpaths; change its `exports` to TypeScript source entry points (`src/lib/index.ts`, `components.ts`, `game.ts`, `audio.ts`, `encoding.ts`) and point Svelte consumers at source without a build step. Remove `dist` package metadata, `build`/`prepack`/`publint` and `scripts/fix-extensions.js` and their now-unused dependencies. No publication to npm, separate packaging artifact, or backward-compatible dist path is needed.

Keep `./audio` and `./encoding` subpaths where they prevent browser-only modules being eagerly imported into Worker/SSR contexts. In particular, `XAaudioContext` is instantiated at module load in `browser/audioDecoder.ts`. Do **not** eagerly re-export the audio engine from the root barrel. Lazy initialization is optional only if the implementation proves useful; otherwise leave this code alone. Reuse current Vite/Bun/Svelte compilation; do not create a custom TypeScript build pipeline.

Move **only** Button and Modal into `common/src/lib/components/` and export from `@dtx/common/components`; adapt imports and tests in web/desktop. Preserve class names, props, modal binding, portal/keyboard behavior and visual appearance. Remove `@dtx/ui-components` package, its component-specific mocks, unused `cn` if it has no external consumers, associated dependencies/workspace entry and package references. Do a complete import/consumer search first. Remove duplicate *package-specific* common/UI aliases once native package exports resolve in Vite, Vitest, SvelteKit and TypeScript; keep real application aliases (`@`, `$lib`) and any **necessary test mocks** rather than deleting them blindly. Smoke-test Worker SSR to catch browser globals.

Update `turbo.json` to remove `^build` from `test` and `test:coverage`. Preserve build ordering for real built applications where necessary. Delete shared-build steps from affected workflows and CI setup scripts; remove invalid `@dtx/ui-components` path filters and affected-scope classifications. A fresh clone must run tests/checks without ever generating common's `dist`.

## 2. Gate meaningful checks, not just lint

The lint workflow gets a **required `bun run check` step** for production packages (web, desktop, common, API), using existing scripts and the existing SvelteKit sync path; add `check` to desktop as an alias of `typecheck`. The root task can include E2E and infrastructure checks as it currently does. Keep the affected-scope fast path for documentation-only PRs and fail-open-to-full-checks on detector uncertainty, but ensure package/code, lockfile, root toolchain and workflow changes trigger the type gate; never skip type checks on a code change. Update `.github/scripts/ci-affected-scope.test.sh` in lockstep with package removal.

Treat PR #364 as an input: if it has merged by implementation time, rebase and test; if not, make only remaining necessary fixes without duplicating its independent changes. Fix residual actual Svelte/TS errors in production code or test fixtures; do not blanket-disable TypeScript diagnostics or exclude whole test suites to get a green gate. API `ExecutionContext` typing should use the Worker types already in the repo. Keep generated GraphQL/schema verification working.

## 3. Dead-code and housekeeping cleanup

Remove the unused `/game` route, the `MainMenu` scene and the **expanded and collapsed** "Play Game" sidebar entries, and remove stale scene imports/registration. Keep the real Editor/Preview Phaser routes untouched. Remove no-op editor auto-save/auto-load/clear-storage paths and delayed timer; preserve actual imports, dirty tracking and save/export behavior and remove now-obsolete lifecycle branches.

Confirm no live consumers, then remove `common/utils/path.ts`, `dtx-web/src/constant.ts`, root `__mocks__/winston.ts` and `node-fetch.ts`, the now-unneeded Supabase auth migration script/test/fixture/`./auth-migration` export/`auth:migrate`, and the ticket-listed unused JS dependencies. Leave the Rust Tauri plugins and Better Auth runtime in place. **Do not delete `backfill-bgm-m4a.ts` merely on a usage search**: it is an operational one-shot script; retain it unless its production backfill completion has been verified. That optional deletion must not block completion.

Delete *verified completed* historical specs/plans in `docs/superpowers/`, `docs/plans/`, and the obsolete May requirements doc, retaining runbooks, active tickets' specs/plans (including HPA-1037/HPA-1039), and any docs still used by ongoing work. Fix internal doc links rather than leaving dangling references. Remove obsolete `.cursor/` scripts, refresh `CLAUDE.md`/the `AGENTS.md` symlink guidance, and ensure scripts elsewhere do not reference removed packages.

Apply mechanical `Mesaure`/`Offest` misspelling fixes as a repo-wide, behavior-preserving rename after rebasing on HPA-1037 as needed. For web's inline SVG icons, use already installed `@lucide/svelte` with a matching existing icon/size/stroke; preserve recognizable semantics, accessible labels and nav spacing. Do not create image assets, a new icon abstraction, or an icon dependency. If a bespoke graphic has no matching Lucide glyph, document and retain it rather than silently degrading the UI.

## 4. Leaner test policy

- Configure Codecov's **patch** status as informational, and project target as 80%. Keep project coverage observable; verify actual branch status/reports, and avoid introducing a custom gate.
- Remove `packages/e2e-desktop/**/*.test.mjs` harness self-tests and the CI/npm `test:harness` step that runs them, *not* desktop integration tests, native type-generation validation, fixture verification or real cross-process E2E.
- Add concise repository guidance: assert observable behavior through public APIs, not private members. Do not bulk-delete legacy tests or add tests for deleted internals. Keep narrow regression tests for renamed/public behavior and component moves.
- Regenerate `bun.lock` with pinned Bun 1.3.9 and confirm `bun install --frozen-lockfile` from a clean checkout.

## Non-goals and risk controls

No UI redesign, DB migrations, new auth/CI framework, Rust plugin removal, replacement build system, publishable common package, coverage inflation, private-method tests, or separate PR. API behavior remains intact. Use the existing real E2E stacks for acceptance instead of writing elaborate new scaffolding. Prioritize independently verifiable behavior in this single large PR; changes can be committed in coherent phases **on the same branch**.

## End-to-end acceptance contract (for implementation, not this docs-only draft)

1. Clean install with deleted common `dist` passes `bun run test`, `bun run test:coverage`, `bun run check`, lint/format and web/desktop/API builds. No `common build` or `ui-components build` step remains in CI/scripts/aliases.
2. Introduce a controlled type error in each of common, web, desktop and API on a temporary test branch/fixture and prove the CI check command fails; remove it and prove green. Changes in code cannot bypass the affected-scope gate.
3. Web/desktop Button and Modal functionality and styles remain intact, the web sidebar has no Play Game entry, Editor/Preview still work, and replaced icons are visually equivalent.
4. **Playwright MCP web E2E:** use a running local app to navigate chart list → editor → preview, open/close a real modal, exercise editor save/export, confirm no broken /game nav, and capture screenshots of expanded/collapsed navigation and toolbar/modal. Compare with pre-change UI screenshots (no Linear mockup attached), check spacing, alignment, clipping, color, labels and icons; this is automated visual verification, not human sign-off.
5. **MCP backend E2E:** run the local Cloudflare Worker plus seeded D1, request `/healthz` and `/graphql?query=%7B__typename%7D` through MCP HTTP/browser, then exercise an existing seed-backed GraphQL chart query or authenticated web flow. Assert successful real Worker responses without dist output or removed migration script. Unit-only backend tests are insufficient.
6. Existing web Playwright E2E and one platform's desktop integration E2E run successfully after component movement; macOS and Windows CI builds remain valid. No OS-specific native behavior changes are introduced, so a second native-platform manual acceptance is unnecessary.
7. Codecov patch is informational, project baseline target is 80%, documentation references are updated, and only completed plans/confirmed dead dependencies were removed. CI and all verification evidence are recorded on **this same PR**.
