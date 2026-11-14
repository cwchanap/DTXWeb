# HPA-914 — Staged dependency majors: Svelte ESLint v3 design

**Status:** Proposed; planning-only draft, with implementation on this **same PR**.  
**Linear:** https://linear.app/cwchanap/issue/HPA-914/maintenance-stage-ignored-lint-vite-and-sveltekit-upgrades  
**Implementation plan:** [2026-11-14-hpa-914-svelte-eslint-v3.md](../plans/2026-11-14-hpa-914-svelte-eslint-v3.md)  
**Superseded Dependabot PR:** https://github.com/cwchanap/DTXWeb/pull/329

## Goal and delivery boundary

Restore the previously ignored `eslint-plugin-svelte` major upgrade, making the existing ESLint 10 + Svelte 5 lint setup work consistently. The migration should affect **lint tooling only**, not application behavior, SvelteKit/Vite versions, native Rust, or deployment infrastructure.

**Exactly one PR for HPA-914:** first review this spec and plan as a draft; commit the lint-only implementation and verification to this same branch. Treat remaining dependency majors as explicitly gated later work, with separate Linear tasks/PRs if implementation becomes necessary. Do not create a second implementation PR for HPA-914. No bulk Dependabot unignore or security-alert dismissal.

## Current repository evidence (main `b014c236`, 2026-11-14)

| Area | Observed state | Implication |
| --- | --- | --- |
| Root `package.json` | `eslint@^10.14.0`, `@eslint/js@^10.0.1`, `@typescript-eslint/{eslint-plugin,parser}@^8.72.1`, `eslint-plugin-svelte@^2.45.1`, `svelte-eslint-parser@^1.10.1` | ESLint 10 is already in place; this is a **plugin v2 → v3** migration, not an ESLint major migration. |
| `eslint.config.js` | Existing flat config extends `...svelte.configs['flat/recommended']` and assigns `tsParser` to `*.svelte`; has scoped JS/TS/Svelte/test overrides | Preserve the current flat-config structure and TS-in-Svelte parsing unless a verified incompatibility requires a local fix. |
| Svelte packages | Web, desktop, common and UI use Svelte 5; web uses SvelteKit 2 and Vite 6; common/UI currently use `@sveltejs/adapter-auto@^7.0.1` | Do not pair lint work with Vite 8, SvelteKit 3 or adapter-auto 8. |
| Toolchain | Bun `1.3.9` in CI; root Node engine `>=22.0.0` | Check the actual ESLint 10 / plugin v3 runtime requirements. Do not independently change the runtime major as a workaround. |
| `.github/workflows/lint-and-format.yml` | Frozen Bun install, repo-wide ESLint and Prettier; expensive checks scope-filtered; draft PRs skip the job | A draft with only plans is intentionally unverified; mark **this same PR** ready after first implementation commit to exercise CI. |
| `.github/workflows/desktop-e2e-test.yml` | macOS + Windows Tauri E2E matrix; `package.json` and `bun.lock` trigger it; drafts skip | A lint dependency PR can receive native-OS end-to-end coverage without adding new harnesses. |
| Dependabot #329 | Attempted `eslint-plugin-svelte` 2.46.1 → 3.23.1, modified manifest and Bun lockfile, was closed **unmerged** after an ignore-major command | Reproduce only the relevant version change against current main; do not reopen an obsolete branch or copy its stale lockfile. |

`eslint-plugin-svelte@3.23.1` advertises peer support for ESLint `^10.0.0` and Svelte `^5.0.0`. Its upstream [v2 → v3 guide](https://sveltejs.github.io/eslint-plugin-svelte/migration/) documents flat-config-only support and additional recommended rules. The existing flat config is a suitable starting point; green lint is still required to prove compatibility.

## Design decisions

### 1. Minimal lint-only migration

- Begin with the v3 release evidenced by #329 (3.23.1), or a newer compatible v3 patch available at implementation time; update the **root manifest and regenerated `bun.lock`** together.
- Keep `eslint.config.js`'s existing rule scopes, ignore patterns, Svelte flat preset, and TypeScript parser integration. Do not introduce a new wrapper package, duplicate lint config, legacy compatibility layer, or wholesale rewrite.
- Run the updated parser/preset on representative `.svelte` files using TypeScript `<script lang="ts">`, as well as the whole workspace lint. Adjust only proven v3 incompatibilities or new recommended-rule findings. Prefer focused source fixes; allow narrowly explained rule overrides when a new rule is inappropriate, not blanket `recommended` disablement.
- Do not change Vite, SvelteKit, Svelte, Vitest, `@types/node`, or application runtime dependencies in this lint PR. Do not use `eslint --fix .` to produce unrelated repository-wide churn.
- If a supported Node floor is misdeclared, verify it against the **already installed ESLint 10** and adjust the declaration only if the lint migration needs it; this is not a Node-major-upgrade ticket.

### 2. Decision ledger for remaining ignored upgrades

The other HPA-914 checklist items are **not additional commits in this lint-only PR**. Before marking HPA-914 done, record one explicit decision or linked next task for each:

| Prior PR | Current evidence and decision | Gate for a separate task / PR |
| --- | --- | --- |
| [#289 — `uuid` 14](https://github.com/cwchanap/DTXWeb/pull/289) | Web declares `uuid@^11.1.0` and root declares `@types/uuid@^10.0.0`. Indexed source search found no JS/TS `uuid` imports; Rust's `uuid::Uuid` is actively used and unrelated. **Candidate removal, not a proven-unused claim.** | Audit all current JS/TS source, scripts, tests and configs with `rg`. If unused, make a small separate dependency-removal ticket/PR for web `uuid` and root `@types/uuid`; leave Cargo dependencies untouched. Otherwise document the real consumers and upgrade gate. |
| [#290 — Vite 8](https://github.com/cwchanap/DTXWeb/pull/290) | Workspace packages use Vite 6 and Svelte Vite plugin 5; web/desktop/common/UI and Vitest are affected. **Defer.** | New issue after a compatible Svelte Vite plugin, Vitest and build stack are established; verify web build and macOS/Windows desktop packaging together in its own PR. |
| [#330 — adapter-auto 8](https://github.com/cwchanap/DTXWeb/pull/330) | `@sveltejs/adapter-auto` is in common/UI, while their SvelteKit remains 2. **Defer; do not apply independently.** | Pair with a deliberate, compatible SvelteKit 3 migration on a separate ticket after assessing workspace packages and web Cloudflare adapter. |
| [#291 — `@types/node` 26](https://github.com/cwchanap/DTXWeb/pull/291) | Root currently uses `@types/node@^25.9.9`; Node engine says `>=22`, Bun CI is pinned. **Hold.** | Revisit when supported Node/CI baseline is deliberately defined; no type-major bump in a lint-only PR. |

These decisions are **holding gates**, not permission to dismiss alerts or mass-unignore major versions. Keep HPA-914 open until its follow-up links or explicit retain/remove outcomes are recorded on the ticket.

### 3. Verification and release behavior

- Regenerate the Bun lockfile using the repository's pinned Bun version. Then validate `bun install --frozen-lockfile` from the updated tree. A dependency update is incomplete if the clean frozen install fails.
- Run root `bun run lint` and `bun run check`, with explicit web SvelteKit check and desktop renderer typecheck as diagnostics if root checks fail.
- After the implementation commit, mark **this PR** ready for review to run the existing required lint/unit and affected web/desktop E2E workflows. Confirm status against that head SHA; draft-only skipped checks are not acceptance evidence.
- Keep application UI and behavior unchanged. There is **no HPA-914 UI mockup**. Use existing automated smoke/E2E evidence for shipped web and desktop flows rather than add visual snapshot infrastructure to a tooling change.

## End-to-end acceptance contract

| Target | Required automated evidence |
| --- | --- |
| macOS | Existing native Tauri/WebdriverIO E2E suite passes on the macOS runner, including app launch and the existing workspace/library interaction. Web Playwright suite remains green for chart/preview flows. |
| Windows | Existing native Tauri/WebdriverIO E2E suite passes on the Windows runner, including app launch and the same supported interactions; no Windows-specific parser/config fallback. |
| Tooling and CI | Clean frozen Bun install, full ESLint, relevant type checks, and required CI checks pass on the implementation commit. No runtime package majors or unrelated lockfile upgrades are introduced. |
| Visual behavior | Existing web/desktop UI output is unchanged; there is no ticket mockup to compare. Investigate test screenshot artifacts if an E2E render check fails, but do not add a new screenshot test framework. |

Native iOS is a different client (not in this repository); no iOS-native acceptance is needed for a build-time lint migration. Android/Linux are not acceptance targets; existing CI may continue covering them. No human sign-off is an acceptance criterion.

## Risks and non-goals

- **Recommended rules changed:** v3 may surface additional lint errors. Triage individual diagnostics without silencing the whole preset or rewriting unrelated product behavior.
- **Parser interaction:** Svelte 5, `svelte-eslint-parser` and `@typescript-eslint/parser` must continue to lint TypeScript scripts and reactive syntax correctly.
- **Lockfile drift / skipped CI:** generate `bun.lock` against the current main state, and do not treat skipped draft checks or historical #329 builds as verification of this PR.
- Out of scope: UI redesign, application refactors, Rust UUID updates, Cloudflare changes, Vite/SvelteKit/Node majors, new test harnesses, compatibility shims, and Dependabot policy changes.
