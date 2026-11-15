# HPA-914 — Svelte ESLint v3 implementation plan

**Status:** Proposed, not implemented. **One PR #351** for design, code and verification; do not open a second implementation PR.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Design:** [2026-11-14-hpa-914-svelte-eslint-v3-design.md](../specs/2026-11-14-hpa-914-svelte-eslint-v3-design.md)

The [reviewer measured](https://github.com/cwchanap/DTXWeb/pull/351#pullrequestreview-5908536527) 113 errors / 40 files after trying `eslint-plugin-svelte@3.24.1` on `main b014c236` with Bun 1.3.9. Use the design's explicit rule dispositions rather than re-triaging those decisions. Recheck current main before implementation.

## 1. Upgrade packages and fix parser config

- Root `package.json`: `eslint-plugin-svelte` → `^3.24.1`; remove unused direct `svelte-eslint-parser` and `@types/uuid`. Web `packages/dtx-web/package.json`: remove unused JS `uuid` per [#289](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424). Quick-check no new consumers; do not edit the Rust crate. No other major upgrades.
- Regenerate root `bun.lock` with **Bun 1.3.9**; `bun install --frozen-lockfile` must pass. Review the lockfile delta for unrelated dependency churn; don't copy #329's old patch.
- In `eslint.config.js`, preserve `...svelte.configs['flat/recommended']`. Extend the existing Svelte parser override to:

  ```js
  files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
  languageOptions: { parserOptions: { parser: tsParser } }
  ```

  This resolves the `audioPreview.svelte.ts` TypeScript `interface` parse error. Add `'**/.wrangler'` to ignores so generated Wrangler temps are not linted.
- In that existing Svelte-scoped rules block: turn off only `svelte/no-navigation-without-resolve` (external URLs, desktop isn't SvelteKit) and `svelte/prefer-svelte-reactivity` (deliberately nonreactive collections). Explain each permanent exception in one comment. Keep `require-each-key` on. Run `bun run lint` to see remaining source findings.

**Exit:** v3 dependency resolves cleanly and rune modules parse; no CI framework/toolchain changes.

## 2. Apply focused Svelte source fixes

- `require-each-key`: update the **30 reviewer-reported sites** with keys unique within each dynamic list. Review `WorkspaceTree.svelte`, `UploadedAssetFiles.svelte`, `SoundLibraryModal.svelte` and `ChartList.svelte` especially. Prefer stable id/path; do not use nonunique formatted display strings, or random values. Index keys require evidence that list order/identity makes them safe. Verify reconciliation after list updates.
- `no-useless-children-snippet`: simplify **17** unnecessary snippets without changing component rendering.
- `prefer-writable-derived`: correct the **one** `ChartList.svelte` state pattern.
- `no-dom-manipulating`: place a targeted disable + rationale beside **one** `NotationView.svelte` imperative container clear.

These counts describe the reviewer's baseline; use the new lint output if main diverges. No global auto-fix, mass refactor, generic wrapper, new harness or broad rule disabling. Key additions change Svelte reconciliation, so validate them with existing component tests/E2E.

**Exit:** `bun run lint` passes and source changes are tightly limited to these rule fixes.

## 3. Run tests, then enable CI on this PR

```bash
bun install --frozen-lockfile
bun run lint
bun run check
bun run --filter=dtx-desktop typecheck
bun run test
bunx prettier --check .
```

Use existing shared-package build order if required for generated outputs. Add a focused unit regression only if modified list/state behavior is not covered. The normal `lint-and-format` job already checks E2E package TypeScript; no redundant local `dtx-e2e-* check` steps.

**After the first implementation commit**, mark **this PR #351** ready for review (drafts skip required CI). The root manifest/lockfile already triggers existing native E2E jobs. Record verification on the final head SHA:

- **macOS:** native Tauri/WebdriverIO actually launches the app and passes existing library/workspace flows.
- **Windows:** same real E2E suite and WebView2 UI checks pass.
- **Web:** existing Playwright E2E and required checks pass; compare rendered chart/list/preview output to existing UI. HPA-914 has **no UI mockup**.
- Required lint, unit tests, formatter and relevant CI are green. Don't treat a successful build, skipped draft check or old #329 CI as proof.

Fix only reproduced migration regressions here; keep unrelated CI issues independent.

## 4. Record existing major-upgrade dispositions and close out

Link the prior GitHub decisions to HPA-914:

| Prior PR | Resolution |
| --- | --- |
| [#289](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424) | Remove unused JS `uuid` and `@types/uuid` in this PR. |
| [#290](https://github.com/cwchanap/DTXWeb/pull/290#issuecomment-6093778422) | Vite 8 held for coordinated build/tooling migration and web + macOS/Windows packaging verification. |
| [#330](https://github.com/cwchanap/DTXWeb/pull/330#issuecomment-6677955853) | adapter-auto 8 held for compatible SvelteKit 3 migration. |
| [#291](https://github.com/cwchanap/DTXWeb/pull/291#issuecomment-6093778453) | Intended Node 22 typings contradicted by merged [#307](https://github.com/cwchanap/DTXWeb/pull/307) (`^25.9.9`). **Choose separate future correction to `@types/node@^22` after compatibility check**. Do not change it in #351. |

**Only after merge** and after v3 lands on main, target-unignore `eslint-plugin-svelte` with `@dependabot unignore eslint-plugin-svelte` on a suitable Dependabot PR, then verify `@dependabot show eslint-plugin-svelte ignore conditions` or the GitHub settings. Leave other major ignores and security alerts untouched.

## Acceptance / verification checklist

- [ ] Dependency and ESLint changes committed to **PR #351**; frozen install, lint, typechecks, `bun run test` and formatting pass.
- [ ] All targeted rule fixes pass with stable each-block keys, no duplicate-key runtime error, correct list/state and children rendering.
- [ ] macOS native desktop E2E passes; existing workspace/library UI visually renders correctly.
- [ ] Windows native desktop E2E passes; existing workspace/library UI visually renders correctly.
- [ ] Web E2E and required GitHub Actions checks pass at final implementation SHA.
- [ ] Four existing prior-PR decisions linked on HPA-914.
- [ ] After merge: targeted plugin unignore verified.

These are **not yet completed**: this draft still contains planning docs only. No additional PR, new CI system, production deployment command or feature migration is part of this ticket.