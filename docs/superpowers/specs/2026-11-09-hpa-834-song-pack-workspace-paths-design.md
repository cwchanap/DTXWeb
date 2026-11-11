# HPA-834 — Preserve song-pack paths in browser workspaces

**Status:** Design revised following [initial review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5836425886) and [second review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5837284291)  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Related completed fix:** HPA-567 / PR #340  
**Delivery:** The design, implementation, tests and final review all belong on draft PR #348 (one ticket, one PR).

## Problem: flattened identity affects more than ZIP export

HPA-567 correctly refuses a ZIP when flat filenames collide. But folder imports are modeled with file.name as the identity despite already recording webkitRelativePath:

- **workspaceService.ts:** Large audio lives under a session cache key of workspace name plus basename; parseDTXFile picks a DTX by basename, pools all audio by basename, and registers local:basename in FileManager. A pack containing multiple mas.dtx and kick.wav files cannot be selected or played reliably.
- **DTXSwitcherModal.svelte:** Uses the chart basename as the selection key, then rematches sound chips against SimFile.files by basename, overwriting correct FileManager entries even if workspaceService is fixed.
- **SoundTab.svelte:** When a local FileManager key is absent, falls back to searching SimFile.files by filename. This can turn an unresolved reference into the wrong song's sample. Leave SoundTab unchanged for desktop; avoid populating that fallback array for browser workspaces.
- **Preview.ts / soundChipPreparation.ts:** Phaser sound keys and the static XA processed-blob cache are based on sound-chip filename, not File identity. setupSoundsAsync skips an already-loaded key **before checking the current File**; changing songs can play a previous sample, or a missing reference can leave old audio playable.
- **ExportWorkspaceModal.svelte:** Writes file.name, not file.path, as the ZIP entry and collision key.

This is a browser workspace issue, with one **shared** audio-path rule extracted to common and a necessary common Preview cache fix. No desktop Rust, Cloudflare, D1, API, or dependency changes.

## Product contract and fixture

```text
Pack/
  Song A/mas.dtx              #WAV01: kick.wav; #WAV02: drums\cymbal.wav
  Song A/kick.wav             (audio A)
  Song A/drums/cymbal.wav
  Song B/mas.dtx              #WAV01: kick.wav
  Song B/kick.wav             (audio B)
```

Import creates one workspace. The two DTX entries are identified by **Song A/mas.dtx** and **Song B/mas.dtx**, not the shared basename. Playing A uses audio A; switching A→B→A uses the corresponding bytes, including when Phaser already has an audio entry for kick.wav. Missing references must stay silent, not play stale audio.

Export writes these five paths **relative to the selected Pack/ root** into one ZIP. Flat-folder workspaces keep root-level entries. Preserve HPA-567's all-or-nothing export behavior: if any selected audio is missing/unreadable or selected entries have colliding normalized _full paths_, refuse to download and show the offending paths. DTX-only export can succeed despite unavailable audio.

Previously imported root-prefixed workspace records are **not migrated**; re-import to use the new identity. Keep the session-only large-file policy.

## Design

### 1. Persist one workspace-relative file identity

Create a small, pure, browser-safe helper in packages/dtx-web/src/lib/services/workspacePaths.ts for:

- toWorkspacePath: strip the first segment of webkitRelativePath at import; fall back to file.name when no relative path exists; preserve the subfolders and original casing. Do not use workspace.name as the source root because a duplicate import may receive a suffixed workspace display name.
- normalized lookup key: NFC-normalize and lowercase a workspace-relative path for exact matching, preserving the original stored path.
- resolveChipPath: combine dirname(dtx.path) with a **valid normalized chip reference**, look it up by the full normalized path in an audio-file map, and return one matching WorkspaceFile or unresolved. Do not select a record when multiple stored paths collapse to the same key.
- zipCollisionKey: adapt the modal's existing per-name NFC/lowercase/Windows-space-and-dot collision key **per path segment** and join with '/'. It is a collision comparison only, not an archive path rewrite.

Store WorkspaceFile.path and WorkspaceDTX.path as those relative paths. Store Workspace.currentDTX as the selected DTX **path**. Parse and switch DTX files by path. Key sessionLargeFiles and getLargeFile by workspace name plus _relative audio path_; clearSessionFiles retains its existing workspace prefix rule.

The DTX switcher already renders dtxFile.path below dtxFile.name: simply change its action and active comparison to use path. No extra UI element needed.

### 2. Reuse the remote engine's one chart-relative #WAV rule

The existing packages/common/src/lib/audio/previewAudioEngine.ts already resolves #WAV against the selected chart directory with a strict rule:

- Convert backslashes to '/'; reject empty, '.' and '..' segments and absolute paths.
- Encode segments for remote URLs (already done by the engine); the browser workspace instead compares normalized relative **path keys**.

Extract the current **reference normalization/rejection** into a dedicated pure file, e.g. `packages/common/src/lib/audio/reference.ts`, and re-export it from `packages/common/src/lib/index.ts` as part of the **main `@dtx/common` entry point**. Import it from that entry point in `workspacePaths.ts` and directly within `previewAudioEngine.ts`. **Do not export/import it through `@dtx/common/audio`**: that barrel imports `previewAudioEngine`, which imports `browser/audioDecoder`, whose top-level `XAaudioContext` constructs an AudioContext at module evaluation. Keep the new helper/browser workspace utility SSR-safe, with a focused import/evaluation regression, and retain the current remote URL behavior and existing tests. Do not build a second, more permissive local rule.

Browser resolution: normalizedKey = NFC-lowercase(dirname(selected DTX relative path) + '/' + normalized sample ref). Select the **exact** audio record at that path. **No workspace-root fallback, global basename fallback, or parent-segment traversal**. The map lookup itself limits matches to imported workspace files; a separate containment check is unnecessary. A reference not under that DTX's own directory does not get another song's sample merely because the basename matches. If real packs require '..', handle it in the shared rule for both preview engines in a separately justified change.

After identifying the right WorkspaceFile:

- Small audio: resolve its pinned SoundLibrary hash; missing hash, failed conversion, or unavailable stored content means unresolved. Never use SoundLibrary's global filename fallback.
- Large audio: resolve with getLargeFile(workspace.name, audioFile.path) from session memory; absent after reload means unresolved.
- Clear old local: FileManager keys on parse while preserving remote keys. Register the resolved File under local:<chip-reference-string> because WebFileProvider, Preview and SoundTab request that key; do **not** register every available audio file by its basename.
- Leave new SimFile([]).files **empty** for these browser workspaces. SoundTab's legacy local fallback against SimFile.files then cannot select a wrong file; desktop keeps its current behavior. Delete parseDTXFile's redundant soundChip.file assignment, which is discarded by the switcher's second parseSoundChips call.
- Delete DTXSwitcherModal's independent SimFile.files rematch and FileManager overwrite. Set the store's sound chips from the parsed DTX, with File objects held only in FileManager. Unresolved references remain silent and may log a path-qualified warning.

### 3. Revalidate loaded audio against File identity in Preview

This is a **required** fix. The existing setupSoundsAsync filters by cacheKey before fetching and static soundCacheMap is not invalidated, so A→B with kick.wav can reuse A's audio.

Change **Preview.ts setupSoundsAsync** for all providers, without a local/remote branch:

1. **Deduplicate** the current sound chips by `getCacheKey(soundChip)` before any asynchronous provider lookup or `load.audio` call. Two chip IDs referring to `kick.wav` must trigger one load for that key per setup pass, while retaining both chip IDs and their independent volume/position semantics for playback. The existing `create()` currently calls `setupSoundsAsync()` and then `startPreview()` (which also calls it); remove this redundant initial invocation so the same chart does not start two overlapping setup passes.
2. Obtain `fileProvider.getFile(currentSimfileID, soundChip.fileName)` **before** deciding whether a cached key can be reused. Keep **`private static loadedFiles: Map<string, File>`** next to the existing static processed-XA `soundCacheMap`, and reuse the loaded Phaser sound/XA blob only when the current File is the same object and both Phaser audio and sound entries are valid.
3. When the File object changes **or is now missing**, stop/destroy the old sound, remove the Phaser audio cache entry, delete the static processed-XA blob entry and update/clear `loadedFiles` before any reload. An unresolved chip must not play a stale sample. On a changed File, load the new bytes; only mark `loadedFiles` after a confirmed usable load, not after the existing load-error/timeout fallback merely resolves the promise.
4. Account for cache lifetime carefully: static `loadedFiles` and `soundCacheMap` survive scene restarts, while Phaser audio cache is **game-scoped**, not global. Treat missing Phaser cache entries or invalid static mappings as cache misses and verify behavior after scene restart/game recreation. No separate cache service, audio hashing, local/remote branch or general new concurrency subsystem.

Web FileManager returns stable File objects within a parse, and DesktopFileProvider caches Files; remote/desktop retain cache reuse for identical objects. A local reparse recreates a File and rightly reloads it. Cover same-File, changed-File, missing-File, and A→B→A reuse, XA processed-blob invalidation, two chip IDs sharing one sample, and source tracking across scene restarts. Keep the change small: per-pass deduplication plus elimination of the duplicate initial setup, not a new loading queue.

### 4. Use path identities for ZIP entries; retain HPA-567 guarantees

In ExportWorkspaceModal, pass each DTX/audio record's **relative path** to JSZip instead of its basename. Compare collisions using zipCollisionKey on each full path (NFC and case-insensitive; preserve the existing leading-space/trailing-space-and-dot rules for each segment). This permits Song A/kick.wav and Song B/kick.wav and still rejects case/NFC-equivalent full paths, including cross DTX/audio collisions; name both paths in errors.

Use relative path when requesting session large audio. Keep hash-based small audio, preflight/read-then-zip, single download, actual entry counts, zero-byte DTX, text encoding via toExportContent, and the audio checkbox. **Do not add a second export-side path validator**: the path already came from browser webkitRelativePath and was normalized on import. The existing selection/collision checks are sufficient for this app.

## Test and acceptance matrix

- **Pure helpers:** root stripping, flat-folder fallback, case/NFC keys, backslash reference normalization, strict empty/dot/dotdot/absolute rejection, chart-relative nested path, no root/basename fallback, ambiguous normalized full path, and per-segment collision equivalence.
- **One workspace integration fixture:** Two mas.dtx and two kick.wav records with distinct content (small hashes and path-keyed large files); switching A/B picks the right file, stale local: keys are cleared, missing hashes/files never substitute another sample, and SimFile.files remains empty.
- **Switcher:** Distinct actions/active states for Song A/mas.dtx and Song B/mas.dtx. Existing path label suffices; no second audio rematch.
- **Preview:** Same File skips reload; changed File replaces Phaser sound/audio and old XA cache; a missing File evicts a previously loaded sample and stays silent; A→B→A loads each sample's bytes; two chip IDs referencing one sample issue one load per setup; scene restart/game recreation validates static identity against real Phaser cache; failed loads do not populate `loadedFiles`.
- **Real JSZip byte test:** Export nested entries and verify each entry's contents; accept duplicate basenames in different directories; fail on identical and NFC/case-equivalent full paths, missing/unreadable audio, and preserve DTX-only / zero-byte / Shift-JIS-or-BOM behavior.
- **Flat workspace:** import, switch, preview and export remain the same for newly imported flat folders.

## Scope and review disposition

Adopted from [initial review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5836425886): shared remote/local sample rule; required provider-agnostic Preview invalidation; SoundTab fallback addressed without modifying SoundTab; pure table-tested helpers; switcher change coupled to identifier change; no export-side path revalidation or redundant UI work. Remove the route's redundant targetDTX/if block, whose body only repeats currentWorkspace assignment. The optional sort-by-song-directory change is **deferred**: it does not affect identity or correctness and can be separately considered after the bug is fixed. From the [second review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5837284291), explicitly use the root `@dtx/common` pure export rather than the audio barrel; deduplicate same-key chip loads and remove the redundant setup call; and use static File identity tracking while validating Phaser's game-scoped cache on scene/game changes.

No new dependencies, persistent audio architecture, new UI flow, root/basename fallback ladders, full draft-storage redesign, cloud API work, desktop Rust work, or compatibility migration.

**One PR only:** Keep PR #348 draft while implementing and testing; do not create a second HPA-834 PR.
