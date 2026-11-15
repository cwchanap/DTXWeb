# HPA-914 — Svelte ESLint v3 implementation plan

**Status:** Proposed; code changes and validation not yet performed.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Design:** [2026-11-14-hpa-914-svelte-eslint-v3-design.md](../specs/2026-11-14-hpa-914-svelte-eslint-v3-design.md)  
**Delivery:** Exactly **one PR #351 for HPA-914**, starting as a design draft, then amended with the implementation. No additional HPA-914 implementation PR.

## Scope and source of truth

The [GitHub design review](https://github.com/cwchanap/DTXWeb/pull/351#pullrequestreview-5908536527) reproduced **113 v3 lint diagnostics in 40 files** (112 rule violations, one `.svelte.ts` parse failure) against `main b014c236` using `eslint-plugin-svelte@3.24.1` and Bun 1.3.9. Treat the counts as a useful measured baseline, not as our own verified test result or fixed numbers if main changes. The design document contains **the decisions for each rule**; don't re-debate them during implementation unless a reproduced counterexample appears.

| Target | Change |
| --- | --- |
| Root `package.json` | Upgrade `eslint-plugin-svelte` to `^3.24.1`; remove unused direct `svelte-eslint-parser` and `@types/uuid`. Leave ESLint, TS parser, Node typings and framework majors alone. |
| `packages/dtx-web/package.json` | Remove unused JS `uuid`; **do not** touch the Rust `uuid` dependency. |
| Root `bun.lock` | Regenerate with Bun 1.3.9; do not copy closed #329's lockfile. Check unrelated versions for churn. |
| Root `eslint.config.js` | Keep `flat/recommended`; add `'**/.wrangler'` ignore; widen TS sub-parser override to `*.svelte.{js,ts}`; permanently disable exactly the two reviewed rules with reasons. |
| Existing Svelte source | Key the 30 reported each-blocks, simplify 17 children snippets, fix one writable-derived pattern, suppress one intentional imperative notation-renderer line. No blanket formatting. |
| PR #351 | Record actual run SHA and CI status; stay one PR through implementation and verification. |

## Work sequence

### 1. Apply manifest and parser changes

1. Recheck current main and verify no overlapping implementation PR; remain on **this PR's branch**. The prior review already established the dependency-unused decisions for `uuid` and `svelte-eslint-parser`; a quick search for newly introduced consumers before removal is sufficient.
2. Change the two package manifests as above. Run `bun install` with Bun 1.3.9 and verify `bun install --frozen-lockfile`. Inspect the changed lockfile for unintended framework or toolchain majors.
3. In `eslint.config.js`:
   - Preserve `...svelte.configs['flat/recommended']`.
   - Change the existing Svelte-scoped override to `files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js']`, retaining `parserOptions: { parser: tsParser }`. Verify `packages/dtx-web/src/lib/audioPreview.svelte.ts` now parses.
   - In that scope set `'svelte/no-navigation-without-resolve': 'off'` (external URLs and desktop non-SvelteKit) and `'svelte/prefer-svelte-reactivity': 'off'` (intentional scratch/nonreactive maps); each with a concise permanent rationale.
   - Ignore generated `'**/.wrangler'` output globally, alongside existing build artifacts.
4. Run `bun run lint` to get the current rule-by-rule residual list. Do not spend time auditing a Node engine migration: it is not implicated by this plugin upgrade.

**Exit:** v3 parser loads all Svelte and rune modules; only intentionally retained source diagnostics remain.

### 2. Fix the measured source diagnostics

1. For every `svelte/require-each-key` finding (30 at review baseline), add a **unique, stable** key (id/path for dynamic collections). Audit duplicates and reordering, especially `WorkspaceTree.svelte`, `UploadedAssetFiles.svelte`, `SoundLibraryModal.svelte` and `ChartList.svelte`; **never** use formatted display strings like the split level labels as keys. If no distinct identity exists, evaluate the list semantics before choosing an index key. No random keys or generic wrapper components.
2. Replace the 17 `svelte/no-useless-children-snippet` cases with equivalent normal children. Preserve slot/snippet behavior and rendering.
3. Fix `svelte/prefer-writable-derived` in `ChartList.svelte` while keeping user-driven filter/list state behavior.
4. Suppress the single `svelte/no-dom-manipulating` report at `NotationView.svelte`'s deliberate `container.innerHTML = ''` with a one-line in-code rationale. Do not globally disable the rule.
5. Rerun lint and fix any genuinely new, adjacent diagnostic. Do **not** run a repository-wide `eslint --fix .`, rewrite the UI, or turn off `require-each-key`. Keyed-list changes affect reconciliation, so they require runtime testing rather than a promise of zero behavioral change.

**Exit:** root lint passes; only relevant source/config/manifest/lock changes are in the diff.

### 3. Verify test behavior and CI

Run locally using the repository's existing build order when generated shared output is needed:

```bash
bun install --frozen-lockfile
bun run lint
bun run check
bun run --filter=dtx-desktop typecheck
bun run test
bunx prettier --check .
```

The already-configured `lint-and-format` CI job checks the E2E packages' TypeScript; no duplicate local `dtx-e2e-web` / `dtx-e2e-desktop` typecheck requirement. Existing Svelte unit/component tests should cover keyed dynamic lists, children snippets, and filter state where tests already exist. Add a focused regression test **only** if a changed behavior lacks coverage; avoid new test platforms.

After the **first implementation commit**, mark **this same PR** ready for review so required workflows run (draft PRs skip them). On the final implementation SHA:

- **macOS:** existing native Tauri/WebdriverIO E2E passes app startup and library/workspace scenarios, with the current UI visually rendered as expected.
- **Windows:** same native Tauri/WebdriverIO E2E passes on WebView2, including library/workspace scenarios and the expected visual layout.
- **Web:** existing Playwright E2E and CI-selected checks pass for chart listing/preview and other affected flows. No UI mockup is attached to HPA-914; use the existing UI and E2E screenshots/artifacts for comparison if a regression appears.
- Required lint, unit, format and other relevant CI checks pass on the PR head. A successful build or skipped draft check is not a substitute for real E2E execution.

Avoid fixing unrelated native harness or deployment problems in this dependency PR. Document any proven pre-existing CI failure separately.

### 4. Finalize the existing major-upgrade decisions

Link these **existing** decisions on HPA-914 rather than creating a new process or ticket just to restate them:

- [#289](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424): unused JS `uuid` and root `@types/uuid` removed by this PR; Cargo unaffected.
- [#290](https://github.com/cwchanap/DTXWeb/pull/290#issuecomment-6093778422): Vite 8 held for coordinated build migration with web plus macOS/Windows production packaging verification.
- [#330](https://github.com/cwchanap/DTXWeb/pull/330#issuecomment-6677955853): adapter-auto 8 held for a deliberate SvelteKit 3 compatibility migration.
- [#291](https://github.com/cwchanap/DTXWeb/pull/291#issuecomment-6093778453): intended Node 22 typings contradicted by merged [#307](https://github.com/cwchanap/DTXWeb/pull/307)'s `^25.9.9`. **Decision:** align to `@types/node@^22` in a separate, targeted follow-up after its own compatibility check. No change to node typings in #351.

**After #351 merges and v3 is present on main**, remove only the old major ignore for the plugin by commenting `@dependabot unignore eslint-plugin-svelte` on an applicable Dependabot PR. Verify using `@dependabot show eslint-plugin-svelte ignore conditions` or the GitHub Dependabot settings if the old PR doesn't process commands. Do not unignore unrelated packages, and don't dismiss any security alert. Keep the issue open until the implementation and the documented closeout evidence are complete.

## Acceptance criteria

- Clean, reproducible Bun install; ESLint v3 parses Svelte components and `.svelte.ts`, passes full lint, checks, formatting and `bun run test`.
- Native macOS and Windows E2E actually exercise the existing UI (including keyed library/workspace lists) and pass; current visual layout remains consistent with the existing UI.
- Web Playwright and required CI checks pass on the same implementation SHA; no major framework versions, product APIs or runtime behavior are unintentionally changed.
- All changes and verification remain on **one PR**; prior-PR dependency decisions are linked, with the targeted Dependabot v3 unignore performed only after merge.

## PR verification checklist (update when implementation runs)

- [ ] Plugin v3, manifest removals and Bun lockfile committed; no unrelated upgrades.
- [ ] Svelte parser/ignore/rule config changes and targeted source fixes committed.
- [ ] Frozen install, lint, checks, unit tests and formatter green.
- [ ] macOS native E2E green on final head SHA; UI rendering checked.
- [ ] Windows native E2E green on final head SHA; UI rendering checked.
- [ ] Web E2E and required CI green at final SHA.
- [ ] Four prior-PR decisions recorded in HPA-914.
- [ ] After merge: targeted Dependabot plugin unignore verified.

This remains a **documentation-only draft** until implementation commits land; the test/CI boxes are intentionally unchecked.