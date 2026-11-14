# HPA-914 — Svelte ESLint v3 migration: implementation plan

**Status:** Proposed; implementation not started.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Design:** [2026-11-14-hpa-914-svelte-eslint-v3-design.md](../specs/2026-11-14-hpa-914-svelte-eslint-v3-design.md)  
**Delivery:** **One PR for HPA-914**. This draft PR contains the planning documents first; make all ensuing lint implementation, focused tests and verification changes on **this branch**. No second implementation PR. Any future Vite/SvelteKit/UUID/Node-major implementation belongs to its own Linear ticket and one PR per ticket.

## Change surface

| Path | Action |
| --- | --- |
| Root `package.json` | Change `eslint-plugin-svelte` from v2 range to a compatible v3 range (start with `^3.23.1` from closed #329, confirm resolved version). Leave other dependency major ranges unchanged. |
| Root `bun.lock` | Recalculate mechanically with Bun 1.3.9; ensure frozen-install consistency. |
| Root `eslint.config.js` | **Only if necessary:** minimally adapt the existing Svelte flat preset, TypeScript-in-Svelte parser setup, or a documented problematic new recommended rule. |
| Narrowly affected `*.svelte` source files | **Only if necessary:** fix real new lint diagnostics without changing runtime behavior. Avoid formatting or auto-fixing the whole repository. |
| Planning docs / PR body | Keep enduring decisions in docs and time-sensitive CI SHA/run links in the PR's Verification section. Record later-upgrade gates on HPA-914. |

No new lint framework, scripts, CI workflow, shared abstraction, test infrastructure, runtime dependency upgrade, or standalone implementation branch is expected.

## Work sequence — all within this PR

### 1. Establish the current lint baseline

1. Recheck current `main` immediately before implementation; do not blindly cherry-pick the closed Dependabot #329 lockfile, which was generated against an older base.
2. Inspect `package.json`, `bun.lock`, `eslint.config.js` and all existing `svelte.configs['flat/recommended']` / `tsParser` uses. Confirm current Svelte, TypeScript, SvelteKit, ESLint and parser peer requirements. Upstream v3.23.1 advertises ESLint 10 and Svelte 5 compatibility, but a successful install and execution are required.
3. Run or record existing clean-baseline output from:
   `bun install --frozen-lockfile`
   `bun run lint`
   `bun run check`
   Note pre-existing failures separately; avoid hiding them with unrelated code edits.
4. Check that the root Node engine floor and actual CI Node/Bun executables meet installed ESLint 10 and plugin v3 requirements. Tighten a demonstrably incorrect engine declaration only if needed to make this lint setup valid; do not plan a new Node major.

**Exit:** reproducible baseline, exact plugin/parser constraints, and no conflicting implementation PR.

### 2. Upgrade the plugin and lockfile, nothing else

1. Update the root `eslint-plugin-svelte` version range to `^3.23.1` (or a compatible later 3.x patch selected at execution time). Keep `eslint`, `@eslint/js`, `@typescript-eslint/*`, `svelte-eslint-parser` and product framework version ranges unchanged unless an actual peer conflict proves a minimal coordinated fix necessary.
2. Run `bun install` using Bun 1.3.9 to update `bun.lock`, then run `bun install --frozen-lockfile`. Review `git diff -- package.json bun.lock` for accidental major bumps or broad unrelated churn.
3. Run `bun run lint` immediately. If it passes, **do not edit `eslint.config.js` just to modernize its syntax**. Confirm a representative Svelte component with `<script lang="ts">` and a Svelte 5 rune has been included in lint's discovered files.
4. If lint fails, classify each failure as version incompatibility, parser configuration, or newly recommended rule. Fix only the failing scope:
   - Preserve the existing v3 flat recommended preset and `tsParser` override wherever they work.
   - Correct genuine errors in affected files only; for false positives or intentional project idioms, use narrow file/rule exceptions with a short rationale.
   - Avoid broad `--fix .`, suppression of all recommended rules, a duplicated config, or introducing backward-compatibility adapters.
5. Rerun root lint until it is green without warnings/errors that violate the repository's existing policy.

**Exit:** plugin v3 is installed, Bun lockfile is reproducible, and the repository-wide linter operates on JS, TS and Svelte.

### 3. Run focused quality gates

On the implementation commit, validate:

```bash
bun install --frozen-lockfile
bun run lint
bun run check
bun run --filter=dtx-web check
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-web check
bun run --filter=dtx-e2e-desktop check
bunx prettier --check package.json eslint.config.js
```

The final Prettier command should include `eslint.config.js` only if modified. CI's full `bunx prettier --check .` is authoritative. Where a check needs generated shared output, use the repository's existing build order rather than changing the task's dependency graph. Do not build or deploy applications merely to verify a lint-only migration unless a real validation failure requires it.

**Exit:** frozen install, lint, package typechecks, and formatter pass.

### 4. Exercise the existing supported-platform E2E gate

1. Once the first **implementation** commit lands, mark **this PR** ready for review. The required lint, unit and E2E workflows skip drafts, so skipped checks are not evidence.
2. Inspect the GitHub Actions runs for that head SHA. The root `package.json` / `bun.lock` changes already trigger the shipped desktop native matrix (`macos-latest` and `windows-latest`). Require both WebdriverIO/Tauri runs to pass the existing application-launch and workspace/library scenarios; do not accept successful native compilation alone.
3. Require the existing web Playwright E2E and web-related checks selected by current affected-scope logic to pass. Web's current Playwright projects use Chromium; this ticket does not introduce a browser/OS matrix or new web E2E cases.
4. Confirm no user-visible UI behavior has changed. HPA-914 provides no UI mockup: reuse existing render/smoke assertions and failure screenshots if the E2E jobs produce them. Do not introduce a manual approval gate or a screenshot-baseline framework.
5. If macOS or Windows fails, fix a reproduced **plugin-induced** regression on this PR. If an unrelated pre-existing environmental E2E failure occurs, document its independent evidence and disposition; do not opportunistically rewrite the Tauri harness or CI.

**Exit:** required CI green at the implementation SHA and both shipped desktop OSes exercise real native E2E. No iOS-native app is built in DTXWeb; Android/Linux are CI-only, not acceptance targets.

### 5. Close the HPA-914 decision ledger without broadening the PR

Document evidence on the Linear issue / PR:

- **#329 lint v3:** link this validated upgrade PR and the passing commit SHA.
- **#289 `uuid` / `@types/uuid`:** perform a repository-wide JS/TS/scripts/config import audit (e.g. `rg "from ['\"]uuid|require\(['\"]uuid|import\(['\"]uuid" packages scripts`). The current index suggests no JS/TS import, but prove it before removal. If unused, create a **separate** small cleanup ticket with a one-PR scope; keep the Rust `uuid` crate.
- **#290 Vite 8:** defer to a linked follow-up ticket gated on a compatible Vite/Svelte plugin/Vitest build stack and web build + macOS/Windows packaging verification.
- **#330 adapter-auto 8:** coordinate with SvelteKit 3 in a separate task; examine common/UI adapters and web's Cloudflare adapter at that point.
- **#291 `@types/node` 26:** retain on hold with the Node runtime/CI compatibility gate until intentionally revisited.

The parent HPA-913 remains a cross-project index. Do not complete HPA-914 until every item either has a verified upgrade, a linked gated follow-up, or an explicit retain/remove decision; do not bulk unignore versions or dismiss dependency/security alerts.

## Acceptance criteria

- **Functional tooling:** clean frozen install; `bun run lint` correctly analyzes JS, TS, and Svelte 5/TS components; root and relevant per-package typechecks pass with no unrelated runtime majors.
- **macOS desktop E2E:** existing Tauri/WebdriverIO matrix runs and passes native launch + workspace/library flows after the root manifest/lockfile change.
- **Windows desktop E2E:** same native suite passes on Windows, including real WebView2 application interaction.
- **Web E2E:** existing Playwright suite and CI checks pass, with no new browser-specific behavior or UI regression. No UI mockup exists for HPA-914; preserve current visual output.
- **Process:** implementation and proof remain on this single PR; all remaining ignored upgrades are given a documented disposition or linked separate follow-up with a clear gate.

No human acceptance, Android, or Linux end-to-end criteria. No deployment is needed for a development-time lint dependency.

## PR evidence checklist (update when implementation lands)

- [ ] Manifest + `bun.lock` diff reviewed; no unintended majors.
- [ ] Frozen install + root lint + type checks passed, with exact execution evidence.
- [ ] Required GitHub Actions lint/unit/web E2E green at head SHA.
- [ ] macOS native Tauri E2E green at head SHA.
- [ ] Windows native Tauri E2E green at head SHA.
- [ ] Linear HPA-914 contains decisions and links/gates for #289, #290, #330 and #291.
- [ ] No unreviewed UI changes, Dependabot bulk unignore, or security-alert dismissals.

The boxes are deliberately **unchecked** in this documentation-only draft; do not report implementation or CI success until those actions actually run.
