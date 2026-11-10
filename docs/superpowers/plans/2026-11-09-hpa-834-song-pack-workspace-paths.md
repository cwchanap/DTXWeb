# HPA-834 — Implementation plan for song-pack workspace paths

**Design:** [2026-11-09-hpa-834-song-pack-workspace-paths-design.md](../specs/2026-11-09-hpa-834-song-pack-workspace-paths-design.md)  
**Linear:** https://linear.app/cwchanap/issue/HPA-834/dtxwebbug-workspace-zip-exporteditor-cannot-handle-same-named-files-in  
**Delivery:** Continue on this single draft PR until code and tests are reviewed. No follow-up implementation PR.

## Working example / test fixture

Use a deterministic browser FileList fixture with webkitRelativePath:

~~~text
Pack/Song A/mas.dtx       #WAV01: kick.wav
Pack/Song A/kick.wav      A-audio-bytes
Pack/Song B/mas.dtx       #WAV01: kick.wav
Pack/Song B/kick.wav      B-audio-bytes
Pack/Shared/cymbal.wav    shared-bytes
~~~

For large-file tests, override File.size above the current threshold without allocating megabytes. For preview tests, verify the file actually passed to the audio loader after switching, not merely which name was found. Keep manual browser verification as a final check, not a replacement for unit tests.

## Task 1 — Canonical paths at import and in the session cache

**Likely files**
- packages/dtx-web/src/lib/services/workspacePaths.ts (small pure helper; create only if used by both service and exporter)
- packages/dtx-web/src/lib/services/workspaceService.ts
- packages/dtx-web/src/lib/services/workspaceService.test.ts

**Steps**
1. Derive the original selected source root from webkitRelativePath, independent of the generated workspace display name. Persist WorkspaceDTX.path and WorkspaceFile.path without that root segment; use file.name for direct File imports without a relative path.
2. Make Workspace.currentDTX the first DTX's *relative path*. Update parseDTXFile and switchDTXFile to find charts by path, including two entries both named mas.dtx.
3. Store sessionLargeFiles by workspace name + relative file path and change getLargeFile callers accordingly; retain clearSessionFiles semantics.
4. Add tests for flat folders, multiple same-name chart paths, suffixed workspace names after duplicate import, and distinct same-name large files by path.

**Done when:** No paths in the newly stored workspace have the selected root folder, and neither chart nor session lookup identifies a file by basename alone.

## Task 2 — Build the per-chart audio mapping once

**Likely files**
- packages/dtx-web/src/lib/services/workspaceService.ts
- packages/dtx-web/src/lib/services/workspaceService.test.ts

**Steps**
1. Build a lookup of workspace.audioFiles keyed by normalized relative path. Match each sound chip relative to dirname(dtxEntry.path), then workspace root, then an unambiguous workspace-wide basename. Normalize Windows separators and case; do not allow an escaping parent reference.
2. Resolve **the matched record's** actual bytes: use its SoundLibrary content hash or the path-keyed session cache. Do not pick from a workspace-wide array of Files by name and do not use global filename fallback for hashless/failed records.
3. Clear old local FileManager entries and register only the resolved files under local:chip-reference keys. Preserve unrelated remote entries. Keep SimFile.files limited to resolved audio needed by this DTX.
4. Test Song A and Song B referencing kick.wav and getting different content; also nested/Shared references, ambiguity, missing hashes, lost session audio, duplicate chip references, and stale local keys.

**Done when:** parseDTXFile('Song B/mas.dtx') cannot resolve or register the sample under Song A/ merely because both files have name kick.wav.

## Task 3 — Fix DTX selection and remove second audio rematch

**Likely files**
- packages/dtx-web/src/lib/components/editor/modals/DTXSwitcherModal.svelte
- packages/dtx-web/src/lib/components/editor/modals/DTXSwitcherModal.test.ts
- packages/dtx-web/src/routes/(game)/editor/[[simfileID]]/+page.svelte (only the fallback that names the first DTX)
- packages/dtx-web/src/tests/mocks/services.ts and affected editor route tests

**Steps**
1. In the switcher, use DTX path for button actions, active selection, switchDTXFile and optional onSwitchDTX callback. Show file.name and parent folder, so two mas.dtx buttons remain distinguishable.
2. Remove the switcher's separate basename search in simFile.files and its FileManager overwrite. WorkspaceService now owns the mapping. Keep sound-chip File references out of the Svelte store and keep the existing stop-preview / note-import behavior.
3. Update fixtures and tests to use path-based currentDTX. Preserve the flat-file case where path equals name.

**Done when:** The UI selects each same-named DTX independently and no component can overwrite the service's chosen sample with a basename match.

## Task 4 — Prevent stale preview audio on chart switch

**Likely files**
- packages/common/src/lib/game/scenes/Preview.ts (small change only if required)
- existing focused Preview/audio tests in packages/common, or a targeted test around the existing loader

**Steps**
1. Reproduce A → B → A preview with the same sound-chip filename and different audio bytes, including an already cached Phaser sound key and an XA processed-blob entry.
2. Apply the smallest local-workspace-only cache invalidation at the chart change / audio-source boundary. Ensure the previous Phaser sound and audio cache entry (and any matching processed XA blob) are discarded before loading new bytes. Do not alter remote chart cache keys or introduce a new cache service.
3. Add a focused regression proving the newly resolved File is loaded instead of an already-cached audio object. If the current scene lifecycle already reliably invalidates both caches, document the proof and do not introduce redundant code.

**Done when:** Changing DTX replays the currently selected song's sample, not a previously cached sample with the same name.

## Task 5 — Export paths, preserving HPA-567's fail-closed rules

**Likely files**
- packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte
- packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts
- packages/dtx-web/src/lib/services/workspacePaths.ts (shared normalization only)

**Steps**
1. Use each DTX/audio record's workspace-relative path as the JSZip entry name; keep original spelling and case.
2. Collision-check full paths segment by segment (NFC and case-insensitive, including existing Windows space/dot treatment). Reject identical full paths even if the file types differ, while accepting Song A/kick.wav and Song B/kick.wav. Refuse malformed/escaping archive paths.
3. Use the full relative path to retrieve large session audio; retain small-audio hash-based retrieval. Report both complete paths in collision errors and use the full path for missing or unreadable file errors.
4. Keep the existing preflight/read-then-zip flow, DTX encoding, empty DTX support, audio toggle, actual counts, single download, and no download on failure.
5. Test entries and actual bytes in a generated JSZip archive (not only mock calls) plus existing component behavior: nested layout, duplicate basenames allowed, exact/NFC/case collision rejected, missing session audio, hash errors, and DTX-only ZIP.

**Done when:** Exporting Pack creates Song A/ and Song B/ entries with distinct correct audio, while all genuine same-path collisions still fail before download.

## Task 6 — End-to-end regression and final review

Run focused checks from the repository root:

~~~bash
bun run --filter=dtx-web test -- workspaceService.test.ts
bun run --filter=dtx-web test -- DTXSwitcherModal.test.ts
bun run --filter=dtx-web test -- ExportWorkspaceModal.test.ts
bun run --filter=dtx-web check
# Only if packages/common was changed:
bun run --filter=@dtx/common test -- Preview.test.ts
bun run --filter=@dtx/common build
# Check formatting/lint for changed sources using the repository's configured tools.
~~~

Manual web-editor smoke test:
1. Import the fixture pack once and switch between both mas.dtx entries.
2. Preview kick.wav A → B → A; verify the correct distinct bytes/audio and no cross-folder reuse.
3. Export with audio; inspect the ZIP tree and samples. Repeat DTX-only.
4. Verify that an intentionally duplicate normalized *full path* fails without a ZIP; verify missing large audio after reload still fails with recovery instructions.
5. Import/export a flat folder and compare behavior to pre-HPA-834.

## Definition of done

- Linear acceptance criteria met: correct per-chart playback, path-preserving ZIP, no same-name large-file overwrites, correct full-path collision refusal, and unchanged flat-folder behavior.
- Focused regressions and package checks pass; no new dependency or infrastructure configuration.
- Implementation, tests, design adjustments, and reviews all land on **this same single PR**. Keep it draft until implementation is complete, then mark ready for review.