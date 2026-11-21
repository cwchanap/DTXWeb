# HPA-1037 — Chart-format correctness: revised design

**Status:** Revised after the 2026-11-21 design review on PR #365. Documentation only; implementation, tests and fixes belong on **this same draft PR**.
**Linear:** https://linear.app/cwchanap/issue/HPA-1037/dtxwebbug-fix-chart-formats-midi-tools-lf-parsing-and-one-setdef
**Plan:** [Implementation plan](../plans/2026-11-20-hpa-1037-chart-format-correctness.md)
**Baseline:** `main` at `59edbe86079a7dab8273a00126dbbbf16d41badf` (rechecked during review).

## Why this is more than MIDI channel mapping

In addition to invalid drum channels and simultaneous note deltas, the shared import/export path loses chart data:

- `LaneMeasureNote.toPattern()` falls back to _four_ slots if an onset matches no grid among 4…192. Off-grid imported MIDI events can snap to the same slot and overwrite one another. Three snare hits at MIDI ticks 3, 487 and 500 in a 1920-tick bar currently become two quarter-grid hits.
- `DTXFile.export()` calls `toPattern()` for **all** lanes (including channel 02 decimal bar lengths) and omits `#BPMxx` declarations. The web editor saves using the same export, so this is not only a MIDI import issue.
- `DTXFile.parseFromText` uses `parseInt` for base BPM and matches `#BPMxx` as if it were the base `#BPM`; decimals and directive order fail.
- `SimFile.parseFromRemoteURLWithMetadata()` still iterates L1–L5 after the server has read higher SET.def slots, so the production editor can drop L6+.

## 1. Only consolidate **converter** drum defaults

Retain the correct canonical notation table in `packages/common/src/lib/notation/drumMapping.ts` and use its 12 DTX playable channels for _export_ (never control/BGM channels 01/02/03/08):

| DTX | Drum      | GM export | DTX | Drum       | GM export |
| --- | --------- | --------: | --- | ---------- | --------: |
| 11  | Closed HH |        42 | 17  | Floor tom  |        43 |
| 12  | Snare     |        38 | 18  | Open HH    |        46 |
| 13  | Bass drum |        36 | 19  | Ride       |        51 |
| 14  | High tom  |        50 | 1A  | Left crash |        57 |
| 15  | Low tom   |        48 | 1B  | Pedal HH   |        44 |
| 16  | Crash     |        49 | 1C  | Left bass  |        35 |

**Import is not an inverse mapping.** Add a small `GM_IMPORT_LANE` many-to-one alias table beside the existing drum table for commonly used GM alternatives, including 35/36 → main kick `13` (not left bass `1C` by default); 37/38/40 → snare `12`; 41/43/45/47/48/50 → floor/low/high tom; 42/44/46 → HH/pedal/open HH; and 49/51/52/53/55/57/59 → appropriate crash/ride/left crash lanes. Make this the source of the editable importer page defaults. Export still uses each DTX lane's own GM note; explicitly mapped exceptions remain possible through user overrides. Unknown notes/lanes produce nonfatal diagnostics, not a middle-C placeholder or control lane.

**Scope cut:** Do not change `BaseGame.ts` lane colors/icon frames/widths, `Preview.ts` spritesheet order, editor scene rendering or `previewAudioEngine.ts`'s already correct audio lane set. DTX lanes are fixed; their presentation data belongs in the scenes. Keep the converter page's `.dtx`/`.txt` validation because common's broader filename validator has different semantics. Delete only the duplicated `groupNotesByLane` helper and reuse the already exported common function.

## 2. Fix shared DTX parse + serialize first

- `parseFromText(text)` splits on `/\r?\n/`; base `#BPM` is matched with an exact directive boundary (not prefix matching `#BPM01`), parsed with `parseFloat` and validated as positive/finite. Per-ID BPM definitions keep their existing format.
- `LaneMeasureNote.toPattern()` defaults to the **finest grid (192)** if no coarser grid can represent all notes. This reduces accidental loss; arbitrary humanized MIDI still requires deliberate quantization. **Invariant:** onsets in `LaneMeasureNote.notes` are bar fractions in `[0, 1)`, so `midiToDtx` must construct each grouped drum lane with `measureLength = 1`, even in a 3/4 bar. Actual meter is stored separately as the channel-02 decimal map; passing `0.75` as `LaneMeasureNote.measureLength` would divide normalized positions by 0.75 and drop hits in the last quarter of that bar.
- Extract a pure **`toDtxText()`** from `DTXFile.export()`; keep `export()` as its browser download wrapper. The shared serializer owns chart metadata, patterns, **`#BPMxx` definitions and channel-08 references**, and **channel-02 decimal values**. Explicitly **skip `laneID === '02'` in the notes/pattern loop** and emit `#NNN02: <decimal>` solely from supplied measure lengths or `this.parseMeasureLengths()`; channel 02 is never sent to `toPattern()`. When writing extended BPM definitions from `parseBPMChanges()`, only emit keys matching a two-character BPM ID (never its base-`#BPM` entry under key `''`); base BPM is emitted exactly once. Preserve parsed controls on editor save, while MIDI conversion can supply new controls to the same serializer. Keep channel 01 and legacy channel 03 pattern handling where already supported. **Initialize `DTXFile.lines: string[] = []` for fresh `new DTXFile()` imports**, so control parsers and the pure serializer cannot call `.filter()` on `undefined`. No second exporter or new chart model.
- Add public parse/serialize and real editor export regression coverage, including exact decimal BPM and channel-02 text.

## 3. One small MIDI module and a required timing seam

Move MIDI parsing/encoding to `packages/common/src/lib/midi/`; exports are small public `parseMidi`, `dtxToMidi`, `midiToDtx` functions/types. Remove MIDI-only methods from `DTXFile` and the standalone parser in `midi-preview/+page.svelte`. Start from the preview parser: it already reads header lengths and channel-message widths more correctly than the DTXFile parser. Preserve existing preview track/note/tempo/duration display. Supported input: SMF 0/1, PPQ, VLQ/running status, note-on/off (including velocity-zero off), tempo `0x51`, meter `0x58`, and properly length-bounded meta/sysex skipping; clearly reject malformed input.

**Required small extraction:** `buildTimingInput(dtx): TimingInput` from `notation/quantize.ts`. It owns the existing channel-02 sticky length expansion and normalization of channel-08 BPM + channel-03 direct-hex tempo into noncolliding synthetic IDs. Both `buildNotationChart` and `dtxToMidi` call it; `dtxToMidi` passes it to `normalizeTempoEvents`. Do not run the notation engraver in conversion or fork these rules.

**DTX→MIDI:** 480 PPQ; drum MIDI channel 9 (zero-based); ticks from cumulative `4 × PPQ × measureLength` and each note's bar fraction; tempo only through `0x51` messages, not tick arithmetic. Emit `0x58` when a meter is representable (required 3/4 → 4/4 fixture). For unusual DTX bar multipliers, e.g. `0.96`, **preserve absolute note ticks and warn nonfatally** when meter metadata must be approximated or omitted; do not reject an otherwise exportable chart. Reimport then guarantees hit timing but not those unsupported bar boundaries. Build absolute-tick events first, sort (control changes, note-off before same-pitch note-on at identical ticks, all simultaneities retained), then delta encode from the previously **emitted tick**, never prior note-off duration.

**MIDI→DTX:** Merge note-on absolute ticks from all tracks, filter MIDI drum channel 9, use import aliases/current editable override, derive bar boundaries from meter changes (4/4 default), and scale from original PPQ. Explicitly quantize positions to the nearest **1/192 of the bar**, even for off-grid/non-480 PPQ notes; count/report hits that collide on one lane/slot, and unknown/unmapped notes. Preserve effective tempo via base `#BPM`, `#BPMxx` and channel `08`; preserve representable bar lengths using decimal channel `02`, all in the **downloaded text**. Reject unsupported mid-bar meter changes instead of shifting later hits. Recompute conversion at download with the current user map (no stale state flag).

**Tool UI behavior:** Replace the DTX-to-MIDI page's hardcoded `01`–`0C` drum-label conditional with names from `laneToStaff()` so correct `11`–`1C` rows don't become `Unknown`. Replace the MIDI-to-DTX page's hardcoded `01`–`0C` labels and `availableLanes` with `PLAYABLE_DRUM_LANES` / `laneToStaff()`; show GM aliases from `GM_IMPORT_LANE`, not a second stale name mapping. Retain the **parsed `ParsedMidi` in page state** after upload/Convert and recompute from those parsed events (rather than parsing the uploaded file again) at download with the current mapping. Reflect actual note counts by summing each `LaneMeasureNote.notes.length`, **not** the number of measure groups. Read the MIDI-detected initial tempo even if it is exactly 120 BPM; preserve later tempo events, and apply a user's BPM edit intentionally to the initial tempo without overwriting the converted tempo map with stale `DTXFile.bpm` state.

**Precision contract:** DTX-origin on-grid events survive representable DTX→MIDI→DTX without unexpected loss. MIDI-origin off-grid notes are within **half a 1/192-bar slot** unless multiple same-lane hits collide in one slot (explicit diagnostic). The old ≤one-MIDI-tick tolerance is impossible at this DTX resolution. Comparing `ChartTiming.positionToTime` against MIDI-derived seconds is a **test assertion**, not runtime validation.

No per-note velocity preservation, original sample IDs, multitrack reconstruction, or general-purpose complex meter engine.

## 4. One server-safe SET.def parser and all production callers

Create pure `parseSetDef(text)` with sorted complete `{ level, label, fileName }` slots and title. Accept space/colon directives, case-insensitive keys, LF/CRLF, levels >L5, multiword labels/filenames; leave path normalization to consumers. Expose from:

- **`@dtx/common/encoding`**, which has no Svelte/browser imports and is safe for dtx-api;
- the common main barrel for web/client callers.

Update **all** uses, not just three parsers:

1. `SimFile.parseHeader` iterates parsed slots.
2. `SimFile.parseFromRemoteURLWithMetadata` iterates **actual metadata keys** (not L1–L5), so the real editor loads L6+.
3. `SimFile.getHighestLevel` chooses the highest **present** numeric slot; `generateDefFileContent` retains populated >L5 slots and existing L1–L5 defaults.
4. Web editor `+page.server.ts` and API `r2Enrichment.ts` call the shared parser; preserve their existing shapes and I/O. In R2, keep duplicate-label queues in numeric L-slot order, sibling-directory-first and case-insensitive resolution, claimed/missing semantics, and normalized slashes.

Rust desktop `songs.rs` remains untouched; it currently caps levels at **1–9**, intentionally different from common's positive level parser. Fix stale Electron path comments, but don't change unrelated file validators.

## End-to-end contract and non-goals

- Exports of kicks (13), snares (12), HH (11), crashes (16) have correct GM notes and all simultaneous hits with parseable nonnegative MIDI deltas.
- On-grid representable 3/4→4/4 + mid-bar BPM changes survive file round-trips. Nonrepresentable DTX meter preserves hit ticks with a warning. Off-grid/non-480 PPQ input retains all distinct 1/192 slots and reports collision losses.
- Editor save and MIDI import download preserve decimal base BPM, per-ID BPM and channel 02 decimal values, even from a freshly constructed `DTXFile` and with base `#BPM` present in `parseBPMChanges()`. Channel-02 measure values are written only once as decimals and never as note patterns; base `#BPM` appears once, followed by valid two-character `#BPMxx` definitions. A hit at fraction 0.875 in a 3/4 bar survives. GM aliases and user mapping overrides change **downloaded** data.
- LF and CRLF DTX copies match. Mixed SET.def with L6+, spaces and duplicate labels works in local SimFile, web editor metadata, **remote editor**, and API R2.
- Converter mapping UI displays real `11`–`1C` lane labels, editable choices and correct hit counts; the parsed-MIDI state is reused for download-time mapping updates, and tempo 120 handling doesn't discard other tempo changes. Focused public-API/unit/editor tests, existing converter download/reparse Playwright tests, API mock-bucket tests, and affected CI pass.
- **Project acceptance:** one MCP-driven web conversion session with a screenshot visually checked against current UI (no Linear mockup), plus an MCP-driven live Worker/R2 request using the existing E2E seed harness. Reuse existing Playwright and local stack; no redundant harnesses, new screenshots committed to Git or human acceptance. Native verification unnecessary without native changes.

No Phaser/audio/UI redesign, art/SFX, DB migrations, Cloudflare infrastructure work, backward-compatibility layer, second PR or general MIDI framework. These criteria are **not complete** on this documentation-only draft.
