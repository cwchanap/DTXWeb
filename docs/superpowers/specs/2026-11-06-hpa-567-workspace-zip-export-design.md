# HPA-567 — Prevent incomplete workspace ZIP exports

**Status:** Proposed design (documentation-only draft)  
**Linear:** https://linear.app/cwchanap/issue/HPA-567/dtxwebbug-prevent-incomplete-workspace-zip-exports  
**Repository:** DTXWeb  
**Implementation:** Complete on this same PR after design review.

## Problem and evidence

The web editor's `ExportWorkspaceModal.svelte` builds a ZIP from browser workspace records. Its present algorithm treats failed entries as best-effort:

- An empty DTX `content` string is omitted.
- A normal audio entry absent from `SoundLibrary.findByFileName` (or whose `toFile` returns null) is omitted.
- A large audio entry absent from the session-only `WorkspaceService.getLargeFile` cache (for example, after reload) is omitted.
- A thrown `zip.file` call is caught and skipped.
- Provided any other entry was added, `generateAsync` runs, the modal closes, and the success toast reports the *declared* counts (`workspace.dtxFiles.length` and `workspace.audioFiles.length`), even for absent entries.

Existing tests in `ExportWorkspaceModal.test.ts` explicitly accept silent omissions and per-entry failures. This can produce an incomplete backup that looks complete.

## Product contract

An export is **all-or-nothing for the selected scope**:

| User option | Required ZIP entries | Missing entry outcome |
| --- | --- | --- |
| Include audio files **on** (default) | Every DTX in `workspace.dtxFiles` plus every audio entry in `workspace.audioFiles` | Abort with error; no download |
| Include audio files **off** | Every DTX in `workspace.dtxFiles` | Missing audio is irrelevant; DTX-only ZIP can download |

- Empty/missing DTX content counts as unavailable, not a valid exported chart.
- An unavailable audio object (both regular sound-library and large session-cache paths), failed audio conversion, or thrown ZIP entry add counts as unavailable.
- A workspace with no included entries still shows the existing no-files error.
- When required files are unavailable, keep the modal open and display an actionable error identifying the failed file name(s). Mention re-importing the folder or selecting DTX-only export if audio is missing.
- Once **every selected entry** has been added, generate one ZIP and download as today. The success toast uses the number of entries *successfully added*, not metadata counts.
- Preserve existing ZIP filename sanitization, include-audio checkbox, single workspace-select button, and modal-close behavior on success.

## Technical design

Change **only the existing** `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte` and its component tests.

Inside `exportWorkspace(workspace)`:

1. Retain the existing `new JSZip()` and file-resolution paths. Track `addedDtxCount`, `addedAudioCount`, and an array of failed-entry names (optionally include whether each is DTX or audio).
2. For every DTX record, require nonempty `content` and a successful `zip.file(dtx.name, dtx.content)`. Otherwise record that DTX as failed. Do not count it.
3. Only when the checkbox is checked, resolve each audio record through the existing paths:
   - `isLarge`: `WorkspaceService.getLargeFile(workspace.name, audioFile.name)`.
   - Otherwise: the first entry from `SoundLibrary.findByFileName(audioFile.name)`, passed through `SoundLibrary.toFile`.
   Require a resolved `File` and successful `zip.file(audioFile.name, file)`; otherwise record the audio name as failed. Do not count it.
4. Before calling `zip.generateAsync`, if **any required** entry failed, throw one descriptive error from the existing outer `try/catch`. It should identify the affected entry(s) and an appropriate retry path. Reuse `exportWorkspaceError` and `toastStore.error`; do not add another state machine or modal.
5. If no entries were added, preserve the existing no-files error. Generate only after every required entry is accounted for.
6. Report `addedDtxCount` and `addedAudioCount` on success; retain existing download via `URL.createObjectURL`, temporary anchor, and `URL.revokeObjectURL`.

A failure to write an entry is an export error; it should never be silently accepted as a best-effort success. The outer `finally` already resets the exporting indicator and selection.

### Failure UX

Examples of acceptable text (copy can be tightened in implementation):

- Audio missing: “Cannot export with audio: kick.wav is unavailable. Re-import the folder or export DTX files only.”
- DTX missing: “Cannot export: basic.dtx has no available chart content. Re-import the folder.”
- ZIP entry failure: “Cannot add advanced.dtx to the ZIP. Please retry.”

Use one error toast, plus the existing error state; do not emit a success toast, close the modal, or create the download URL for failed exports. No new i18n architecture is required for this existing hard-coded-copy component.

## Tests

Update `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts` using its current Vitest/Svelte Testing Library and JSZip mocks:

1. Fix successful fixture defaults: a mock workspace declaring `kick.wav` must also resolve `kick.wav` from the sound library. Keep the mocks explicitly reset in `beforeEach` so failure cases cannot leak into other tests.
2. Successful include-audio export: assert that both DTX records and requested audio are added, `generateAsync` runs once, download URL is created, success reports exact included counts, and `onClose` fires.
3. Missing normal audio (lookup empty or conversion fails) and missing session-only large audio: assert named error and **no** `generateAsync`, URL creation, success toast, or close.
4. Empty DTX content and thrown `zip.file` (test DTX and audio paths): assert abort rather than best-effort continuation.
5. With audio disabled, even if declared audio is missing, the DTX-only ZIP succeeds and no audio lookup/ZIP addition is required.
6. Keep existing coverage for empty workspaces, ZIP generation errors, rendering, checkbox, and Cancel.

Replace the old “skips large audio” and “catches per-file error and continues export” expectations; they encode the bug.

## Scope boundaries and decisions

- **Use current services.** No new export abstraction, backup format, IndexedDB migration, server API, or dependency.
- **Keep stored-workspace semantics.** Large audio is intentionally held in session memory; missing data after reload is surfaced, not reconstructed from stale metadata.
- **Do not rework ZIP path layout or same-name collision behavior** in this bug-fix slice. This issue targets silently absent entries, not ZIP hierarchy semantics.
- **Do not extend to desktop Google Drive uploads.** That is a separate export path.
- **Do not split PRs.** This planning draft becomes the implementation PR; additional commits on the same branch finish the work.

## Acceptance

- No incomplete ZIP can be downloaded and announced as complete within the selected export scope.
- Failure names required unavailable/failed entries and offers a practical recovery path.
- DTX-only export stays usable when audio is missing.
- Success counts are based on entries actually added.
- Focused component tests, web typecheck, and applicable lint/format checks pass.

## Source references

- [Web export modal](../../../packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte)
- [Export modal tests](../../../packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts)
- [Workspace service](../../../packages/dtx-web/src/lib/services/workspaceService.ts)
