# HPA-567 — Workspace ZIP export integrity: implementation plan

**Status:** Planned, implementation not started  
**Linear:** https://linear.app/cwchanap/issue/HPA-567/dtxwebbug-prevent-incomplete-workspace-zip-exports  
**Design:** [2026-11-06-hpa-567-workspace-zip-export-design.md](../specs/2026-11-06-hpa-567-workspace-zip-export-design.md)  
**Delivery rule:** Exactly **one PR** for this ticket. This documentation draft is the branch to implement on; do not open a second PR for coding.

## Objective

Prevent silently incomplete ZIP exports from the browser editor. The selected export scope is atomic: required DTX entries (and audio when selected) are all present, or no ZIP download is started. Reuse the existing modal, JSZip, workspace service, sound library, and test harness.

## Files to change

- `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte` — export behavior, failure message, accurate success counts.
- `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts` — regression tests and correct mock defaults.
- The design and plan docs on this PR if reviews reveal a necessary correction.

Do **not** change `workspaceService.ts`, Cloudflare API, desktop ZIP upload flow, package dependencies, or ZIP layout for this issue.

## Task 1 — Add failing behavioral tests

Update the **existing** `ExportWorkspaceModal.test.ts` rather than creating a new harness.

1. In `beforeEach`, reset all behavior-changing mocks explicitly. Successful default workspaces currently declare an audio entry but the default sound-library lookup returns `[]`; make the default fixture fully resolvable, with `kick.wav` returning a `SoundLibraryFile` and `toFile` returning a matching `File`. Reset `getLargeFile` to undefined for each test.
2. Add the negative assertion shared by the incomplete-export cases:
   - `toastMock.error` receives a message containing the missing/failed filename.
   - `mockZipInstance.generateAsync` is **not** called.
   - `URL.createObjectURL` is **not** called.
   - `toastMock.success` and `onClose` are **not** called.
3. Cover: missing normal audio, `SoundLibrary.toFile` failing, missing large session-only audio, empty DTX content with at least one other valid DTX, and `zip.file` throwing for required DTX or audio.
4. Replace, rather than duplicate, the existing tests that expect silent skipping/continuation.
5. Add a DTX-only case: with checkbox off and audio absent, verify the export succeeds, audio lookup is not required, and the success message reports DTX-only.
6. Strengthen the all-files-present success case: verify names and number of `zip.file` calls, the actual success counts, a download URL and modal close. Keep existing tests for no-file and `generateAsync` failures.

**Expected red baseline:** Newly added negative tests fail against the current behavior. Do not accept a test that only checks the mock's own return value.

## Task 2 — Implement the minimal modal fix

Change `exportWorkspace(workspace)` without introducing a helper/service unless a tiny local function demonstrably removes duplication.

1. Replace `fileCount` with `addedDtxCount` and `addedAudioCount`, and track any required entry that cannot be included.
2. DTX loop: reject empty `content`; count only a successful `zip.file` addition; capture an add exception as a failure.
3. Audio loop (only if checkbox checked): reuse `WorkspaceService.getLargeFile` for large files and `SoundLibrary.findByFileName` + `SoundLibrary.toFile` otherwise. Treat missing/failed resolution and ZIP add errors as failed required entries.
4. After both loops, throw one descriptive error if any required entry failed. This must occur **before** `generateAsync` or creating the download anchor. For missing audio, direct the user to re-import or uncheck Include audio; for missing DTX, recommend re-importing.
5. Retain existing no-files guard and outer catch/finally. On success, report `addedDtxCount` and (when selected) `addedAudioCount`.
6. Avoid changes to unrelated modal state, storage lifetime, path handling, or page-level routing.

## Task 3 — Verify and review on the same branch

From the repository root:

~~~bash
bun install --frozen-lockfile
bun run --filter=dtx-web test -- src/lib/components/editor/modals/ExportWorkspaceModal.test.ts
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bunx eslint packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts
bunx prettier --check packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts docs/superpowers/specs/2026-11-06-hpa-567-workspace-zip-export-design.md docs/superpowers/plans/2026-11-06-hpa-567-workspace-zip-export.md
~~~

Record actual commands/results in the PR description after implementation. If workspace environment prevents tests, explicitly record what was not run; do not mark unverified checks passed.

## Review checklist

- [ ] Audio selected, missing small audio: named error, no ZIP.
- [ ] Audio selected, missing large session audio after reload: named error, no ZIP.
- [ ] Audio selected, `toFile`/`zip.file` fails: named error, no ZIP.
- [ ] Missing/empty DTX content: named error, no ZIP.
- [ ] Audio unchecked and missing: DTX-only export succeeds.
- [ ] Complete workspace: every selected entry added, accurate success counts and one download.
- [ ] No new service, dependency, migration, or second PR.
- [ ] Focused and full web tests, typecheck, formatting/lint commands verified.

## Merge boundary

This draft PR holds **design + plan only** initially. Once approved, commit the code and tests here, rerun checks, and mark the same PR ready for review. No backward-compatibility layer, feature flag, or separate follow-up implementation PR is needed.
