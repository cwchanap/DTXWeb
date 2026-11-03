# HPA-690 — MusicXML Drum Chart Export Implementation Plan

**Date:** 2026-11-02  
**Status:** Draft plan, revised after review and the Task 0 importer spike; encoding decided per the user-approved "proceed with caveats" ruling; no implementation started  
**Linear:** [HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)  
**Design:** [MusicXML export design](../specs/2026-11-02-hpa-690-musicxml-export-design.md)

> **One PR for this ticket:** Continue all work on `docs/hpa-690-musicxml-export-design` in the **existing PR #335**. Do not open a separate implementation or testing PR. Keep it draft until implementation and required verification have been recorded.

**Goal:** A visitor can export the currently committed difficulty on `/preview/[id]` to MusicXML 4.0 for MuseScore 4 and Guitar Pro 8.

**Constraints:** Pure TypeScript writer in `@dtx/common`, Svelte button + existing download helper, zero new dependencies/backend work, no separate renderer framework. Every implementation step should leave affected package type checks/tests passing.

## File scope

| File                                                                          | Change                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/common/src/lib/notation/model.ts`                                   | Replace `NotationNoteEntry.keys` with required `laneIds`                                |
| `packages/common/src/lib/notation/quantize.ts`                                | Collect DTX lane IDs at each onset                                                      |
| `packages/common/src/lib/notation/drumMapping.ts`                             | Add `midi` and `instrumentName` to existing `DrumStaff` values; no second mapping table |
| `packages/common/src/lib/notation/drumMapping.test.ts`                        | Update existing object expectations and test GM pitches                                 |
| `packages/common/src/lib/notation/quantize.test.ts`                           | Update note fixtures; add bass + left-bass regression                                   |
| `packages/dtx-web/src/lib/components/preview/NotationView.svelte`             | Compute deduplicated VexFlow keys from `laneIds`                                        |
| `packages/dtx-web/src/lib/components/preview/NotationView*.test.ts`           | Update typed fixtures and assert VexFlow output unchanged                               |
| `packages/common/src/lib/notation/musicxml.ts` (new)                          | Pure `exportNotationChartToMusicXml` writer                                             |
| `packages/common/src/lib/notation/musicxml.test.ts` (new)                     | Structural tests via DOMParser and one file snapshot                                    |
| `packages/common/src/lib/notation/__snapshots__/hpa690-sample.musicxml` (new) | Deterministic export for regression and manual import                                   |
| `packages/common/src/lib/index.ts`                                            | Export writer from existing barrel                                                      |
| `packages/dtx-web/src/lib/api/download.ts`                                    | Export the existing private Blob-to-anchor helper as `triggerBrowserDownload`           |
| `packages/dtx-web/src/routes/preview/[id]/+page.svelte`                       | One export button for committed chart and level                                         |
| `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`               | Three export-specific tests, reuse existing level-switch tests                          |
| `packages/dtx-web/src/lib/i18n/locales/{en,jp}.json`                          | Two localized keys per locale                                                           |
| `packages/e2e-web/preview.spec.ts`                                            | One browser download smoke test using existing fixture                                  |

Do not change `dtx-api`, GraphQL, D1, R2, auth, desktop/Tauri, the separate DTX-to-MIDI converter, package manifests or lockfile unless actual evidence proves an unavoidable dependency.

## Task 0 — Importer compatibility spike (before implementing)

**Why first:** The implementation choices for same-staff multi-instrument chords, mid-bar tempo offsets and off-grid duration/type mismatches all depend on importer behavior. It is cheaper to inspect them on a tiny manually authored MusicXML file than after completing the exporter and UI.

- [ ] Make one small **schema-valid hand-authored** MusicXML sample, stored temporarily (do not build a generator). Use two `score-instrument`/`midi-instrument` IDs for real GM kick `13` and left kick `1C` at the same staff `F4` onset with `<chord/>`.
- [ ] Include two tempo cases: (a) a metronome `<direction>` exactly at a note/rest entry boundary **without** `<offset>`, and (b) one inside a rest with positive `<offset sound="yes">`.
- [ ] Include a one-tick off-grid mismatch, using explicit `<duration>` with a standard visual `<type>`. For a missing _leading_ tick, check the alternative `<forward><duration>1</duration></forward>` rather than inserting an untyped rest.
- [ ] Validate the sample against the official MusicXML 4.0 XSD using `xmllint --nonet` with the bundled `catalog.xml` as well as `xml.xsd`/`xlink.xsd` (same offline command as Task 2). The schema imports absolute MusicXML URLs, so simply placing the XSDs in the same folder is insufficient.
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
- [ ] Implement musical-time cursor: every entry's `<duration>` equals its **effective written duration** — the ticks of its `<type>` (dots included), multiplied by `normal/actual` inside a `<time-modification>` group — never the raw gap to the next onset. Visual `<type>` comes from `entry.durTicks` (or the tuplet written base `slotTicks * 3/2`), using the preview's representable-duration lookup, degraded to the largest type whose effective duration fits the span to the next onset. Then emit `<forward>` for the remaining ticks to the next onset/measure end — the Task 0 `t7` encoding, XSD-valid and MuseScore-exact at tick precision. For a 3:2 member, `<duration>` = `slotTicks` while the written base is `slotTicks * 3/2`: the equality check applies _after_ the ratio.
- [ ] **Do not insert 1–2-tick artificial rests.** Validate strictly increasing entry start ticks and advance once per onset (not once per chord member). If the first entry starts at tick `g > 0`, emit the tick-zero tempo direction and any other events at ticks `< g` **before** a `<forward><duration>g</duration></forward>`; a direction at tick `g` comes after the forward. A nonzero tempo tick inside the leading gap uses `<offset sound="yes">eventTick</offset>` relative to cursor 0. `<forward>` is adopted for gaps of any size (leading and inter-onset) per the Task 0 result and the user-approved "proceed with caveats" decision: MuseScore-verified at tick precision incl. 1 tick; GP8 renders a 24-tick forward exactly but other sizes are unverified (documented, not gated). Reject with a **specific export error** only when a span is shorter than the finest supported written type (3 ticks / 64th at divisions=48) — whether between consecutive onsets or, for the last entry, between its onset and the barline (`measureTicks - startTick`; a final onset at tick 190 or 191 of a 192-tick bar has no representable written duration) — the one genuinely unrepresentable case — never an untyped note, a mismatched duration/type, or a fake rest. Verify forwards plus all advancing durations exactly equals `measureTicks`.
- [ ] Emit normalized tempo `<direction>` elements **exactly once, in order**, applying three boundaries: **leading gap** `[0, first.startTick)` before `<forward>`; **entry half-open spans** `[entry.startTick, next.startTick)` before the corresponding entry (offset omitted at the boundary, positive `<offset sound="yes">` only for interior ticks); and **measure end** `eventTick === measureTicks` **after** all advancing notes/rests at the barline, without an offset, **before** the next measure's directions. Normalization accepts `fraction === 1` and supplies an initial tick-zero event. Preserve the relative order when a previous measure's end and next measure's start represent the same absolute time. Include `<direction-type>` metronome and `<sound tempo>` in schema order.
- [ ] Add one concise **3-measure fixture** to `musicxml.test.ts`: 4/4 with bass/hi-hat chord; 3/4 with eighth-note triplet, rest and a tempo change at tick 72 inside a rest beginning at tick 48 (offset 24); 7/8 with stable expected durations.
- [ ] Inspect XML using existing jsdom `DOMParser` (`packages/common/vitest.config.ts` already uses jsdom): validate instrument references, per-measure advancing durations, distinct voices/chord semantics, meter changes, tuplets, tempo event offsets, escaping and off-grid onset timing. **Add three small focused writer regressions:** (a) a first entry starting at tick 1, with the normalized initial BPM emitted at tick 0 **before** the forward (and any leading-gap interior direction at its correct absolute tick), (b) a tempo event with `fraction: 1` serialized **after** the final advancing entry and **before** any next-measure tick-zero direction, without offset, and (c) a last entry whose span to the barline is below the finest written type (e.g. a final onset at tick 190 of a 192-tick measure) rejecting with the specific export error naming the measure and tick — the final-entry counterpart of the inter-onset < 3-tick rule — rather than emitting an unrepresentable note. Walk the output as a single MusicXML time cursor (including forwards, chords and direction offsets) to assert each event's reconstructed position, not only measure-duration totals.
- [ ] Use Vitest `await expect(xml).toMatchFileSnapshot('./__snapshots__/hpa690-sample.musicxml')`. This creates a human-importable snapshot, not a hand-written 200-line golden literal. Check it in, and do not automatically update snapshots without diff review.
- [ ] Run **once locally** with the official MusicXML 4.0 `musicxml.xsd`, `xml.xsd`, `xlink.xsd`, and **`catalog.xml`** downloaded as raw XML into the same temporary directory (`/path/to/musicxml-4.0/`). The XSD imports use absolute `http://www.musicxml.org/xsd/...` URLs; the catalog rewrites them to the local copies. Validate the actual checked-in snapshot using the exact command below; record success/failure and schema source, and do not skip merely because `DOMParser` succeeds:

    ```sh
    XML_CATALOG_FILES=/path/to/musicxml-4.0/catalog.xml xmllint --nonet --noout \
      --schema /path/to/musicxml-4.0/musicxml.xsd \
      packages/common/src/lib/notation/__snapshots__/hpa690-sample.musicxml
    ```

    Confirm `--nonet` does not report unresolved imports; failing to load the catalog or XSD is **not** exporter validation.

- [ ] **Before UI changes**, import this generated snapshot into the two apps where a working session is available; re-check the Task 0 assumptions. Record observations and mark unverified apps/criteria explicitly — unverified is an accepted documented state under the user-approved caveats decision, not a blocker.
- [ ] Export the writer from `packages/common/src/lib/index.ts`, run common tests/checks.

**Important:** Task 0 proved `<duration>` must equal the **effective written duration** — MusicXML nominally permits intended vs notated duration to differ, but both importers break on it (MuseScore recalculates from `<type>` and hard-fails; GP8 empties the measure). The gap between an entry's written duration and the next onset is carried by `<forward>` elements, not by a mismatched `<duration>` and not by a new rhythm engine.

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
- [ ] Import the same output via Guitar Pro 8 where a working GUI session is available (File > Import → MusicXML) and record what is actually observed — kick vs left kick sounds, cymbals/hi-hat, tempo playback, onsets. Expected documented caveats from Task 0: mid-bar tempo marks may be dropped or repositioned to bar start (observed on one encoding — timing-affecting, not just lossy), forward sizes other than 24 ticks are unverified, and `drum.group.set` tolerance is unverified. Mark unobserved criteria explicitly unverified; do not report passes that were not observed.
- [ ] Post specific results (apps/versions), unresolved defects and any unverified manual checks on PR #335. Do not label parser-only tests as proof of importer success.
- [ ] Keep the PR draft until required automated verification and agreed manual acceptance are complete.

## Acceptance matrix

| Scenario                        | Expected evidence                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simultaneous kick and left kick | Two `laneIds` and two MIDI instruments; one visual staff note                                                                                                                                  |
| Open/closed hi-hat              | Distinct `x` and `circle-x` and correct GM sounds                                                                                                                                              |
| 4/4 → 3/4 → 7/8                 | Proper `<time>` transitions and total advancing durations                                                                                                                                      |
| Triplet                         | 3:2 modifier, correct written type, first/last tuplet notation                                                                                                                                 |
| Mid-bar tempo                   | No offset at entry boundary, `sound="yes"` offset inside entry                                                                                                                                 |
| Leading gap + tick-zero tempo   | Direction before forward, proper absolute time and measure cursor; `<forward>` is the adopted encoding (MuseScore tick-exact; GP8 support beyond 24 ticks documented as unverified, not gated) |
| Barline tempo (`fraction: 1`)   | Direction after last entry with no offset; ordered before next measure start event                                                                                                             |
| 1-tick gap                      | Exact intended onset times in the MusicXML; no artificial untyped rest (MuseScore tick-exact verified; GP8 onset preservation at sub-24-tick sizes unverified — documented limitation)         |
| Export while level pending      | Button disabled; committed level is never misrepresented                                                                                                                                       |
| Ready export                    | Correct XML, Unicode-safe filename with committed level and successful download                                                                                                                |
| Error                           | Localized toast, preview remains usable                                                                                                                                                        |
| Regression                      | Existing quantizer, VexFlow, audio, seek and level-switch tests pass                                                                                                                           |
| Target app import               | Actual MuseScore 4 and Guitar Pro 8 observations recorded                                                                                                                                      |

## Explicitly outside HPA-690

The DTX-to-MIDI tool appears to map source `11`–`1C` lanes through `01`–`0C`-keyed maps, potentially falling back to MIDI note 60. It merits independent investigation/ticket if desired; **do not fix it in this PR**.

## References

- [MusicXML 4.0 percussion](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/)
- [MusicXML 4.0 offset](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/)
- [MusicXML 4.0 XSD](https://www.w3.org/2021/06/musicxml40/listings/musicxml.xsd/)
- [Vitest file snapshots](https://vitest.dev/guide/snapshot.html)
