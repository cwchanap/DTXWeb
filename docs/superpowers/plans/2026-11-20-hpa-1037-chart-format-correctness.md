# HPA-1037 — Chart format correctness: one-PR implementation plan

**Status:** Planning-only draft PR. Implement, validate, and address reviews on **this same PR**; do not open a second implementation PR.
**Linear:** https://linear.app/cwchanap/issue/HPA-1037/dtxwebbug-fix-chart-formats-midi-tools-lf-parsing-and-one-setdef
**Design:** [2026-11-20-hpa-1037-chart-format-correctness-design.md](../specs/2026-11-20-hpa-1037-chart-format-correctness-design.md)
**Baseline inspected:** `main` SHA `59edbe86079a7dab8273a00126dbbbf16d41badf`.
**Dependencies:** No blockers. HPA-1039 is independent but overlaps the mechanical "Mesaure/Offest" rename; whichever lands second rebases. PR #364 currently addresses unrelated pre-existing Svelte type errors and may merge first.

## Scope and file ownership

| Area | Target files | Action |
| --- | --- | --- |
| Drum definition | `packages/common/src/lib/notation/drumMapping.ts`; `game/scenes/BaseGame.ts`; `game/scenes/Preview.ts`; `audio/previewAudioEngine.ts`; any editor preview sprite-order consumers | Enrich existing canonical drum table; derive GM maps, labels, palette/frame/width and audio drum filtering, while retaining caller-specific ordering/BGM controls |
| Shared chart timing | `common/src/lib/notation/timing.ts` and `notation/quantize.ts` | Reuse `buildChartTiming`, sticky channel-02 and legacy 03/08 tempo normalization; extract just the existing preparation helper if MIDI needs it without engraving |
| Binary MIDI | New small `packages/common/src/lib/midi/` module, `common/src/lib/index.ts`, `chart/dtx.ts` | One parser, one writer, public conversion functions; remove MIDI-only methods from `DTXFile` |
| DTX serializer/parsing | `common/src/lib/chart/dtx.ts` and `chart/note.ts` if useful | LF fix; generate chart text with channel 02/08 control data from MIDI import without browser/DOM coupling |
| Three tool pages | `packages/dtx-web/src/routes/(tool)/tool/{dtx-to-midi,midi-to-dtx,midi-preview}/+page.svelte`; `dtx-to-midi/midi-helpers.ts` | Use shared parser/writer/maps, wire editable map, retain UI layout and download behavior, drop redundant parser/helpers |
| SET.def | New `common/src/lib/chart/setDef.ts`; `common/src/lib/chart/simFile.ts`; web editor `+page.server.ts`; API `src/services/r2Enrichment.ts` | Share pure parser; keep per-caller IO and R2 resolution; support L6+ consistently |
| Tests and fixtures | `common/src/lib/chart/dtx-midi.test.ts`; new public `common/src/lib/midi/*.test.ts` and `chart/setDef.test.ts`; existing web/API tests; `packages/e2e-web/{dtx-to-midi,midi-to-dtx,midi-preview}.spec.ts` and `fixtures/` | Replace private-method assertions with actual round trips and add user-workflow assertions, not large redundant suites |

Keep other packages, all database schemas, CSS visuals, native Rust SET.def parser and auth unchanged.

## Work sequence — all changes stay on this PR

### Task 1 — Pin behavior and create small regression fixtures

1. Rebase on current `main` and review overlap with PR #364 / HPA-1039; do not reproduce unrelated type-cleanup work. Check target paths and exports still exist.
2. Add minimal **public-facing** fixtures: DTX with `11`, `12`, `13`, `16` hits, simultaneous kick+crash, close adjacent notes, BPM change in the middle of a measure, sticky `#00102: 0.75` followed by 4/4 reset; LF/CRLF twins; SET.def with L6, both separators, two identical labels and multiword filenames. Use existing `packages/e2e-web/fixtures` generation conventions, no binary screenshot assets.
3. Tests first: assert valid exported MIDI can be reparsed and count/GM notes/absolute ticks match; imported DTX text can be reparsed with equivalent channels/bar lengths/BPM. Replace `dtx-midi.test.ts` checks that call private methods via `as any`; avoid tests tied to byte offsets except file-validity contract.

### Task 2 — Consolidate drum-lane metadata

1. Extend `notation/drumMapping.ts`'s existing table (do not add another registry). Preserve its correct GM numbers and notation positions. Add only the color/frame/width/order data required by current callers.
2. Derive converter defaults, importer lane select options and MIDI preview labels from the table. Treat BGM/tempo/meter as separate control channels, never as drum defaults. Add a unit contract that all 12 playable channels have a unique mapping and that channels 01/02/03/08 do not.
3. Replace redundant literal drum metadata in `BaseGame`, `Preview`, relevant editor preview sprites, and drum-only parts of `previewAudioEngine`. Leave layout-specific order and BGM audio handling as caller-level constants instead of forcing a generic table to own all UI layout.
4. Remove the web copy of `groupNotesByLane` and use the existing common export. Remove any duplicated DTX-file identification check only after verifying equivalent extension/content semantics.

### Task 3 — Extract and fix MIDI parsing and export

1. Move the useful existing parser code out of `midi-preview/+page.svelte` / `DTXFile` into a small, pure MIDI module. Return one structured parsed representation with absolute ticks and track data needed for preview. Handle SMF 0/1, running status, meta VLQ lengths, note-on velocity zero, varying channel message widths, and malformed input.
2. Remove MIDI-specific public/private methods from `DTXFile`; make the pages call common public functions. Preserve the preview's track summary, duration, notes and channel display.
3. Build DTX→MIDI from **correct drum channels**, 480 PPQ and real per-measure lengths. Reuse the timing normalization (including legacy channel 03) for tempo events. Emit time-signature changes for supported meter changes and tempo `0x51` events at the correct ticks. Do not apply BPM twice to tick coordinates.
4. Serialize sorted **absolute** event ticks to delta VLQs. Tie handling: tempo/meter first at same tick, off before on for same pitch, end-of-track after the final hit tail. Reject negative/unrepresentable deltas rather than creating corrupt files. Unknown lanes do not become middle C.
5. Assert an independently parsed export has every simultaneous note and exact expected GM note number; test one non-4/4 bar and a midbar tempo change via the public API.

### Task 4 — MIDI import, DTX timing output and UI mapping

1. Parse/merge MIDI events into drum hits (channel 9, velocity > 0) and tempo/meter data. Convert absolute tick positions into measures/fractions using PPQ and the changing time signature; use existing chart timing to cross-check time-domain positions. Fail clearly on unsupported mid-bar/unrepresentable signatures rather than silently shifting chart positions.
2. Return a minimal conversion result with grouped notes plus base BPM, indexed tempo change and changed bar-length data. Extend the existing DTX text output path to write `#BPMxx`, channel `08` and channel `02` directives, not only `#BPM`. Extract a pure serializer from the existing `DTXFile.export` download wrapper if necessary; avoid a second DTX exporter.
3. Seed the importer page's mapping from the canonical lane table **and pass the current mapping** to conversion. If mapping changes after conversion, invalidate stale output or recompute before download. Keep the existing metadata edits (title/artist/level/BPM/comment) and ensure the downloaded chart retains timing controls.
4. Exercise **DTX→MIDI→DTX→parse** and verify measure/fraction ≤ one MIDI tick, correct control lines, all expected hits; verify changing GM 49's target lane changes the exported DTX channel. Tests should not inspect private parser fields.

### Task 5 — Canonical SET.def, LF parsing, API integration

1. Change `DTXFile.parseFromText` line splitting to `/\r?\n/` and compare LF/CRLF fixtures for metadata, chip names and parsed notes/control lines.
2. Implement pure `parseSetDef` accepting `#TITLE` and `#L{n}(LABEL|FILE)` in space/colon forms; complete pairs only; preserve full labels, filenames and numeric slot ordering, including L6+. Export from common's safe main barrel.
3. Switch `SimFile.parseHeader`, web editor server loader and API R2 enrichment to consume it. In `SimFile`, select highest numeric level dynamically and keep populated >L5 slots when generating SET.def; do not discard current default L1–L5 behavior.
4. For R2 enrichment derive the same label→files queue in numeric slot order. Keep normalization, sibling-directory-first resolution, duplicate-label consumption, missing-file claim, case-insensitive matching and the error/fallback behavior in API code. Remove stale Electron comments. Rust parser unchanged.
5. Add integration tests through public surfaces: `SimFile.parseHeader/getHighestLevel`, editor metadata loader, `discoverCatalogFiles` using mocked R2 objects. Assert two duplicate labels are paired with distinct referenced keys, including a missing-file reference.

### Task 6 — Verification, MCP E2E and finish the same PR

Commands (use repository-pinned Bun and current CI conventions; run against the **implementation** SHA, not this documentation-only commit):

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

Add targeted assertions to the **existing** Playwright suites where possible. Their current coverage checks only download success or basic preview display, **not file contents**. Save and inspect the downloaded MIDI/DTX bytes in tests and reparse through public APIs; do not duplicate the entire E2E infrastructure. Keep the other affected existing CI workflows passing.

**Playwright MCP web acceptance (one platform, real hydrated UI):**
1. Load `/tool/dtx-to-midi`, upload the drum/timing fixture, convert and download. Confirm the downloaded MIDI is parseable and contains kick=36, snare=38, hi-hat=42, crash=49 with simultaneous kick+crash and the expected tempo/time signature events.
2. Load `/tool/midi-preview` with that MIDI and verify the displayed track, tempo and notes are coherent.
3. Load `/tool/midi-to-dtx`, upload that MIDI, change one GM note's lane mapping, convert and download, then inspect/reparse the downloaded DTX to confirm the changed channel, its hit count, and channel-02/08 timing lines. Reimport without override if needed to verify canonical round-trip.
4. Capture **one screenshot** of the converter mapping after editing a select. Check visible lane IDs/names, contrast, clipping, alignment, responsive layout and status messaging against the existing page (no Linear mockup attached). Record MCP observations and evidence in this PR discussion, without committing screenshots. This is an automated visual check, **not human sign-off**.

**MCP backend end-to-end acceptance (required because API code changes):**
1. Run the local dtx-api Worker and seed its local R2 using the existing test harness with a mixed-form `set.def` and two actual chart objects sharing a difficulty label plus an L6 object with a filename containing a space.
2. Use an MCP-driven HTTP/browser request against the **running Worker endpoint** exercising catalog enrichment (not only importing `parseSetDef`). Confirm the returned chart labels and distinct file URLs resolve to their intended R2 objects; include nested-path and missing-file scenarios in the API integration tests.
3. Record request/response assertion and Worker evidence in this PR. The MCP web UI session and this Worker E2E are sufficient; no macOS/Windows native acceptance is required.

After tests and screenshots, address review findings and update these docs if the accepted design changes. Keep a **single PR** for this issue; move it from draft to ready-for-review only when code, tests and evidence are present and then check any CI jobs skipped for drafts.

## End-to-end acceptance criteria

- [ ] Export of the four-lane drum fixture produces a valid SMF with channel-9 kick 36, snare 38, closed HH 42 and crash 49, including every simultaneous/adjacent hit; no invalid/negative event delta.
- [ ] GM MIDI import yields DTX drum lanes 11–1C only, allows the page's edited note→lane mapping to affect the **downloaded content**, and preserves the user's title/metadata changes.
- [ ] A 3/4 → 4/4 change and mid-measure BPM event survive round trip, with hits at the same measure/fraction within one MIDI tick. Real downloaded DTX includes channel-02/08 timing directives.
- [ ] LF vs CRLF DTX copies parse equivalently for title, BPM, notes and WAV chips; no false successful parse of a one-line malformed chart.
- [ ] Mixed-style SET.def with spaces, L6+, and duplicate labels yields identical results in shared SimFile, server editor metadata, and API R2 chart enrichment; highest level selection reaches L6 and two identical labels resolve to distinct files.
- [ ] All duplicated MIDI readers and invalid hardcoded default lane maps are removed; existing visual lane presentation, drum preview/audio, DTX sample/audio controls, and MIDI preview metadata still work.
- [ ] Public-API round-trip/unit/integration assertions pass in common/web/API, including malformed MIDI and R2 missing/duplicate behavior; no new private-method tests.
- [ ] **MCP web end-to-end:** Browser uploads fixtures, completes DTX→MIDI→DTX, validates actual saved files, changes a mapping, and displays correct preview details. A captured converter screenshot is visually checked for intact lane labels/selection, status and layout with no regression; no human acceptance criterion.
- [ ] **MCP API end-to-end:** Seeded R2 SET.def is fetched through the running Worker and produces correct chart file pairing; results documented with reproducible assertions. An API unit test alone is insufficient.
- [ ] Frozen install, shared build, common/web/API tests + type checks, web Playwright converter suites, repository lint/Prettier and affected ready-PR CI jobs pass at the final SHA. No new art/SFX, DB migrations, backend redesign, second PR or extra native acceptance.

## Work tracking

This PR starts as documentation only. Do not tick acceptance items or claim E2E execution until the implementation and MCP evidence actually exist.