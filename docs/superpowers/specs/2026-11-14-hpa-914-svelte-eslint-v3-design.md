# HPA-914 — Svelte ESLint v3 migration design

**Status:** Proposed; implementation follows on the **same draft PR #351**.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Plan:** [2026-11-14-hpa-914-svelte-eslint-v3.md](../plans/2026-11-14-hpa-914-svelte-eslint-v3.md)

## Goal and current evidence

Replace the unsupported `eslint-plugin-svelte` v2 / ESLint 10 combination with v3, keeping Svelte 5 / SvelteKit 2 / Vite 6 and application APIs intact. One PR for the complete HPA-914 slice: these design/plan files now, implementation and verification on the same branch. No bulk dependency-major upgrade.

- `main` at `b014c236` has `eslint@^10.14.0`, `eslint-plugin-svelte@^2.45.1` and a root `svelte-eslint-parser@^1.10.1`. The installed v2 plugin resolves its own older parser and does not advertise ESLint 10 peer support. Closed, unmerged [Dependabot #329](https://github.com/cwchanap/DTXWeb/pull/329) proposed v3.23.1.
- `eslint.config.js` already uses `...svelte.configs['flat/recommended']` with `@typescript-eslint/parser`. Keep that structure.
- **Reproduced by the [PR design reviewer](https://github.com/cwchanap/DTXWeb/pull/351#pullrequestreview-5908536527):** upgrading to `eslint-plugin-svelte@3.24.1` with Bun 1.3.9 yielded **113 diagnostics in 40 files** (112 rule violations plus a `.svelte.ts` parse error). These results are reviewer evidence, not a CI pass or a run performed by this planning branch.
- The root manifest/lockfile trigger the existing macOS and Windows desktop E2E matrix. Draft PRs skip the required workflows; mark **PR #351** ready after the first implementation commit.

## Design: explicit rule decisions

Use `eslint-plugin-svelte@^3.24.1`, regenerate `bun.lock` with pinned Bun 1.3.9, and preserve the v3 `flat/recommended` preset. Fix only the measured diagnostics and any remaining ones confirmed by execution.

| v3 diagnostic | Reported hits | Decision | Reason |
| --- | ---: | --- | --- |
| `svelte/no-navigation-without-resolve` | 43 | **Disable in existing Svelte-scoped config** | Web has no `paths.base`, many values are external URLs, and desktop isn't SvelteKit; bulk `resolve()` changes would add noise and invalid desktop imports. |
| `svelte/require-each-key` | 30 | **Fix source** | Dynamic list reconciliation benefits from stable unique keys. Choose ids or paths where stable; do **not** key by formatted display strings that may duplicate (Svelte `each_key_duplicate`). Test affected interactions. |
| `svelte/prefer-svelte-reactivity` | 20 | **Disable in existing Svelte-scoped config** | Reported hits include scratch maps/sets, intentionally nonreactive bookkeeping, and immutable-map replacement. Converting to reactive collections changes behavior needlessly. |
| `svelte/no-useless-children-snippet` | 17 | **Fix source** | Use equivalent ordinary children syntax; preserve component rendering. |
| `svelte/prefer-writable-derived` | 1 | **Fix `ChartList.svelte`** | Address the actual writable-derived pattern, then check state transitions with existing tests. |
| `svelte/no-dom-manipulating` | 1 | **Line-level disable in `NotationView.svelte`** | Clearing the imperative notation-renderer container is intentional; document the reason beside the line. |
| Parser error in `audioPreview.svelte.ts` | 1 | **Fix config** | v3 applies `svelte-eslint-parser` to `*.svelte.{js,ts}`. Extend the current TypeScript sub-parser override to `['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js']`. |

The two disabled recommended rules are deliberate **permanent project decisions**, not vague temporary exemptions. Keep `require-each-key` on rather than weakening the preset globally. Adding keys does change reconciliation semantics; it must be tested, not described as a behavior-free lint edit.

## Minimal other changes

- Remove the unused **direct** root `svelte-eslint-parser` entry. The app does not import it and plugin v3 declares the parser as its own dependency. Keep the existing `@typescript-eslint/parser` direct dependency.
- Add `'**/.wrangler'` to `eslint.config.js` ignores. The reviewer's local baseline found 744 generated `packages/dtx-api/.wrangler/tmp` diagnostics; generated build output should not be linted.
- Also remove `uuid` from `packages/dtx-web/package.json` and `@types/uuid` from root `package.json` in this **same** lockfile PR. [#289's closing decision](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424) already established no JS/TS consumers; the reviewer rechecked zero imports. This is manifest-only cleanup and avoids another CI cycle. Do **not** touch the active Rust `uuid` crate.
- No Node engine adjustment: plugin v3's Node engine range is less restrictive than the already-installed ESLint 10. Leave all other major upgrades out.

## Prior-PR decisions to carry forward

| Item | Recorded decision |
| --- | --- |
| [#289 `uuid` 14](https://github.com/cwchanap/DTXWeb/pull/289#issuecomment-6093778424) | Remove unused web `uuid` / root `@types/uuid` now; no JS major upgrade. |
| [#290 Vite 8](https://github.com/cwchanap/DTXWeb/pull/290#issuecomment-6093778422) | Keep held: coordinated bundler/plugin/Vitest migration requires web build and **macOS/Windows production packaging** verification. Do not bundle it here. |
| [#330 adapter-auto 8](https://github.com/cwchanap/DTXWeb/pull/330#issuecomment-6677955853) | Keep ignored until a compatible, intentional SvelteKit 3 migration; no standalone adapter-auto bump. |
| [#291 `@types/node` 26](https://github.com/cwchanap/DTXWeb/pull/291#issuecomment-6093778453) | The closing decision was to align types to Node **22**, but merged [#307](https://github.com/cwchanap/DTXWeb/pull/307) later installed `@types/node@^25.9.9`. **Choose Node-22-aligned typings as the eventual correction**, explicitly defer that separate types/runtime alignment task; do not downgrade it in this PR. Keep the Node 26 ignore. |

No new process/architecture is needed for these existing decisions: link them in HPA-914 closeout.

## Verification and acceptance

- **Tools / CI:** clean `bun install --frozen-lockfile`, `bun run lint` (including rune modules), `bun run check`, desktop typecheck, `bun run test`, formatting and required CI pass on the implementation head SHA. The source fixes justify component-unit coverage; don't add a test framework.
- **macOS desktop:** existing native Tauri/WebdriverIO E2E starts the real app and completes existing library/workspace flows.
- **Windows desktop:** the same native E2E flows pass on Windows/WebView2.
- **Visual check:** existing rendered desktop UI and web chart/list/preview output remain consistent with current behavior; no UI mockup is attached, and no new visual-regression framework is required. Use existing E2E assertions and failure screenshots to investigate regressions.

**Post-merge only:** the “ignore this major version” on #329 would otherwise suppress later v3 patch notifications. Send the **targeted** `@dependabot unignore eslint-plugin-svelte` on an appropriate Dependabot PR, then check `@dependabot show eslint-plugin-svelte ignore conditions` (or confirm via Dependabot settings if the bot does not act on the old thread). Do not bulk-unignore other packages or dismiss security alerts.

## Non-goals

No application feature changes, deployment commands, Vite/SvelteKit/Svelte/Vitest upgrades, Rust dependency changes, new CI/test harness, compatibility adapters, or second PR for this ticket.