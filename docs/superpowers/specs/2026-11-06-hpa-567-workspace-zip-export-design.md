# HPA-567 — Prevent incomplete or incorrect workspace ZIP exports

**Status:** Design updated after PR #340 review (implementation remains pending)  
**Linear:** https://linear.app/cwchanap/issue/HPA-567/dtxwebbug-prevent-incomplete-workspace-zip-exports  
**Reviews addressed:** [first pass](https://github.com/cwchanap/DTXWeb/pull/340#issuecomment-6703010130), [second pass](https://github.com/cwchanap/DTXWeb/pull/340#pullrequestreview-5810706437)  
**Delivery:** Continue implementing on the *same* draft PR #340.

## Problem and code evidence

`ExportWorkspaceModal.svelte` currently treats workspace ZIP construction as best-effort. It skips missing audio, catches `zip.file` failures, and reports the workspace metadata counts even if the ZIP contains fewer entries. In addition, its small-file lookup `SoundLibrary.findByFileName(name)[0]` is global: a different workspace's earlier `kick.wav` may be selected even though the ZIP appears complete. JSZip replaces an entry when the same flat filename is added twice.

The browser workspace stores DTX as decoded text; audio files at or under 2 MiB live in the shared sound library, while larger audio has a session-only `File` cache (`WorkspaceService.getLargeFile`). Reloading loses large files but retains workspace records.

## Product contract

An export is **all-or-nothing for the selected entries**:

| Option | Required entries | Failure |
| --- | --- | --- |
| **Include audio files** selected (default) | Every DTX record, **including a valid zero-byte DTX**, and every listed audio record | Abort without generating or downloading the ZIP |
| **Include audio files** unchecked | Every DTX record, including zero-byte files | Unavailable audio is irrelevant; DTX-only ZIP works |

- A zero-byte DTX is valid input for a faithful backup; never skip it based on empty content. If no files of any selected kind exist, show the existing no-files error.
- Every selected filename must map to **one unique flat ZIP entry**, including on case-insensitive extraction filesystems. Normalize selected names with `name.toLowerCase()` for collision checks across DTX/audio, while preserving original casing in `zip.file`. Fail for names that differ only by case (e.g. `BGM.ogg` and `bgm.ogg`) or match exactly (e.g. “Two files named bgm.ogg; import songs separately”). No ZIP layout change or silent overwrite.
- Every selected **small audio** record must have a content hash that identifies *that workspace's audio bytes*. Missing hash, missing hash match, or failed `toFile` conversion means the requested file is unavailable. Never substitute the oldest library file sharing the same name.
- For **large audio**, keep the current session-only lookup. If the file is gone after reload, say so: “bgm.ogg is only available until the page reloads. Uncheck Include audio files, or re-import the folder and **export the newly imported copy**.” Re-import creates a distinct workspace name (e.g. `Name (1)`), not a repair of the previous workspace.
- Failed `zip.file` additions are errors with the affected filename. No `generateAsync`, object URL, success toast, or modal close on a failure.
- Keep the modal open and show the error **inline above the workspace list** (`role="alert"` and `whitespace-pre-line` to preserve newlines in multi-item messages), as well as in the existing error toast. Preserve it until the next export attempt **or the modal is closed and reopened**; clear `exportWorkspaceError` in the existing `show`-true `$effect` when opening. Remove the unused 10-second clear timer.
- On success, count entries actually added to JSZip and retain the existing filename and single-download flow.

## Small-audio identity: reuse existing hash mechanism

`SoundLibrary.addFiles` already computes a SHA-256 content hash, persists it with each small file, and deduplicates identical contents. `SoundLibrary.getByHash` already resolves it. However `WorkspaceFile` currently has no hash; its `saveWorkspace` serializer explicitly selects only `name`, `path`, and `isLarge`. So the export cannot know which same-named audio file belongs to its workspace.

Make the smallest boundary change:

1. Change `SoundLibrary.generateFileHash(file)` from private to public static; keep the same implementation. Do not introduce a second hashing utility or change `addFiles`'s signature.
2. Add optional `hash?: string` to `WorkspaceFile`. During `WorkspaceService.importFolder`, compute and assign the content hash **for small audio files** (≤2 MiB) using that existing method. Continue to call `SoundLibrary.addFiles([file])`; no new storage.
3. Include `hash: af.hash` in the `saveWorkspace` audio-file serializer so it survives reload. Large audio continues using the existing in-session `File` cache, without a required hash.
4. In the export modal, use `SoundLibrary.getByHash(audioFile.hash)` followed by `SoundLibrary.toFile`. If a small audio record has no hash (e.g. imported before this change) or no resolvable data, fail with a named error and say to re-import and export the **new** workspace. **Do not add filename fallback** or a backward-compatibility migration.

The importer may hash a small audio file again when calling `addFiles`. This is acceptable for files capped at 2 MiB; avoid a new API just to deduplicate that cheap work.

## ZIP construction: keep it in the modal

Update only the existing `exportWorkspace(workspace)` flow:

1. Use a single `Set<string>` of **lowercased** selected/added flat names (including across DTX and audio) to detect duplicates, including case variants. Use `name.toLowerCase()` only as the comparison key, not for the file added with `zip.file(name, ...)`. Track duplicate names independently of missing audio. A duplicate is a failure, not an overwrite.
2. Always call `zip.file(dtxFile.name, dtxFile.content)` for each nonduplicated DTX record, even if content is `''`; increment `addedDtxCount` after a successful call. A thrown add error is reported with the DTX filename via the existing outer catch.
3. When audio is selected, for each nonduplicated audio record:
   - Large: resolve `WorkspaceService.getLargeFile(workspace.name, audioFile.name)`.
   - Small: require `audioFile.hash` and resolve `SoundLibrary.getByHash(audioFile.hash)` → `SoundLibrary.toFile`.
   - Collect unavailable audio names and their useful recovery hints. Only call `zip.file` after resolution and increment `addedAudioCount` after successful addition. A thrown add error is reported with the audio filename.
4. If any missing-audio or duplicate-name errors were collected, throw **one** informative error through the existing outer `catch` before `generateAsync`. Keep the error categories separate so the recovery text is accurate.
5. If no entries were added, use the existing “No files found in workspace to export” failure. Otherwise generate and download one ZIP. The success toast reports `addedDtxCount` and `addedAudioCount`.

Do not extract a cross-package export service, conflate this with `parseDTXFile` playback lookup, add an up-front availability precheck, or change the persistent-large-file policy.

## Tests and regression requirements

Modify the **existing** suites rather than create another test framework.

**`ExportWorkspaceModal.test.ts`**

- Add a default `hash: 'mock-hash-kick'` for the small `kick.wav` in the shared `packages/dtx-web/src/tests/mocks/services.ts` `makeWorkspace` fixture; it is used by the modal's hoisted workspace mocks. Add a `getByHash` mock to the modal test's `soundLibMock`, and ensure the default hash resolves the matching file through `getByHash`/`toFile`. Explicitly reset `getByHash`, `toFile`, `getLargeFile` and `zip.file` implementations in `beforeEach`; `vi.clearAllMocks()` alone does *not* reset them.
- Add a tiny local helper for the repeated render → find-workspace-button → click sequence.
- In failure tests, **wait until the error toast or inline alert appears** before asserting that `generateAsync`, `URL.createObjectURL`, `onClose` and the success toast have *not* been called.
- Test missing hashed small audio, old small audio with no hash, same-named audio across workspaces (the correct workspace hash must win), missing large session audio with “newly imported copy” guidance, exact-name and **case-only** ZIP collisions (DTX/DTX, audio/audio and DTX/audio where useful), and `zip.file` errors.
- Zero-byte DTX is exported faithfully. Change the old “no exportable files” fixture to have `dtxFiles: []` and `audioFiles: []`, not an empty DTX content string.
- Verify DTX-only export ignores missing audio, and a fully available export adds the correct unique entries, reports actual counts, creates one download, closes, and clears any previously displayed error on a new attempt **and when reopened**. Exercise an alert containing newlines and verify it has `whitespace-pre-line` for readable multi-item errors.
- Replace the existing tests that assert skipping missing files or continuing after add failures. Remove the 10-second-timer test because the timer is removed.

**`workspaceService.test.ts` and `soundLibrary.test.ts`**

- Assert that a small audio import stores the correct content hash on its `WorkspaceFile` and that `saveWorkspace` retains the field in localStorage.
- Assert large audio remains session-only (no hash required) and remains available through the current cache for the same workspace session.
- Reuse existing hash tests/mocks; only extend `soundLibrary.test.ts` if public `generateFileHash` needs a focused direct regression.

## Scope, risk, and non-goals

- **Files:** `ExportWorkspaceModal.svelte`, its test, `workspaceService.ts`, its test, `soundLibrary.ts`, the shared test fixture `packages/dtx-web/src/tests/mocks/services.ts`, and `soundLibrary.test.ts` only if necessary. The boundary expands slightly beyond the original modal-only proposal to fix **wrong content**, not to add infrastructure.
- No new libraries, D1/Cloudflare changes, upload endpoints, ZIP directory layout, persistent audio cache, new UI dialog, or second PR.
- No compatibility fallback for pre-fix workspaces with no hash. The error explicitly asks for a fresh import/new copy.
- **Separate follow-up (not HPA-567):** DTX strings are decoded on import and serialized as UTF-8 by JSZip; on re-import, `importFolder` tries Shift-JIS first with a weak ASCII-header validator, potentially producing mojibake in Japanese titles. This is a distinct **text encoding round-trip fidelity** issue. Keep it visible for a later ticket and focused byte-level regression; do not mix an encoding overhaul into this ZIP completeness PR.

## Acceptance criteria

- No export is reported successful when a selected entry is missing, an entry-add fails, or flat entry names collide **case-insensitively** (e.g. `BGM.ogg` vs `bgm.ogg`).
- Distinct workspaces with same-named but different audio content export their own bytes, selected by hash.
- An empty DTX can be backed up.
- Unavailable large audio after reload produces a filename-specific, readable multiline inline error that explains the need to export the **new** imported workspace or use DTX-only. The error clears when the modal is reopened or a new attempt starts.
- Focused tests, web typecheck, and relevant lint/format checks pass on the same PR.
