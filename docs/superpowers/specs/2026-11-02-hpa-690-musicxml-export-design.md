# HPA-690 — MusicXML Drum Chart Export Design

**Date:** 2026-11-02  
**Status:** Draft for review  
**Linear:** [HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)  
**Repository:** DTXWeb  
**Target packages:** `@dtx/common`, `dtx-web`  
**Delivery:** One PR for this ticket. This documentation-only draft PR is the implementation PR; commit the eventual code and tests to this branch rather than creating another PR.

## Problem and user outcome

A published DTX chart can be previewed as drum notation but cannot be exported to standard notation applications. Add an **Export MusicXML** button to `/preview/[id]` so the currently displayed difficulty downloads as an uncompressed `.musicxml` file. Target importers are MuseScore 4 and Guitar Pro 8. No account, new endpoint, or storage is needed.

The user sees drum placement, noteheads, simultaneous drum hits, tempo changes, non-4/4 measures, and triplets. The export is a practical exchange format, not a pixel-identical clone of VexFlow.

## Current repository state

- `packages/common/src/lib/notation/model.ts` defines `NotationChart`, `NotationMeasure`, `NotationNoteEntry` (`keys: string[]`), `NotationTuplet` and `NotationTempoEvent`.
- `quantize.ts` builds a pure notation model from a selected `DTXFile`; `TICKS_PER_WHOLE = 192`. Its `byTick` map currently stores only a set of VexFlow staff keys, discarding original lane identity.
- `drumMapping.ts` maps playable DTX lanes to visual staff keys. Bass (`13`) and left bass (`1C`) both become `f/4`. Consequently the current model can merge simultaneous bass + left bass into one visual key.
- `timing.ts` already normalizes initial BPM and effective tempo changes; `NotationChart.tempoEvents` is available.
- `packages/dtx-web/src/routes/preview/[id]/+page.svelte` has `chart`, `title`, `artist`, `selectedFileUrl` and `committedFileUrl`. The displayed chart stays committed while an asynchronous level switch is pending.
- Existing tests: `packages/common/src/lib/notation/quantize.test.ts` and `packages/dtx-web/src/routes/preview/[id]/preview-page.test.ts`. The localized labels live in `src/lib/i18n/locales/en.json` and `jp.json`.
- A separate `dtx-to-midi` tool exists, but its `DEFAULT_LANE_NOTE_MAP` uses different lane identifiers (`01`…`0C`). Do **not** reuse that map for this export: the preview uses actual DTX lanes (`11`…`1C`).

## Decisions

| Area | Decision |
| --- | --- |
| Format | UTF-8, uncompressed, MusicXML 4.0 `score-partwise`, one `P1` drumset part |
| Location | Pure `exportNotationChartToMusicXml(chart, metadata): string` writer in `packages/common/src/lib/notation/musicxml.ts`; export from the existing common barrel |
| Dependencies | No new XML library, rendering package, backend or Cloudflare feature |
| Timebase | `<divisions>48</divisions>` per quarter = 192 ticks per whole; write existing integer `durTicks` directly |
| Voice | One rhythmic voice, stems up, a single advancing note per onset; additional simultaneous drums use `<chord/>` |
| Identity | Preserve source DTX lanes on each notation note entry; continue leaving existing VexFlow `keys` untouched |
| Sounds | One score/midi-instrument pair per playable lane present in the chart, MIDI channel 10 and `midi-unpitched = General MIDI drum pitch + 1` |
| Visuals | `<unpitched>` step/octave from `laneToStaff(laneId).key`; `/x2` = `x`, `/x3` = `circle-x`, other keys = normal |
| Meter | Derive from `measureTicks`, emit `<time>` on first measure or when changed |
| Tempo | Serialize every normalized `tempoEvents` entry as metronome `<direction>` and `<sound tempo>` at the correct position |
| UI | Local browser download for currently committed difficulty; no server calls during serialization |
| Delivery | The **same single PR** starts with docs and later acquires implementation and tests |

### Retain the DTX lane without changing rendering

Extend `NotationNoteEntry` with one required field:

```ts
interface NotationNoteEntry {
  kind: 'note';
  startTick: number;
  durTicks: number;
  keys: string[];     // unchanged VexFlow representation
  laneIds: string[];  // distinct playable DTX lanes at this onset
}
```

Replace `byTick: Map<number, Set<string>>` with a small onset accumulator keeping two sets: visual `keys` and `laneIds`. Append each non-empty playable lane before key deduplication; sort `laneIds` for deterministic XML. No extra general-purpose model or adapter. VexFlow still uses `keys` only; multiple drums sharing one staff position can now be exported as separate instrument sounds.

Update all existing notation entry fixtures/assertions in the same implementation commit as the required type change. Do not keep a compatibility fallback for omitted `laneIds`.

### Drum map and MusicXML shape

The serializer owns a small export-only table of drum **names + MIDI pitches**, keyed by DTX lane. Visual placement comes from the existing `laneToStaff` rather than being copied into a second mapping.

| DTX lane | Instrument | GM drum pitch | MusicXML midi-unpitched |
| --- | --- | ---: | ---: |
| `11` | Closed hi-hat | 42 | 43 |
| `18` | Open hi-hat | 46 | 47 |
| `1B` | Pedal hi-hat | 44 | 45 |
| `12` | Snare | 38 | 39 |
| `13` | Bass drum | 36 | 37 |
| `1C` | Left bass drum | 35 | 36 |
| `14` | High tom | 50 | 51 |
| `15` | Low tom | 48 | 49 |
| `17` | Floor tom | 43 | 44 |
| `16` | Crash | 49 | 50 |
| `1A` | Left crash | 57 | 58 |
| `19` | Ride | 51 | 52 |

Generate stable XML IDs such as `P1` and `I-11`. For each used lane, create `<score-instrument id="I-11">` and a matching `<midi-instrument id="I-11">` with `<midi-channel>10</midi-channel>`, `<midi-program>1</midi-program>` and `<midi-unpitched>43</midi-unpitched>`. Each note references the matching ID via `<instrument id="I-11"/>`. Use a percussion clef and a five-line staff. The `<notehead>` string is `x`, `circle-x`, or `normal`.

The writer escapes title/artist as XML text and supplies those values as movement metadata; it never injects raw DTX strings into XML markup.

The MusicXML 4.0 percussion tutorial documents the separate visual `<unpitched>` placement, per-instrument IDs, and **1-based** MIDI unpitched values: https://www.w3.org/2021/06/musicxml40/tutorial/percussion/ . Guitar Pro 8 may have different importer behavior; verify its interpretation against real playback rather than silently switching to 0-based values.

### Rhythmic serialization

- `divisions = TICKS_PER_WHOLE / 4 = 48`. One `NotationEntry` advances the voice by exactly `durTicks`. A chord of N drums still advances by **one** entry duration; N-1 notes carry `<chord/>`.
- Emit `<duration>` from `durTicks`. Map standard tick values 192/96/48/24/12/6/3 to whole/half/quarter/eighth/16th/32nd/64th note types.
- The current quantizer sometimes folds or drops a 1–2 tick off-grid rest for VexFlow. Export must not shift following onsets: traverse entries by `startTick`; if a gap appears before an entry or the barline, insert an exact-duration rest in the **writer only**. Assert the resulting advancing durations sum to `measureTicks` and never exceed it. For unusual non-standard durations, retain the exact `<duration>` and omit `<type>` when it cannot honestly be represented; do not invent an incorrect visible type or mutate preview quantization.
- `NotationTuplet { startIndex, count, slotTicks }` identifies entries in a 3:2 group. For each covered entry use a printed `<type>` corresponding to `slotTicks * 3 / 2`, its original `<duration>` equal to `slotTicks`, and `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`. Put `<notations><tuplet type="start|stop"/>` on the first/last entry of the group (on the first note of a chord). Rests inside a triplet remain triplet rests.
- For time signatures, pick the **largest note value** dividing `measureTicks` exactly: quarter=48, eighth=24, sixteenth=12, 32nd=6, 64th=3 ticks. Examples: `192 → 4/4`, `144 → 3/4`, `168 → 7/8`. Emit on the first measure and whenever the pair changes; fail with a clear export error for an unrepresentable bar rather than produce a misleading meter.
- For each tempo event in measure M, compute `eventTick = round(fraction * measureTicks)`. Emit a direction at the measure start with `<offset sound="yes">eventTick</offset>`, quarter-note metronome/per-minute, and `<sound tempo="..."/>`. The `sound="yes"` attribute is essential: without it the direction may appear at the right spot while playback applies the tempo at measure start. See https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/ .

Validate the XML element sequence against the MusicXML 4.0 schema, especially `<direction>` child order (`direction-type`, `offset`, `sound`), `<note>` ordering, and `<notations>` on triplet notes/rests. The writer does not build an abstract XML DOM, schema framework, or generic serializer.

### Preview UX

Place a localized **Export MusicXML** button in the existing preview header next to the difficulty selector. It is available whenever a chart is ready, independent of audio readiness. During a pending difficulty change (`selectedFileUrl !== committedFileUrl`), disable export so the selected label never disagrees with the committed chart being downloaded. Keep it disabled while the page is loading or unavailable.

On click: serialize the current `chart` and title/artist; create a UTF-8 XML Blob and trigger a native browser download named `<artist> - <title>.musicxml` (sanitize filename separators/control characters; allow Unicode). No navigation, API mutation, R2 write, or background process. Catch serializer/download errors and show a localized failure toast. Add keys `preview.export_musicxml` and `preview.export_musicxml_failed` in English and Japanese.

## Alternatives not chosen

1. **Export bass and left bass both as GM 36.** Less type churn but permanently loses an available source distinction and can erase a simultaneous double-pedal hit. Preserve lane IDs instead.
2. **Re-parse the DTX inside the serializer.** Duplicates preview work and couples a pure writer to parser/filesystem concerns. The committed `NotationChart` already has timing and can carry the narrow missing field.
3. **New MusicXML dependency or server exporter.** No need for package size, deploy, storage, or a new API contract for a straightforward deterministic text writer.
4. **Refactor the existing MIDI conversion tool.** It uses a different lane-numbering convention. This ticket must not expand into a converter redesign.

## Acceptance / verification

- [ ] Writer emits valid UTF-8 MusicXML 4.0 for one drum part, separate instrument IDs and correctly placed unpitched percussion notes.
- [ ] Kick + left kick at one onset export as two MIDI sounds even though the preview uses the same VexFlow key for both.
- [ ] Golden test contains a real chord, triplet (including a rest if convenient), 3/4 and 7/8 measures, initial BPM and a mid-measure change.
- [ ] Structural tests verify every exported measure's **advancing** durations (counting each chord once) sum to its `measureTicks`, including off-grid gaps, and all used instrument IDs resolve.
- [ ] Unit/UI test verifies the exported level is the currently committed chart, not a pending selection; covers disabled state, filename, error toast, and XML escaping.
- [ ] Existing VexFlow preview/seek/audio and quantizer tests still pass.
- [ ] Manually import a real DTX export into **MuseScore 4**: drum lines, noteheads, 3/4, BPM changes and triplets are correct.
- [ ] Manually import into **Guitar Pro 8** and listen/check drum sounds and tempos. Its current MIDI-unpitched interpretation is **not verified**. Only adjust mapping based on documented observed results.
- [ ] Run `bun run --cwd packages/common check`, `bun run --cwd packages/common test`, `bun run --cwd packages/dtx-web check`, `bun run --cwd packages/dtx-web test`, and targeted preview E2E where practical.

## Scope boundaries and risks

- One selected difficulty per download. No batch export, bundled `.mxl`, MusicXML import, persistent exports, backend changes, new permissions, time-signature editor, or score layout customization.
- The export is readable and musically useful, not engraving-identical: exotic off-grid quantization may look simplified in an importer despite correct onset timing. If validation exposes actual musical drift, fix the smallest test-proven case rather than implement a general rhythm notation system.
- No backwards-compatibility adapter for older in-memory note fixtures; update them in one PR.
- MusicXML importer quirks are an explicit manual acceptance dependency, especially Guitar Pro 8. Do not claim completion from a parser-only unit test.

## References

- [Linear HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)
- [MusicXML 4.0 percussion tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/)
- [MusicXML 4.0 direction offsets](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/)
- [Guitar Pro 8 import documentation](https://www.guitar-pro.com/docs/gp8/import-export/import)
