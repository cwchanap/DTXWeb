# HPA-834 — Single-PR implementation plan: path-aware song packs

**Design:** [2026-11-09-hpa-834-song-pack-workspace-paths-design.md](../specs/2026-11-09-hpa-834-song-pack-workspace-paths-design.md)  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Reviews:** [First design review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5836425886), [second design review](https://github.com/cwchanap/DTXWeb/pull/348#pullrequestreview-5837284291)  
**Delivery:** Implement and test on **this same draft PR #348**; no separate implementation PR.

## Test fixture used throughout

Use a deterministic browser FileList with webkitRelativePath:

~~~text
Pack/Song A/mas.dtx            #WAV01: kick.wav; #WAV02: drums\cymbal.wav
Pack/Song A/kick.wav           A-audio-bytes
Pack/Song A/drums/cymbal.wav   cymbal-bytes
Pack/Song B/mas.dtx            #WAV01: kick.wav
Pack/Song B/kick.wav           B-audio-bytes
~~~

Use distinct audio bytes and pinned SoundLibrary hashes to detect accidental basename selection. Simulate large files by overriding File.size above the existing threshold, avoiding large allocations. A missing/unresolvable file must not play a previously cached sample. Export tests should inspect actual JSZip bytes.

## Step 1 — Import identity, large files, and DTX switcher together

**Files**
- packages/dtx-web/src/lib/services/workspacePaths.ts (new small pure helper; used by service and export)
- packages/dtx-web/src/lib/services/workspacePaths.test.ts
- packages/dtx-web/src/lib/services/workspaceService.ts and .test.ts
- packages/dtx-web/src/lib/components/editor/modals/DTXSwitcherModal.svelte and .test.ts
- packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.svelte (remove dead fallback)
- Affected route/mock fixtures only

**Work**
1. Add toWorkspacePath(webkitRelativePath, file.name), a normalized NFC/lowercase path key, and per-segment zipCollisionKey to the pure workspacePaths helper. The selected root directory is the *first browser path segment*, not the possibly suffixed workspace.name.
2. Persist WorkspaceDTX.path and WorkspaceFile.path relative to that root. Set Workspace.currentDTX to the DTX **path** and update parseDTXFile / switchDTXFile to identify the chart by path. Existing flat imports have path === name.
3. Change large-file session cache writes, getLargeFile reads and export call sites to workspace name + **relative path**; preserve clearSessionFiles prefix behavior and session-only retention.
4. Change the switcher buttons/active comparison to DTX path **in the same step** as the identity change. Keep the already-rendered dtxFile.path; remove its independent SimFile.files basename lookup and FileManager overwrite, while keeping store/event behavior.
5. Drop the onSwitchDTX callback argument because the only parent consumer takes no arguments; remove the route's dead targetDTX/if block, whose body only reassigned currentWorkspace.

**Tests:** Pure helper table (root stripping, case/NFC, flat paths, per-segment collisions); two same-named mas.dtx button actions, selected state; path-keyed large-file independence across two folders; generated workspace-name suffix; existing flat folder behavior.

**Done:** Duplicate mas.dtx files are independently selectable; no active-chart or session-file lookup keys off basename. The switcher is never left broken by a partial identifier migration.

## Step 2 — Share the existing remote sample-path rule and map web audio once

**Files**
- packages/common/src/lib/audio/previewAudioEngine.ts
- packages/common/src/lib/audio/previewAudioEngine.test.ts
- packages/common/src/lib/audio/reference.ts (new **pure** file for audio-reference normalization) and its tests
- packages/common/src/lib/index.ts (main barrel export; **not** audio.ts)
- packages/dtx-web/src/lib/services/workspacePaths.ts and .test.ts
- packages/dtx-web/src/lib/services/workspaceService.ts and .test.ts

**Work**
1. Extract the current backslash-to-slash normalization and reject-empty/dot/dotdot/absolute-segment check from `previewAudioEngine.ts` into pure `audio/reference.ts`. Re-export only the pure helper from the main `@dtx/common` barrel (`src/lib/index.ts`), and import that from browser `workspacePaths.ts`. **Never import it via `@dtx/common/audio`**: that loads `previewAudioEngine` → `browser/audioDecoder` → top-level `new XAAudioContext()`. Reuse the helper in `previewAudioEngine` without changing existing URL encoding or fetch behavior; add an SSR-safe import/evaluation regression.
2. Implement pure resolveChipPath(dtxRelativePath, chipRef, audioKeys): normalize the chip ref via the shared helper, join it to dirname(dtxRelativePath), NFC/lowercase the full relative path, and match that exact key in the workspace audio map. If absent or multiple files collapse to that normalized full path, return unresolved. **No root fallback, basename fallback, parent traversal, or extra containment algorithm.**
3. In parseDTXFile, resolve each chip to its **WorkspaceFile**, then resolve audio bytes by that record's stored hash (small audio) or path-keyed session file (large audio). Failed hash/library/session lookups must never substitute another file by filename.
4. Reuse the existing FileManager local: cleanup and register resolved Files by the sound-chip's **original reference key** so WebFileProvider/Preview/SoundTab find them. Leave SimFile.files **empty** for browser workspaces to prevent SoundTab's legacy basename fallback (retain it in common for desktop). Delete redundant soundChip.file assignment and the old pooled-all-files code. Do not reintroduce the switcher's rematch.
5. Log path-qualified warnings on unresolved chips and keep those chips silent. Preserve the current DTX parsing/stores.

**Tests:** Pure table tests for backslashes, nested paths, Unicode NFC/case equivalence, rejection of '.'/'..'/empty/absolute refs, no root/basename fallback, normalized-path ambiguity, and flat folders. Confirm `@dtx/common` main-barrel import does not evaluate an `AudioContext` on SSR/test module load. One service-level integration fixture for A/B bytes, stale local-key cleanup, missing hashes/session files, empty SimFile.files, and no wrong-file substitution. Retain existing PreviewAudioEngine regressions (URLs and traversal).

**Done:** Each song resolves only its own referenced audio, and the web/remote normalization rule has one implementation.

## Step 3 — Required Preview cache invalidation by File identity

**Files**
- packages/common/src/lib/game/scenes/Preview.ts
- packages/common/src/lib/game/scenes/Preview.test.ts

**Work**
1. Deduplicate the current `soundChips` by `getCacheKey(soundChip)` **before any async provider lookup or loading**. Two chips referring to `kick.wav` are still separate playback events but must resolve/load their shared source only once per setup pass. Also remove the duplicate initial `setupSoundsAsync()` call in `create()`: its following `startPreview()` already invokes setup. Keep this a small local fix, not a new concurrency framework.
2. Obtain `fileProvider.getFile` before the “already loaded” check. Declare **`private static loadedFiles: Map<string, File>`** next to the existing static `Preview.soundCacheMap`. The source-map tracks what File populated each sound key across scene restarts; Phaser audio remains game-scoped, so a missing Phaser cache entry must still force a reload instead of trusting the static map.
3. Reuse a cached sound only if the currently resolved File is the **same object** and both Phaser cache and sound-manager entries are valid. On a changed File, stop/remove stale sound/audio/processed XA blob, clear the previous source map entry, and load the new File.
4. **If the current File is missing**, evict its old sound, audio blob and `loadedFiles` entry and avoid playback. A→missing must be silent. Record the new File **only on confirmed successful load** (`filecomplete`/usable cache), not merely when the existing error or timeout callback resolves.
5. Keep no local/remote branch or new cache service. FileManager and DesktopFileProvider return stable File objects within a parse/cache lifetime. Test restart and game recreation to ensure static File mapping is never trusted without valid Phaser cache/sound entries.

**Tests:** Extend the existing setupSoundsAsync “already loaded” test around Preview.test.ts:1050 for: two chips sharing one filename perform **one load**; same File skips; different File invalidates and reloads; changed XA File invalidates the processed blob; missing File removes old sound and stays silent; A→B→A uses the correct audio source; scene restart preserves useful source tracking; game recreation or a missing Phaser cache does not reuse stale bytes; load errors/timeouts do not mark a File as cached. Check that `create()` only starts one initial setup pass. Keep remote/desktop behavior unchanged for the same File.

**Done:** Cache reuse never overrides the latest provider mapping for a chart or leaves a missing sample audible.

## Step 4 — Preserve relative paths in ZIP without weakening HPA-567

**Files**
- packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte and .test.ts
- packages/dtx-web/src/lib/services/workspacePaths.ts and .test.ts (reuse helpers from step 1)

**Work**
1. Write each selected DTX/audio using its persisted **relative path** as JSZip entry name.
2. Use the per-segment zipCollisionKey for a whole-path collision map. Preserve original case/path in entries while rejecting identical and NFC/case-equivalent selected full paths, including cross-type collisions. Allow duplicate basenames in different directories. **Do not add a second archive-path validation pass**; browser-derived paths were normalized at import.
3. Resolve large audio through getLargeFile(workspace.name, audioFile.path), and small audio by stored hash. Name full relative paths in missing/unreadable/collision errors.
4. Keep HPA-567's preflight, all-or-nothing read-before-ZIP, actual entry counts, DTX encoding, zero-byte DTX, audio checkbox and single-download behavior.

**Tests:** Use a real JSZip archive to inspect exact Song A/ and Song B/ entry names and bytes (including two different kick.wav files). Cover DTX-only ZIP, missing session audio after reload, hash miss, unreadable source, same-full-path and NFC/case-equivalent collisions, cross-type collision, flat-folder export, zero-byte and Shift-JIS/UTF-8-BOM DTX.

**Done:** Song-pack ZIP mirrors the source hierarchy with correct bytes; genuinely colliding paths still fail before download.

## Step 5 — Verify and finish the single PR

After **every implementation step**, run the affected focused tests plus the full dtx-web and @dtx/common suites and the common build, not merely the initial workspace-service tests:

~~~bash
bun run --filter=dtx-web test
bun run --filter=@dtx/common test
bun run --filter=@dtx/common build
bun run --filter=dtx-web check
# Focused investigations as useful:
bun run --filter=dtx-web test -- workspaceService.test.ts
bun run --filter=dtx-web test -- DTXSwitcherModal.test.ts
bun run --filter=dtx-web test -- ExportWorkspaceModal.test.ts
bun run --filter=@dtx/common test -- Preview.test.ts
bun run --filter=@dtx/common test -- previewAudioEngine.test.ts
# Apply repository formatting/lint to changed files.
~~~

Manual browser smoke checks:
1. Import the two-song pack once, select both mas.dtx paths, and preview A→B→A.
2. Check an invalid/missing same-named sample stays silent instead of playing prior audio.
3. Export ZIP with audio, inspect the hierarchy and exact audio bytes; repeat DTX-only.
4. Confirm duplicate normalized full paths abort export with both relative paths named; missing large audio after reload still provides a recovery hint.
5. Import/export a flat song folder and verify the old behavior.

**Completion criteria:** Two independent songs import and play their own samples; same-name large files do not overwrite; ZIP preserves hierarchy and all-or-nothing correctness; full-path collisions still fail; flat imports remain correct. All changes and review follow-ups land **on PR #348 only**; leave it draft until implementation is complete.

## Review decisions and exclusions

Accepted the first review's seven simplifications: reuse the remote #WAV rule, require provider-agnostic Preview invalidation, leave web SimFile.files empty to neutralize SoundTab's basename fallback, use pure helpers, couple DTX identity and switcher updates, remove duplicate export validation, and reuse the existing switcher UI. Accepted the second review's three refinements: export the helper from the SSR-safe main common barrel rather than the audio barrel, deduplicate chips by cache key to avoid concurrent same-key loads, and make `Preview.loadedFiles` static with tests for scene/game lifetimes and missing entries. We also remove `create()`'s redundant initial setup call discovered while validating concurrent loading. Sorting the DTX switcher by parent directory is **optional and deferred**. No compatibility migration, new concurrency framework, infrastructure, dependencies or second PR.
