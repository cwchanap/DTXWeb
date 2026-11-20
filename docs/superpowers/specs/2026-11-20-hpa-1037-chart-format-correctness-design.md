# HPA-1037 — Chart format correctness: design

**Status:** Proposed design; documentation-only draft PR. Implementation, test evidence, and review fixes go on **this same PR**.
**Linear:** https://linear.app/cwchanap/issue/HPA-1037/dtxwebbug-fix-chart-formats-midi-tools-lf-parsing-and-one-setdef
**Plan:** [2026-11-20-hpa-1037-chart-format-correctness.md](../plans/2026-11-20-hpa-1037-chart-format-correctness.md)
**Baseline:** `main` at `59edbe86079a7dab8273a00126dbbbf16d41badf` (recheck after rebase).

## Problem and outcome

Fix the user-visible wrong-channel/invalid MIDI conversions, LF-only DTX parsing, and conflicting SET.def interpretations without introducing another chart model or framework.

Current facts from main:
- `chart/dtx.ts` maps MIDI drum notes against `01`–`0C` (DTX control/BGM channels), uses 4/4 positional ticks, serializes note-on immediately followed by note-off (negative next delta for simultaneous/nearby hits), and embeds a second MIDI reader.
- `midi-to-dtx/+page.svelte` offers editable drum mappings but passes none into the converter. `midi-preview/+page.svelte` has a separate SMF parser.
- `DTXFile.parseFromText` splits only on `'\r\n'`. `SimFile.parseHeader` handles only L1–L5 and truncates multiword labels/filenames; editor and API use separate, more capable SET.def readers. `SimFile.getHighestLevel` also assumes L1–L5.
- `notation/drumMapping.ts` already has correct lane/GM/staff data; `notation/timing.ts` provides `buildChartTiming` and normalization; `notation/quantize.ts` already prepares sticky channel-02 measure lengths and handles both channel-08 and legacy channel-03 tempo changes.
- Existing web Playwright suites: `packages/e2e-web/{dtx-to-midi,midi-to-dtx,midi-preview}.spec.ts`; existing public unit suites in common/web/API.

## 1. One playable drum-lane source of truth

Extend the existing pure `notation/drumMapping.ts` table rather than introduce a parallel registry. Keep the 12 playable DTX channels and existing notation attributes as the source for name, GM MIDI note, staff, editor color/icon frame/width; include any necessary display-order field. Control channels `01` (BGM), `02` (bar length), `03`/`08` (tempo) are **not** playable drums and are never emitted as note-ons.

| DTX lane | Instrument | GM note | DTX lane | Instrument | GM note |
| --- | --- | ---: | --- | --- | ---: |
| 11 | Closed hi-hat | 42 | 17 | Floor tom | 43 |
| 12 | Snare | 38 | 18 | Open hi-hat | 46 |
| 13 | Bass drum | 36 | 19 | Ride | 51 |
| 14 | High tom | 50 | 1A | Left crash | 57 |
| 15 | Low tom | 48 | 1B | Pedal hi-hat | 44 |
| 16 | Crash | 49 | 1C | Left bass | 35 |

Derive default DTX→GM and GM→DTX maps, notation lookup, Phaser lane rendering metadata, preview sprite ordering, preview audio drum inclusion, and both converter-page lane labels from this table. Keep **scene-specific presentation order and channel-01 BGM treatment** where needed; derive rather than duplicate their lane properties. Unknown/non-drum lanes are skipped with an explicit nonfatal diagnostic, never converted to note 60. Page mapping overrides remain user-editable, cloned from defaults, and passed to conversion.

Reuse `groupNotesByLane` already exported by common's notation code; remove the web duplicate. Reuse the existing common DTX filename validator; remove redundant check(s) only where semantics actually match (do not replace content validation with an extension-only check).

## 2. One MIDI implementation in common

Put MIDI read/write and public types in `packages/common/src/lib/midi/`, exporting small public functions (for example, `parseMidi`, `dtxToMidi`, `midiToDtx`). `DTXFile` retains DTX parsing/serialization and chart metadata, **not** MIDI binary parsing or writing. Reuse/adapt the existing MIDI preview parser rather than maintain two or introduce a full conversion framework. Preserve the preview page's current track, note, tempo, duration and channel display via shared parsed data.

**Supported input:** Standard MIDI format 0/1, PPQ ticks, delta-time VLQs, running status, note-on/note-off (including note-on velocity zero as off), tempo meta `0x51` and time-signature meta `0x58`. Handle other standard channel-message widths and bounded meta/sysex skipping without corrupting offsets; reject malformed/truncated input clearly. The parser may read multiple tracks, but DTX drum conversion flattens their absolute-time events; preserving track identity, velocities, instruments, and MIDI playback are out of scope.

**DTX→MIDI timebase:** Use 480 PPQ, 0-based channel 9 (GM drums), an initial tempo event and tempo changes. Share the existing DTX timing preparation feeding `buildChartTiming` (including sticky channel 02 and legacy channel 03), extracting a tiny pure helper from notation code if necessary rather than copying the rules. Map note/control positions to absolute ticks using cumulative **4 × PPQ × measureLength** plus fraction of that measure. Emit tempo changes at their actual tick. Tempo changes affect elapsed seconds, **not** tick position; check with `ChartTiming.positionToTime`. Emit MIDI time signatures at measure-length changes when representable; 3/4 → 4/4 is the required round-trip fixture. Keep unchanged 4/4 output simple. Explicitly reject an unrepresentable arbitrary DTX bar multiplier rather than silently claim a lossless round trip.

**MIDI→DTX timebase:** Merge input track events by absolute ticks, select drum-channel note-ons, map GM note→DTX channel using the page override, derive bar boundaries from the MIDI time signatures (4/4 default), and derive note fractions from per-bar tick lengths. Convert tempo events into base `#BPM` plus `#BPMxx` references on channel `08` and meter changes into channel `02` lines. Include this timing in actual downloaded DTX text, **not merely in ephemeral page state**. Reuse `buildChartTiming` to validate chart positions against the event tempo sequence, including mid-measure changes. Unsupported mid-bar meter changes should fail explicitly instead of shifting later notes silently. Round-trip target is the same drum lanes, hit ordering/simultaneity, absolute measure positions, and effective tempo/bar lengths, up to MIDI tick quantization (≤ one tick); original noteID/sample mappings are not carried through GM MIDI.

**Serialization:** Build an array of absolute-tick events (tempo, meter, note-off, note-on, end-of-track), sort by tick with stable tie ordering (note-off before note-on for same pitch), then encode nonnegative deltas from the **previous emitted absolute tick**. Explicit note-off durations may remain 1/16 note as existing behavior; do not let them alter following note-on deltas. Verify each note-on remains parseable, including simultaneous hits and closely spaced events. Keep existing DTX browser download wrapper while factoring a pure DTX text serialization path (or exposing an equivalent public API) so timing lines can be round-trip tested without DOM internals.

## 3. LF/CRLF and canonical SET.def parser

- Replace `DTXFile.parseFromText` line split with `/\r?\n/`; cover LF and CRLF copies containing header, BPM map, chip definition, notes, channel 02 and 08 events.
- Add one pure `parseSetDef(text)` in common, returning `{ title, levels: [{ level, label, fileName }] }` in numeric level order, with only complete LABEL/FILE pairs; accept space and colon delimiters, case-insensitive directives, all positive level indices, and full values containing spaces. Trim values; preserve filename content (including relative paths) at the parser boundary.
- Refactor `SimFile.parseHeader`, the editor `+page.server.ts` loader, and API `r2Enrichment.ts` to call the shared parser. Keep their respective file access/decoding/metadata shapes. R2 boundary still normalizes slashes, handles case-insensitive keys, resolves files relative to SET.def first, honors missing/claimed files, and consumes distinct files for duplicated labels in slot order. **Do not change** the native Rust `songs.rs` parser.
- Update `SimFile.getHighestLevel` to choose the highest parsed numeric level, not just L5. Preserve existing 1–5 default SET.def generation and include any actual levels above L5 on serialization; don't silently erase them.
- Remove only the genuinely duplicated note-group helper and DTX-content-detection checks. Fix stale Electron source-path comments touched by this work.

## Tradeoffs and non-goals

- Reuse current DTX parsing, timing normalization, Svelte pages, sample/notation mapping, and Playwright harness. No extra state store, new database schema, cloud infrastructure, extra PR, native feature, or backward-compatibility layer.
- No new UI art/SFX, major layout redesign, per-note velocities, multitrack preservation, or fully general odd-meter notation engine.
- Avoid green tests that only call private MIDI serializers; assert public binary and downloaded text behavior. No blanket deletion of unrelated tests.

## Acceptance contract

1. A chart with kick (13), snare (12), closed HH (11) and simultaneous kick+crash (16) exports readable MIDI with the exact GM drum notes on channel 9 and **all note-ons** present; a zero/negative delta is never serialized.
2. A GM MIDI import puts hits exclusively on expected DTX channels 11–1C. Changing the importer map changes the downloaded lane, not just UI state.
3. 3/4 → 4/4 change plus a mid-measure BPM change survive DTX→MIDI→DTX (and reparse) with hit measures/fractions within one MIDI tick and corresponding timing lines.
4. LF and CRLF DTX fixtures parse to equivalent title, BPM, notes, chip names, and timing inputs.
5. A mixed-colon/space SET.def with L6+, multiword labels/filenames and repeated labels is interpreted consistently by common, web editor metadata, and API R2 enrichment; one referenced chart per duplicate slot.
6. Existing converter and preview UI semantics remain intact. One **Playwright MCP** browser run exercises conversion and reimport on the web, with a screenshot showing mapping selection, readability and absence of new visual defects; no mockup attached to Linear, so visually check against the existing page layout.
7. A **MCP-driven backend end-to-end** request through the running local dtx-api Worker with seeded SET.def/chart R2 objects returns the correct distinct file URLs/labels; unit-only API parser tests are not sufficient. Web alone is sufficient for UI acceptance; no desktop-native acceptance needed.
8. Common/web/API unit tests, relevant type checks, web E2E, lint/format and affected CI pass on the implementation commit. This draft contains **documentation only**; acceptance is for later implementation on **this PR**.