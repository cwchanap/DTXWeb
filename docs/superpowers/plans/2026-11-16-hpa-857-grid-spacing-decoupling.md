# HPA-857 — Grid-spacing ToggleGroup decoupling: implementation plan

**Status:** Approved approach, planning-only draft PR. **Implement and verify on this same PR**.
**Linear:** https://linear.app/cwchanap/issue/HPA-857/refactor-decouple-dtxcommon-from-dtxui-components-maintab-togglegroup
**Design:** [2026-11-16-hpa-857-grid-spacing-decoupling-design.md](../specs/2026-11-16-hpa-857-grid-spacing-decoupling-design.md)

## One PR, minimum changes

**Proceed.** The existing dependency is valid, but it supports only one fixed six-button selector. Replace the UI primitive inline, then delete the unused generic implementation and its package edge. Review confirmed the existing `ChartList.svelte` inline-toggle convention, plus Tailwind 4 `first:`/`last:`/`not-first:` variants. No separate implementation PR, reusable replacement component, extra E2E test, or compatibility layer.

| File                                                                                     | Change                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/common/src/lib/components/editor/MainTab.svelte`                               | Replace the component import/instance with keyed native buttons; preserve accessible group, numeric options, state/effect and exact small/outline visual classes. |
| `packages/common/src/lib/components/editor/MainTab.test.ts`                              | Remove the UI-package mock, add one selector interaction test, extend the existing preview-disabled test.                                                         |
| `packages/common/package.json`, `bun.lock`                                               | Remove the common package's now-unused UI dependency and regenerate the lockfile.                                                                                 |
| `packages/common/vitest.config.ts`                                                       | Remove only the unused common UI-package alias.                                                                                                                   |
| `packages/ui-components/src/lib/components/ToggleGroup.svelte` and `ToggleGroup.test.ts` | Delete obsolete implementation and generic-only test.                                                                                                             |
| `packages/ui-components/src/lib/index.ts` and `src/lib/components/index.ts`              | Remove exactly the two dead ToggleGroup exports.                                                                                                                  |

Keep `packages/e2e-web/editor.spec.ts` and both apps' other ui-components imports/aliases unchanged unless one additional existing editor visibility assertion is needed. Keep `clsx` in ui-components for `Button.svelte` and `utils/cn.ts`.

## Work sequence — all commits on this PR

### 1. Test the behavior, reusing existing tests

- Delete `vi.mock('@dtx/ui-components', …)` in `MainTab.test.ts` so the real buttons render.
- Add **one** test that checks six buttons in order under `getByRole('group', { name: 'Select grid spacing for note placement' })`; 16th starts pressed; clicking 24th selects only 24th.
- Assert **one** numeric `GRID_SPACING_UPDATE` event with value `24` after state settles. Clear initial events first; filter `mockEmit.mock.calls` by event name rather than counting unrelated events.
- **Extend** the existing `renders with isPreviewing=true disables inputs` test to assert all six native buttons are `toBeDisabled()`. **Do not dispatch `fireEvent.click` on disabled buttons** to prove selection is unchanged: jsdom synthetic events need not honor native browser disabled semantics. The native `disabled` attribute is the contract; do not add an unnecessary click-handler guard or a separate preview test.

### 2. Inline the native selector with exact style parity

- Keep `gridSpacingOptions`, `gridSpacing` and the `$effect` unchanged. Remove the `ToggleGroup` import.
- Replace the dangling `label for="grid-spacing"` with a `<span>`; render `<div role="group" aria-label="Select grid spacing for note placement" class="inline-flex rounded-md shadow-sm">` and a keyed `{#each gridSpacingOptions as option (option.value)}` of `<button type="button">` controls.
- Use `aria-pressed={gridSpacing === option.value}`, `disabled={isPreviewing}` and `onclick={() => (gridSpacing = option.value)}`. **Do not emit directly on click**.
- Copy `ToggleGroup.svelte`'s exact `sm`/`outline` base, selected and unselected class lists as documented in the design. Use static `first:rounded-l-md last:rounded-r-md not-first:-ml-px focus:z-10` instead of an index-based helper. **Do not** add `overflow-hidden` (it can clip the focus ring).

### 3. Remove dead UI package references

- Delete the orphaned `ToggleGroup.svelte` and its one generic test; remove both UI package exports, common's declared dependency, and the common Vitest alias.
- Regenerate `bun.lock` using Bun 1.3.9. Do not alter active web/desktop UI dependencies or remove the still-needed `clsx` package.
- Search **source files** for `ToggleGroup`; documentation references are expected, so don't require a repository-wide zero-match grep.

### 4. Automated verification

Run in this order with the repository-pinned Bun 1.3.9. Regenerate `bun.lock` after the dependency removal, then verify the frozen install. **Build the shared packages before downstream typechecks/tests**, because the desktop TypeScript config resolves `@dtx/common` through built `dist/` output instead of a source alias; stale artifacts can otherwise mask errors. The package builds also exercise the updated exports.

```bash
bun install
bun install --frozen-lockfile
bun run --filter=@dtx/ui-components build
bun run --filter=@dtx/common build
bun run --filter=@dtx/common test
bun run --filter=@dtx/ui-components test
bun run --filter=dtx-web test
bun run --filter=dtx-desktop test
bun run --filter=@dtx/common check
bun run --filter=@dtx/ui-components check
bun run --filter=dtx-web check
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-web e2e -- editor.spec.ts --project=chromium
bun run lint
bunx prettier --check .
git grep -n ToggleGroup -- packages/ __mocks__/
```

The final `git grep` must produce **zero matches** (exit status **1** means success for this absence check); if it finds a match, remove/resolve the leftover reference. Do not grep `docs/`, where historical explanations intentionally mention `ToggleGroup`. The other commands must exit 0. Run the existing affected CI jobs (including the desktop native E2E matrix) on the implementation SHA; the web Playwright configuration starts its own web/API servers, so do not manually start duplicates. **Draft PR CI skips expensive/unit/lint gates**: move this same PR to ready-for-review only after local checks are green and verify the required CI afterward.

### 5. Single-platform MCP end-to-end and screenshot acceptance

Use **one Playwright MCP session** against the real web editor after implementation:

1. Open the hydrated editor (`PAGES.EDITOR`); confirm the grid-spacing group and six labels render, with 16th pressed.
2. Click 24th and confirm it alone has `aria-pressed="true"`. Unit tests independently prove event emission and preview disabled behavior.
3. Ensure **a grid-spacing button has actual focus** before capture (e.g. verify that 24th remains focused after the click, or tab to 8th/64th near the edge). Capture **one after-selection screenshot** through MCP with the focus ring visible. Inspect it for the expected compact purple/slate outline styles, joined border/rounding, readable labels, and no clipped/overlapping controls. Inspect DOM bounds if a visual issue is suspected; **do not** claim a pixel-golden comparison or nonexistent reference screenshot.
4. Paste/attach the screenshot in the same PR discussion if the MCP output supports it, or report the visual check and a valid evidence link. **Do not add screenshot `.png` files to Git.** No human sign-off, new permanent E2E spec, screenshot baseline, extra browser matrix, or second PR.

One web-platform MCP acceptance run is sufficient for this shared component; keep the existing web and native desktop CI E2E regression suites as-is.

## Acceptance criteria

- [ ] The existing `MainTab` unit tests exercise the actual six buttons; one new selection test confirms order, default 16th, click 24th and exactly one `GRID_SPACING_UPDATE(24)`; the existing preview test confirms all six native buttons are `toBeDisabled()` without synthetic disabled clicks.
- [ ] The UI retains the accessible group, native keyboard/button semantics, original small/outline styling and original event/state flow. No duplicated generic toggle or index-based styling logic.
- [ ] An MCP-driven real web editor run verifies selected-state behavior end-to-end and yields **one focused-button screenshot checked visually** against expected styling, with no missing/clipped controls; record evidence in PR discussion and do not commit images; no mockup is attached.
- [ ] There are no `ToggleGroup` references in common/UI **source files**, common no longer depends on ui-components, and the frozen lockfile installation works. Web/desktop retain their valid UI dependencies.
- [ ] Shared packages build before downstream checks; **full** common/UI/web/desktop unit suites, typechecks, repository-wide lint/Prettier, existing web E2E and affected CI (including desktop E2E) pass on the implementation commit; grep confirms no leftover source/config/mock references.
- [ ] Spec updates, code changes, test results and review fixes are all part of **PR #362**. No human acceptance, another PR or unrelated cleanup.
