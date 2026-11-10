# HPA-834 — Preserve song-pack paths in web workspaces

**Status:** Proposed design for implementation on this same draft PR  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Related completed fix:** HPA-567 / DTXWeb PR #340  
**Scope:** Browser workspace import, DTX selection, sample playback, and ZIP export. One issue, one PR.

## Problem and verified code paths

HPA-567 made ZIP export fail closed, but the workspace still identifies files by their basename. The normal pack layout contains multiple song folders, each with mas.dtx and commonly named samples such as kick.wav or bgm.ogg.

- **workspaceService.ts / importFolder:** Each file's path is recorded from webkitRelativePath (including the selected root directory), but large session audio is keyed by workspace name plus file.name; same-name files in different song folders overwrite one another.
- **workspaceService.ts / parseDTXFile:** Finds the DTX by file.name; builds an unordered pool of every audio file; resolves sound chips by basename; registers all files as local:basename, overwriting duplicate keys. Small-file hashes now protect byte identity, but not which folder a chip belongs to.
- **DTXSwitcherModal.svelte:** Calls parseDTXFile with a basename, then independently re-matches each chip to SimFile.files by basename and writes it to FileManager; this would undo a fix limited to workspaceService.
- **Preview.ts / soundChipPreparation.ts:** Preview uses the file provider and caches sound by the chip reference filename. Switching charts with the same chip filename must not replay a cached audio buffer from the previous song.
- **ExportWorkspaceModal.svelte:** Uses file.name as ZIP entry and collision key; the pack currently fails even when paths differ.

No API, Cloudflare infrastructure, desktop Rust, library schema or new dependency is needed.

## Product contract

Example folder selected through the browser:

~~~text
Pack/
  Song A/mas.dtx             #WAV01: kick.wav
  Song A/kick.wav            (audio A)
  Song B/mas.dtx             #WAV01: kick.wav
  Song B/kick.wav            (audio B)
  Shared/cymbal.wav
~~~

Import creates one workspace with two selectable DTX entries identified as **Song A/mas.dtx** and **Song B/mas.dtx**. Previewing Song A uses its kick.wav bytes; switching to Song B uses Song B's bytes, including when a previous preview was already loaded. Export produces the same five *relative* paths inside the ZIP, without a top-level Pack/ directory. DTX-only export preserves both DTX paths.

A newly imported flat folder continues to export files at the ZIP root. The existing HPA-567 all-or-nothing contract remains: missing selected audio, unreadable files, or colliding full paths abort the download with actionable, path-specific errors. Existing persistence is disposable; re-import old workspaces to adopt path-based identity instead of adding a compatibility migration.

## Design decisions

### 1. One canonical workspace-relative identity

At import, strip the selected browser folder's first path segment from webkitRelativePath, standardize separators to '/', and persist **WorkspaceDTX.path** and **WorkspaceFile.path** as paths *relative to that root*. If webkitRelativePath is absent, use file.name. Do not derive the source root from workspace.name: generateUniqueWorkspaceName can suffix it.

Keep file.name as a display label and as the File object's native basename; path becomes the stable identity across all workspace operations. Store **Workspace.currentDTX** as that DTX relative path, not its basename. **parseDTXFile** and **switchDTXFile** accept the relative DTX path. DTXSwitcherModal selects/compares by path, displays the parent folder to distinguish identical names, and passes the path to its callback. Update the editor route's first-chart fallback to use path.

Use a small pure workspace-path helper alongside the existing browser workspace service for import normalization, case-insensitive path comparison, and ZIP collision keys. No general virtual filesystem or new persistent index.

### 2. Resolve chart audio by the referenced path

For each parsed DTX sound-chip reference:

1. Convert Windows backslashes in the reference to '/', resolve '.' and parent segments relative to the selected DTX's directory, and require the result to stay inside the workspace.
2. Look up that normalized relative path case-insensitively (NFC) in workspace.audioFiles. This gives the chart's own folder first, including references into nested Samples/ or a sibling Shared/ folder.
3. If absent, try the same reference relative to workspace root, then a **unique** workspace-wide basename match as a compatibility-free convenience for older chart conventions. Never silently choose one of several same-name candidates.
4. Resolve the chosen **WorkspaceFile record** to bytes: pinned SoundLibrary.getByHash for small files, WorkspaceService.getLargeFile(workspace.name, audioFile.path) for session-only large files. A missing hash, failed library lookup, or missing session file stays unresolved; never substitute another file from the global library.

Only selected, resolved audio belongs in the current chart's SimFile.files. Register it in FileManager under the key based on the chip's **reference filename** (the key WebFileProvider/Preview will request), not every workspace file's basename. Remove stale local keys on reparse, preserving remote keys. DTXSwitcherModal should trust this mapping and stop its separate basename rematch. Avoid putting File objects in Svelte sound-chip stores.

Ambiguous or missing audio does not play: log a path-qualified warning; do not add a new blocking modal. Duplicate *referenced* names within a DTX still map to the same resolved audio file.

### 3. Session cache and playback cache identity

Change the large-file session key and getLargeFile call sites to workspace name plus **relative path**. Keep the current session-only retention behavior; no IndexedDB or persistent large-file migration.

A chart switch must not reuse Phaser sound or decoded XA data for a same-named chip with different bytes. Validate the existing Preview lifecycle and implement the smallest **local-workspace-only** invalidation when the selected chart's audio mapping changes. The chosen implementation must clear the appropriate Phaser sound/audio and processed-blob cache entries before loading the new local sample; remote preview caching behavior stays unchanged. Include an explicit A-to-B-to-A playback regression.

### 4. ZIP entry paths and collisions

Use the persisted relative path, including directory segments, as the ZIP entry name for both DTX and audio. Preserve original spelling and case in the archive. Normalize *each path segment* to NFC and lowercase for collision detection and retain the existing Windows leading-space / trailing-space-or-dot handling per segment. Disallow empty, absolute, current-directory, or escaping parent paths rather than writing surprising ZIP entries. Check DTX/DTX, audio/audio, and DTX/audio collisions among the selected entries. Entries in different folders may share the same basename.

Keep HPA-567 behavior otherwise: preflight all selected entries; for audio export, read every file before writing it; retain Shift-JIS-or-UTF-8-BOM DTX encoding via WorkspaceService.toExportContent; preserve zero-byte DTX, the download path, and counts of actual entries. Include both conflicting relative paths in a collision error. DTX-only export is allowed even when audio is missing.

## Tests and acceptance

- Import a two-song fixture with repeated mas.dtx and kick.wav in separate folders: both charts have distinct path IDs; each resolves the correct pinned audio (including same-name large files); switching A→B→A preserves audio identity and preview output.
- Cover chart-relative nested paths, Windows backslashes, root-relative Shared/ fallback, ambiguous workspace-wide basename fallback (no arbitrary audio), hashless/failed small-audio lookup (no global substitution), and stale FileManager cleanup.
- Export ZIP entries under Song A/ and Song B/ rather than flat names; assert bytes by hash/session source, count correctness, DTX-only behavior, and no download on missing/unreadable audio.
- Permit duplicate basenames under distinct directories; reject identical full paths and NFC/case-insensitive equivalents, including DTX/audio cross-type conflicts; report both full paths.
- Flat-folder import, selection, preview and ZIP remain unchanged. Preserve zero-byte and Japanese text encoding regressions from HPA-567.

## Explicit non-goals

No migration of previously serialized root-prefixed paths, audio persistence overhaul, server-side ZIP APIs, native desktop workspace behavior, full draft-storage redesign, general path abstraction, or new UI flow. If unrelated draft persistence collisions are observed, track them separately instead of expanding HPA-834.

## Delivery

The design and implementation plan start this draft PR. Implement code, update tests, and obtain final review **on this same PR**; do not open a second implementation PR for HPA-834.