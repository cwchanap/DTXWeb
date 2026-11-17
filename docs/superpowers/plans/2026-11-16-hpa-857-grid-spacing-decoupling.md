# HPA-857 — Grid-spacing ToggleGroup decoupling: implementation plan

**Status:** Documentation-only draft PR. **All implementation and verification commits stay on this same PR**; no follow-up implementation PR.
**Linear:** https://linear.app/cwchanap/issue/HPA-857/refactor-decouple-dtxcommon-from-dtxui-components-maintab-togglegroup
**Design:** [2026-11-16-hpa-857-grid-spacing-decoupling-design.md](../specs/2026-11-16-hpa-857-grid-spacing-decoupling-design.md)

## Scope and sequencing

HPA-857 is an optional, unblocked, unprioritized backlog item; all issues currently assigned to the DTXWeb Linear project are Done. The existing dependency is valid, so this work should **not** grow beyond a small self-contained cleanup. If the initial implementation makes the code worse, keep the existing dependency and close this PR as not worth pursuing.

Exactly **one PR for HPA-857**. Draft starts with design + plan only; once code and automated checks are ready, mark this PR ready for review to run the normal affected-path CI gates. Avoid broad refactors, new components, and compatibility scaffolding.

## Intended files

| File | Action |
| --- | --- |
| `packages/common/src/lib/components/editor/MainTab.svelte` | Replace sole `ToggleGroup` with six native `button` controls, preserving styles, `aria-pressed`, disabled state, and event flow. |
| `packages/common/src/lib/components/editor/MainTab.test.ts` | Remove UI-package mock; exercise real grid-spacing selection/disabled behavior. |
| `packages/common/package.json`, `bun.lock` | Remove common's one unnecessary UI dependency and regenerate/verify lockfile. |
| `packages/common/vitest.config.ts` | Remove the now-unused common test alias for `@dtx/ui-components`; leave other packages' aliases intact. |
| `packages/ui-components/src/lib/components/ToggleGroup.svelte`, `ToggleGroup.test.ts` | Delete genuinely unconsumed component and its generic-only test. |
| `packages/ui-components/src/lib/index.ts`, `src/lib/components/index.ts` | Remove dead named exports, preserving Button/Modal/etc. |
| `packages/e2e-web/editor.spec.ts` | Add one focused selector E2E to the existing hydrated-editor suite. |
| `docs/superpowers/specs/…` and `docs/superpowers/plans/…` | Keep the plan/decisions current on this PR if evidence changes. |

## Implementation steps (commits on the same branch)

### 1. Change the behavioral test first

- Remove `vi.mock('@dtx/ui-components', …)` from `MainTab.test.ts` so the test uses the real rendered selector.
- Assert the accessible `group` contains six buttons in the expected order, 16th has `aria-pressed="true"` initially, selecting 24th switches the pressed state and produces a single `GRID_SPACING_UPDATE` event with numeric 24 after Svelte effects settle. Clear the mock event history after initial render so the mount-time default emission does not invalidate the click assertion.
- With `isPreviewing` emitted as true by the test store, assert all six controls are disabled and no click updates the event.
- Reuse the current global store mocks and existing test setup; no additional mock file or test library.

### 2. Inline fixed editor grid-spacing control

- Retain `gridSpacingOptions`, `gridSpacing`, `handleGridSpacingChange()` and its existing `$effect`. Replace the component with an accessible group and one keyed Svelte `{#each}` of native buttons.
- Use `type="button"`, `aria-pressed={gridSpacing === option.value}`, `disabled={isPreviewing}`, `onclick={() => (gridSpacing = option.value)}`, and the original selected/unselected/focus/rounded/outline utility styles.
- Do not call `EventBus.emit` in the click handler: the existing effect already publishes grid updates. Replace the dangling `label for="grid-spacing"` with a non-form label/span while keeping the original control's descriptive group aria-label.
- Avoid an additional `GridSpacingToggle` component, generic props, or app-side injection.

### 3. Remove the dead shared-UI contract

- Verify no other consumers via repository search, then remove `ToggleGroup.svelte`, its component-specific test, both UI-package exports, common's dependency and common Vitest alias. Do **not** delete `@dtx/ui-components` from web/desktop or alter their Vite aliases: their Modal/Button imports are live.
- Regenerate `bun.lock` using the repository-pinned Bun version and check a clean frozen install. Ensure the remaining `ui-components` tests/build still succeed, without keeping an unused compatibility export.
- No extra cleanup beyond the paths listed above.

### 4. Extend existing web end-to-end test

- Add a test to `packages/e2e-web/editor.spec.ts`. Reuse `PAGES.EDITOR`, hydration checks, and `waitForXaDecoder`; the default editor tab is expanded (`isTabsCollapsed = false` in the editor route).
- Within the actual editor, find `getByRole('group', { name: 'Select grid spacing for note placement' })`. Assert six buttons, 16th pressed, then click 24th and assert only it is pressed. This avoids coupling E2E to internal Svelte stores. Unit tests check the emitted event.
- No new auth fixture, chart, UI art, Playwright project, or test file. Existing editor visual baseline is used since Linear supplies no mockup.

### 5. Validate and record evidence

Execute commands using the repository's pinned Bun 1.3.9; existing Playwright config launches its own local web/API stack (do not manually start a second server):

```bash
bun install
bun install --frozen-lockfile
bun run --filter=@dtx/common check
bun run --filter=@dtx/common test -- MainTab.test.ts
bun run --filter=@dtx/ui-components check
bun run --filter=@dtx/ui-components test
bun run --filter=dtx-web check
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-web e2e -- editor.spec.ts --project=chromium
bun run lint
bunx prettier --check docs/superpowers/specs/2026-11-16-hpa-857-grid-spacing-decoupling-design.md docs/superpowers/plans/2026-11-16-hpa-857-grid-spacing-decoupling.md
```

Also run the existing affected build/CI jobs and verify a repository-wide source search has no `ToggleGroup` imports/exports. Do not treat passing docs-only checks as implementation evidence.

**MCP acceptance:** run the web editor through Playwright MCP (Chromium suffices because `MainTab` is common to web and desktop), click the six-option grid spacing selector, capture and inspect a screenshot with 24th selected. Programmatically verify the selected state, group accessibility, and absence of clipped/overlapping buttons in the screenshot/DOM; compare the appearance with the original visual baseline rather than requiring human signoff. Attach or link the screenshot and MCP run evidence in **this PR**. Existing native desktop E2E CI continues as regression protection; no second manually scripted OS-specific acceptance flow.

## End-to-end acceptance checklist

- [ ] Real editor loads under Playwright MCP; the six grid-spacing options render in order and 16th is selected initially.
- [ ] Selecting 24th changes exactly one pressed button; the common unit test proves the correct numeric EventBus update, and preview disables every option.
- [ ] MCP screenshot of the after-selection web editor is inspected for matching outline/selected styling, keyboard-focus affordances, readable labels, and no clipping. No mockup is available. **No human acceptance.**
- [ ] `@dtx/common` imports no UI package, dead component/exports/tests are removed, and Bun's frozen isolated install resolves all dependencies.
- [ ] Common/UI unit tests, web/desktop checks, web E2E, lint/format, required affected CI, and existing desktop E2E regressions pass on the implementation commit.
- [ ] Design, implementation, test evidence, and any review fixes land on **one PR**. No extra abstractions or compatibility shims.

If there is a material UI regression or the inline logic becomes more complex than the current small dependency, prefer to close the optional task as not worth doing rather than expanding its scope.
