# HPA-914 — Svelte ESLint v3 design

**Status:** Implemented on **the same PR #351**.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Plan:** [2026-11-14-hpa-914-svelte-eslint-v3.md](../plans/2026-11-14-hpa-914-svelte-eslint-v3.md)

## Decision

Upgrade `eslint-plugin-svelte` from v2 to **`^3.24.1`** against the existing ESLint 10, keeping the current `flat/recommended` configuration, Svelte 5, SvelteKit 2, and Vite 6. Rebuild `bun.lock` using Bun 1.3.9; never reuse closed [Dependabot #329](https://github.com/cwchanap/DTXWeb/pull/329)'s old lockfile. One PR contains design, implementation and verification. No other framework/toolchain majors.

The [reviewer reproduced](https://github.com/cwchanap/DTXWeb/pull/351#pullrequestreview-5908536527) **113 diagnostics in 40 files** with v3.24.1 on `main b014c236`: 112 rule reports and a `.svelte.ts` parse failure. These are reviewer measurements, not tests run by this planning draft. The following are explicit implementation decisions.

## ESLint v3 rule decisions

| Rule                                   | Hits | Resolution                                                                                                                                                                         |
| -------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte/no-navigation-without-resolve` |   43 | **Disable in Svelte scope.** Many targets are external URLs, the web app has no `paths.base`, and desktop isn't SvelteKit.                                                         |
| `svelte/require-each-key`              |   30 | **Fix.** Add unique, stable identifiers/paths to dynamic `{#each}` blocks. Never key by nonunique display strings (e.g. comma-split level labels); test list reconciliation.       |
| `svelte/prefer-svelte-reactivity`      |   20 | **Disable in Svelte scope.** Scratch collections, nonreactive bookkeeping and immutable-map replacement are intentional; making them reactive changes behavior.                    |
| `svelte/no-useless-children-snippet`   |   17 | **Fix** redundant children snippets without changing rendered output.                                                                                                              |
| `svelte/prefer-writable-derived`       |    1 | **Fix** `ChartList.svelte` and check reactive state transitions.                                                                                                                   |
| `svelte/no-dom-manipulating`           |    1 | **Line-level suppression** for `NotationView.svelte`'s intentional imperative renderer clear, with a reason.                                                                       |
| Parse error                            |    1 | **Fix config** for `audioPreview.svelte.ts`. v3 parses `*.svelte.{ts,js}`; expand the current TypeScript parser override to `['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js']`. |

Keep the two global Svelte-rule exceptions as **permanent, documented choices**; leave the other new recommended rules enabled. Keys change runtime reconciliation, so this is not guaranteed zero-behavior-change work. No broad `eslint --fix .` or new configuration abstraction.

## Small adjacent cleanup

- Remove root **direct** `svelte-eslint-parser` dependency: v3 already depends on it, and the project does not import it directly. Keep `@typescript-eslint/parser`.
- Add `'**/.wrangler'` to ESLint ignores: the reviewer's local baseline found 744 unrelated errors from generated Wrangler temp files.
- Remove unused JS `uuid` from the web package and `@types/uuid` from root **in this same lockfile PR**, per the [already-confirmed #289 decision](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424). Preserve active Rust `uuid`.
- Do not revisit Node engine constraints: plugin v3's Node minimum is less restrictive than the already-installed ESLint 10.

## Existing decisions on other ignored majors

| PR                                                                          | Decision                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#289](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424) | Remove unused JS UUID dependencies now; no UUID 14 upgrade.                                                                                                                                                                                                                   |
| [#290](https://github.com/cwchanap/DTXWeb/pull/290#issuecomment-6093778422) | Vite 8 remains held for a coordinated migration validated by web build plus macOS/Windows production packages.                                                                                                                                                                |
| [#330](https://github.com/cwchanap/DTXWeb/pull/330#issuecomment-6677955853) | Hold adapter-auto 8 until deliberately upgrading compatible SvelteKit packages.                                                                                                                                                                                               |
| [#291](https://github.com/cwchanap/DTXWeb/pull/291#issuecomment-6093778453) | Intended `@types/node@^22` to match the Node 22 runtime, but merged [#307](https://github.com/cwchanap/DTXWeb/pull/307) installed `^25.9.9`. Choose a **separate Node-22 typings correction**, after compatibility checking; keep unchanged in #351 and keep Node 26 ignored. |

## Acceptance and closeout

- Frozen Bun install, full lint including rune modules, typechecks, `bun run test`, formatting and required CI pass at the **implementation SHA**.
- **macOS and Windows:** existing native Tauri/WebdriverIO E2E exercises real app launch, visible library/workspace UI elements and interactions on both shipped OSes. **Automated visual-rendering check:** assert the existing UI is present/visible through the current DOM/behavior suites (no HPA-914 mockup). The WebdriverIO and web Playwright suites do not capture screenshots on successful runs; **do not** require nonexistent screenshot artifacts or claim pixel-level comparison. Existing web Playwright tests also pass.
- After the first implementation commit, mark PR #351 ready to run CI; draft/skipped checks do not count.
- **After merge only:** reverse the [#329](https://github.com/cwchanap/DTXWeb/pull/329) major ignore with targeted `@dependabot unignore eslint-plugin-svelte` on an applicable Dependabot PR; verify using `@dependabot show eslint-plugin-svelte ignore conditions` or the Dependabot settings if necessary. No bulk unignore/security dismissals.

No Vite/SvelteKit/Node major upgrade, feature work, manual deployment, new CI framework, or second HPA-914 PR.
