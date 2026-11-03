# HPA-690 — MusicXML Drum Chart Export Design

**Date:** 2026-11-02  
**Status:** Draft, revised after GitHub design review  
**Linear:** [HPA-690](https://linear.app/cwchanap/issue/HPA-690/export-dtx-drum-charts-to-musicxml-for-musescore-and-guitar-pro)  
**Delivery:** One PR for design, implementation and tests. This documentation-only draft PR becomes the implementation PR; no second PR.

## Goal and boundaries

Add **Export MusicXML** to the read-only `/preview/[id]` page. The currently displayed drum difficulty downloads as an uncompressed UTF-8 MusicXML 4.0 (`.musicxml`) file that can be imported into MuseScore 4 and Guitar Pro 8.

Reuse the existing notation/timing model, without a new dependency, backend, storage, GraphQL endpoint, Cloudflare job or standalone tool. The intended exchange preserves drum sounds, chord onsets, staff positioning, open/closed hi-hat noteheads, 3:2 tuplets, bar lengths and effective tempo changes. Exact VexFlow layout is not a goal.

## Existing boundaries

- `packages/common/src/lib/notation/model.ts` defines `NotationChart`, `NotationMeasure`, `NotationNoteEntry`, `NotationTuplet` and `NotationTempoEvent`; `TICKS_PER_WHOLE = 192`.
- `quantize.ts` currently collapses playable DTX lanes into visual `keys: string[]`. Bass (`13`) and left bass (`1C`) share the same `f/4` key and can be merged.
- `drumMapping.ts` is already the authoritative playable lane-to-staff mapping through `laneToStaff()`.
- `NotationView.svelte` is the only production reader of `entry.keys`: it passes the array to VexFlow. It can derive those keys from actual source lane IDs instead.
- `timing.ts` already supplies normalized `chart.tempoEvents`. The preview page owns `chart`, `title`, `artist`, `levels`, `selectedFileUrl` and `committedFileUrl`.
- `packages/dtx-web/src/lib/api/download.ts` already implements a Blob-to-download-anchor helper. Reuse that rather than creating another.
- The separate DTX-to-MIDI tool and `DTXFile.getMidiNoteNumber` use lane IDs `01`–`0C` rather than notation lanes `11`–`1C`; do not reuse those maps in this task.

## Confirm importer semantics early (Task 0)

Before committing to the model/writer encoding, construct a small **schema-valid** reference `.musicxml` file directly (without the exporter or UI) and import it into both target apps. Include:

1. Simultaneous `13` bass + `1C` left bass: two instrument IDs on the same `F4` staff position; listen for separate GM sounds.
2. A tempo change in the middle of a measure: compare a direction placed at an entry boundary (no offset) against one inside a rest (positive offset with `sound="yes"`).
3. An off-grid one-tick gap: compare the intended `<duration>` vs the visual `<type>` and confirm onset timing.
4. If possible, a small triplet example with a rest.

Record **observed** app/version/results or explicitly `unverified` in this PR. Do not assume Guitar Pro 8 handles `<midi-unpitched>` or direction offsets the same way as MuseScore. Use MusicXML 4.0 semantics as the default and adjust only from a reproduced failure. If apps are unavailable, continue standards-based implementation but do not claim either importer acceptance.

## Core decisions

| Area | Decision |
| --- | --- |
| Writer | Pure `exportNotationChartToMusicXml(chart: NotationChart, metadata: {title: string; artist?: string}): string` in `@dtx/common` |
| XML | MusicXML 4.0 `score-partwise`, one percussion `part`/voice; `<divisions>48</divisions>` per quarter |
| Model | **Replace** `NotationNoteEntry.keys` with required `laneIds: string[]`; no parallel visual/source arrays, no compatibility adapter |
| Staff + MIDI map | Extend each existing `DrumStaff` row with `midi` (GM pitch) and a readable `instrumentName`; keep existing `key` and short `name` |
| VexFlow | Derive unique visual keys with `laneIds.map(laneToStaff).map(staff => staff.key)`, deduplicating keys in order |
| Chords | One advancing note at an onset; remaining distinct lanes emit `<chord/>` |
| Meter | Derive from `measureTicks`; emit `<time>` initially and on change, error on unrepresentable lengths |
| Tempo | Emit directions inline in the measure stream; avoid offsets on entry boundaries, use positive offset + `sound="yes"` only within an entry |
| Irregular timing | Derive the advancing duration from consecutive entry `startTick` values, never insert artificial 1–2-tick rests; use `<forward>` for otherwise missing initial timing only if verified |
| Download | Reuse exported `triggerBrowserDownload` from `$lib/api/download`; include the **committed** difficulty in the filename |
| Tests | Focused structural tests via existing jsdom `DOMParser`, one Vitest file snapshot, one manual XSD validation, three page tests and one Playwright download check |

### Replace VexFlow keys with source lane IDs

```ts
export interface NotationNoteEntry {
  kind: 'note';
  startTick: number;
  durTicks: number;
  laneIds: string[]; // distinct, sorted playable DTX lanes at this onset
}
```

In `quantize.ts`, collect `Set<string>` of playable lane IDs per onset; no intermediate VexFlow keys. Continue ignoring non-playable lanes and `noteID === '00'`, and keep the existing start/duration, rest and triplet logic unchanged. Only the shape of note entries changes.

In `NotationView.svelte`, use `Array.from(new Set(entry.laneIds.map(id => laneToStaff(id)!.key)))` when creating a `StaveNote`. That reproduces the existing visual result: open/closed hi-hats remain separate; kick/left kick share one visible notehead but retain two exported MIDI sounds. Update typed fixtures and exact expectations together with the model change; do not maintain legacy `keys` support.

### Single drum map

Add `midi: number` and `instrumentName: string` to `DrumStaff` in `drumMapping.ts`. Preserve its existing `key` and short display `name`. Use the same entry for visual position, MusicXML instrument name and GM pitch.

| Lane | Drum | GM MIDI pitch | MusicXML midi-unpitched |
| --- | --- | ---: | ---: |
| `11` | Closed hi-hat | 42 | 43 |
| `18` | Open hi-hat | 46 | 47 |
| `1B` | Pedal hi-hat | 44 | 45 |
| `12` | Snare | 38 | 39 |
| `13` | Bass | 36 | 37 |
| `1C` | Left bass | 35 | 36 |
| `14` | High tom | 50 | 51 |
| `15` | Low tom | 48 | 49 |
| `17` | Floor tom | 43 | 44 |
| `16` | Crash | 49 | 50 |
| `1A` | Left crash | 57 | 58 |
| `19` | Ride | 51 | 52 |

For each **used** lane emit matching stable `score-instrument`/`midi-instrument` IDs (`I-11`, etc.) in one `score-part id="P1"`; notes reference them with `<instrument id="I-11"/>`. Set `<midi-channel>10</midi-channel>`, `<midi-program>1</midi-program>` and **1-based** `<midi-unpitched>` per MusicXML spec. Use five-line percussion clef, `<unpitched><display-step>...` and `<display-octave>...` from the existing key. `/x2` → `<notehead>x</notehead>`; `/x3` → `circle-x`; other keys → normal. XML-escape all metadata and text.

### Timing and musical encoding

- `divisions = TICKS_PER_WHOLE / 4 = 48`. Process entries in ascending `startTick`. For entry i, the **advancing** `<duration>` is `nextEntry.startTick - entry.startTick`, or `measure.measureTicks - entry.startTick` for the last. For a chord, all notes carry that duration, but only the first advances the cursor.
- Visual `<type>` uses `entry.durTicks` (or the tuplet written base `slotTicks * 3/2`), with the existing preview-style largest representable value not exceeding that length. Unusual off-grid values can make `duration` and `type` differ by 1–2 ticks; MusicXML permits intended vs notated duration to differ, **but importer behavior must be checked in Task 0**. Never emit an untyped 1–2-tick rest to paper over this.
- Validate strictly increasing entry `startTick`, positive advancing durations, and the measure total. Normal quantization starts at tick 0, but its sub-3-tick rest handling can leave a **leading gap**. When `first.startTick > 0`, emit tempo directions within `[0, first.startTick)` **before** `<forward><duration>first.startTick</duration></forward>`: the tick-zero direction has no `<offset>`, later leading-gap directions use a positive offset relative to cursor 0. A direction exactly at `first.startTick` follows the forward. Use `<forward>` only after the Task 0 importer spike confirms it; if unsupported, reject that leading-gap chart with a clear export error rather than inventing an untyped rest. The forward plus all advancing note/rest durations must total `measureTicks`.
- `NotationTuplet` startIndex/count/slotTicks signals 3:2. Emit actual duration from the computed advancing span, `<time-modification>` with 3 actual/2 normal and written `<type>` for `slotTicks * 3/2`; put tuplet start/stop on first/last tuplet entry, on first note of a chord (or rest). Test that usual aligned triplet spans match `slotTicks`.
- Choose the largest exact tick unit from quarter 48, eighth 24, 16th 12, 32nd 6, 64th 3; examples `192 → 4/4`, `144 → 3/4`, `168 → 7/8`. Fail on bar lengths these units cannot represent instead of inventing a meter.
- For each normalized tempo event, compute `eventTick = round(fraction * measureTicks)` and emit it exactly once in sorted order. **Boundary policy:** (1) `0 <= eventTick < first.startTick`: before the leading forward as above, with no offset at tick 0 and a positive `<offset sound="yes">eventTick</offset>` otherwise; (2) `first.startTick <= eventTick < measureTicks`: immediately before the entry whose **half-open** span `[entry.startTick, next.startTick)` contains it, omitting the offset at the entry start or using `<offset sound="yes">eventTick - entry.startTick</offset>` for an interior event; (3) `eventTick === measureTicks` (including a normalized `fraction === 1`): **after** the final advancing note/rest, when the measure cursor is at the barline, emit `<direction>` with **no offset** before the next measure begins. Preserve ordering relative to a separate next-measure tick-zero direction at the same absolute time; reject events outside `[0, measureTicks]`. Directions include the metronome mark and `<sound tempo="..."/>` in schema order. A positive offset affects playback only with `sound="yes"`.
- For malformed/inconsistent entry or tempo positions, fail with a precise message; do not silently shift notes or expand this feature into a general rhythm engine.

### Preview action

Add a localized button in the existing `status === 'ready' && chart` header, next to the level selector. It is naturally absent when loading/error; it does **not** depend on audio readiness. Disable only while `selectedFileUrl !== committedFileUrl` so a pending selection never exports the previously committed notation under the new label.

On click: serialize the current `chart`, build a UTF-8 `.musicxml` Blob and pass it to the existing download helper (rename/export `defaultTriggerBrowserDownload` as `triggerBrowserDownload`). Filename:

```text
<artist> - <title> (<committed level label>).musicxml
```

Look up the level label through `levels.find(level => level.fileUrl === committedFileUrl)`, **not** `selectedFileUrl`. Sanitize path separators/control characters and preserve Unicode. Add `preview.export_musicxml` and `preview.export_musicxml_failed` in `en.json`/`jp.json`; catch errors and toast without navigating or modifying the chart. Use only the existing download utility; do not add a fifth copy of the Blob/anchor code.

### Verification and acceptance

- [ ] Early hand-authored import spike records observed MuseScore 4 / Guitar Pro 8 support (or says unverified).
- [ ] Note model has only `laneIds`, VexFlow derives identical visual keys, and bass + left bass produces **two different MIDI instrument IDs**.
- [ ] Writer output is MusicXML 4.0 with one part/voice, correct GM pitches + 1, valid note order, XML escaping, chords, hi-hat heads, meters, triplets and tempo changes.
- [ ] `DOMParser` tests assert musical invariants; a dedicated `toMatchFileSnapshot('./__snapshots__/hpa690-sample.musicxml')` fixture is human-importable. Include **leading forward + tick-zero BPM** and **fraction-1 / barline BPM** writer regressions: inspect direction ordering, reconstructed event positions, and cursor positions as well as summed durations. Do not hand-maintain an enormous inline golden XML literal.
- [ ] Run a **required one-off offline validation** with the official MusicXML 4.0 `musicxml.xsd`, `xml.xsd`, `xlink.xsd` and **`catalog.xml`** stored together locally: `XML_CATALOG_FILES=/path/to/musicxml-4.0/catalog.xml xmllint --nonet --noout --schema /path/to/musicxml-4.0/musicxml.xsd packages/common/src/lib/notation/__snapshots__/hpa690-sample.musicxml`. The catalog maps the XSD's absolute `http://www.musicxml.org/xsd/` imports to those local files; co-locating the XSDs alone does **not** resolve imports. Record the result. A DOM parse alone is insufficient.
- [ ] Three page tests: pending switch disables export; ready click passes committed chart and difficulty filename; writer failure shows localized toast. Existing switch/load tests remain intact.
- [ ] One Playwright export check uses `page.waitForEvent('download')` (not the Python-only `page.expect_download`).
- [ ] Run `bun run --filter=@dtx/common check`/`test` and `bun run --filter=dtx-web check`/`test` plus affected browser E2E. Confirm existing preview playback and seek behavior remain unchanged.
- [ ] Manually import a real chart into both target apps and verify sound/time notation, recording any unverified importer requirement honestly.

## Non-goals and follow-up note

No MusicXML import, batch export, `.mxl` compression, separate score builder, new music theory abstractions or broad DTX MIDI converter refactor. The currently separate DTX-to-MIDI tool appears to use incompatible lane numbering; this may warrant its own future task but is **outside HPA-690**.

## References

- [MusicXML 4.0 percussion tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/percussion/)
- [MusicXML 4.0 duration element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/)
- [MusicXML 4.0 direction offset](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/offset/)
- [MusicXML 4.0 XSD](https://www.w3.org/2021/06/musicxml40/listings/musicxml.xsd/)
- [Vitest file snapshots](https://vitest.dev/guide/snapshot.html)
