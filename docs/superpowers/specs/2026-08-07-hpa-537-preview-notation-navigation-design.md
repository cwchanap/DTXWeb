# HPA-537 Preview Notation and Navigation Enhancement

**Date:** 2026-08-07  
**Status:** Approved design  
**Linear:** HPA-537  
**Package(s):** `@dtx/common`, `dtx-web`, `dtx-e2e-web`

## Overview

HPA-537 improves the public music-tab preview in two related ways:

1. Increase notation fidelity by showing explicit measure boundaries and BPM markings, including mid-song tempo changes.
2. Make navigation match user intent: public browsing should lead to the read-only notation preview, while owner/management surfaces should continue to lead to the editor.

The existing `/preview/[id]` route remains the public read-only viewer. The existing `/editor/[simfileID]` route remains the creator/editor surface. No new route, API endpoint, database field, or permission model is introduced.

The central design rule is:

> **Preview is the public/read-only consumption surface. Editor is the creator/owner surface.**

## Goals

- Render clear measure barlines in the VexFlow notation view.
- Render the effective initial BPM and all effective BPM changes in musical position.
- Keep notation tempo markings and playback timing derived from one normalization path.
- Make blog card and table navigation open `/preview/[id]` for previewable published charts.
- Keep owner chart-list navigation focused on `/editor/[id]`, with Preview as a secondary action.
- Clarify the existing owner metadata action by renaming `Edit` to `Edit details`.
- Keep the implementation narrow and local to existing notation/chart-list boundaries.

## Non-goals

- General-purpose notation annotations or event infrastructure.
- Tempo/speed playback controls.
- Looping or A/B regions.
- Measure numbers.
- Auth- or ownership-aware actions on the public preview page.
- Adding Preview navigation inside the editor shell.
- New GraphQL fields, API endpoints, database changes, or codegen changes.
- Desktop/Tauri changes.
- Changes to the Phaser gameplay-style Preview scene.
- A universal shared `ChartActions` abstraction.
- Redesigning routes or changing `/preview/[id]` URL semantics.

## Current State

The public preview is already a separate Songsterr-style notation experience using VexFlow. It loads one published DTX level, builds a pure notation/timing model in `@dtx/common`, renders notation through `NotationView.svelte`, and drives playback/cursor synchronization from `ChartTiming`.

Relevant existing files:

- `packages/common/src/lib/notation/model.ts`
- `packages/common/src/lib/notation/quantize.ts`
- `packages/common/src/lib/notation/timing.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- `packages/dtx-web/src/routes/preview/[id]/+page.svelte`

The preview already parses the selected DTX file, so all tempo information is available without extending `getPreviewSimfile()` or GraphQL.

Navigation is currently inconsistent with the public/owner distinction:

- Blog card titles can navigate to `/editor/[id]`.
- Blog table titles can navigate to `/editor/[id]`.
- Owner card/table titles also navigate to `/editor/[id]`, which is appropriate for that context.
- The authenticated chart-detail page already exposes `/preview/[id]` separately for published charts.

HPA-537 makes the list views follow the same distinction consistently.

## Design Decisions

| Topic | Decision |
| --- | --- |
| Tempo source | Normalize tempo once in `@dtx/common` and reuse it for timing + notation |
| Tempo model | Add narrow `NotationTempoEvent { measure, fraction, bpm }` data |
| Initial tempo | Always expose one effective event at measure `0`, fraction `0` |
| Tempo changes | Support both channel `08` (`#BPMxx`) and legacy channel `03` |
| Duplicate tempo | Collapse consecutive effective events with the same BPM |
| Invalid tempo | Ignore invalid/non-positive/non-finite changes and retain prior effective BPM |
| Measure lines | Use VexFlow stave barline APIs; no custom SVG overlay |
| Measure-start tempo | Use VexFlow stave tempo rendering |
| Mid-measure tempo | Draw tempo text above the stave at the musical fraction after layout |
| Blog primary route | `/preview/[id]` |
| Owner primary route | `/editor/[id]` |
| Owner preview | Secondary action only when published + uploaded |
| Preview-page editor action | Excluded |
| Editor-shell preview action | Excluded |

## Tempo Model

### Types

Extend the notation model with a deliberately narrow tempo event:

```ts
export interface NotationTempoEvent {
	measure: number;
	fraction: number;
	bpm: number;
}

export interface NotationChart {
	measures: NotationMeasure[];
	tempoEvents: NotationTempoEvent[];
}
```

`fraction` is normalized to `0..1` within the measure. The event describes the effective tempo beginning at that musical position.

Do not introduce a generic `NotationEvent`, annotation registry, discriminated event hierarchy, or renderer plug-in mechanism. HPA-537 only needs tempo markings.

### Single Normalization Path

The current timing pipeline already combines:

- the base DTX BPM;
- channel `08` BPM-reference changes;
- channel `03` direct-hex legacy BPM changes.

Refactor that interpretation into one pure helper in the notation/timing module, for example:

```ts
normalizeTempoEvents(input: TimingInput): NotationTempoEvent[]
```

`buildChartTiming()` consumes the normalized sequence rather than independently resolving raw BPM change notes. `buildNotationChart()` then exposes that same normalized sequence on `NotationChart`.

Conceptually:

```text
DTX base BPM + channel 08 + channel 03
                 |
                 v
        normalizeTempoEvents()
                 |
          +------+------+
          |             |
          v             v
     ChartTiming    NotationChart
       playback       engraving
```

This avoids two independent interpretations of DTX tempo semantics.

### Normalization Rules

1. Resolve the initial BPM using the same effective fallback currently used by preview timing (`dtx.bpm || 120`).
2. Convert channel `08` references through `bpmValueMap`.
3. Convert legacy channel `03` note IDs to their direct hexadecimal BPM values using the existing legacy conversion path.
4. Sort changes by measure and fraction using deterministic source order for ties.
5. Treat only finite BPM values greater than zero as valid changes.
6. Invalid or unresolved changes leave the previous effective BPM unchanged and do not produce a notation event.
7. A valid change at measure `0`, fraction `0` replaces the initial effective event rather than adding a duplicate mark at the same position.
8. If multiple valid changes occur at the same musical position, apply them in the same deterministic order used by timing and keep only the final effective BPM for that position.
9. Collapse consecutive events when the effective BPM does not change.

Example:

```text
#BPM 120
measure 3 @ 0.5 -> 160
measure 6 @ 0.0 -> 180
```

produces:

```ts
[
	{ measure: 0, fraction: 0, bpm: 120 },
	{ measure: 3, fraction: 0.5, bpm: 160 },
	{ measure: 6, fraction: 0, bpm: 180 }
]
```

### Timing Consumption

`ChartTiming` continues to expose its existing public behavior:

- `measureStartSeconds`
- `totalDuration`
- `positionToTime()`
- `timeToPosition()`

It may expose the normalized tempo sequence internally/publicly if that produces the simplest implementation, but callers should not need a second tempo parser.

The important invariant is:

> The tempo sequence used to compute time must be the same sequence rendered as notation markings.

No BPM-specific logic is added to the preview Svelte page.

## Notation Rendering

### Measure Boundaries

`NotationView.svelte` already creates one VexFlow `Stave` per `NotationMeasure`. Measure lines therefore belong to the stave configuration itself.

For each stave:

- use VexFlow barline APIs to produce a single measure boundary;
- avoid drawing an additional custom SVG/HTML line;
- avoid doubled visual boundaries between adjacent staves;
- preserve the existing responsive wrapping and geometry recording.

The visual intent is conventional adjacent measures:

```text
| measure 1 | measure 2 | measure 3 |
```

The last measure may use the normal final/end barline supported by the selected VexFlow API, but this should remain a small renderer detail rather than a new model field.

### Initial and Measure-start Tempo

For a `NotationTempoEvent` where `fraction === 0`, render a conventional tempo marking above that measure's stave using VexFlow's stave-tempo support.

The first measure therefore shows the effective starting tempo, for example:

```text
quarter note = 120
```

Use VexFlow's musical tempo glyph/rendering instead of manually drawing a Unicode quarter-note symbol when the stave-tempo API supports the desired output.

A later tempo event exactly on a measure boundary is rendered the same way above that measure.

### Mid-measure Tempo

A tempo event with `fraction > 0` must not split the measure or participate in the rhythmic voice.

After the stave and voice have been formatted, derive an annotation x-coordinate from the laid-out stave:

```ts
const x =
	stave.getNoteStartX() +
	event.fraction * (stave.getNoteEndX() - stave.getNoteStartX());
```

Render the tempo text above the stave using the VexFlow render context/text support at that x position.

Do not use a `TextNote` in the musical `Voice`: tempo annotations must not change note spacing, rhythmic duration, beam generation, or cursor geometry.

This proportional x placement is intentionally simple. It matches the existing measure-fraction geometry model and avoids introducing tick-context coupling solely for annotations.

### Layout

Tempo markings need additional vertical headroom. Adjust the existing local layout constants in `NotationView.svelte` (`TOP`, `SYSTEM_HEIGHT`, or equivalent) so markings do not collide with the preceding system.

Do not introduce dynamic annotation measurement or a separate layout engine. A fixed small increase to system headroom is sufficient for this feature.

### Failure Behavior

Notation annotation failure must not prevent the chart from rendering or playing.

- Tempo normalization returns a valid effective sequence whenever the chart timing itself is usable.
- Invalid tempo directives are ignored as described above.
- A rendering failure for a tempo mark should be contained to that annotation and follow the existing non-fatal rendering posture.
- Audio loading, seek, playback, level switching, and cursor behavior remain unchanged.

## Public Blog Navigation

### Public Mental Model

The public browsing path becomes:

```text
/blog -> /preview/[id] -> optional download
```

The editor is not the primary destination from the public blog.

### Card View

In `ChartListItem.svelte`, derive the title destination from context:

- `isBlog && previewable` -> `/preview/[id]`
- `!isBlog && has_uploaded_files` -> `/editor/[id]`
- otherwise -> non-link title

For blog cards, add an explicit **Preview** action in the footer near the existing Download action so preview is discoverable even when users do not click titles.

A chart is previewable when it is published and has uploaded files:

```ts
item.is_published === true && item.has_uploaded_files === true
```

The published check is defensive in blog mode because the blog query is already scoped to published items.

### Table View

For blog table rows:

- chart title -> `/preview/[id]` when previewable;
- add a compact Preview action beside the existing download/external-link action;
- keep the public row compact; do not add the owner action popover.

## Owner Navigation

The owner/management path remains:

```text
My Charts -> /editor/[id]
```

For non-blog card and table views:

- uploaded chart title remains `/editor/[id]`;
- existing **Open in Editor** remains the primary action;
- add **Preview** as a secondary action when `is_published && has_uploaded_files`;
- keep `/app/chart/[id]` as the metadata/details destination;
- rename the generic **Edit** action to **Edit details** to distinguish it from the DTX editor.

Do not create a reusable cross-surface `ChartActions` component for this ticket. The number of touched actions is small and the card/table components already own their contextual rendering.

## Preview and Editor Navigation Exclusions

### No Editor Action on Public Preview

Do not add an Editor button to `/preview/[id]`.

The preview route is intentionally public and anonymous for published charts. Showing an editor action correctly would require ownership/auth state that is otherwise unnecessary for the page. Adding that state solely for one button is outside HPA-537.

### No Preview Action in Editor Shell

Do not add a public-preview button to `EditorNavigation.svelte` in this ticket.

The remote editor shell currently does not carry publication state. Obtaining it solely to decide whether a Preview action should appear adds coupling without improving the main public browsing flow. The owner chart list and chart-detail page already provide suitable preview entry points.

## Error Handling

HPA-537 introduces no new page-level error state.

Preserve the existing preview behavior:

- metadata/chart load failure -> existing preview unavailable state;
- level load failure -> keep committed chart and restore transport state;
- audio failure -> existing visual-only fallback;
- partial sound-file failure -> existing non-fatal notification.

Tempo-specific behavior:

- unresolved BPM reference -> retain prior effective BPM;
- non-finite or non-positive BPM -> retain prior effective BPM;
- duplicate effective BPM -> omit duplicate notation mark;
- annotation draw failure -> log/skip annotation without invalidating the measure.

## Testing Strategy

### `@dtx/common` Unit Tests

Extend notation/timing tests to verify the meaningful tempo semantics:

1. Base BPM creates an event at measure `0`, fraction `0`.
2. Channel `08` BPM references resolve correctly.
3. Legacy channel `03` direct-hex BPM changes resolve correctly.
4. A valid position-zero change replaces the initial effective mark.
5. Mid-measure changes preserve their exact fraction.
6. Same-BPM consecutive changes collapse.
7. Effective tempo carries across measure boundaries.
8. Invalid/unresolved/non-positive/non-finite BPM changes are ignored.
9. Same-position changes resolve deterministically to the same final effective tempo used by timing.
10. Timing calculations and exposed notation tempo events consume the same normalized sequence.

Do not test trivial object construction.

### `NotationView.test.ts`

Continue the current orchestration-test style with VexFlow mocked.

Add assertions that:

- measure staves receive explicit barline configuration;
- the initial tempo uses the stave-tempo rendering path;
- a later measure-start change is attached to the correct stave;
- a mid-measure change is rendered at the expected proportional x-coordinate;
- tempo rendering does not add entries to the musical `Voice` or alter the existing rhythmic note array;
- a chart with no/empty tempo-event data remains safe for defensive compatibility inside tests/helpers.

Do not snapshot VexFlow SVG output.

### Preview Page Unit Tests

The preview page should only be tested for its orchestration responsibility:

- level switching commits the newly built chart, including its tempo events;
- no independent page-level BPM parsing/state is introduced;
- existing audio loading, transport, and stale-load guards continue to pass.

### Chart List Unit Tests

Cover the context matrix explicitly:

| Context | Uploaded | Published | Primary destination |
| --- | --- | --- | --- |
| Blog | yes | yes | `/preview/[id]` |
| Blog | no | yes | no preview link |
| Owner | yes | yes/no | `/editor/[id]` |
| Owner | no | yes/no | no editor title link |

Also verify:

- blog Preview CTA visibility;
- owner secondary Preview visibility only for published + uploaded charts;
- `Edit details` targets `/app/chart/[id]`;
- equivalent public-vs-owner behavior in table mode.

### E2E

Keep E2E coverage intentionally small.

Extend the existing preview fixture with at least one BPM change and assert that visible tempo information is rendered by real VexFlow/browser rendering.

Add one public navigation path:

```text
/blog -> click previewable published chart -> /preview/[id]
```

Do not duplicate all tempo edge cases in Playwright; unit tests own those semantics.

## Expected File Impact

Likely production files:

- `packages/common/src/lib/notation/model.ts`
- `packages/common/src/lib/notation/timing.ts`
- `packages/common/src/lib/notation/quantize.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- `packages/dtx-web/src/lib/components/ChartList.svelte`
- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`

Likely tests/fixtures:

- `packages/common/src/lib/notation/timing.test.ts` and/or existing notation tests
- `packages/common/src/lib/notation/quantize.test.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
- `packages/dtx-web/src/lib/components/ChartList.test.ts`
- table-item tests if a focused test already exists or is justified
- `packages/e2e-web/preview.spec.ts`
- `packages/e2e-web/blog.spec.ts`
- `packages/e2e-web/fixtures/test-sample.dtx`

No expected changes:

- `packages/dtx-api/**`
- GraphQL operations/generated client
- database migrations
- `packages/dtx-desktop/**`
- `packages/common/src/lib/game/scenes/Preview.ts`
- editor route/navigation unless an implementation detail proves strictly necessary

## Acceptance Criteria

1. `/preview/[id]` visibly renders the selected DTX's effective starting BPM.
2. Valid channel `03` and `08` tempo changes render BPM markings at their musical positions.
3. Tempo markings use the same normalized effective tempo sequence as playback timing.
4. Notation shows clear VexFlow-rendered measure boundaries without doubled custom overlay lines.
5. Tempo markings do not alter note spacing, beam grouping, cursor geometry, seek behavior, or playback timing.
6. Switching difficulty rebuilds notation and therefore shows the newly selected DTX level's tempo sequence.
7. Blog card titles for previewable charts navigate to `/preview/[id]`, not `/editor/[id]`.
8. Blog table titles follow the same rule.
9. Blog cards expose an explicit Preview action; table rows expose a compact Preview action.
10. Owner chart titles continue to open `/editor/[id]` when uploaded files exist.
11. Published owner charts with uploaded files expose Preview as a secondary action.
12. The owner metadata action is labelled `Edit details` and continues to open `/app/chart/[id]`.
13. No API, GraphQL, database, desktop, or auth changes are required.
14. Existing preview transport/audio/level-switch behavior continues to pass its tests.

## Scope Check

This design is intentionally one implementation unit: a small shared tempo-normalization/model extension plus localized VexFlow and chart-list UI changes. It does not create new infrastructure or broaden into general notation/editor architecture.

Future work, if desired, should be separate tickets for measure numbers, richer musical directives, owner-aware actions on the public preview, editor-shell preview navigation, or generalized chart-action components.