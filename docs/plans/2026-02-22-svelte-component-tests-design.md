# Design: Svelte Component Unit Tests

**Date:** 2026-02-22
**Scope:** `packages/dtx-web` — all untested or logic-only Svelte components
**Approach:** Full render-based tests using `@testing-library/svelte` + shared mock factories

---

## Context

All tests currently pass. Coverage summary before this work:

- `dtx-web`: 29% stmt — Svelte components at 0%, services at 81%
- `@dtx/common`: 47% stmt — game scenes low, components at 0%

`DifficultyModal` is the established pattern: render with `@testing-library/svelte`, assert DOM via `screen`, fire events via `fireEvent`. All new tests follow this pattern.

---

## Test Infrastructure

### Shared mock helpers

New file: `packages/dtx-web/src/tests/mocks/services.ts`

Exports factory functions for services reused across multiple components:

```ts
mockWorkspaceService(); // getWorkspaces, getCurrentWorkspace, setCurrentWorkspace,
// deleteWorkspace, parseDTXFile, switchDTXFile, switchWorkspaceDTX
mockSoundLibrary(); // getAll, getStats, addFiles, removeFile, clearAll,
// findByFileName, toFile
mockToastStore(); // success, error
```

### UI dependency stubs

Mocked via `vi.mock` per test file — render children passthrough so the component's own markup is exercised:

- `@skeletonlabs/skeleton-svelte` — Popover, Tooltip (render trigger/content snippets)
- `@dtx/ui-components/components` — Modal (render children + call onConfirm/onCancel), Button
- `@dtx/common/components` — MainTab, PreviewTab, SoundTab (render as div stubs)
- `@lucide/svelte/icons` — all icons (render as empty span)

---

## Component Test Plan

### Group 1 — Pure modals

**DiscardModal** (`editor/modals/DiscardModal.test.ts`)

- Renders when `show=true`, hidden when `show=false`
- Displays `chartName` and `difficultyText` in body text
- Escape keydown fires `onCancel`
- "Discard Changes" button fires `onConfirm`
- "Cancel" button fires `onCancel`

**DeleteWorkspaceModal** (`editor/modals/DeleteWorkspaceModal.test.ts`)

- Hidden when `workspaceToDelete` is null (even if `show=true`)
- Shows workspace name, DTX file count, audio file count, last-modified date
- Shows current-workspace warning when `currentWorkspace.name === workspaceToDelete.name`
- "Delete Workspace" button fires `onConfirm`
- "Cancel" button fires `onCancel`

**NewFileModal** (`editor/modals/NewFileModal.test.ts`)

- Renders warning text when `show=true`
- Confirm fires `onConfirm`
- Closing via Modal triggers `onCancel` via `$effect`

---

### Group 2 — Editor components

**EditorTabs** (`editor/EditorTabs.test.ts`)

- Renders "Editor Tabs" heading
- Toggle button fires `onToggleCollapsed`
- `isTabsCollapsed=true` hides tab panel content
- Tab button clicks fire `onTabChange` with correct index (0=Main, 1=Sound)
- `isPreviewing=true` disables relevant actions

**EditorNavigation** (`editor/EditorNavigation.test.ts`)

- Renders File, Edit, View menu buttons
- File menu: New fires `onNewFile`, Import fires `onImportFile`, Import Folder fires `onImportFolder`, Export fires `onExportFile`
- Edit menu: Discard fires `onDiscardLocalChanges`, Difficulty fires `onShowDifficultyModal`, DTX Switcher fires `onShowDTXSwitcher`
- View menu: Workspace Manager fires `onShowWorkspaceManager`, Sound Library fires `onShowSoundLibraryModal`
- `isPreviewing=true` disables file-edit actions

**EditorTips** (`editor/EditorTips.test.ts`)

- Renders keyboard shortcut tip content

---

### Group 3 — Service-coupled modals

**WorkspaceManagerModal** (`editor/modals/WorkspaceManagerModal.test.ts`)

- Lists workspaces returned by mocked `workspaceService.getWorkspaces()`
- Highlights current workspace
- Clicking a workspace calls `onSwitchToWorkspace` and `workspaceService.setCurrentWorkspace`
- Delete icon opens nested delete confirm
- Confirming delete calls `workspaceService.deleteWorkspace`
- Closing fires `onClose`

**SoundLibraryModal** (`editor/modals/SoundLibraryModal.test.ts`)

- Shows file count and formatted size from mocked `SoundLibrary.getStats()`
- Lists files from mocked `SoundLibrary.getAll()`
- Remove button opens confirm; confirm calls `SoundLibrary.removeFile`
- Clear all button opens confirm; confirm calls `SoundLibrary.clearAll`
- Close fires `onClose`

**ExportWorkspaceModal** (`editor/modals/ExportWorkspaceModal.test.ts`)

- Lists workspaces from mocked `workspaceService.getWorkspaces()`
- Include-audio checkbox toggles label text on workspace buttons
- Export button calls zip generation flow and `onClose` on success
- Error state displayed when export fails
- Cancel fires `onClose`

**DTXSwitcherModal** (`editor/modals/DTXSwitcherModal.test.ts`)

- Lists DTX files from mocked current workspace
- Active file is visually marked
- Clicking a file calls `workspaceService.parseDTXFile` and `EventBus.emit(STOP_PREVIEW)`
- On success, emits `NOTE_IMPORT` and closes modal
- Error during parse is caught without crash

---

### Group 4 — List and media components

**ChartListItem** (`ChartListItem.test.ts`)

- Renders `display_id`, `title`, `artist`
- Action menu hidden when `isBlog=true`
- Action menu visible when `isBlog=false`
- Delete opens confirm modal; confirm calls `onFileDelete(item.id)`

**ChartListTableItem** (`ChartListTableItem.test.ts`)

- Action menu hidden when `isBlog=true`
- Delete opens confirm modal; confirm calls `onFileDelete(item.id)`
- Publish toggle calls `togglePublishChart(item.id, !is_published)`
- Invalid `item.id` shows error toast instead of opening modal

**ImageAudio** (`ImageAudio.test.ts`)

- Renders play button when `soundPreviewUrl` is provided
- Clicking play creates `Audio` and calls `.play()`
- Clicking again pauses audio
- Audio error sets error state
- Changing `soundPreviewUrl` resets playback state

---

## Implementation Order

1. Create `src/tests/mocks/services.ts` with shared factories
2. Group 1: DiscardModal → DeleteWorkspaceModal → NewFileModal
3. Group 2: EditorTips → EditorTabs → EditorNavigation
4. Group 3: WorkspaceManagerModal → SoundLibraryModal → ExportWorkspaceModal → DTXSwitcherModal
5. Group 4: ChartListItem → ChartListTableItem → ImageAudio

Run `bun run --filter=dtx-web test` after each group to verify no regressions.
