# Preview notation triplet duration support

**Date:** 2026-07-07
**Status:** Approved design (pre-implementation)
**Linear:** HPA-116
**Package(s):** `@dtx/common`, `dtx-web`

## Context

The `/preview` notation viewer currently quantizes triplet onsets correctly, but
engraves triplet durations as binary approximations. `TICKS_PER_WHOLE = 192` lets
triplet positions land on integer ticks, but `DURATION_TABLE` in
`packages/common/src/lib/notation/quantize.ts` is binary-only. A 16-tick
eighth-triplet slot therefore decomposes as a sixteenth plus sixty-fourth instead
of rendering as an eighth note inside a triplet.

Playback, timing, cursor positioning, transport, and audio scheduling are already
independent of engraved duration strings. This fix is limited to the notation model,
quantizer, renderer, and tests.

## Decision

Use an additive tuplet-group model on `NotationMeasure`. Keep `entries` as the flat
source of rendered tickables, and add explicit metadata that tells renderers which
entry range belongs to a tuplet group.

```ts
export interface NotationTuplet {
	startIndex: number;
	count: number;
	numNotes: 3;
	notesOccupied: 2;
	slotTicks: number;
	baseDurTicks: number;
}

export interface NotationMeasure {
	index: number;
	measureTicks: number;
	beatsPerMeasure: number;
	entries: NotationEntry[];
	tuplets: NotationTuplet[];
}
```

`tuplets` is required and is `[]` for non-tuplet measures. This avoids optional-field
branching in the renderer and makes the output contract explicit.

For an eighth-note triplet, each entry keeps its real span (`durTicks: 16`) while the
tuplet marker carries `baseDurTicks: 24`. The renderer uses `baseDurTicks` for the
VexFlow duration code (`8`) and `durTicks` remains available for cursor/timing math.

## Quantizer

Add a triplet detection path before binary fallback.

A candidate triplet group is valid when:

- it consists of exactly three equal slots;
- `slotTicks * 3` is a directly representable binary unit, initially `48`, `96`, or
  `192` ticks;
- each slot boundary is on the integer tick grid;
- at least two slots contain playable content;
- if the third slot is empty, the group end must be an observed boundary: either the
  next playable onset is exactly at the group end or the group end is the measure end.
  This prevents an isolated `0,16` pair from being inferred as note/note/rest without
  a completing boundary.

When a group is detected:

- a slot with a playable onset emits a note entry with `durTicks = slotTicks`;
- an empty slot inside the group emits a rest entry with `durTicks = slotTicks`;
- one `NotationTuplet` marker covers the three emitted entries;
- quantization then resumes after the group.

The measure walk stays left-to-right. Binary rests before, between, and after triplet
groups continue to use the existing rest decomposition. Existing sub-3-tick remainder
folding remains the fallback behavior for non-triplet/off-grid spans.

Examples:

- ticks `0, 16, 32` in a 4/4 measure produce three note entries and one tuplet group
  over slots `0..48`;
- ticks `0, 32` produce note/rest/note inside one tuplet group;
- ticks `0, 16, 48` produce note/note/rest for slots `0..48`, followed by the note at
  tick `48`;
- ticks `0, 16` without the completing third slot are still treated as ambiguous and
  use binary decomposition.

## Renderer

`packages/dtx-web/src/lib/components/preview/NotationView.svelte` converts entries to
VexFlow `StaveNote`s as it does today, with one additional lookup for entries covered
by a tuplet marker.

- Plain entries use their own `durTicks` to find the VexFlow duration code.
- Tuplet-covered entries use the marker's `baseDurTicks` for the VexFlow duration
  code, adding `r` for rests.
- After creating the `StaveNote[]`, create `Tuplet` objects from the covered note
  slices with `{ num_notes: 3, notes_occupied: 2 }`.
- Create tuplets before `Beam.generateBeams` so VexFlow can inspect and reformat the
  attached tuplets while generating beams.
- Keep the draw order: format voice, draw voice, draw beams, draw tuplets.

VexFlow 4.2.5 exposes `new Tuplet(notes, options)`, with `notes_occupied` as the
preferred option. Its beam generation code can inspect attached tuplets, so tuplets
must be created before beaming.

## Data Flow

```text
DTX lane notes
  -> quantizeMeasure()
  -> NotationMeasure.entries + NotationMeasure.tuplets
  -> NotationView.toStaveNotes()
  -> Voice / Formatter / Beam / Tuplet
  -> SVG notation
```

Cursor geometry, click seeking, active-note highlighting, and playback continue to
use `startTick`, `durTicks`, and `measureTicks`. No timing or audio data flow changes.

## Tests

### `packages/common/src/lib/notation/quantize.test.ts`

- all-note eighth-triplet group emits three `durTicks: 16` entries plus one tuplet
  marker;
- rest-in-triplet emits a rest entry covered by the same tuplet marker;
- mixed binary and triplet measure keeps plain durations outside the tuplet group;
- isolated ambiguous 16-tick span remains binary fallback;
- existing empty-measure, non-4/4, off-grid, and remainder-folding tests still pass.

### `packages/dtx-web/src/lib/components/preview/NotationView.test.ts`

- mocked VexFlow receives one `Tuplet` construction for a tuplet-covered entry range;
- tuplet-covered note/rest entries use base binary codes such as `8`, `8r`, or `q`
  instead of raw triplet tick fallback codes;
- existing beam-splitting behavior still holds for rests outside tuplets.

## Verification

Run package-scoped checks after implementation:

```bash
bun run --filter=@dtx/common test -- quantize.test.ts
bun run --filter=dtx-web test -- NotationView.test.ts
bun run --filter=dtx-web check
```

Do not run project-wide builds unless explicitly requested.

## Out of scope

- playback engine, audio scheduling, transport, cursor timing, and seek behavior;
- GraphQL/API changes;
- visual redesign of the preview route;
- tuplets beyond triplets, such as quintuplets or septuplets;
- nested tuplets.
