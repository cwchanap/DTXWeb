# HPA-1037 — Chart-format correctness: single-PR implementation plan

**Status:** Implementation and tests are on PR #365; bot review findings are triaged and confirmed fixes land on the **same PR**. Playwright MCP web and MCP Worker acceptance runs are reported complete on the PR; type/lint/CI gates remain open until verified.
**Linear:** https://linear.app/cwchanap/issue/HPA-1037/dtxwebbug-fix-chart-formats-midi-tools-lf-parsing-and-one-setdef
**Design:** [Revised specification](../specs/2026-11-20-hpa-1037-chart-format-correctness-design.md)
**Baseline:** `main` at `59edbe86`, rechecked on review day. HPA-1039 remains independent and has overlapping typo renames; PR #364 has unrelated type-error fixes. Rebase when one lands.

## Reduced change surface

| Work                     | Source files (examples)                                                                                                        | Keep out of scope                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Shared chart bugs        | `common/src/lib/chart/{dtx,note,simFile}.ts`; new `chart/setDef.ts`; `common/src/lib/{encoding,index}.ts`                      | Other file-format rewrites                                          |
| Chart timing / MIDI maps | `common/src/lib/notation/{quantize,drumMapping}.ts`, a small exported `buildTimingInput` helper                                | `BaseGame`, `Preview` sprite order, editor visuals, audio lane sets |
| MIDI                     | New `common/src/lib/midi/`; remove binary MIDI methods in `chart/dtx.ts`; remove duplicate preview parser                      | Separate MIDI framework, per-track output                           |
| Pages                    | `dtx-web/src/routes/(tool)/tool/{dtx-to-midi,midi-to-dtx,midi-preview}/+page.svelte` and `dtx-to-midi/midi-helpers.ts`         | New UI, validation semantics changes                                |
| SET.def callers          | `common/src/lib/chart/simFile.ts`, web editor `+page.server.ts` and API `src/services/r2Enrichment.ts`                         | Native Rust `songs.rs`                                              |
| Regression/E2E           | Common/public unit tests, editor-path test, API `r2Enrichment.test.ts`, existing `e2e-web` converter specs + fixture generator | New test harnesses, screenshot files committed to Git               |

Only one PR, no separate implementation ticket/PR, no art/SFX work. Suggested commit order below is **within** this PR.

## Work order

### 1 — Fix LF and SET.def first; verify the actual editor path

1. Fix `DTXFile.parseFromText` splitting to `/\r?\n/`. Parse base BPM via `parseFloat` and match exact `#BPM`, not `#BPMxx`; validate finite, positive BPM. Test LF/CRLF equivalence with headers, sound chips, drum notes, channel-02 change and BPM definitions, plus `#BPM01` appearing **before** decimal `#BPM`.
2. Add pure `parseSetDef` in `chart/setDef.ts` (space/colon, case-insensitive, full labels/file paths, numeric positive L slots, complete pairs only). Re-export it from **`@dtx/common/encoding`** for SSR/API and the main barrel for web. Do **not** make dtx-api import the Svelte-dependent main barrel.
3. Switch `SimFile.parseHeader`, web editor `+page.server.ts`, and `r2Enrichment.ts` to it; keep R2 label→file queues, numeric slot order, duplicate labels, missing-file/claimed rows, sibling path and case-insensitive resolution. Fix the touched obsolete Electron comment.
4. Also update the _live editor's_ `SimFile.parseFromRemoteURLWithMetadata` to iterate `Object.keys(metadata.levels)` rather than L1–L5; update `getHighestLevel` (maximum present numeric key) and `generateDefFileContent` (retain L6+, default L1–L5 behavior). Rust's 1–9 slot limit is deliberately unchanged.
5. Public tests: `parseSetDef`, `SimFile.parseHeader`/remote metadata/highest/serialization, editor page metadata load, `discoverCatalogFiles` with duplicate labels and a claimed missing file. Assert the remote editor reaches L6+, not merely that the server parses it.

### 2 — Repair the shared DTX writer before importing MIDI

1. In `LaneMeasureNote.toPattern()`, choose 192 slots when no grid fits, **not 4**. Preserve its existing smallest exact grid for on-grid notes. **The `LaneMeasureNote` position contract is `[0,1)` within a bar with `measureLength = 1` for MIDI imports, including 3/4; the actual meter must stay only in the separate channel-02 length map.** Test three off-grid snare events near ticks 3/487/500 of a 1920-tick bar and one note at fraction `0.875` in a 3/4 bar; no quarter-note fallback or last-quarter note loss.
2. Refactor `DTXFile.export()` into pure `toDtxText()` + the existing browser download wrapper. Accept parsed/editor controls or explicit MIDI-import controls: persist base/extended `#BPM` definitions and channel-08 reference patterns. **Skip `laneID === '02'` when iterating `notes`** and emit `#NNN02: <decimal>` **only** from supplied measure lengths or `this.parseMeasureLengths()`. The existing `parseBPMChanges()` exposes the base `#BPM` under key `''`, so emit extended `#BPMxx` declarations only for valid two-character IDs, with exactly one base `#BPM` line. **Initialize `DTXFile.lines: string[] = []`** so a fresh instance used for MIDI import can call its control parsers and serializer safely. Keep existing BGM/legacy patterns; do not invent a second DTX text writer.
3. Regression test **editor save/export** through the public export path using a chart with decimal `#BPM: 145.5`, a `#BPM01` definition and channel `#00102: 0.75`; download/reparse text to verify each survives. Ensure no `0.007500` artifact, duplicate base `#BPM:` lines, or channel-02 pattern output. Test `toDtxText()` with a brand-new `new DTXFile()` and explicit import control data (no uninitialized `lines` access).

### 3 — Extract chart timing input and add import aliases

1. Extract **`buildTimingInput(dtx): TimingInput`** from `buildNotationChart`'s existing measure-length and BPM-change preparation. Make `buildNotationChart` call it. Keep channel-02 sticky behavior and channel-03 direct-hex BPM distinct from same-ID channel-08 references. This is mandatory; `ChartTiming` alone does not expose measure lengths.
2. In `drumMapping.ts` use existing lane→GM data for export and add `GM_IMPORT_LANE` with common many-to-one aliases (including note 35 → main bass `13`, rim/snare 37/40, alternate toms 41/45/47, cymbals 52/53/55/59). Export the mapping for importer defaults and user options. Control channels never become playable drums; return diagnostics for unmapped notes.
3. Unit tests for representative alias families, 12 canonical export lanes and timing-input equivalence. **Do not** change Phaser lane presentation, sprite order, audio lanes or either page's unrelated file-extension validation.

### 4 — Shared MIDI parser, writer and explicit quantization

1. Move the existing _preview_ parser's useful logic into `common/src/lib/midi/` with a stable public parsed representation; replace `DTXFile`'s MIDI parser and preview's local parser. Parse SMF 0/1/PPQ, note on/off/velocity-zero off, meta tempo/meter, VLQ, running status and variable command widths; skip sysex safely; reject malformed/truncated bytes. Keep preview metadata UI unchanged.
2. `dtxToMidi`: calculate absolute note ticks from cumulative `4×480×measureLength` and normalized tempo events from `buildTimingInput`. Emit GM channel 9 notes (real DTX 11–1C), tempo and representable meter events; keep hit **tick positions** correct for unsupported DTX meter values like 0.96 and surface a **nonfatal warning** rather than aborting export. Sort absolute events then encode nonnegative delta VLQs, including simultaneous/adjacent hits.
3. `midiToDtx`: flatten drum-channel note-ons across tracks using input PPQ and meter changes, apply editable GM aliases, then quantize to **1/192 of each measure**. Construct `LaneMeasureNote` groups with **`measureLength = 1`** and `[0,1)` fractions even in 3/4; pass actual meter exclusively through the separate decimal channel-02 map. Count/report same-lane same-slot collisions and unmapped MIDI notes; these are nonfatal, visible diagnostics. Reject unsupported _mid-bar_ meter changes. Output grouped drum notes **plus** tempo refs, base BPM and decimal measure-length controls consumable by `toDtxText`.
4. Round-trip tests using a **non-480 PPQ, humanized/off-grid fixture** added to `e2e-web/fixtures/create-test-midi.ts`. Validate within **half a 1/192-bar slot** for MIDI-origin events, while representable DTX-origin events stay exact. Where cells collide, assert the reported count (not an impossible no-loss guarantee). Validate time-domain `ChartTiming.positionToTime` vs MIDI seconds **in tests only**. Assert all tempo/meter lines are in the downloaded DTX text; no private-member tests.

### 5 — Wire the three existing web tools and committed E2E

1. `dtx-to-midi` calls shared conversion and editable DTX→GM map. Remove duplicated `groupNotesByLane` from its helper; reuse common. Preserve the page's `.dtx`/`.txt` validator. **Replace its hardcoded `01`–`0C` instrument-name conditional in the mapping rows with `laneToStaff(lane)?.instrumentName`** (or the table's existing name), so the corrected `11`–`1C` keys don't display `Unknown`.
2. `midi-preview` consumes the shared parsed MIDI representation while retaining its summary/track/tempo UI.
3. `midi-to-dtx` seeds editable rows from `GM_IMPORT_LANE` and uses **`PLAYABLE_DRUM_LANES` / `laneToStaff()`** for selector options/labels instead of hardcoded `01`–`0C` labels, available lane IDs or duplicate GM names. **Retain `ParsedMidi` in page state after the initial parse**; at download recompute conversion from that cached parsed data and the _latest_ mapping, without re-parsing the uploaded file or serving stale notes. Keep displayed note count accurate by summing each grouped `LaneMeasureNote.notes.length`, not the number of lane/measure groups; refresh the summary when conversion/mapping changes. Populate the editable base BPM from MIDI even when the detected value is exactly 120, and let user edits intentionally override base BPM **without discarding later tempo changes**. Preserve metadata fields and show nonfatal collision/unmapped/meter warnings.
4. Upgrade **existing** `packages/e2e-web/{dtx-to-midi,midi-to-dtx,midi-preview}.spec.ts`: save real downloads and reparse their bytes/text, not just assert a filename or toast. Verify GM aliases, a lane override changed **after Convert but before Download**, simultaneous hits, a late-bar 3/4 note, 3/4→4/4 + mid-bar BPM and the humanized/non-480 PPQ case. Verify displayed mapping rows contain correct drum labels rather than `Unknown`, available lanes are exclusively playable drum channels, the note-count summary equals parsed note hits (not measure groups), and base MIDI tempo 120 plus a later tempo change survives download. Extend existing API `r2Enrichment.test.ts` with mock bucket duplicate/missing checks; no new test framework or repetitive large test suite.

### 6 — CI and lean MCP acceptance on this same PR

Run the relevant package checks against the **implementation commit**:

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/common build
bun run --filter=@dtx/common test
bun run --filter=dtx-web test
bun run --filter=dtx-api test
bun run --filter=@dtx/common check
bun run --filter=dtx-web check
bun run --filter=dtx-api check
bun run --filter=dtx-e2e-web check
bun run --filter=dtx-e2e-web e2e -- dtx-to-midi.spec.ts midi-to-dtx.spec.ts midi-preview.spec.ts
bun run lint
bunx prettier --check .
```

Keep the changed-package CI gates green after moving **this same PR** out of draft when ready. Avoid fresh CI workflows or coverage gates.

**MCP-driven end-to-end acceptance — reuse existing work, no ceremony:**

- **One Playwright MCP web session**, after code changes, exercises the real hydrated `/tool/dtx-to-midi` → downloaded file → `/tool/midi-preview` → `/tool/midi-to-dtx` flow and a changed GM map. Verify the actual saved files as in the committed Playwright assertions. **Capture one screenshot after mapping selection** (no Linear mockup), and visually verify selected label, alignment, legibility, clipping and status against the existing page. Record the result and screenshot evidence on PR #365 (do not commit image binaries or demand human signoff). One web platform suffices; no native run unless native behavior changes.
- **One MCP-driven API HTTP/Worker check**, because backend code changes: extend the **existing** `e2e-web/setup/prepare-stack.ts` seed with a small mixed-form SET.def/duplicate-label L6 fixture (or use its existing seed hooks) and drive the running local Worker catalog/preview endpoint through MCP, asserting the returned labels and **distinct R2 URLs**; reuse existing `preview.spec.ts` where practical. Keep API `r2Enrichment.test.ts` for missing-file and relative directory cases. No new backend harness or separate PR. This Worker request is the backend E2E acceptance, distinct from a parser-only unit test.

Post a compact proof-of-results in the PR discussion only after actual execution. Update the design/plan within this same PR if accepted review comments change scope. Do not tick criteria early.

## End-to-end acceptance criteria (all automated)

- [x] Shared DTX parser accepts LF and CRLF; decimal `#BPM` matches exactly even after `#BPMxx` definitions, and base BPM survives parse/export.
- [x] `toPattern()` never falls back to a quarter-note grid for unrepresentable off-grid onsets; a note at fraction `0.875` in a 3/4 bar is preserved using `LaneMeasureNote.measureLength = 1`. Shared `toDtxText()` skips channel-02 in the pattern loop, preserves `#BPMxx` / channel-08 BPM refs and channel-02 **decimal** values for **editor save and MIDI import**, emits base `#BPM` exactly once (filtering the empty `parseBPMChanges()` key), and works with fresh `DTXFile.lines = []`.
- [x] DTX→MIDI writes correct channel-9 GM notes 36/38/42/49 for lanes 13/12/11/16, retaining simultaneous and close hits with nonnegative deltas. GM aliases including note 35/37/40/45/47/52/53/55/59 import into valid drum lanes, and changing a page mapping changes the actual downloaded DTX lane.
- [x] Representable 3/4→4/4 and mid-measure tempo changes survive file round trips; arbitrary unrepresentable DTX meter values preserve **tick timing** with warning; unsupported import-side mid-bar meter changes fail explicitly.
- [x] Off-grid non-480 PPQ MIDI hits use nearest 1/192-bar slot: distinct slots preserved, normalized timing error ≤ half a slot, same-lane cell collisions counted and warned. `ChartTiming` comparison exists only in automated regression tests.
- [x] Mixed colon/space SET.def with duplicate labels and L6+ gives equivalent common/web/API results, remote editor loads highest L6, and R2 resolves distinct expected files with claimed-missing semantics. Rust 1–9 cap is intentionally unchanged.
- [ ] Public MIDI/DTX tests, editor export, shared SET.def/web/API integration, existing modified Playwright E2E, lint/format/type checks and affected CI pass at implementation SHA. No private-helper assertions.
- [x] **Playwright MCP web E2E + visual:** actual converter workflow, saved-file checks, editable map changed after Convert, cached `ParsedMidi` reused, correct `11`–`1C` row labels (no `Unknown`/control lanes), true note-hit count and one screenshot assessed against existing page UI, without human acceptance or new UI art.
- [x] **MCP Worker backend E2E:** local seeded R2/D1 SET.def requests reach the running API and assert file pairing; mock bucket tests remain in CI and are not mistaken for E2E.
- [x] Only **PR #365** contains code, docs, tests and evidence; no second PR, unrelated scene/UI refactor, migration, new framework or extra native-platform acceptance.

**Current state:** implementation, unit tests and e2e specs are committed on this PR. Reported on the PR description (not independently re-run here): unit suites common 1,329 / web 1,028 / API 750 / desktop 1,068 / UI 54 / infra 26; the three existing converter Playwright specs 15/15 against an isolated Worker/D1/R2 stack including downloaded-file reparsing and duplicate-label/L6 SET.def resolution; and a Playwright MCP session covering upload → convert → post-conversion lane override → pre-conversion BPM edit → downloaded-DTX check, a local Worker/R2 catalog query, and a visually inspected screenshot (not committed). The MCP criteria above are ticked on the strength of that report; the description does not enumerate the full three-tool flow or the distinct-R2-URL assertion individually. The remaining open item is type/lint/CI verification at the implementation SHA.
