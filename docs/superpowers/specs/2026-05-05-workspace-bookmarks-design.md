# Workspace Bookmarks — Design

**Date:** 2026-05-05
**Package:** `packages/dtx-desktop`

## Goal

Let desktop users bookmark workspace folders and switch between them in one click, instead of opening the OS folder picker every time.

## Non-goals

- Syncing bookmarks across devices or to the cloud
- Recency-based ordering, pinning, or grouping/folders for bookmarks
- Auto-bookmarking every folder ever opened
- Multi-workspace (multiple workspaces open at once) — only one active workspace at a time, same as today

## Current state

The desktop renderer holds a single workspace path in `workspaceStore` (`packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`), persisted to `localStorage` under `workspace_path`. The user picks a folder via `workspaceService.selectWorkspace()`, which invokes Electron's `select-folder` IPC, then loads sub-workspaces and the tree. The header in `Workspace.svelte` (lines 302–322) shows the current path and a "Change folder" link that re-opens the picker. There is no concept of saved/named workspaces.

## Design

### Data model

A bookmark is:

```ts
interface WorkspaceBookmark {
	path: string;
	name: string;
}
```

`name` defaults to `basename(path)` at creation and is user-editable. `path` is the unique key.

### Storage

Bookmarks persist to `localStorage` under the key `workspace_bookmarks` as a JSON array. This matches the existing `workspace_path` / `auth_session` / `simfiles_cache` pattern in the desktop renderer — no main-process IPC, no new persistence layer.

Ordering: insertion order (newest at the bottom).

Soft cap: 20. Attempting to add past the cap surfaces an inline error and does not mutate state. (Safety net for typo/automation cases; not a hard product constraint.)

### Store: `bookmarkStore.ts` (new)

Lives in `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`, alongside `workspaceStore.ts`. A Svelte writable wrapping `WorkspaceBookmark[]`, hydrated from `localStorage` on creation. All mutations write through to localStorage immediately.

API:

- `add(path: string, name?: string): { ok: true } | { ok: false; reason: 'duplicate' | 'cap-exceeded' }` — appends if `path` not present and list is below cap. Default name is `basename(path)`.
- `remove(path: string): void` — removes the entry with matching path; missing path is a no-op.
- `rename(path: string, newName: string): void` — updates `name`; trims whitespace; if result is empty, falls back to `basename(path)`.
- Standard Svelte store `subscribe`.

Hydration is defensive: malformed JSON or non-array data resolves to `[]`.

### UI: `WorkspaceBookmarksMenu.svelte` (new)

Replaces the static "Current workspace: {path}" + "Change folder" block in `Workspace.svelte` (lines 302–322). The trigger is a button styled like the current path display: basename of the active workspace path + a chevron. Clicking opens a dropdown panel anchored below the trigger.

Dropdown contents, top to bottom:

1. **Current** label, then the full active path in mono-font (read-only).
2. **★ Bookmark this folder** action row — visible only when the active path is not already in `bookmarkStore`. Click adds the bookmark with `name = basename(path)` and closes the dropdown. When the active path is bookmarked, this row is replaced by a subtle "✓ Bookmarked as `<name>`" indicator.
3. **Divider + "Bookmarks" heading** — only when bookmarks exist.
4. **Bookmark list.** Each row shows the nickname (primary) and path (secondary, mono, truncated). Hover reveals two icon buttons:
    - Pencil — inline rename: nickname swaps to an `<input>`, Enter saves, Esc cancels, blur saves.
    - Trash — remove, no confirmation.
      Clicking elsewhere on the row triggers the switch. The active bookmark (path matches current workspace) is visually marked (left accent bar or check icon) and is not clickable as a switch action.
5. **Divider + "Browse for folder…"** — calls `workspaceService.selectWorkspace()` (existing flow, unchanged).

The existing "New Song", "Refresh", and "Clear" buttons in the workspace header remain unchanged. The "Change folder" link is removed.

Accessibility:

- Dropdown uses `role="menu"`, items use `role="menuitem"`.
- Esc closes; arrow keys navigate; focus returns to the trigger on close.
- Per `CLAUDE.md`, all clickable non-button elements get `tabindex="0"`, `aria-label`, and `on:keydown` alongside `on:click`.

Styling: Skeleton UI primitives where they fit; otherwise Tailwind utilities matching `Workspace.svelte` (slate palette, `rounded-lg`, dark-mode variants).

### Service: `workspaceService.switchToBookmark`

New method in `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts`:

```ts
switchToBookmark: async (bookmark: WorkspaceBookmark): Promise<void>
```

Steps:

1. `workspaceStore.reset()` — clears tree, sub-workspaces, selected song, song details view, new song form, templates view, search query, error.
2. `workspaceStore.setPath(bookmark.path)` — persists to `localStorage.workspace_path`.
3. `await workspaceService.loadSubWorkspaces()`.
4. `await workspaceService.loadTreeStructure()`.
5. On thrown error from steps 3–4, the existing error path applies — `workspaceStore.setError(...)` — and the workspace error block in `Workspace.svelte` renders.

`linkageCacheService` is **not** cleared on switch. The cache is keyed by folder path, so entries for other workspaces should survive a switch (they're harmless and useful when switching back). Only `clearWorkspace()` clears the linkage cache; that path is unchanged.

No confirmation prompt. There is no unsaved-state concept in the desktop app today.

### Error handling for missing/unreadable paths

Validation is lazy: try the switch, surface the failure via the existing error UI. The error block in `Workspace.svelte` (lines 266–279) already shows "Try Again". We extend it:

- When `state.path` (the path that failed to load) is present in `bookmarkStore`, show a second button: **Remove bookmark**.
- Click calls `bookmarkStore.remove(state.path)` then `workspaceStore.clearWorkspace()`, returning the user to the empty-state "Select Folder" screen.

We do not auto-prune broken bookmarks (an offline USB drive or sleeping network mount is not a permanent failure).

We do not pre-validate every bookmark when the dropdown opens (filesystem stats per entry would hang on unmounted network drives).

## Components / files

**New:**

- `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`
- `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts`
- `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

**Modified:**

- `packages/dtx-desktop/src/renderer/src/components/Workspace.svelte` — replace the path-display block (lines 302–322) with `<WorkspaceBookmarksMenu />`; extend the error block (lines 266–279) with the conditional "Remove bookmark" button.
- `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts` — add `switchToBookmark`.
- `packages/dtx-desktop/src/renderer/src/services/workspaceService.test.ts` — cover `switchToBookmark`.
- `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts` — cover the new error-block button.

## Testing

Following project conventions: logic only, no trivial tests, check `__mocks__/` before adding new ones, Vitest + jsdom.

**`bookmarkStore.test.ts`:**

- Hydrates from localStorage: valid JSON, empty, malformed → `[]`.
- `add` appends; duplicate `path` is a no-op (original name preserved); returns `{ ok: false, reason: 'duplicate' }`.
- `add` at cap returns `{ ok: false, reason: 'cap-exceeded' }`; state unchanged.
- `remove` removes matching path; missing path is a no-op.
- `rename` trims whitespace; empty falls back to basename.
- Each mutation calls `localStorage.setItem` with serialized state.

**`workspaceService.test.ts` (extend):**

- `switchToBookmark` calls `reset` → `setPath` → `loadSubWorkspaces` → `loadTreeStructure` in order.
- On `loadTreeStructure` rejection, `setError` is called; the path remains set (so the error UI can identify the failing bookmark).

**`WorkspaceBookmarksMenu.test.ts`:**

- Trigger renders basename of current path.
- "Bookmark this folder" shown only when current path is not in store; "Bookmarked as X" otherwise.
- Click on a bookmark row calls `workspaceService.switchToBookmark`.
- Pencil renames inline: Enter saves, Esc reverts, empty input falls back to basename.
- Trash removes without confirmation.
- Active bookmark (path matches current) is marked and is not clickable as switch.
- "Browse for folder…" calls `workspaceService.selectWorkspace`.

**`Workspace.test.ts` (extend):**

- "Remove bookmark" button appears only when `state.path` is in `bookmarkStore` and `state.error` is set.
- Click calls `bookmarkStore.remove` + `workspaceStore.clearWorkspace`.

No e2e tests. Playwright is web-only; this is desktop.

No new global mocks needed; jsdom covers `localStorage`, and `workspaceService.selectWorkspace` is already mocked in `Workspace.test.ts`.

## Risks & open questions

- **Bookmark cap (20):** picked as a sanity bound; if it ever bites real users, drop or raise it. No migration cost.
- **Path normalization:** we treat `path` as opaque. If a user bookmarks `/foo/bar` and later picks `/foo/bar/` via the dialog, those would be different bookmarks. Acceptable — Electron's `dialog.showOpenDialog` returns canonical paths without trailing slashes, so duplicates are unlikely in practice.
- **Renaming the underlying folder on disk:** the bookmark `path` becomes invalid; the user removes it via the error UI's "Remove bookmark" button and re-bookmarks. This is the same behavior as the current `workspace_path` localStorage entry.
