# `/preview` — Songsterr-style Drum Chart Viewer

**Date:** 2026-06-25
**Status:** Approved design (pre-implementation)
**Package(s):** `dtx-web` (route + UI), `@dtx/common` (notation model + audio engine)

## Overview

A new public web route `/preview?id=<simfileID>` that renders a DTX drum chart as
**engraved staff notation** (Songsterr-style) flowing horizontally across wrapping
systems, with a **playback cursor** synced to **full-mix audio** (BGM backing track +
per-note drum samples). Users can switch between the simfile's difficulty levels.

This is distinct from the existing Phaser-based vertical-scrolling `Preview` scene
(DTXMania gameplay style); it is a separate, static-notation reading experience.

### Goals

- Public, shareable, no-login route that loads a **published** chart from R2 by id.
- True engraved drum notation (5-line staff, drum clef, x/oval noteheads, stems,
  beams, rests) via a notation engine (VexFlow).
- Synced playback cursor over the notation, driven by the chart's own audio
  (BGM channel `01` + drum samples), with play/pause and click-to-seek.
- Difficulty/level switcher (Songsterr "track selector" analogue).

### Non-goals (explicitly out of scope for v1)

- Tempo/speed control (would pitch-shift; excluded).
- Looping (whole-song or A/B region; excluded).
- File upload as a data source (load by id only).
- Authentication-gated access (route is public; relies on the published scope).
- Pitch-preserving time-stretch.
- Desktop (`dtx-desktop`) integration (the pure model is shared and could be reused
  later, but no desktop UI is built now).

## Decisions (locked during brainstorming)

| Topic             | Decision                                         |
| ----------------- | ------------------------------------------------ |
| Data source       | Load published simfile from R2/GraphQL by `?id=` |
| Visual form       | True engraved staff notation via VexFlow         |
| Interactivity     | Full: synced cursor + audio + transport          |
| Audio             | Full mix — BGM (`01`) + per-note drum samples    |
| Level handling    | Level switcher, default to highest               |
| Route / auth      | Public top-level `/preview?id=`                  |
| Tempo/speed       | **Excluded** from v1                             |
| Loop              | **Excluded** from v1                             |
| Notation engine   | VexFlow (dtx-web-only dependency)                |
| Quantization grid | 1/48 of a measure default                        |

## Feasibility notes (verified against the codebase)

- The GraphQL `simfile(id)` query uses a `publicOrOwner` auth scope
  (`packages/dtx-api/src/schema/builder.ts`): **published** simfiles resolve for
  anonymous requests, so a public `/preview` needs no login. Each `DtxFile`
  exposes a public R2 `fileUrl` (built from `PUBLIC_SIMFILE_BUCKET_URL`).
- Existing audio playback (`packages/common/src/lib/game/scenes/Preview.ts`) is
  Phaser-bound (Phaser sound manager / loader). The genuinely reusable, Phaser-free
  pieces are `XAAudioContext` (`packages/common/src/lib/browser/audioDecoder.ts`,
  WASM XA→PCM decode) and `getFileProvider()` / direct R2 fetch. The notation page
  needs its **own** Web Audio scheduler.
- DTX note positions are fractional, normalized to /192
  (`packages/common/src/lib/chart/note.ts`). Converting these to notatable
  durations/beams/rests is the core engraving challenge and is what VexFlow handles.
- Timing math already exists in the Preview scene / `game/utils/notePositioning.ts`
  and is ported into a shared, pure `timing` module so audio and cursor agree.

## Architecture

### Separation of concerns

Pure, framework-agnostic, testable logic lives in `@dtx/common`; VexFlow rendering and
Svelte UI live in `dtx-web`.

| Location                                                       | Module         | Responsibility                                                                 |
| -------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `@dtx/common` `src/lib/notation/drumMapping.ts`                | pure config    | DTX `laneID` → `{ staffKey, noteheadType, name }`                              |
| `@dtx/common` `src/lib/notation/quantize.ts`                   | pure           | a measure's lane notes → a `NotationMeasure` (quantized notes + rests)         |
| `@dtx/common` `src/lib/notation/timing.ts`                     | pure           | bpm + bpmNotes + measureLengths → measure/tick ↔ seconds maps                  |
| `@dtx/common` `src/lib/notation/model.ts`                      | types          | `NotationNote`, `NotationMeasure`, `NotationChart`                             |
| `@dtx/common` `src/lib/audio/previewAudioEngine.ts`            | class          | fetch+decode R2 audio via `XAAudioContext`, schedule full mix, transport clock |
| `dtx-web` `src/routes/preview/+page.svelte`                    | orchestrator   | load chart, wire engine⇄view⇄transport, rAF cursor loop                        |
| `dtx-web` `src/lib/components/preview/NotationView.svelte`     | VexFlow render | engrave systems, record geometry, position cursor, emit seek                   |
| `dtx-web` `src/lib/components/preview/PreviewTransport.svelte` | controls       | play/pause, level switcher, time readout                                       |

> VexFlow is added as a **dtx-web-only** dependency. `@dtx/common` gains no new
> dependency (uses Web Audio + the existing `xa_decoder`).

### Route

- File: `packages/dtx-web/src/routes/preview/+page.svelte`, accessed as
  `/preview?id=<simfileID>` (top-level, public — not under the `(app)` auth group).
- Chart loading happens client-side in `onMount` (mirrors `/app/chart/[id]`) using an
  **anonymous** GraphQL client; works for published charts via `publicOrOwner`.
  (SSR meta tags are a possible later nicety, not required for v1.)

### Data flow

1. `onMount`: read `id` from the query → `getSimfile(id)` (anonymous) → metadata
   (`title`, `artist`, `dtxFiles: [{ level, label, fileUrl }]`).
2. Default to the **highest** available level → fetch its `fileUrl` →
   `DTXFile.parse()` → `parseNotes()`, `parseBPMChanges()`, `parseSoundChips()`, `bpm`.
3. Build `NotationChart` (quantize per measure) + timing model → render via VexFlow.
4. In the background, `PreviewAudioEngine.load()` fetches + decodes BGM + drum
   samples; Play enables when decoding finishes (loading indicator until then).
5. Transport: Play → `engine.play(currentTime)`; a `requestAnimationFrame` loop reads
   `engine.currentTime` → timing model → cursor x-position + autoscroll. Click
   notation → seek. Level switch → re-fetch DTX, rebuild model, re-render, reset
   audio.

## Notation model (`@dtx/common/notation`)

### `drumMapping.ts`

DTX `laneID` → standard 5-line drum-staff position + notehead (default map, tunable):

| DTX lane          | Piece          | VexFlow key | Notehead        |
| ----------------- | -------------- | ----------- | --------------- |
| `13` BD / `1C` LB | Bass drum      | `f/4`       | normal, stem ↓  |
| `12` SN           | Snare          | `c/5`       | normal          |
| `14` HT           | High tom       | `e/5`       | normal          |
| `15` LT           | Low/mid tom    | `d/5`       | normal          |
| `17` FT           | Floor tom      | `a/4`       | normal          |
| `11` HHC          | Closed hi-hat  | `g/5`       | `x`             |
| `18` HH           | Open hi-hat    | `g/5`       | `x` + open ring |
| `1B` LP           | Pedal hi-hat   | `d/4`       | `x`, stem ↓     |
| `16` CY           | Crash          | `a/5`       | `x`             |
| `1A` LC           | L. crash/china | `b/5`       | `x`             |
| `19` RD           | Ride           | `f/5`       | `x`             |

Unknown/unmapped lanes fall back to a default staff position and are logged
(non-fatal). Non-playable channels (`08` BPM, `01` BGM) are excluded from notation.

### `quantize.ts` (pure — the hard part)

For each measure:

1. Collect all onsets across **playable** lanes; snap to a grid (default **1/48** of a
   measure; supports 8/12/16/24/32/48-tuplet subdivisions).
2. Group simultaneous hits into a **chord** (stacked noteheads at one tick).
3. Compute each entry's duration as onset-to-onset distance; decompose it into
   notatable durations + **rests** (greedy power-of-two with triplet support).
   Non-decomposable remainders fall back to the nearest grid value and are logged.
4. Map `measureLength` → time signature (`1.0`→4/4, `0.75`→3/4, `0.5`→2/4, …; odd
   lengths approximate to the nearest standard signature and are flagged).

Output: `NotationMeasure { index, timeSig, entries: ({ startTick, durTicks, drums: [{ staffKey, notehead }] } | { rest: true, durTicks }) }`.

### `timing.ts` (pure)

From `bpm` + `bpmNotes` (channel `08` BPM changes) + `measureLength[]`, build
`measureStartSeconds[]` plus `positionToTime()` / `timeToPosition()`. This **single
model is shared by both the audio scheduler and the cursor**, guaranteeing they never
drift. Ported from the existing `notePositioning` / Preview time math.

### `model.ts`

The `NotationNote` / `NotationMeasure` / `NotationChart` type definitions tying the
above together.

### Known engraving limitations (recorded, non-fatal)

- Extreme/irregular subdivisions may engrave imperfectly.
- Non-standard measure lengths approximate the time signature.

Both are non-fatal: playback and cursor remain correct because timing is computed
independently of engraving.

## Audio engine (`@dtx/common/audio/previewAudioEngine.ts`)

Phaser-free `PreviewAudioEngine` class built on `XAAudioContext` (Web Audio + WASM XA
decode).

### Load

- Inputs: `soundChips[]` (id, fileName, volume, position), notes for **all** channels
  incl. BGM `01`, `simfileID` + public bucket URL, the timing model.
- Map each note's 2-char `noteID` → its `SoundChip` (by base-36 id).
- Fetch every unique referenced file from R2
  (`${bucketUrl}/${simfileID}/${fileName}`); decode to `AudioBuffer` (`.xa` →
  `XAAudioContext.decodeAudioData`; `.wav/.ogg/.mp3` → native `decodeAudioData`),
  cache by fileName. Concurrency-limited; **per-file failure is non-fatal** (skip +
  report via `failedFiles`).
- Build a flat schedule `{ timeSec, buffer, gain (volume%), pan (position) }` for every
  note across drum lanes **and** BGM; `timeSec` comes from the shared timing model.

### Transport

- `play(from)` — for each event at `time ≥ from`, create
  `AudioBufferSourceNode → GainNode → (StereoPanner) → destination`, `start()` at
  `ctx.currentTime + (time − from)`. Track active sources.
- `currentTime` = `(ctx.currentTime − startCtxTime) + startOffset` — the clock the
  cursor reads.
- `pause()` stops sources and saves the offset; `seek(t)` re-anchors and replays from
  `t` if currently playing.
- `volume` master gain; `onEnded` callback; `dispose()` stops sources and releases
  resources.
- **No** `rate`/tempo and **no** `loop` (out of scope).

### Interface

```
class PreviewAudioEngine {
  load(params): Promise<{ loaded: number; failedFiles: string[] }>
  play(fromSeconds?: number): void
  pause(): void
  seek(seconds: number): void
  get currentTime(): number
  get duration(): number
  set volume(v: number)   // 0..1
  onEnded?: () => void
  dispose(): void
}
```

## Rendering, cursor sync, transport UI (`dtx-web`)

### `NotationView.svelte` (VexFlow)

- Props: `NotationChart`, `currentTime`; emits `seek(time)`.
- Render on mount / chart change / resize (debounced `ResizeObserver`): lay measures
  into **wrapping systems** sized to container width; per system draw percussion clef
  (+ time signature when it changes); build `StaveNote`s from each `NotationMeasure`
  entry (stacked `keys[]` for chords, `x`-noteheads via key suffix, per-drum stems,
  rests, `Beam.generateBeams`, tuplets where needed).
- **Record geometry**: per measure → `{ systemRow, xStart, xEnd, top, height }` (from
  stave/tickable absolute x), stored in `measureGeometry[]`.
- **Cursor**: an absolutely-positioned vertical line over the container; position from
  `timing.timeToPosition(currentTime)` → `{ measure, fraction }` →
  `x = lerp(xStart, xEnd, fraction)`, row from `systemRow`. Reactive `$effect` on
  `currentTime`.
- **Autoscroll**: when the cursor's `systemRow` changes, smooth-scroll it into view.
- **Seek-on-click**: click x,y → row + measure + fraction → time → emit `seek`.
- The **cursor-position** and **click→time** computations are extracted as pure
  functions so they can be unit-tested directly.

### `PreviewTransport.svelte`

Play/pause (disabled with a loading/progress indicator until audio buffers are
decoded), level switcher (difficulty labels), current/total time readout. No speed
slider, no loop toggle.

### `/preview/+page.svelte` orchestrator

State machine: `loading-meta → loading-chart → ready (notation visible, audio
decoding) → playable`.

- Holds `currentTime`; a `requestAnimationFrame` loop reads `engine.currentTime` while
  playing (cancelled on pause/end).
- Wires: play → `engine.play(currentTime)` + start rAF; pause → `engine.pause()` +
  stop rAF; `seek` from `NotationView` → `engine.seek` + update `currentTime`; level
  change → tear down audio, re-fetch DTX for the level, rebuild chart + timing,
  re-render, reset to 0, reload audio.
- Play stays disabled until audio finishes decoding (the full mix needs the buffers),
  except in the audio-unavailable fallback below.

## Error handling

- **Missing `id`** → "No chart specified" empty state.
- **`getSimfile` null or FORBIDDEN** (not found, or unpublished + anonymous) → a
  single "Chart not found or not available" state (the two cases are not
  distinguished, to avoid leaking existence).
- **No playable levels / DTX parse fails** → error state. **Per-level DTX fetch
  failure** → error with retry / switch level.
- **Audio, graceful degradation:**
    - Per-sample fetch/decode failure → non-fatal; skip, collect `failedFiles`, show a
      non-blocking toast; notation + cursor still work.
    - `XAAudioContext`/`AudioContext` totally unavailable → keep notation; the **cursor
      falls back to a wall-clock timer** (visual-only playback, no sound). The cursor
      reads the audio clock when present, else wall-clock.
    - Suspended `AudioContext` (autoplay policy) → `resume()` on the Play gesture.
- **VexFlow per-measure render error** → catch, draw a placeholder stave, log; the
  page never crashes.
- **Teardown** → cancel rAF, `engine.dispose()`, disconnect `ResizeObserver` on
  unmount / level switch.

## Testing

Follow project conventions: check `__mocks__/` first, prefer enhancing global mocks,
use the `Preview.test.ts` pattern (top-level `vi.mock`, `beforeEach`/`afterEach`).

- **Unit (`@dtx/common`, Vitest):**
    - `quantize`: durations + rests, chords (simultaneous lanes), triplets, empty
      measure → full rest, time-sig from measure length, remainder fallback path.
    - `timing`: `measureStartSeconds` with constant + changing BPM,
      `timeToPosition`↔`positionToTime` round-trip, measure-length variation.
    - `drumMapping`: lane coverage + unknown-lane fallback.
    - `previewAudioEngine`: event-time scheduling, `noteID`→soundChip mapping,
      `failedFiles` handling, `currentTime`/`seek`, using a mocked `AudioContext` +
      `fetch` (enhance existing `__mocks__/audioDecoder`).
- **Component (`dtx-web`, Vitest + jsdom):** page states (no-id / loading /
  not-available / ready), level-switch reload, play/pause wiring (mock `getSimfile`,
  `fetch`, engine, VexFlow). Unit-test the extracted **cursor-position** and
  **click→time** pure functions directly. `PreviewTransport`: disabled-until-loaded,
  event emission.
- **E2E (Playwright): optional follow-up** — load `/preview?id=<seeded published>`,
  assert notation renders + Play advances the cursor. Gated on the local stack having
  a seeded published chart with audio.

## Dependencies & integration

- **New dependency:** `vexflow` (dtx-web only). None added to `@dtx/common`.
- **Entry points:** add a "View tab" / Preview link to `/preview?id=<id>` from the
  chart detail page (`/app/chart/[id]`) and optionally the chart list, for published
  charts.
- **i18n:** all new strings via `svelte-i18n` (en + jp).
- **a11y:** the click-to-seek area gets `tabindex="0"`, `aria-label`, and `keydown`
  alongside `click`; play/pause is a real `<button>`.

## Milestones (one spec, phased)

1. **M1 — Notation MVP:** public route + anonymous load + DTX parse + notation model
   (`drumMapping` / `quantize` / `timing` / `model`) + `NotationView` (static, wrapping
   systems) + level switcher. No audio/cursor. Unit tests for the model.
2. **M2 — Audio engine:** `PreviewAudioEngine` (load/decode/schedule full mix) +
   Play/Pause + loading state + failure handling. Engine unit tests.
3. **M3 — Cursor + transport:** shared-timing cursor overlay, autoscroll,
   seek-on-click, time readout, wall-clock fallback. Integration/component tests.
