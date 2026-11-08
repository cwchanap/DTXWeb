# HPA-567 — Workspace ZIP integrity: implementation plan

**Status:** Implemented and verified on PR #340; see Task 4 results below  
**Linear:** https://linear.app/cwchanap/issue/HPA-567/dtxwebbug-prevent-incomplete-workspace-zip-exports  
**Design (source of truth):** [2026-11-06-hpa-567-workspace-zip-export-design.md](../specs/2026-11-06-hpa-567-workspace-zip-export-design.md)  
**Reviews:** [initial feedback](https://github.com/cwchanap/DTXWeb/pull/340#issuecomment-6703010130), [latest review](https://github.com/cwchanap/DTXWeb/pull/340#pullrequestreview-5810706437)  
**PR rule:** Exactly **one PR**, #340. Implement and verify on this same branch; no second implementation PR.

## Goal and current defect

The browser editor's ZIP export skips unavailable entries, may substitute unrelated same-named audio from the global sound library, and can overwrite duplicate flat ZIP names. Its toast still claims that every workspace file was exported. Preserve the existing UI/services and make the selected export scope complete and content-correct.

## Files

| File                                                                             | Change                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/dtx-web/src/lib/services/soundLibrary.ts`                              | Expose existing `generateFileHash` as public static; no new hash implementation                   |
| `packages/dtx-web/src/lib/services/workspaceService.ts`                          | Optional small-audio `hash`, compute during import, serialize it during save                      |
| `packages/dtx-web/src/lib/services/workspaceService.test.ts`                     | Verify imported hash and persisted workspace copy                                                 |
| `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte`  | Hash-based lookup, duplicate-name detection, atomic ZIP, persistent inline error, accurate counts |
| `packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts` | Replace skip-on-error assertions with behavior regressions; reset hash-aware mocks                |
| `packages/dtx-web/src/tests/mocks/services.ts`                                   | Give shared `makeWorkspace()`'s default small audio a fixture hash                                |
| `packages/dtx-web/src/lib/services/soundLibrary.test.ts`                         | Only if needed to verify newly public hash method                                                 |

This is a **small cross-file correction to the existing ownership seam**; do not create an export service, change the ZIP's flat name layout, modify backend APIs, or migrate storage.

## Task 1 — Prove the bug with failing focused tests

Use the existing Vitest suites and mocks; add no test infrastructure.

1. In the shared `packages/dtx-web/src/tests/mocks/services.ts`, add `hash: 'mock-hash-kick'` to `makeWorkspace()`'s default `kick.wav` record; this keeps its default small-audio fixture valid for consumers. In `ExportWorkspaceModal.test.ts`, add `getByHash` to the hoisted `soundLibMock` and set successful defaults **explicitly in `beforeEach`**: `getByHash('mock-hash-kick')` finds the expected record, `SoundLibrary.toFile` resolves its bytes, and large-file lookup returns undefined by default. Reinitialize mocks with `mockReset`/`mockImplementation` as appropriate; `vi.clearAllMocks()` only clears call history. Remove filename-based lookup assumptions and the `toFile` mock that leaks an inline assertion.
2. Add a **local `clickExport(workspaceName)` helper** to avoid copy-pasting render/spy/find/click boilerplate. Keep download-link spies restored properly so they cannot leak between tests.
3. Replace tests that deliberately accept silent skipping of missing large audio and `zip.file` errors. Cover:
    - Missing small-audio hash and hash with no matching stored bytes.
    - Same-named audio in two workspaces with different hashes: export the selected workspace's actual bytes, not the first filename match.
    - Missing large cached audio after reload: inline error names the file and says to uncheck audio or export the **newly imported copy**.
    - Duplicate names among selected entries (DTX/DTX, audio/audio, DTX/audio), including **case-only variants** such as `BGM.ogg` versus `bgm.ogg`: no ZIP and error names collision.
    - `zip.file` failures for required DTX and audio: no ZIP and affected filename appears in error.
    - A valid **empty-string DTX** is included in ZIP; no-files test now uses zero records, not a zero-byte DTX.
    - Audio unchecked: with audio unavailable, only DTX is required and export succeeds.
    - Complete default export: expected unique entry names, actual DTX/audio counts, one generate/download, one success toast, modal closes.
4. For every failure test, **await a visible error toast or inline alert first**, then assert `generateAsync`, `URL.createObjectURL`, `toastStore.success` and `onClose` have not run. Immediate negative assertions just after `fireEvent.click` can pass before the async function finishes.
5. Verify the visible inline message persists until the next attempt, then clears. Also close and re-open the same modal with `show` toggled false→true and assert the previous error no longer appears. Use an error with newline-separated entries to verify the alert applies `whitespace-pre-line`. Remove the no-longer-relevant timer-clear test.

**Expected:** New failure tests fail on current source. Tests must interact with the rendered modal, not just assert mocked services' values.

## Task 2 — Pin small audio to workspace content

In `soundLibrary.ts`, make `generateFileHash(file)` public static, retaining SHA-256 and existing implementation.

In `workspaceService.ts`:

1. Add `hash?: string` to the audio `WorkspaceFile` type.
2. During `importFolder`'s audio case, calculate the hash for **small audio only** (at most 2 MiB) via `await SoundLibrary.generateFileHash(file)`; record it on the `WorkspaceFile`. Keep the current call to `SoundLibrary.addFiles([file])`. Its own hash computation can remain; do not expand its API or add abstractions for one small duplicate digest.
3. In `saveWorkspace`'s explicit audio projection, include `hash: af.hash`. Without this, the hash is lost during a reload.
4. Do not require hashes or change the existing `sessionLargeFiles` logic for large audio.

Add `workspaceService.test.ts` assertions for correct small-audio hash, actual persisted field in `dtx_workspaces`, and unchanged large-file behavior; adjust the existing sound-library mock so it exposes `generateFileHash`. If a direct public hash-method test is useful, put it in the existing `soundLibrary.test.ts`, not a new file.

## Task 3 — Enforce complete, correct ZIP entries in existing modal

In `ExportWorkspaceModal.svelte`'s current `exportWorkspace`:

1. Track `addedDtxCount` and `addedAudioCount`, a `seenNames: Set<string>` of **lowercased flat names** (`name.toLowerCase()`), and two failure groups (`missingAudio` and `duplicates`). Only selected entries participate in collision detection. Preserve original casing in `zip.file(name, ...)` so case-only collisions fail before Windows/macOS extraction can overwrite a file.
2. For each DTX record: detect duplicate flat name; otherwise add `zip.file(name, content)` even if `content === ''`; increment DTX count only after addition succeeds. Wrap exceptions to identify the DTX filename and let the outer catch show them. A zero-byte DTX is a valid backup entry.
3. If Include audio is checked, for each audio record: detect duplicates across both categories, then resolve:
    - Large: `WorkspaceService.getLargeFile(workspace.name, audioFile.name)` (no persistence change).
    - Small: require `audioFile.hash`, resolve `SoundLibrary.getByHash(hash)`, then `SoundLibrary.toFile`. **Never fall back to `findByFileName`**.
      On missing data, append filename + actionable reason to `missingAudio`. On `zip.file` failure, include the file name in the thrown error. Count only successful adds.
4. Before `zip.generateAsync`, throw **one** combined error if any selected names are duplicated or any selected audio is missing; do not invoke ZIP generation, download link, success toast or modal close. For large audio, mention that it lasts only until reload; after re-import, user must **export the new workspace copy**. For a legacy no-hash workspace, ask user to re-import and export the new copy. The existing DTX-only toggle remains a recovery path if only audio is missing.
5. Add one conditional inline `role="alert"` region above the workspace choices, rendering existing `exportWorkspaceError` with Tailwind `whitespace-pre-line` so newline-separated filenames and recovery advice remain readable. Keep the error until the next export attempt; also clear it inside the existing `show`-true `$effect` when the modal opens again. Remove the 10-second `setTimeout` and its dead test. The existing toast can still announce the failure.
6. Keep `fileCount === 0` semantics as “no selected entries were added.” A workspace containing only audio may export audio when enabled; an empty workspace cannot export.
7. On success, report actual added DTX/audio counts and retain existing sanitized ZIP name, anchor download, URL cleanup and `onClose`.

No up-front availability check or new state machine. No automatic repair of session-only large files. No backward-compatibility hash fallback.

## Task 4 — Verify and record actual results

From the repository root, run the smallest focused commands first, then the existing web suite:

```bash
bun install --frozen-lockfile
bun run --filter=dtx-web test -- src/lib/components/editor/modals/ExportWorkspaceModal.test.ts
bun run --filter=dtx-web test -- src/lib/services/workspaceService.test.ts
bun run --filter=dtx-web test -- src/lib/services/soundLibrary.test.ts
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bunx eslint packages/dtx-web/src/lib/services/soundLibrary.ts packages/dtx-web/src/lib/services/workspaceService.ts packages/dtx-web/src/lib/services/workspaceService.test.ts packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts packages/dtx-web/src/tests/mocks/services.ts
bunx prettier --check packages/dtx-web/src/lib/services/soundLibrary.ts packages/dtx-web/src/lib/services/workspaceService.ts packages/dtx-web/src/lib/services/workspaceService.test.ts packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.svelte packages/dtx-web/src/lib/components/editor/modals/ExportWorkspaceModal.test.ts packages/dtx-web/src/tests/mocks/services.ts docs/superpowers/specs/2026-11-06-hpa-567-workspace-zip-export-design.md docs/superpowers/plans/2026-11-06-hpa-567-workspace-zip-export.md
```

Include `soundLibrary.test.ts` in changed-file lint/format commands if that file is modified. Record actual outcomes in PR #340 before marking it ready; do not claim tests passed during the documentation-only phase.

### Actual results (2026-11-07, on this branch)

- `bun install --frozen-lockfile --ignore-scripts`: exit 0, 1448 packages checked, no changes (`--ignore-scripts` prevents the root `prepare`/husky hook from mutating git config).
- `bun run --filter=dtx-web test -- src/lib/components/editor/modals/ExportWorkspaceModal.test.ts`: **32/32 pass** (final-review fix wave added one collision-recovery test; 2026-11-08 review wave added a named read-error test).
- `bun run --filter=dtx-web test -- src/lib/services/workspaceService.test.ts`: **48/48 pass** (added hash-failure import resilience test).
- `bun run --filter=dtx-web test -- src/lib/services/soundLibrary.test.ts`: **45/45 pass** (added zero-byte `toFile` reconstruction test).
- `bun run --filter=dtx-web test`: **64 files, 920/920 tests pass** (was 916/916 before the final-review fix wave).
- `bunx eslint …` (all seven changed source/test files, incl. `soundLibrary.test.ts`): exit 0, clean.
- `bunx prettier --check …`: initially failed **only** on this plan doc and the design doc (pre-existing formatting drift: table alignment, `~~~` fences, emphasis markers). Fixed with `prettier --write`; all listed files now pass.
- `bun run --filter=dtx-web check` (**typecheck limitation — pre-existing repo-wide debt**): exits 1 with `svelte-check found 420 errors and 4 warnings in 56 files`. An identical run against the PR starting commit (`84100c7`, archived worktree, same installed dependencies) reported the same `420 errors and 4 warnings in 56 files` with an identical per-file diagnostic distribution, so this PR introduces **zero net new typecheck errors**. During implementation the new modal tests added 22 diagnostics (untyped jest-dom matchers: 3 `toBeInTheDocument`, 1 `toHaveClass`, 18 `toHaveTextContent`); they were resolved by switching the new assertions to native Vitest equivalents (`textContent` + `toContain`/`toMatch`, `toBeNull()` on `queryByRole`, `classList.contains`). The 8 diagnostics remaining in `ExportWorkspaceModal.test.ts` (7 `toBeInTheDocument`, 1 `Object.assign` overload) are pre-existing baseline errors, not new.

### 2026-11-08 review follow-up (on this branch)

- `SoundLibrary.toFile` now reconstructs zero-byte records (`size === 0`, empty `fileData`) as empty `File`s instead of returning `null`; only records with missing non-empty data still fail.
- `importFolder` keeps the audio record without a hash when `generateFileHash` throws, so one unreadable file no longer aborts the whole import; audio-inclusive export remains blocked via the existing missing-hash path.
- `generateAsync` failures now probe the added audio `File`s and name the unreadable ones, since JSZip reads file contents during generation rather than at `zip.file` time.

## Acceptance and review checklist

- [x] Hash is captured for imported small audio and survives `saveWorkspace`.
- [x] Same-named samples from two workspaces cannot be confused by global filename search.
- [x] Missing small hash/data or large session-only audio blocks full export and identifies the file.
- [x] Large-file recovery directs the user to the _newly imported_ workspace, or DTX-only export.
- [x] Duplicate flat names across selected records, including case-only variants, block export instead of overwriting bytes.
- [x] Empty DTX content exports; truly empty workspace does not.
- [x] `zip.file` errors prevent download and include offending names.
- [x] Inline `whitespace-pre-line` alert shows readable multi-item errors, survives until the next attempt, and clears when the modal reopens; toast still works, timer removed.
- [x] After observable failure, no ZIP generation, URL creation, success toast, or modal close.
- [x] Shared `makeWorkspace` fixture supplies `mock-hash-kick` and modal test mocks resolve it; fully available ZIP and DTX-only ZIP report actual counts.
- [x] Existing web test/typecheck/lint/format checks verified.
- [x] All work remains inside PR #340.

## Deferred finding: Shift-JIS round-trip fidelity

The reviewer also found a separate possible data-loss bug: ZIP writes DTX decoded text as UTF-8 but `importFolder` attempts Shift-JIS first and uses an ASCII-header validation predicate. A later UTF-8 ZIP re-import may corrupt Japanese metadata. Keep this **outside this PR** as a separate encoding/round-trip investigation with a focused fixture. Avoid creating a new issue unless an eligible canceled/duplicate Linear Graveyard ticket is available for reuse.

## Merge boundary

Keep this draft PR reviewable as design + implementation plan; after approval, add source and regression tests to **this same PR**. Do not split HPA-567 across multiple PRs.
