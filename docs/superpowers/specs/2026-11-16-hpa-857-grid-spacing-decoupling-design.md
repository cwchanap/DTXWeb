# HPA-857 — Remove the unused ToggleGroup dependency from @dtx/common

**Status:** Proposed, documentation-only draft PR. Implement, validate, and merge through this **same PR** if the small cleanup is approved by review.
**Linear:** https://linear.app/cwchanap/issue/HPA-857/refactor-decouple-dtxcommon-from-dtxui-components-maintab-togglegroup
**Implementation plan:** [2026-11-16-hpa-857-grid-spacing-decoupling.md](../plans/2026-11-16-hpa-857-grid-spacing-decoupling.md)

## Decision and motivation

This is **optional low-priority maintenance**, not a bug or a build fix. Bun's isolated dependency declarations were already repaired: `@dtx/common` legally declares `@dtx/ui-components` and the workspace dependency is acyclic. The benefit of changing it is modest: remove an unnecessary cross-package edge and an unused generic component; it will not remove `@dtx/ui-components` from either web or desktop, which use other components. Do not claim a measurable performance win.

If implementing HPA-857, make the smallest coherent change: render its six **fixed grid-spacing buttons directly in MainTab.svelte**, using native buttons and existing Tailwind classes. Remove the generic ToggleGroup only after its sole production consumer is gone. Do not move a generic primitive into the domain package, duplicate the 90-line component, inject snippets from both apps, rename packages, or restructure the workspace.

If review finds the inline buttons more difficult to maintain than the current explicit dependency, **close this optional PR/ticket rather than expand the scope**.

## Verified current code (main, 2026-11-16)

- `packages/common/src/lib/components/editor/MainTab.svelte` is the only production import of `ToggleGroup`. It is consumed by the web editor's `EditorTabs.svelte` and desktop editor. Both apps continue to depend on `@dtx/ui-components` for unrelated controls.
- `packages/ui-components/src/lib/components/ToggleGroup.svelte` is generic, but it has **no other consumers**; it is re-exported by `src/lib/index.ts` and `src/lib/components/index.ts`.
- `packages/common/package.json` declares `@dtx/ui-components` under dependencies. `packages/common/vitest.config.ts` aliases it; `MainTab.test.ts` mocks its import, preventing a real grid-spacing interaction assertion.
- `packages/ui-components/src/lib/components/ToggleGroup.test.ts` tests generic keyed reordering/insertion, which is not needed by a fixed editor-only set once the generic component is removed.
- The web Playwright suite already has `packages/e2e-web/editor.spec.ts`, which opens the real editor and verifies hydration. No Linear UI mockup is attached.
- Existing common/ui changes trigger unit/lint and the affected web/desktop E2E CI matrix. The branch may start as docs-only; draft PRs can skip the expensive native matrix.

## Behavior to preserve

- Exactly six buttons in order: 8th (8), 12th (12), 16th (16), 24th (24), 48th (48), 64th (64).
- Initially, **16th is selected** (`gridSpacing = 16`), and exactly one button has `aria-pressed="true"`. Selecting another option updates `gridSpacing` and emits `GRID_SPACING_UPDATE` through the existing `$effect`. Do not emit twice from the click handler.
- The whole selector is disabled during preview (`isPreviewing`). Native `button` semantics retain tab focus, Space/Enter activation, `type="button"`, and disabled interaction.
- Preserve existing compact/outline appearance: purple selected background, slate unselected backgrounds, joined outline borders, rounded outer corners, focus ring, and readable labels. Preserve the accessible group name `Select grid spacing for note placement` and correct the current unassociated `for="grid-spacing"` label by using a text label without a non-existent input ID.

## Change boundary

1. In `MainTab.svelte`, replace the imported `ToggleGroup` instance with a `role="group"` containing a keyed `{#each gridSpacingOptions as option (option.value)}` of native buttons. Keep the option array and existing state/event flow. Use a small constant base class plus a selected/unselected class expression, and per-position rounded/border classes; no new wrapper component or new package.
2. In `MainTab.test.ts`, delete the `@dtx/ui-components` mock and test real selector behavior (initial pressed state, 24th selection/event, preview disabled). Keep unrelated editor tests unchanged.
3. Delete `ToggleGroup.svelte` and its now-obsolete generic test; remove its two exports. Remove `@dtx/ui-components` only from `packages/common/package.json`, its unused common Vitest alias, and update `bun.lock`. Keep the package itself and web/desktop dependencies and aliases, which have other consumers.
4. Extend the existing `packages/e2e-web/editor.spec.ts` with one focused real-editor selector interaction. Avoid a new harness, fixture, dependency, browser project, or separate PR.

## Acceptance — automated only

- **Dependency:** repository search finds no remaining references to `ToggleGroup`; `@dtx/common` no longer declares/imports `@dtx/ui-components`. `bun install --frozen-lockfile` succeeds from a clean workspace and affected package builds/typechecks pass.
- **Behavior:** common unit test renders six real buttons; 16th initially pressed, clicking 24th leaves only 24th pressed and emits `GRID_SPACING_UPDATE(24)` exactly once after the state settles; preview disables all six.
- **E2E (MCP):** through a Playwright browser MCP session on the web editor, load the real hydrated editor, locate the named selector, verify six labels and 16th selected, click 24th, verify state transition, and take an after-click screenshot. Inspect that screenshot against the existing editor's layout/visual baseline for legibility, alignment, selected-state contrast, focus styles, and absence of clipping. There is **no attached mockup**, so use a screenshot visual check rather than invented pixel-golden thresholds. Record screenshot evidence and MCP test outcome on the **same PR**. No human acceptance criterion.
- **CI:** affected common/ui tests, web and desktop typechecks/builds, lint/Prettier and existing web/desktop E2E gates pass at the implementation SHA. A single web-platform MCP acceptance run suffices for the shared UI change; retain CI's existing target-OS regression coverage without authoring a second platform-specific acceptance scenario.

## Out of scope

No separate art/SFX task (no new assets), authentication/Cloudflare changes, desktop IPC, package renames, generic design-system rebuild, compatibility alias, or second implementation PR.
