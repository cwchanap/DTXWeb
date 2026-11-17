# HPA-857 — Remove the unused ToggleGroup dependency from @dtx/common

**Status:** Design accepted after review; this is still a documentation-only draft PR. Implement and verify on the **same PR**.
**Linear:** https://linear.app/cwchanap/issue/HPA-857/refactor-decouple-dtxcommon-from-dtxui-components-maintab-togglegroup
**Implementation plan:** [2026-11-16-hpa-857-grid-spacing-decoupling.md](../plans/2026-11-16-hpa-857-grid-spacing-decoupling.md)

## Decision

**Proceed with the minimal cleanup.** The current dependency is valid and acyclic, not a build failure or user-facing bug. Removing it is worthwhile because `MainTab.svelte` is the only production consumer of `ToggleGroup`, and the current mock prevents grid-spacing interaction tests. This is a small maintenance cleanup, **not** a performance optimization.

Render the six fixed grid-spacing options as **native buttons directly inside `MainTab.svelte`**. Reuse the inline `aria-pressed` button convention from `packages/dtx-web/src/lib/components/ChartList.svelte`, but **not** its `overflow-hidden` container (which would clip the focus ring). Do not move or duplicate `ToggleGroup`, introduce a new component or snippet injection, use Skeleton Segment (different semantics/styling), or restructure packages.

## Current repository evidence

- `packages/common/src/lib/components/editor/MainTab.svelte` imports `ToggleGroup` once. Web `EditorTabs.svelte` and the desktop editor both render the shared `MainTab`. Their other `@dtx/ui-components` imports remain live.
- `packages/ui-components/src/lib/components/ToggleGroup.svelte` is exported from `src/lib/index.ts` and `src/lib/components/index.ts`; its keyed-reconciliation test covers a generic behavior no remaining consumer needs after the cleanup.
- `packages/common/package.json` declares `@dtx/ui-components`, `packages/common/vitest.config.ts` aliases it, and `MainTab.test.ts` mocks it.
- `packages/e2e-web/editor.spec.ts` already checks the real editor loads. It **does not provide a screenshot baseline**; no Linear mockup is attached. The existing web/desktop E2E CI matrix provides regression coverage for common/UI changes.

## Exact behavior and styling

- Preserve option order and numeric values: **8th (8), 12th (12), 16th (16), 24th (24), 48th (48), 64th (64)**. Initially 16th alone has `aria-pressed="true"`.
- Clicking an option updates only `gridSpacing`. The existing `$effect` emits `GRID_SPACING_UPDATE` once after it settles; **do not emit in the click handler**. All six buttons are disabled during preview.
- Preserve a `role="group"` wrapper with `aria-label="Select grid spacing for note placement"`, `class="inline-flex rounded-md shadow-sm"` and the Grid Spacing text as a `<span>` instead of the currently dangling label `for="grid-spacing"`. Each control is a native `<button type="button">` with keyed iteration, `aria-pressed` and `disabled={isPreviewing}`.
- Copy the actual `ToggleGroup` classes for `size="sm"` + `variant="outline"`: base `inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:pointer-events-none`; size `px-2 py-1 text-xs`; selected `bg-purple-600 text-white border border-purple-600 hover:bg-purple-700`; unselected `bg-slate-800/50 text-slate-300 border border-purple-500/30 hover:bg-slate-700/50 hover:text-slate-200`.
- Use **static Tailwind 4 positional variants** `first:rounded-l-md last:rounded-r-md not-first:-ml-px focus:z-10`. Do not replicate `ToggleGroup`'s index-based `getButtonClasses` logic. Use one reusable base-class string and one selected/unselected class expression in the template.

## Smallest change surface

1. In `MainTab.svelte`, replace the component with inline buttons; preserve existing state/options/effect and accessible styling.
2. In `MainTab.test.ts`, remove the UI-package mock, add **one** real selection test (six ordered buttons, 16th default, 24th click, one numeric grid event), and **extend the existing preview-disabled test** to assert all six buttons have native `disabled` set. Filter `mockEmit` by event type because other editor controls use it. **Do not simulate `fireEvent.click` on disabled buttons**: jsdom's synthetic dispatched click is not a reliable browser-disabled interaction check; rely on native button semantics and `toBeDisabled()`.
3. Remove `ToggleGroup.svelte` and `ToggleGroup.test.ts`; remove its two exports, `@dtx/common`'s `@dtx/ui-components` dependency, the now-unused common Vitest alias, and refresh `bun.lock`. Keep `clsx` in ui-components: `Button.svelte` and `utils/cn.ts` still use it. Keep web/desktop dependencies and Vite aliases.
4. **Do not add a new E2E spec or screenshot-golden test.** The existing `editor.spec.ts` may receive one `toBeVisible()` assertion for the named selector if necessary; unit tests already cover the interactions.

## Automated acceptance

- **Unit:** one real `MainTab` selection test confirms exact option order, initial pressed state, and a single `GRID_SPACING_UPDATE(24)` after clicking 24th; existing preview-disabled test checks all six disabled.
- **Dependency/CI:** `git grep -n ToggleGroup -- packages/ __mocks__/` finds no remaining source/config/test references (design docs are outside this search); common no longer imports/depends on ui-components. After refreshing the lockfile, a frozen Bun install succeeds; **build `@dtx/ui-components` and `@dtx/common` before downstream checks** so desktop checks use current `dist/` output. Full common/UI/web/desktop unit tests, affected typechecks, repository-wide ESLint/Prettier, and existing web/desktop E2E CI pass at the implementation SHA.
- **MCP end-to-end (one platform):** use a Playwright MCP browser session to load the actual hydrated web editor and verify the named group is rendered and selecting 24th changes its `aria-pressed` state. **Focus a button (24th after the click, or another group edge button) and take one screenshot** after selection so its focus ring is actually visible. Visually check labels, selected/unselected contrast, joined borders, focus treatment, alignment and clipping against the intended classes. No pre-existing baseline/golden or mockup exists; do **not** claim an automated pixel-diff or screenshot-clipping algorithm. Record the MCP result and an attached/linked screenshot in the **PR discussion only**, or summarize the visual finding if attachment is unavailable; **do not commit screenshot binaries to the repository**. Do not add a permanent redundant E2E test or require human sign-off.

## Non-goals

No new art/SFX, authentication, Cloudflare, desktop IPC, other package redesign, backward compatibility alias or second PR. Keep the PR as a draft until implementation and verification are ready.
