# HPA-690 — MusicXML Export Implementation Plan

**Date:** 2026-11-02  
**Status:** Draft for review (no implementation started)  
**Linear:** [HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)  
**Design:** [2026-11-02-hpa-690-musicxml-export-design.md](../specs/2026-11-02-hpa-690-musicxml-export-design.md)

> **Single-PR rule:** All steps, including implementation and validation, belong to the **same draft PR and branch** as these documents. Do not open implementation PR B, separate test PRs, or a follow-up PR for work already in scope. Mark ready only after acceptance is met.

**Goal:** Download the currently displayed DTX drum chart from the public preview as a valid, importable `.musicxml` file with the correct instruments, rhythm, meter, triplets and BPM.

**Architecture:** Preserve DTX lane identity through `NotationNoteEntry`, serialize `NotationChart` with a dependency-free function in `@dtx/common`, and add a single browser download action in the existing Svelte preview page. No backend change.

**Stack:** TypeScript, Svelte 5, MusicXML 4.0, Vitest, Testing Library, existing Playwright web E2E.

## Existing seams and files

| File | Proposed change |
| --- | --- |
| `packages/common/src/lib/notation/model.ts` | Add required `laneIds` to `NotationNoteEntry` |
| `packages/common/src/lib/notation/quantize.ts` | Record playable source lanes in each onset without changing existing visual keys or timing |
| `packages/common/src/lib/notation/quantize.test.ts` | Update exact objects, add simultaneous kick/left-kick regression |
| `packages/common/src/lib/notation/musicxml.ts` (new) | Pure XML exporter, small local GM drum mapping and XML escaping |
| `packages/common/src/lib/notation/musicxml.test.ts` (new) | Golden XML, meter/tuplet/tempo/mapping/timing tests |
| `packages/common/src/lib/index.ts` | Export writer from root barrel |
| `packages/dtx-web/src/routes/preview/[id]/+page.svelte` | Export action for committed difficulty and Blob download |
| `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts` | Download, disabled states, level switch, toast, file name |
| `packages/dtx-web/src/lib/i18n/locales/en.json` | Export label + failure message |
| `packages/dtx-web/src/lib/i18n/locales/jp.json` | Japanese equivalents |
| `packages/e2e-web/preview.spec.ts` | One focused browser smoke check for button/download if practical |

Do **not** touch `dtx-api`, GraphQL, D1, R2, auth, Cloudflare workflows, Tauri/Desktop, the unrelated MIDI converter, or the existing Phaser preview. No package or lockfile change expected.

## Task 1 — Preserve source lane identity (tests first)

**Goal:** Distinguish two drums with the same visual staff key without changing VexFlow presentation.

- [ ] In `quantize.test.ts` add failing tests for: (a) lane `13` and lane `1C` simultaneously produce visual `keys: ['f/4']` but `laneIds: ['13', '1C']`; (b) non-playable/`00` notes are absent from `laneIds`; (c) separate simultaneous hi-hat lanes stay distinct.
- [ ] In `model.ts` add `laneIds: string[]` to `NotationNoteEntry`, required (no compatibility shim). Keep `keys`, `startTick`, `durTicks` unchanged.
- [ ] In `quantize.ts` accumulate `keys: Set<string>` and `laneIds: Set<string>` by tick, then materialize both onto note entries. Sort lane IDs for deterministic output; do not reorder visual `keys` gratuitously. Keep all existing quantization/rest/tuplet logic unchanged.
- [ ] Update `quantize.test.ts` exact object expectations and any typed `NotationChart`/`NotationNoteEntry` fixtures in common/web tests, including `NotationView` tests, to the required field. Do it within this task; compilation must not temporarily fail on the new field.
- [ ] Verify shared and web unit/check commands below pass before proceeding.

**Done when:** Simultaneous double bass still renders once on the notation staff but has two source lane IDs in the model; all existing tests see the same visual keys and timing.

## Task 2 — XML skeleton, percussion instruments, notes and rests

**Goal:** Produce valid MusicXML 4.0 for simple 4/4 measures and multi-drum chords.

- [ ] Write small expected-output tests in `musicxml.test.ts` for a 4/4 chart containing a kick+closed-hi-hat chord, a rest, and a snare. Include XML special characters in title/artist.
- [ ] Add `musicxml.ts` exporting `exportNotationChartToMusicXml(chart: NotationChart, metadata: { title: string; artist?: string }): string`.
- [ ] Emit XML declaration, `<score-partwise version="4.0">`, movement metadata, one `score-part`/`part` pair for drums, five-line percussion clef and `<divisions>48</divisions>`.
- [ ] Add the 12-lane GM mapping from the design. Enumerate only used playable `laneIds`, give each one stable ID, one `score-instrument` and one matching `midi-instrument`. Use channel 10 and `GM pitch + 1`.
- [ ] For each note entry, serialize every `laneIds` instrument as `<unpitched>`, `<duration>` and `<instrument>` using `laneToStaff` for placement/notehead. Emit `<chord/>` on the second and following drums at one onset. Serialize rests via `<rest/>`. A chord advances time only once.
- [ ] Escape XML text/attribute values and use deterministic ordering/formatting. Do not introduce XML libraries or a generic DOM builder.
- [ ] Export writer from `packages/common/src/lib/index.ts` and re-run tests.

**Tests:** Assert IDs resolve, open vs closed hi-hat differs, kick/left kick is **two notes** with different instrument IDs, MIDI channels/unpitched values are correct, `<chord/>` does not consume additional beats, and XML escapes `&`/`<`/quotes correctly.

## Task 3 — Timing, time signatures, triplets and off-grid gaps

**Goal:** Preserve the chart's musical positions in the file rather than merely producing well-formed XML.

- [ ] Build a deterministic three-measure fixture in `musicxml.test.ts`:
  - measure 0: 4/4, simultaneous kick/hi-hat, remaining notes/rests;
  - measure 1: 3/4 (144 ticks), three 16-tick eighth-triplet notes or notes + a rest and a 96-tick rest;
  - measure 2: 7/8 (168 ticks), simple durations that fill the measure;
  - tempo events at measure 0/fraction 0 (120 BPM) and measure 1/fraction 0.5 (160 BPM, offset **72** ticks).
- [ ] Add a golden expected XML fixture (inline string is sufficient; no extra tooling) and focused structural assertions. It must verify `<time>` changes, `<time-modification>3:2`, tuplet start/stop, and a mid-bar `<offset sound="yes">72</offset>` plus `<sound tempo="160"/>`.
- [ ] Map standard `durTicks` to legal `<type>` values. Within a triplet derive written type from `slotTicks * 3 / 2`; retain actual `durTicks` as `<duration>`. Put tuplet start/stop on the first/last *entry*, attaching only to the first note of a chord.
- [ ] Track the write cursor by `startTick` and `durTicks`. Insert exact-duration rests for any omitted sub-3-tick gaps, including before the barline. Do not modify the quantizer solely to help XML. Do not assign a misleading note type to non-standard tick counts.
- [ ] Compute meter as the largest exact divisor among quarter/eighth/16th/32nd/64th tick units. Emit time signature only on first measure or a change. Return a descriptive error for unsupported meter or overfull measure, rather than silent truncation.
- [ ] Place each tempo direction at its measure offset; include `sound="yes"` to ensure timing applies to playback. Add a test for a tempo event at measure start and another in the middle.
- [ ] Assert for every fixture measure: sum of **advancing** XML durations == `measureTicks`; chord members are counted only once. Add a targeted off-grid case with a one-tick gap after a note.
- [ ] Use a simple existing XML parsing/inspection method for structural tests if available; no new library is needed for this PR. If schema validation is available locally, validate the generated sample against MusicXML 4.0.

**Important constraints:** Keep the writer one voice and one percussion part. Do not add multi-voice engraving, tempo quantization, a new timebase, or a general rhythmic event model.

## Task 4 — Preview download UX and localization

**Goal:** A chart visitor can export the currently *committed* difficulty with one click.

- [ ] Add failing page tests for: ready chart shows **Export MusicXML**; loading/error state hides it; selected level pending asynchronously disables it; audio still loading does **not** disable it; level switch commits and export uses the **new** chart object; failed switch reverts and allows the old chart; failure displays localized toast.
- [ ] Extend the existing `vi.mock('@dtx/common')` in `preview-page.test.ts` with the new writer function and stub Blob/URL click as needed. Keep new tests at the page seam; do not rewrite the test harness.
- [ ] Put the button in `+page.svelte` header beside the current level selector. Disable while `selectedFileUrl !== committedFileUrl` (and while not ready). Do not use the audio-ready flag to gate the export.
- [ ] On click, call the pure writer on the current `chart`, wrap the text in a UTF-8 MusicXML Blob, create and click a browser download link, then revoke the object URL.
- [ ] Use `<artist> - <title>.musicxml`, with safe path/control-character replacement and Unicode retained. Provide reasonable missing-metadata fallbacks. The filename must reflect the chart's current song metadata, not a pending level label.
- [ ] Add `preview.export_musicxml` and `preview.export_musicxml_failed` to both language JSON files and wire the toast to the error key.
- [ ] Run web tests and check. Add one small Playwright assertion using the already-seeded preview if existing E2E is available, preferably `page.expect_download`; do not grow E2E infrastructure for this action.

**Done when:** Clicking export on ready/committed notation saves one local file; pressing it during a difficulty switch cannot produce a mislabeled chart; existing playback remains untouched.

## Task 5 — Review, format, verification and import proof

- [ ] Check against the design's full acceptance table and inspect the final PR diff for unrelated changes.
- [ ] Verify MusicXML document order and (when locally possible) schema validity; inspect emitted `<instrument>` ID references and note/chord duration accounting.
- [ ] Run from repository root:
  - `bun run --filter=@dtx/common check`
  - `bun run --filter=@dtx/common test`
  - `bun run --filter=dtx-web check`
  - `bun run --filter=dtx-web test`
  - `bun run --filter=dtx-e2e-web check` (if E2E file changed)
  - `bun run --filter=dtx-e2e-web e2e -- preview.spec.ts` (with existing local stack if available)
  - `bun run lint` / `bun run build:web` if affected CI requires them.
- [ ] Use a real imported DTX drum chart to visually inspect **MuseScore 4**: noteheads, hi-hat openness, drum staff positions, time signatures, mid-bar BPM and tuplets.
- [ ] Separately import the same output via **Guitar Pro 8 → File > Import → MusicXML**, then verify which MIDI drums sound, especially kick vs left kick, open/closed/pedal hi-hat and cymbals. Only adjust the MIDI-unpitched values based on an observed importer problem; record the difference in PR notes/tests.
- [ ] Record any manual verification that could not be run (e.g. target app unavailable) explicitly as **unverified**, not “passed.”
- [ ] Keep this PR in draft until code, automated checks and agreed importer validation are complete. Do not run production deployment.

## Expected acceptance matrix

| Case | Expected result | Proof |
| --- | --- | --- |
| Simple note + chord | Correct percussion staff; two simultaneous sounds | Unit / XML structural test |
| Kick + left kick | Both lanes preserved despite same `f/4` display key | Quantizer + XML test |
| Open/closed hi-hat | Distinct x vs circle-x and distinct MIDI sounds | Unit + importer |
| 4/4 → 3/4 → 7/8 | Meter changes and exactly filled measures | Golden test + MuseScore |
| Eighth triplet | Three slots in 2 eighths with explicit 3:2 and tuplet start/stop | Golden test + MuseScore |
| Mid-bar tempo | Direction offset applies to notation and sound | XML test + importer playback |
| Off-grid 1–2 tick gap | No shifted onset or lost measure length | Structural test |
| Difficulty switch pending | Export cannot download stale committed level under pending selection | Page test |
| Normal download | Unicode-safe filename, UTF-8 `.musicxml`, one click | Page / Playwright |
| Failure | Localized error, page stays usable | Page test |
| Non-regression | Preview audio, seek, VexFlow and chart loading still work | Existing suites |

## Risks, boundaries, stop conditions

- **Importer-specific drums:** MusicXML's MIDI-unpitched values are 1-based by specification. Guitar Pro 8 playback behavior needs manual observation. Do not invent compatibility code before testing.
- **Non-standard DTX quantization:** Preserve exact tick positions and avoid assigning false written durations. A readable export for arbitrary micro-gaps is a future feature only if actual charts demand it.
- **Changes to model fixture shape:** The new `laneIds` is required; update fixtures in the same task. No backwards-compatibility layer is justified.
- **No feature expansion:** Do not include batch export, MusicXML import, standalone editor tool, server jobs, PDF, metadata management or improved engraving beyond this ticket.
- **Single PR:** The draft planning PR is the delivery PR. No second PR for implementation or acceptance.

## Source references

- Existing notation and preview model: `packages/common/src/lib/notation/`, `packages/dtx-web/src/routes/preview/[id]/`
- Existing tests: `packages/common/src/lib/notation/quantize.test.ts`, `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`, `packages/e2e-web/preview.spec.ts`
- MusicXML 4.0 percussion tutorial: https://www.w3.org/2021/06/musicxml40/tutorial/percussion/
- MusicXML 4.0 offset (sound attribute): https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/
