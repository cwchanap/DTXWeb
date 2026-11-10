# HPA-834 — Folder-aware workspaces: single-PR implementation plan

**Status:** Planning only; no implementation or verification has been performed yet  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Design (source of truth):** [2026-11-09-hpa-834-folder-aware-workspaces-design.md](../specs/2026-11-09-hpa-834-folder-aware-workspaces-design.md)  
**Dependency:** HPA-567 is Done; [PR #340](https://github.com/cwchanap/DTXWeb/pull/340) has merged.  
**PR rule:** Exactly **one draft PR** holds these documents first, then the code and regression tests. Do not open a second implementation PR. No backward-compatibility migration.

## Scope and files

| Path | Work |
| --- | --- |
| `packages/dtx-web/src/lib/services/workspacePaths.ts` (small new helper, if useful) | Convert browser selection to root-relative ZIP path; segment-aware collision key; minimal chart-relative resolution utility |
| `packages/dtx-web/src/lib/services/workspaceService.ts` | Root-relative paths, path-based chart identity, large-file cache keys, chart-scoped sound binding |
| `packages/dtx-web/src/lib/services/workspaceService.test.ts` | Import, collision/ambiguity, large-file cache, playback binding regressions |
| `packages/dtx-web/src/lib/components/editor/modals/DTXSwitcherModal.svelte` | Switch and active state by `dtxFile.path`; register only local chart files |
| `packages/dtx-web/src/lib/components/editor/modals/DTXSwitcherModal.test.ts` | Two same-named DTX files can be selected; correct local chip files after switch |
| `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte` | ZIP entry and collision key from `path`, with full-path errors |
| `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts` | Folder-preserving success, cross-folder duplicates, genuine collisions, failure guarantees |
| `packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.svelte` | Use chart path instead of name for the initial/current workspace fallback |
| `packages/dtx-web/src/tests/mocks/services.ts` and affected web page tests | Update newly imported flat-workspace fixture paths and `currentDTX` expectations |

Do **not** add dependencies, modify `SoundLibrary` storage/hashing, introduce a new service hierarchy, or touch common, API, desktop, or database code.

## Task 1 — Red tests for the actual song-pack problem

In the existing `workspaceService.test.ts` and modal tests, build a representative `FileList`:

```text
SongPack/SongA/mas.dtx       #WAV01: bgm.wav
SongPack/SongA/bgm.wav       audio A (small, unique hash)
SongPack/SongB/mas.dtx       #WAV01: bgm.wav
SongPack/SongB/bgm.wav       audio B (small, different hash)
```

Use `Object.defineProperty(file, 'webkitRelativePath', { value: ... })` as existing tests do. Assert imported DTX paths and selected `currentDTX` are root-relative and distinct; existing per-file display `name` remains unchanged.

Add failing behavioral assertions that:
1. `parseDTXFile(workspace, 'SongB/mas.dtx')` resolves B's bytes, not A's; switching to A and back does not retain an old `local:bgm.wav` binding.
2. `DTXSwitcherModal` clicks B's own row (the duplicated `mas.dtx` label) and passes its **path** to parse/switch, and only B shows `Currently active`.
3. ZIP includes both `SongA/bgm.wav` and `SongB/bgm.wav` and their chart paths; success still downloads exactly once.
4. Same path with case/NFC/Windows space-or-dot variants refuses to download and names the conflicts. Different directories with the same basename succeed.
5. A missing selected audio file still prevents the whole audio-inclusive download; a DTX-only export remains allowed.

Tests should first prove wrong-byte/missing-member behavior on current code, not merely count service calls.

## Task 2 — Make the path canonical and use it as identity

1. In the web-only path helper (or small local functions if duplication is lower), turn `webkitRelativePath` into the path **below** the selected root, retaining spelling/case and `/` separators; use `file.name` if the browser does not supply a relative path. Handle a flat selected folder as `mas.dtx`, not `Folder/mas.dtx`. Do not derive original root from `workspace.name`, which may have a uniqueness suffix.
2. In `importFolder`, assign this path to `WorkspaceDTX.path` and `WorkspaceFile.path`. Keep difficulty ordering by basename; initialize `currentDTX` to `sortedDtxFiles[0].path`.
3. Change `parseDTXFile(workspace, dtxPath)` and `switchDTXFile(workspace, dtxPath)` lookups to `path`. In `DTXSwitcherModal`, call them with `dtxFile.path`, compare to `currentDTX` by path and show both basename and directory. Update the editor page fallback.
4. Change large-file session insertion and `parseDTXFile` retrieval to key `${workspace.name}/${audioFile.path}`; keep `getLargeFile(workspaceName, relativePath)`, `clearSessionFiles(workspaceName)` and their callsites consistent. Do not persist large bytes.
5. Change fixture expectations in tests that assumed `path` included the selected root. A newly imported flat folder should still yield `path === name`.

**Exit:** importing two `mas.dtx` or two large `bgm.wav` files in different directories does not alias either in chart identity or in-memory cache.

## Task 3 — Bind referenced audio per chart, not per workspace

Work inside `WorkspaceService.parseDTXFile`, before constructing `SimFile.files`:

1. Parse the selected DTX's `#WAV` chips as today. Build a lookup over **this workspace's** `audioFiles` metadata (not every global sound-library item).
2. For each distinct nonempty sound-chip filename, first resolve the referenced path under the selected chart's directory. Normalize separators and `.`/`..` only within the workspace; a reference outside its root is invalid/unresolved. Use NFC/case-insensitive matching; reject ambiguous matches rather than relying on array order.
3. If no exact relative match exists, permit fallback to a same-basename audio record **only when one candidate exists in this workspace**. For two candidates, leave unbound and emit a useful diagnostic. Never substitute audio from another workspace, nor fall back after an exact candidate was selected but its bytes are unavailable.
4. Resolve the chosen `WorkspaceFile`: for small files require its hash and `SoundLibrary.getByHash(hash) -> toFile`; for large files retrieve from path-keyed session storage. Do not discard HPA-567's `libraryStorageFailed` semantics. An unavailable record remains unavailable, not silently rebound.
5. Expose selected files under the `SoundChip.fileName` expected by `DTXSwitcherModal` and `FileManager`; wrapping the original `Blob` in a `File` with that name is sufficient and avoids reading bytes or changing the underlying library. `SimFile.files` must not contain unrelated same-named audio from other folders.
6. Retain `parseDTXFile`'s cleanup of previous `local:` keys, then register the selected chart's bindings only. In the switcher use `FileManager.generateKey(null, chip.fileName)`; do not carry a previous remote `simfileID` into workspace sound mappings.

Regression tests:
- Two same-named small samples with distinct hashes map to the right `File` by chart.
- Two same-named large samples are still both available and map correctly.
- A sample in `SongA/samples/kick.wav` resolves from `#WAV01: samples/kick.wav`.
- A unique root/shared audio sample resolves as fallback; ambiguous fallback does **not** bind.
- Missing/hashless/failed-import selected audio does not fall back to another same-named file.
- Switching from A to B clears A's `local:` entries and maps B's bytes.

**Exit:** the editor and the switcher's second filename-based mapping see the same chart-scoped audio, not all workspace audio.

## Task 4 — Preserve paths and HPA-567 integrity in ZIP export

In `ExportWorkspaceModal.svelte`:

1. Replace every pending entry `name: file.name` and every `claimName(file.name, file.path)` with `file.path` as its actual ZIP member. Continue to show human-readable full paths in errors. The physical `File.name` obtained from `SoundLibrary.toFile` is **not** the archive path.
2. For collision keys, compare NFC/lowercase normalized **path segments**, including Windows edge-padding rules per segment. Reject invalid/traversing entries; preserve the original relative path when calling `zip.file`. Report both full conflicting paths. Do not reject `SongA/bgm.wav` vs `SongB/bgm.wav`.
3. Pass `audioFile.path` to `WorkspaceService.getLargeFile`. Continue resolving small audio only from `audioFile.hash`.
4. Keep the existing all-or-nothing pipeline: collect selected entries; detect missing/colliding records; read audio bytes with named failures; generate/download **only** once all selected content is ready. Keep empty DTX handling, DTX text encoding, true success counts and persistent multiline error.
5. Preserve DTX-only behavior: do not require or collision-check unselected audio; do not count JSZip-created directory entries as chart/audio files.

Regression tests should verify exact `zip.file(path, data)` calls (including original casing), ZIP generation/download count, two chart folders with duplicate basenames, and true path-collision cases (same folder, case/NFC and segment padding). For a negative async export, await the displayed failure before asserting no `generateAsync`, object URL, success toast or close.

## Task 5 — Verify, review and implement in this same PR

- [ ] Run focused web Vitest: `bun run --filter=dtx-web test src/lib/services/workspaceService.test.ts src/lib/components/editor/modals/DTXSwitcherModal.test.ts src/lib/components/editor/modals/ExportWorkspaceModal.test.ts`.
- [ ] Run full web tests: `bun run --filter=dtx-web test`.
- [ ] Run web Svelte/TypeScript check: `bun run --filter=dtx-web check`. PR #340 noted pre-existing Svelte diagnostics; compare against current main and require **zero new diagnostics**, rather than asserting a clean check without evidence.
- [ ] Run lint/Prettier for touched files and web build if feasible; capture any environment blockers separately.
- [ ] Validate with a real two-song folder: each chart plays its own sample; exported ZIP has both original directories; extraction and re-import recover each file.
- [ ] Mark completed tasks above with test evidence and request review; keep implementation on **this same PR**.

## Risks kept intentionally small

- `SoundChip.fileName` remains the existing playback lookup key. Correctness relies on `SimFile.files` and `local:` entries being **chart-scoped**; do not solve this by introducing a cross-package path-aware FileProvider.
- Old stored `path` values include the root folder. Prefer explicit re-import to a migration layer because there are no real users to preserve.
- A filename-only reference outside its chart folder may be inherently ambiguous; refuse to guess rather than select the first file.
- Preserve HPA-567's protections. This ticket repairs path identity and hierarchy; it is not a second ZIP integrity overhaul.
- No art or audio-asset generation is involved.

## PR checklist

- [x] Select HPA-834 from the DTXWeb Linear backlog
- [x] Review HPA-834 and merged predecessor HPA-567
- [x] Investigate the current workspace/import/parse/switcher/export seams
- [x] Commit design specification and single-PR plan
- [ ] Review/approve design
- [ ] Commit implementation and tests on this same branch
- [ ] Run verification and request final review
