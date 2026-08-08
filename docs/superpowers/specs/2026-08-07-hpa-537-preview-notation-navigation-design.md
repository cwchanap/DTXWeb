# HPA-537 Preview Notation and Navigation Enhancement

**Date:** 2026-08-07  
**Status:** Approved design, revised after repository review  
**Linear:** HPA-537  
**Package(s):** `@dtx/common`, `dtx-web`, `dtx-e2e-web`

## Overview

HPA-537 improves the public music-tab preview in two related ways:

1. Improve notation readability by removing doubled measure boundaries and rendering the effective BPM, including mid-song tempo changes.
2. Make navigation match user intent: public browsing leads to the read-only notation preview, while owner/management surfaces continue to lead to the editor.

The existing `/preview/[id]` route remains the public read-only viewer. The existing `/editor/[simfileID]` route remains the creator/editor surface. No new route, API endpoint, database field, or permission model is introduced.

The central UX rule is:

> **Preview is the public/read-only consumption surface. Editor is the creator/owner surface.**

## Goals

- Remove doubled barlines between adjacent measures in the same rendered system.
- Render the effective initial BPM and all effective BPM changes at their musical positions.
- Derive notation tempo markings and playback timing from one normalized tempo sequence.
- Make blog card/table navigation open `/preview/[id]` for previewable published charts.
- Keep owner chart-list navigation focused on `/editor/[id]`, with Preview as a secondary action.
- Rename the ambiguous owner metadata action from `Edit` to `Edit details`.
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
- A universal shared `ChartActions` component.
- Redesigning routes or changing `/preview/[id]` URL semantics.
- Solving dense/multiple tempo-label collision in the same measure.

## Current State

The public preview already provides a Songsterr-style notation experience using VexFlow. It loads one published DTX level, builds a pure notation/timing model in `@dtx/common`, renders notation through `NotationView.svelte`, and drives playback/cursor synchronization from `ChartTiming`.

Relevant files:

- `packages/common/src/lib/notation/model.ts`
- `packages/common/src/lib/notation/quantize.ts`
- `packages/common/src/lib/notation/timing.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- `packages/dtx-web/src/routes/preview/[id]/+page.svelte`

The preview already parses the selected DTX file, so all tempo information is available without extending `getPreviewSimfile()` or GraphQL.

### Existing barline behavior

VexFlow 4.2.5 creates a `Stave` with both `left_bar: true` and `right_bar: true` by default. `NotationView.svelte` packs measure staves edge-to-edge in a system. Therefore measure boundaries are **already rendered**, but two adjacent staves produce a doubled boundary: the previous measure's end bar plus the next measure's begin bar.

HPA-537 does not add missing barlines. It removes the redundant begin bar for non-first measures in a rendered row while leaving VexFlow's existing end bars intact.

### Existing navigation behavior

Navigation is currently inconsistent with the public/owner distinction:

- Blog card titles can navigate to `/editor/[id]`.
- Blog table titles can navigate to `/editor/[id]`.
- Owner card/table titles also navigate to `/editor/[id]`, which is appropriate for that context.
- The authenticated chart-detail page already exposes `/preview/[id]` separately for published charts.

HPA-537 makes the list views follow that distinction consistently.

## Design Decisions

| Topic | Decision |
| --- | --- |
| Tempo source | Normalize tempo once in `@dtx/common` and reuse it for timing + notation |
| Tempo model | Add narrow `NotationTempoEvent { measure, fraction, bpm }` data |
| Timing exposure | `ChartTiming.tempoEvents` is the normalized effective tempo sequence |
| Initial tempo | Always expose one effective event at measure `0`, fraction `0` |
| Tempo changes | Support channel `08` (`#BPMxx`) and legacy channel `03` |
| Duplicate tempo | Collapse consecutive effective events with the same BPM |
| Invalid tempo | Ignore invalid/non-positive/non-finite changes and retain prior effective BPM |
| Measure boundary fix | Keep VexFlow end bars; suppress begin bar only for non-first staves in a row |
| Tempo rendering | Use VexFlow `StaveTempo` outside the rhythmic `Voice` |
| Mid-measure positioning | Position from the measure's normalized fraction after layout |
| Blog primary route | `/preview/[id]` |
| Owner primary route | `/editor/[id]` |
| Owner preview | Secondary action only when published + uploaded |
| Navigation policy reuse | Small pure helpers in existing `ChartList.helpers.ts` |
| Preview-page editor action | Excluded |
| Editor-shell preview action | Excluded |

## Tempo Model

### Types

Add a deliberately narrow tempo event:

```ts
export interface NotationTempoEvent {
	measure: number;
	fraction: number;
	bpm: number;
}
```

Extend the timing result:

```ts
export interface ChartTiming {
	tempoEvents: NotationTempoEvent[];
	measureStartSeconds: number[];
	totalDuration: number;
	positionToTime(measure: number, fraction: number): number;
	timeToPosition(t: number): { measure: number; fraction: number };
}
```

When DTX notation is built, expose the normalized sequence on the chart:

```ts
export interface NotationChart {
	measures: NotationMeasure[];
	tempoEvents: NotationTempoEvent[];
}
```

`fraction` is normalized to `0..1` within the measure. The event describes the effective tempo beginning at that musical position.

Do not introduce a generic `NotationEvent`, annotation registry, discriminated event hierarchy, or renderer plug-in mechanism.

### Single normalization path

The current timing pipeline already interprets:

- the base DTX BPM;
- channel `08` BPM-reference changes;
- channel `03` direct-hex legacy BPM changes after the existing synthetic-key conversion in `buildNotationChart()`.

Extract the timing interpretation into one pure helper:

```ts
normalizeTempoEvents(input: TimingInput): NotationTempoEvent[]
```

`buildChartTiming()` consumes that normalized sequence for both forward and inverse timing and exposes it as `ChartTiming.tempoEvents`. `buildNotationChart()` exposes an equivalent `tempoEvents` sequence on `NotationChart`.

The contract is **value equivalence**, not array identity. A future defensive copy must be allowed as long as the effective sequence is unchanged.

Conceptually:

```text
DTX base BPM + channel 08 + converted channel 03
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

### Normalization rules

1. Resolve the initial BPM to a finite positive value; otherwise use `120`.
2. Resolve channel `08` references through `bpmValueMap`.
3. Reuse the existing channel `03` synthetic-key conversion rather than parsing legacy BPM again in the renderer.
4. Sort by measure and fraction while preserving input order for exact ties.
5. `buildNotationChart()` supplies channel `08` changes before converted channel `03` changes, so channel `03` is the final effective value at an exact same-position tie.
6. Treat only finite BPM values greater than zero as valid changes.
7. Invalid or unresolved changes leave the previous effective BPM unchanged and do not produce a notation event.
8. A valid change at measure `0`, fraction `0` replaces the initial effective event rather than adding a duplicate mark.
9. If multiple valid changes occur at the same musical position, keep only the final effective BPM at that position.
10. Collapse consecutive events when the effective BPM does not change.

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

### Timing consumption

`secondsIntoMeasure()` and `fractionAtSeconds()` must consume the normalized sequence rather than independently walking raw `bpmChanges`.

The first normalized tempo event is also the timing engine's initial BPM. Timing must not initialize separately from the raw `input.bpm` after normalization.

The important invariant is:

> The effective tempo values used to compute time are the same values exposed to notation rendering.

No BPM-specific logic is added to the preview Svelte page.

## Notation Rendering

### Remove doubled measure boundaries

`NotationView.svelte` already creates one VexFlow `Stave` per `NotationMeasure`, and VexFlow already supplies a single begin and end bar by default.

For each laid-out measure:

```ts
const firstInRow = x === LEFT;
const stave = new Stave(x, y, width);
if (!firstInRow) stave.setBegBarType(BarlineType.NONE);
```

Do not re-set the end bar to `SINGLE`; that is already the VexFlow default and would be a no-op.

Do not draw custom SVG/HTML barline overlays.

At the start of a wrapped system, retain the normal begin bar. Between adjacent measures, the previous measure's end bar becomes the single visible boundary.

Suppressing a begin bar may change VexFlow's formatted `getNoteStartX()`. The renderer already recomputes geometry in the same render pass, so cursor/seek geometry should remain internally consistent, but preview cursor/seek regression tests remain in the verification blast radius.

### Tempo annotations

Render all tempo events through the same post-layout VexFlow `StaveTempo` path, outside the rhythmic `Voice`.

After the stave and voice have been formatted, derive the nominal annotation coordinate:

```ts
const x =
	stave.getNoteStartX() +
	event.fraction * (stave.getNoteEndX() - stave.getNoteStartX());
```

Then draw:

```ts
new StaveTempo({ bpm: event.bpm, duration: 'q' }, x, 0).draw(stave, 0);
```

Using `StaveTempo` rather than `TextNote` keeps tempo annotations out of note spacing, rhythmic duration, beam generation, and cursor geometry.

### Known rendering limitations

VexFlow 4.2.5 internally applies a `+10px` `StaveTempo.shift_x`, so the final glyph position is offset from the nominal proportional x. Tests must not assert exact browser pixel placement.

Multiple tempo events in one measure currently share the same top-text baseline and may overlap if they are close together. Do not add dynamic label measurement, vertical staggering, or collision avoidance in HPA-537. If real charts demonstrate a readability problem, handle that as a focused follow-up.

Tempo markings need additional vertical headroom. Adjust only the existing local layout constants (`TOP`, `SYSTEM_HEIGHT`, or equivalent); do not introduce a separate layout engine.

### Failure behavior

Notation annotation failure must not prevent the chart from rendering or playing.

- Invalid tempo directives are ignored during normalization.
- A rendering failure for one tempo mark is logged/skipped independently.
- Audio loading, seek, playback, level switching, and cursor behavior remain unchanged.

## Public Blog Navigation

### Public mental model

```text
/blog -> /preview/[id] -> optional download
```

The editor is not the primary destination from the public blog.

### Shared pure policy

Keep card/table UI separate, but centralize the tiny route policy in existing `ChartList.helpers.ts`:

```ts
isPreviewable(item): boolean
chartTitleHref(item, isBlog): string | null
```

Rules:

- blog + published + uploaded -> `/preview/[id]`;
- owner + uploaded -> `/editor/[id]`;
- otherwise -> no title link.

This prevents the card title, table title, and table action visibility from drifting without introducing a shared UI component.

### Card view

For blog cards:

- title uses `chartTitleHref()`;
- add an explicit **Preview** action near the current Download action when `isPreviewable()` is true;
- non-previewable blog items remain non-clickable and never fall back to Editor.

### Table view

For blog table rows:

- title uses the same `chartTitleHref()` helper;
- add a compact Preview action beside the existing download/external-link action;
- use a visually distinct Preview icon such as `Eye`; reserve `ExternalLink` for external download;
- keep the public row compact; do not add the owner action popover.

## Owner Navigation

The owner/management path remains:

```text
My Charts -> /editor/[id]
```

For non-blog card and table views:

- uploaded chart title remains `/editor/[id]`;
- existing **Open in Editor** remains the primary action;
- add **Preview** as a secondary action when published + uploaded;
- keep `/app/chart/[id]` as the metadata/details destination;
- rename **Edit** to **Edit details**.

Do not create a reusable `ChartActions` component.

## Preview and Editor Navigation Exclusions

### No Editor action on public Preview

Do not add an Editor button to `/preview/[id]`. The route is intentionally public and anonymous for published charts; ownership/auth state is otherwise unnecessary there.

### No Preview action in editor shell

Do not add a public-preview button to `EditorNavigation.svelte`. The remote editor shell currently does not carry publication state, and owner list/detail surfaces already provide suitable entry points.

## Error Handling

HPA-537 introduces no new page-level error state.

Preserve existing preview behavior:

- metadata/chart load failure -> existing preview unavailable state;
- level load failure -> keep committed chart and restore transport state;
- audio failure -> existing visual-only fallback;
- partial sound-file failure -> existing non-fatal notification.

Tempo behavior:

- unresolved BPM reference -> retain prior effective BPM;
- non-finite or non-positive BPM -> retain prior effective BPM;
- duplicate effective BPM -> omit duplicate notation mark;
- annotation draw failure -> log/skip annotation without invalidating the measure.

## Testing Strategy

### `@dtx/common`

Unit tests must verify:

1. Base BPM creates the initial event.
2. Invalid base BPM falls back to 120.
3. Channel `08` references resolve correctly.
4. Legacy channel `03` changes resolve through the existing conversion path.
5. Position-zero changes replace the initial effective mark.
6. Mid-measure changes preserve their fraction.
7. Same-BPM consecutive changes collapse.
8. Exact same-position changes resolve deterministically, including the `08` then `03` rule.
9. Invalid/unresolved/non-positive/non-finite changes are ignored.
10. A mapped `0` BPM does not poison duration; a 4/4 measure at 120 BPM remains two seconds.
11. Forward and inverse timing use the normalized sequence.
12. `NotationChart.tempoEvents` and `ChartTiming.tempoEvents` are equal by value. Do not require reference identity.

### `NotationView`

Continue orchestration tests with VexFlow mocked.

Assert:

- the second adjacent stave has its begin bar changed to `BarlineType.NONE`;
- do not assert explicit end-bar setters because VexFlow already supplies them;
- tempo events instantiate/draw `StaveTempo` outside the rhythmic `Voice`;
- a mid-measure event uses the expected nominal proportional x in the unit-level constructor call;
- tempo rendering does not add voice entries;
- tempo draw failure remains non-fatal;
- chart fixtures use `tempoEvents: []` when no marks are needed.

Do not snapshot VexFlow SVG output.

### Preview page tests

No new page-level BPM test is required. Update existing typed fixtures when `NotationChart.tempoEvents` becomes required and keep existing audio/transport/level-switch behavior tests unchanged.

### Chart-list tests

Test the route matrix once at the pure-helper seam, then keep lightweight card/table integration assertions. Extend the existing `ChartListTableItem.test.ts`; do not recreate its mock scaffolding. Update its existing `Edit` assertion to `Edit details`.

### E2E

Use a dedicated `preview-tempo.dtx` fixture; leave shared `test-sample.dtx` unchanged.

The dedicated fixture must contain valid DTX object lines beginning with `#NNNCC:` so `DTXFile.parseNotes()` produces real playable notes. Put a channel `08` tempo change in a measure that also contains playable notes.

Verify:

- the existing real-VexFlow preview journey still renders notation;
- visible tempo text includes the initial and changed BPM;
- Blog -> published uploaded chart navigates to `/preview/[id]`.

Browser assertions must not depend on exact tempo-label pixel positions.

## Expected File Impact

Likely production files:

- `packages/common/src/lib/notation/model.ts`
- `packages/common/src/lib/notation/timing.ts`
- `packages/common/src/lib/notation/quantize.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.svelte`
- `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
- `packages/dtx-web/src/lib/components/ChartList.svelte`
- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`

Likely tests/fixtures:

- `packages/common/src/lib/notation/timing.test.ts`
- `packages/common/src/lib/notation/quantize.test.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`
- `packages/dtx-web/src/lib/components/preview/NotationView.errors.test.ts`
- `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`
- `packages/dtx-web/src/lib/components/ChartList.test.ts`
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
- existing `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
- new `packages/e2e-web/fixtures/preview-tempo.dtx`
- `packages/e2e-web/preview.spec.ts`
- `packages/e2e-web/blog.spec.ts`

No expected changes:

- `packages/e2e-web/fixtures/test-sample.dtx`
- `packages/dtx-api/**`
- GraphQL operations/generated client
- database migrations
- `packages/dtx-desktop/**`
- `packages/common/src/lib/game/scenes/Preview.ts`
- editor route/navigation

## Acceptance Criteria

1. `/preview/[id]` visibly renders the selected DTX's effective starting BPM.
2. Valid channel `03` and `08` tempo changes render BPM markings at their musical positions.
3. Timing and notation expose equivalent normalized effective tempo sequences.
4. Adjacent measures in the same rendered system no longer show a doubled boundary.
5. Removing the redundant begin bar does not break cursor/seek behavior.
6. Tempo markings do not alter note spacing, beam grouping, cursor geometry, seek behavior, or playback timing.
7. Switching difficulty rebuilds notation and shows the selected DTX level's tempo sequence.
8. Blog card/table titles for previewable charts navigate to `/preview/[id]`, not `/editor/[id]`.
9. Blog cards expose an explicit Preview action; table rows expose a compact, visually distinct Preview action.
10. Non-previewable blog items remain non-clickable and never fall back to Editor.
11. Owner chart titles continue to open `/editor/[id]` when uploaded files exist.
12. Published owner charts with uploaded files expose Preview as a secondary action.
13. The owner metadata action is labelled `Edit details` and continues to open `/app/chart/[id]`.
14. No API, GraphQL, database, desktop, auth, public-preview ownership, or editor-shell changes are required.
15. Existing preview transport/audio/level-switch behavior continues to pass its tests.

## Scope Check

This remains one focused implementation unit: a small shared tempo-normalization/model extension plus localized VexFlow and chart-list UI changes. The barline work is intentionally only removal of the redundant adjacent begin bar, not a notation-layout rewrite.

Future work, if desired, should be separate tickets for measure numbers, dense tempo-label collision handling, richer musical directives, owner-aware actions on public preview, editor-shell preview navigation, or generalized chart-action components.
