# HPA-834 — Folder-aware browser workspaces: design specification

**Status:** Proposed for review; implementation has not started  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Predecessor:** [HPA-567 / merged PR #340](https://github.com/cwchanap/DTXWeb/pull/340)  
**Implementation plan:** [2026-11-09-hpa-834-folder-aware-workspaces.md](../plans/2026-11-09-hpa-834-folder-aware-workspaces.md)  
**Delivery:** Exactly one PR for this ticket; implement in the **same draft PR** that introduces these documents.

## Goal

Import a selected folder containing multiple DTX songs without conflating same-named charts or samples, play audio belonging to the selected chart, and export a complete ZIP preserving the folders **below** the selected root. Keep current flat-folder behavior.

Example browser selection:

```text
SongPack/
  SongA/mas.dtx
  SongA/bgm.wav
  SongA/snare.wav
  SongB/mas.dtx
  SongB/bgm.wav
  SongB/snare.wav
```

Expected ZIP entries: `SongA/mas.dtx`, `SongA/bgm.wav`, etc., and the analogous `SongB/` entries — **not** a second `SongPack/` wrapper, and not six flattened names. Selecting `SongB/mas.dtx` must play `SongB/bgm.wav` and `SongB/snare.wav`.

## Verified current seams

- `WorkspaceService.importFolder` stores `webkitRelativePath` (including selected root) in `WorkspaceDTX.path` / `WorkspaceFile.path`, but large files in `sessionLargeFiles` are keyed by `${workspace.name}/${file.name}`.
- `WorkspaceService.parseDTXFile(workspace, dtxFileName)` finds the chart by `name`, loads all workspace/library files, and matches `SoundChip.fileName` by name across the whole workspace; which duplicate wins depends on iteration order.
- `Workspace.currentDTX`, `switchDTXFile`, and `DTXSwitcherModal` also identify charts by basename. Two separate `mas.dtx` files cannot be selected independently.
- The switcher remaps `simFile.files` into `FileManager` by sound-chip name. Merely changing `parseDTXFile`'s private match is insufficient: the resulting `simFile.files` must itself contain **only the selected chart's binding for each referenced name**.
- `ExportWorkspaceModal` currently claims `file.name` as the ZIP entry key. HPA-567 correctly fails closed on same-name collisions and missing audio; this ticket must retain its hash-bound source lookup and all-or-nothing behavior.
- Small audio has workspace-local `hash` metadata and shared `SoundLibrary.getByHash`/ `toFile`; large audio is session-only. Neither storage policy needs redesign.

## Decisions

### 1. Canonical workspace-relative file path

For **new imports**, `WorkspaceDTX.path` and `WorkspaceFile.path` are the full **root-relative** path with forward slashes, original spelling and case, and no selected root prefix:

| Browser `webkitRelativePath` | Stored `path` | `name` |
| --- | --- | --- |
| `SongPack/SongA/mas.dtx` | `SongA/mas.dtx` | `mas.dtx` |
| `SongPack/SongB/bgm.wav` | `SongB/bgm.wav` | `bgm.wav` |
| `SingleSong/bgm.wav` | `bgm.wav` | `bgm.wav` |
| Unavailable / empty | `file.name` | `file.name` |

`name` remains for display and difficulty sorting; **`path` is identity and ZIP entry location**. Extract the root from `webkitRelativePath`, not from `Workspace.name` (the latter can be suffixed, e.g. `SongPack (1)`). A tiny web-only path helper is enough; do not add a virtual filesystem or new dependency.

The helper for collision comparison uses NFC + lowercase and folds leading spaces / trailing spaces and dots **per path segment**, preserving the original path when writing ZIP entries. Treat `/` as the separator. Reject malformed export entry paths (absolute/empty segments or traversal `.` / `..`) rather than constructing a misleading ZIP. A collision is a duplicate **full normalized relative path**, not a duplicate basename; `SongA/bgm.wav` and `SongB/bgm.wav` are distinct. No case-normalization of the actual archive member name.

Older serialized workspaces may contain the selected root in `path`; no migration or compatibility shim is planned. Re-import those folders to acquire the new canonical paths. Freshly imported flat folders continue to use `path === name`.

### 2. Chart identity is path, including in the switcher

- Store `Workspace.currentDTX` as the selected **chart path**; initialize it from `sortedDtxFiles[0].path`.
- `parseDTXFile` and `switchDTXFile` accept the chart path and find the matching `WorkspaceDTX.path`, not `name`.
- `DTXSwitcherModal` passes `dtxFile.path`, compares the active selection to `path`, and continues displaying the basename plus the path for context.
- Update the editor page's current-chart fallback from `workspace.dtxFiles[0]?.name` to `?.path`. No changes to the remote/desktop chart selector.
- `TempChartStorage` does not currently create independent persisted drafts for `simFileID === null`; changing editor autosave/storage semantics is a separate concern, not part of making workspace import, playback, and export safe.

### 3. Resolve samples within the current chart, then fall back only when unambiguous

Given chart `SongA/mas.dtx` and `#WAV01: bgm.wav`:

1. Resolve the WAV reference relative to the chart directory: `SongA/bgm.wav`. Also handle references such as `samples/kick.wav` relative to that directory. Reject references traversing outside the workspace root. Compare paths case-insensitively with NFC for lookup; an identical normalized path with multiple candidates is **ambiguous**, not a reason to pick the first.
2. If no exact chart-relative match exists, search **only the current workspace's** audio metadata by referenced basename. Use a fallback **only if exactly one candidate** exists; a shared root-level `bgm.wav` thus works when unique. If two other song folders contain `bgm.wav`, leave the reference unresolved and issue a diagnostic naming the chart/reference rather than playing an arbitrary other song.
3. After a `WorkspaceFile` is chosen, resolve its bytes **only from that record**: small file via `hash -> SoundLibrary.getByHash -> toFile`; large file via `getLargeFile(workspace.name, audioFile.path)`. If unavailable, leave missing and do **not** substitute another same-named record. Preserve HPA-567's `libraryStorageFailed` protection; no unrestricted global library-name fallback.
4. Build `SimFile.files` using only the selected audio references, each exposed under its chip's expected `fileName` (an inexpensive `new File([sourceBlob], chip.fileName, { type })` alias if necessary). `DTXSwitcherModal` can then retain its existing filename-based remapping without selecting an unrelated duplicate. Deduplicate equivalent chip reference names.
5. Clear stale `local:` FileManager entries as `parseDTXFile` already does. Register only the chart's bound files under the corresponding lowercased chip reference; the switcher should use the **local** key (`generateKey(null, chip.fileName)`) rather than an old remote simfile ID.

Keep lookup inside `WorkspaceService`. Do not change `SoundChip`, the common parser, shared `FileManager` contract, or the remote fetch path.

### 4. Path-keyed large audio

Use `${workspace.name}/${audioFile.path}` instead of basename for `sessionLargeFiles` when importing, parsing, and exporting. Keep the existing `getLargeFile(workspaceName, relativePath)` API shape and workspace-scoped `clearSessionFiles`. No persistence for large files: a page reload still requires re-import for audio-inclusive export.

### 5. Path-preserving and fail-closed ZIP export

- For each selected DTX and, optionally, audio record, use `file.path` as both the collision claim and ZIP entry name. Do not use the restored audio `File.name` — sound-library deduplication can retain a different original name.
- Check collisions by the **normalized full path**, across DTX and selected audio. Preserve HPA-567's cross-type collision detection, case/NFC/Windows-padding protection, missing-file refusal, named read errors, zero-byte DTX handling, Shift-JIS/UTF-8 encoding decision, accurate counts, persistent inline error, and single download.
- Report **both full paths** when entries normalize to the same name. Update the guidance: same basename in distinct folders is valid; rename/re-import only truly conflicting paths.
- DTX-only export ignores unselected audio, as it does today. Nothing is downloaded if any selected entry is missing, colliding, or unreadable.
- JSZip receives paths with forward slashes. Directory entries it creates do not count as user-selected exported files.

## Acceptance and regression matrix

| Case | Expected behavior |
| --- | --- |
| `SongA/mas.dtx`, `SongB/mas.dtx` | Both selectable individually; `currentDTX` records path |
| Same-named small samples with different content hashes | Each chart binds only its own bytes; switching never inherits the previous chart's `local:` file |
| Same-named >2 MiB audio in two directories | Both retained in session cache and resolved by full path |
| Chart-relative `samples/kick.wav` | Resolves within the chart directory; editor's file-manager lookup uses the chip reference |
| Unique workspace-wide shared sample | Works as fallback; multiple candidates do not silently select the first |
| Missing or failed-import audio | Remains unavailable; no wrong-source name fallback |
| Two folders with `bgm.wav` | Both ZIP entries present with relative directories; succeeds |
| Same full path, or NFC/case/edge-padding equivalents within a directory | Export refuses, names both conflicting paths; no download |
| DTX-only selection with missing audio | Exports DTX paths without requiring audio |
| Flat single-song folder | Existing import, chart switch, playback and flat ZIP names continue to work |

## Non-goals and limits

No new schema, database, API, R2 logic, desktop/Tauri change, archive importer, filesystem abstraction, folder tree UI, audio storage migration, or compatibility layer for previously serialized workspaces. Preserve one-PR scope. The implementation should extend existing Vitest coverage and only add a small path utility if actually shared by service and modal.

## Design decision / completion checklist

- [ ] Approve this path-identity and unambiguous-fallback contract
- [ ] Implement and test on this same PR
- [ ] Verify affected web tests, formatting/lint, check against repository baseline and representative multi-song ZIP output
