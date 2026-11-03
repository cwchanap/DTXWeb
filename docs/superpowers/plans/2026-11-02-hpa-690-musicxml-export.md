# HPA-690 — MusicXML Drum Chart Export Implementation Plan

**Date:** 2026-11-02  
**Status:** Draft plan, revised after review; no implementation started  
**Linear:** [HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)  
**Design:** [MusicXML export design](../specs/2026-11-02-hpa-690-musicxml-export-design.md)

> **One PR for this ticket:** Continue all work on `docs/hpa-690-musicxml-export-design` in the **existing PR #335**. Do not open a separate implementation or testing PR. Keep it draft until implementation and required verification have been recorded.

**Goal:** A visitor can export the currently committed difficulty on `/preview/[id]` to MusicXML 4.0 for MuseScore 4 and Guitar Pro 8.

**Constraints:** Pure TypeScript writer in `@dtx/common`, Svelte button + existing download helper, zero new dependencies/backend work, no separate renderer framework. Every implementation step should leave affected package type checks/tests passing.

## File scope

| File | Change |
| --- | --- |
| `packages/common/src/lib/notation/model.ts` | Replace `NotationNoteEntry.keys` with required `laneIds` |
| `packages/common/src/lib/notation/quantize.ts` | Collect DTX lane IDs at each onset |
| `packages/common/src/lib/notation/drumMapping.ts` | Add `midi` and `instrumentName` to existing `DrumStaff` values; no second mapping table |
| `packages/common/src/lib/notation/drumMapping.test.ts` | Update existing object expectations and test GM pitches |
| `packages/common/src/lib/notation/quantize.test.ts` | Update note fixtures; add bass + left-bass regression |
| `packages/dtx-web/src/lib/components/preview/NotationView.svelte` | Compute deduplicated VexFlow keys from `laneIds` |
| `packages/dtx-web/src/lib/components/preview/NotationView*.test.ts` | Update typed fixtures and assert VexFlow output unchanged |
| `packages/common/src/lib/notation/musicxml.ts` (new) | Pure `exportNotationChartToMusicXml` writer |
| `packages/common/src/lib/notation/musicxml.test.ts` (new) | Structural tests via DOMParser and one file snapshot |
| `packages/common/src/lib/notation/__snapshots__/hpa690-sample.musicxml` (new) | Deterministic export for regression and manual import |
| `packages/common/src/lib/index.ts` | Export writer from existing barrel |
| `packages/dtx-web/src/lib/api/download.ts` | Export the existing private Blob-to-anchor helper as `triggerBrowserDownload` |
| `packages/dtx-web/src/routes/preview/[id]/+page.svelte` | One export button for committed chart and level |
| `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts` | Three export-specific tests, reuse existing level-switch tests |
| `packages/dtx-web/src/lib/i18n/locales/{en,jp}.json` | Two localized keys per locale |
| `packages/e2e-web/preview.spec.ts` | One browser download smoke test using existing fixture |

Do not change `dtx-api`, GraphQL, D1, R2, auth, desktop/Tauri, the separate DTX-to-MIDI converter, package manifests or lockfile unless actual evidence proves an unavoidable dependency.

## Task 0 — Importer compatibility spike (before implementing)

**Why first:** The implementation choices for same-staff multi-instrument chords, mid-bar tempo offsets and off-grid duration/type mismatches all depend on importer behavior. It is cheaper to inspect them on a tiny manually authored MusicXML file than after completing the exporter and UI.

- [ ] Make one small **schema-valid hand-authored** MusicXML sample, stored temporarily (do not build a generator). Use two `score-instrument`/`midi-instrument` IDs for real GM kick `13` and left kick `1C` at the same staff `F4` onset with `<chord/>`.
- [ ] Include two tempo cases: (a) a metronome `<direction>` exactly at a note/rest entry boundary **without** `<offset>`, and (b) one inside a rest with positive `<offset sound="yes">`.
- [ ] Include a one-tick off-grid mismatch, using explicit `<duration>` with a standard visual `<type>`. For a missing *leading* tick, check the alternative `<forward><duration>1</duration></forward>` rather than inserting an untyped rest.
- [ ] Validate the sample against the official MusicXML 4.0 XSD with `xmllint`, including its imported `xml.xsd`/`xlink.xsd` support files.
- [ ] Import into **MuseScore 4** and **Guitar Pro 8**; compare visual position, kick/left kick sounds, tempo timing and onset timing. Record app versions, pass/fail and exact deviations in the PR discussion. Do **not** infer a result from XML parsing alone.
- [ ] If an app is not available in the execution environment, mark it **unverified** explicitly, retain standards-based defaults, and flag manual importer validation as an unresolved acceptance gate. Do not claim the spike passed.
- [ ] Adjust the minimal encoding rules in the design before proceeding if the actual import reproduces a problem. No broad compatibility abstraction.

**Acceptance:** Either importer results are documented, or the unverified state is explicit; the spec reflects observed evidence rather than guesses.

## Task 1 — Model and existing VexFlow adapter

- [ ] Add failing quantizer tests asserting simultaneous `13`+`1C` remains **two `laneIds`** on one entry, while closed/open hi-hat source lanes remain distinct and `00` / non-playable entries do not appear.
- [ ] Replace `keys` with required `laneIds: string[]` on `NotationNoteEntry`; no optional field or compatibility fallback.
- [ ] In `quantize.ts`, collect distinct playable lanes by tick, sorted for stable serialization; keep all `startTick`, `durTicks`, rest and triplet behavior exactly as before. Do not compute visual keys here.
- [ ] In `drumMapping.ts` extend `DrumStaff` and every `LANE_TO_STAFF` row with the GM pitch and full MusicXML instrument name from the design. Preserve `key`/`name`. Update `drumMapping.test.ts` exact object fixtures and GM value assertions.
- [ ] In `NotationView.svelte` derive unique keys from `entry.laneIds` using exported `laneToStaff`, then pass them to `new StaveNote` as currently. Do not change notehead, geometry or transport logic.
- [ ] Update all affected `quantize.test.ts`, `NotationView.test.ts`, `NotationView.errors.test.ts` and other model fixtures in the same implementation commit. Existing visual-key assertions should now exercise `NotationView`'s derived result.
- [ ] Run common/web checks and tests before continuing.

**Acceptance:** Visual preview remains unchanged, yet source double-bass identity is available to the XML serializer with no duplicated model representation.

## Task 2 — MusicXML writer + early snapshot import

- [ ] Add initial failing `musicxml.test.ts` tests covering XML-escaped metadata; one drum part + one voice; correct note/instrument IDs; a bass/left-bass chord; open/closed hi-hat noteheads; a rest.
- [ ] Implement pure `exportNotationChartToMusicXml(chart, {title, artist})` in `musicxml.ts`. Emit UTF-8 XML declaration, `<score-partwise version="4.0">`, `<part-list>`, a single drum `score-part`, five-line percussion clef and `<divisions>48</divisions>`.
- [ ] Derive used percussion instruments directly from `laneToStaff(laneId)`. Emit stable unique score/midi-instrument IDs; use channel 10, MIDI program 1 and **1-based** `midi-unpitched = staff.midi + 1`. Note elements refer to those IDs and use `<unpitched>` plus `<notehead>` from existing staff keys.
- [ ] For every note entry, produce one note per distinct lane. First note advances time; remaining ones carry `<chord/>`. Rests remain `<rest/>`; do not introduce multiple voices. Properly escape metadata.
- [ ] Implement bar lengths and 3:2 tuplets. Derive meter from `measureTicks` and reject nonrepresentable values. Use `<time-modification>` and tuplet start/stop on first/last tuplets. Keep the existing integer tick timebase.
- [ ] Implement musical-time cursor: every entry's `<duration>` = next `startTick` minus current `startTick` (last entry ends at `measureTicks`); visual `<type>` comes from `entry.durTicks` or the tuplet written base, using the preview's representable-duration lookup.
- [ ] **Do not insert 1–2-tick artificial rests.** Verify total advancing durations against `measureTicks`, including chord counting. A first entry after tick 0 is an exception: handle the leading gap explicitly with an importer-verified `<forward>` or fail with a specific validation error; do not silently lose the time. Reject invalid ordering/overlaps.
- [ ] Emit tempo `<direction>` inline, immediately before the entry whose span includes the event. Events at entry start omit offset; events within an entry use a positive `<offset sound="yes">` measured from that entry start. Include `<direction-type>` metronome and `<sound tempo>`, in schema order. Handle measure-end event explicitly.
- [ ] Add one concise **3-measure fixture** to `musicxml.test.ts`: 4/4 with bass/hi-hat chord; 3/4 with eighth-note triplet, rest and a tempo change at tick 72 inside a rest beginning at tick 48 (offset 24); 7/8 with stable expected durations.
- [ ] Inspect XML using existing jsdom `DOMParser` (`packages/common/vitest.config.ts` already uses jsdom): validate instrument references, per-measure advancing durations, distinct voices/chord semantics, meter changes, tuplets, tempo event offsets, escaping and off-grid onset timing.
- [ ] Use Vitest `await expect(xml).toMatchFileSnapshot('./__snapshots__/hpa690-sample.musicxml')`. This creates a human-importable snapshot, not a hand-written 200-line golden literal. Check it in, and do not automatically update snapshots without diff review.
- [ ] Run **once locally** `xmllint --noout --schema /path/to/musicxml.xsd packages/common/src/lib/notation/__snapshots__/hpa690-sample.musicxml` with the published MusicXML 4.0 XSD and its imported support files. Record pass/fail; a DOM parse does not catch element-order violations.
- [ ] **Before UI changes**, import this generated snapshot into the two apps where available; re-check the Task 0 assumptions. Record failures or unavailable apps.
- [ ] Export the writer from `packages/common/src/lib/index.ts`, run common tests/checks.

**Important:** MusicXML `<duration>` represents intended timing and `<type>` visual duration; deliberately different values are valid but importer interpretation must be checked. Do not add a new rhythm engine to hide a small mismatch.

## Task 3 — Preview button, reuse helper, small tests

- [ ] Export existing private `defaultTriggerBrowserDownload` from `packages/dtx-web/src/lib/api/download.ts` as `triggerBrowserDownload`, and use it from `downloadSimfile` as before. No copied Blob/anchor/revoke code in the page.
- [ ] Add a single **Export MusicXML** button to the existing ready-chart header in `+page.svelte`. Disable while `selectedFileUrl !== committedFileUrl`; the header already hides it while loading/error. Do not gate on audio readiness.
- [ ] On click, serialize the **current committed `chart`**, create a UTF-8 `.musicxml` Blob, and call `triggerBrowserDownload(blob, filename)`.
- [ ] Lookup the label from `levels.find(l => l.fileUrl === committedFileUrl)` and construct `<artist> - <title> (<committed level label>).musicxml`, sanitizing path/control characters and retaining Unicode. Avoid accidentally naming the chart for a pending selection.
- [ ] Add `preview.export_musicxml` and `preview.export_musicxml_failed` in English/Japanese locale files. Catch writer/download errors and display the localized toast.
- [ ] Extend the existing page test's `vi.mock('@dtx/common')` with an exporter mock and mock `$lib/api/download`, similar to the existing chart-detail tests.
- [ ] Add exactly **three focused tests**: (a) pending level switch disables export, (b) clicking exports the committed chart and correctly labeled filename, (c) writer error displays a localized toast. Rely on existing tests for not-ready render and failed/committed level switching.
- [ ] Add one lightweight Playwright check in `packages/e2e-web/preview.spec.ts` with the existing chart fixture. Use **`const downloadPromise = page.waitForEvent('download')`** before clicking, then assert `download.suggestedFilename()` ends in `.musicxml`. Do not use Playwright Python's `page.expect_download` syntax.
- [ ] Run web tests/check and targeted E2E if the local test stack is available.

**Acceptance:** Download requires no backend or persisted export, uses the right currently displayed chart, and leaves playback/seek and normal download paths unchanged.

## Task 4 — Verification and readiness

- [ ] Review complete PR diff against the design; do not include unrelated MIDI converter fixes or architecture refactors.
- [ ] Run from repository root:
  - `bun run --filter=@dtx/common check`
  - `bun run --filter=@dtx/common test`
  - `bun run --filter=dtx-web check`
  - `bun run --filter=dtx-web test`
  - `bun run --filter=dtx-e2e-web check`
  - `bun run --filter=dtx-e2e-web e2e -- preview.spec.ts` (with local stack; if not available, report unverified)
  - `bun run lint` and `bun run build:web` where affected CI expects them
- [ ] Confirm the schema validation and the snapshot are up-to-date and document the command used.
- [ ] Import a **real DTX chart** into MuseScore 4: inspect drums, open hi-hat, chord, 3/4, BPM and triplets.
- [ ] Import the same output via Guitar Pro 8 → File > Import → MusicXML. Listen to kick vs left kick, cymbals and hi-hat; check tempo change playback and exact onsets.
- [ ] Post specific results (apps/versions), unresolved defects and any unverified manual checks on PR #335. Do not label parser-only tests as proof of importer success.
- [ ] Keep the PR draft until required automated verification and agreed manual acceptance are complete.

## Acceptance matrix

| Scenario | Expected evidence |
| --- | --- |
| Simultaneous kick and left kick | Two `laneIds` and two MIDI instruments; one visual staff note |
| Open/closed hi-hat | Distinct `x` and `circle-x` and correct GM sounds |
| 4/4 → 3/4 → 7/8 | Proper `<time>` transitions and total advancing durations |
| Triplet | 3:2 modifier, correct written type, first/last tuplet notation |
| Mid-bar tempo | No offset at entry boundary, `sound="yes"` offset inside entry |
| 1-tick gap | Exact intended onset times; no artificial untyped rest |
| Export while level pending | Button disabled; committed level is never misrepresented |
| Ready export | Correct XML, Unicode-safe filename with committed level and successful download |
| Error | Localized toast, preview remains usable |
| Regression | Existing quantizer, VexFlow, audio, seek and level-switch tests pass |
| Target app import | Actual MuseScore 4 and Guitar Pro 8 observations recorded |

## Explicitly outside HPA-690

The DTX-to-MIDI tool appears to map source `11`–`1C` lanes through `01`–`0C`-keyed maps, potentially falling back to MIDI note 60. It merits independent investigation/ticket if desired; **do not fix it in this PR**.

## References

- [MusicXML 4.0 percussion](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/)
- [MusicXML 4.0 offset](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/)
- [MusicXML 4.0 XSD](https://www.w3.org/2021/06/musicxml40/listings/musicxml.xsd/)
- [Vitest file snapshots](https://vitest.dev/guide/snapshot.html)
