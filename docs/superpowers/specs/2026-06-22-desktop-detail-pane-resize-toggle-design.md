# Desktop Detail-Pane Resize + Toggle (persisted to `~/.dtxweb`) — Design

**Date:** 2026-06-22
**Status:** Approved (design); spec pending user review
**Scope:** `packages/dtx-desktop` only (Tauri desktop app). No `@dtx/common`, `dtx-web`, or `dtx-api` changes.
**Builds on:** the `feat/desktop-ui-redesign` branch (introduces `AppShell`/`TopToolbar`/`DetailPane`); this feature extends those components, so it is developed on top of that branch, not off `main`.

## Goal

In the wide master–detail layout, let the song-detail pane be **drag-resized**, add a **TopToolbar button to hide/show** it, and **persist both the width and the visible state** to a JSON file under `~/.dtxweb`, restoring them on next launch.

## Non-Goals

- No detached / multi-window mode (explicitly dropped by the user).
- No change to the web app or shared packages; no new runtime dependencies.
- No persistence of anything beyond detail-pane width + visibility (schema is forward-extensible, but this feature only adds those two fields).

## Architecture Overview

```text
TopToolbar (toggle button) ─┐
                            ├─> preferencesStore (Svelte) ──> preferencesService.ts ──invoke──> Rust commands ──> ~/.dtxweb/preferences.json
AppShell (width + render) ──┘            ▲                                                         (read/write via dirs + serde_json)
                                         └── load() on startup
```

Single source of truth for the two prefs is a Svelte store, hydrated from the JSON file at startup and written back on change. The detail pane's rendering (width, visibility) and the toolbar toggle both read/write that store, so they stay in sync.

## Components

### 1. Rust — `src-tauri/src/preferences.rs` (new)

Two Tauri commands plus testable core helpers (mirrors the command/`_path` + env-injected split already used in `songs.rs`):

- `#[tauri::command] read_preferences() -> Preferences`
- `#[tauri::command] write_preferences(prefs: Preferences) -> Result<()>`
- Core (unit-testable, no Tauri/home dependency): `read_preferences_from(path: &Path) -> Preferences`, `write_preferences_to(path: &Path, prefs: &Preferences) -> Result<()>`, `preferences_path(home: &Path) -> PathBuf` (= `home/.dtxweb/preferences.json`).
- Home resolution reuses the existing testable helper style in `songs.rs` (`home_dir()` / `home_dir_from_env`) so tests inject a tempdir.

`Preferences` struct (serde, `rename_all = "camelCase"`, **every field has `#[serde(default = …)]`** so old/partial files load cleanly):

```rust
struct Preferences {
    detail_pane_width: f64,   // default 420.0
    detail_pane_visible: bool // default true
}
```

Behavior: `read_*` returns defaults if the file is missing or fails to parse (never errors to the UI); width is clamped to the valid range (320–640) on read. `write_*` creates `~/.dtxweb/` if absent, then writes pretty JSON. Register both commands in `lib.rs`'s `generate_handler!`.

### 2. `src/renderer/src/services/preferencesService.ts` (new)

Thin wrapper over `@tauri-apps/api/core` `invoke`:

```ts
loadPreferences(): Promise<Preferences>          // invoke('read_preferences')
savePreferences(prefs: Preferences): Promise<void> // invoke('write_preferences', { prefs })
```

Typed `Preferences = { detailPaneWidth: number; detailPaneVisible: boolean }`. Errors are caught and logged; `loadPreferences` falls back to defaults so the UI never blocks on a bad file.

### 3. `src/renderer/src/stores/preferencesStore.ts` (new)

Svelte `writable<{ detailPaneWidth: number; detailPaneVisible: boolean; loaded: boolean }>` with:

- `load()` — calls `loadPreferences()`, sets state, marks `loaded`.
- `setDetailWidth(px)` — clamps to **320–640**, updates state, persists (called on drag-end / keyboard adjust).
- `setDetailVisible(bool)` / `toggleDetail()` — updates state, persists immediately.

Persistence calls `savePreferences` with the current two fields. Defaults before load: width 420, visible true, loaded false.

### 4. `src/renderer/src/components/shell/AppShell.svelte` (modify)

- On mount (alongside the existing `ResizeObserver`): `preferencesStore.load()`.
- `const detailWidth = $derived($preferencesStore.detailPaneWidth)`, `const detailVisible = $derived($preferencesStore.detailPaneVisible)`.
- `showDetail` becomes `isListSection && !!$workspaceStore.selectedSong && detailVisible`.
- Detail wrapper: **wide** mode uses inline `style="width:{detailWidth}px"` (replacing the fixed `w-[420px]`); medium/narrow stays full-width (`flex-1`).
- **Resize handle** on the detail pane's **left edge**, rendered only in wide mode. Reuses this app's existing editor-sidebar resize idiom (mousedown → document mousemove/mouseup; keyboard `tabindex="0"` + `aria-label="Resize details panel"` + ArrowLeft/ArrowRight). Because the detail pane is flush-right, new width = `clamp(window.innerWidth - e.clientX, 320, 640)`.
- **Drag → render → persist** (to avoid a file write per mousemove): AppShell holds local drag state (`isDragging`, `dragWidth`). The detail wrapper's rendered width = `isDragging ? dragWidth : $preferencesStore.detailPaneWidth`. Each mousemove updates `dragWidth` only (no store/file write); on mouseup, call `preferencesStore.setDetailWidth(dragWidth)` once (clamps → updates store → persists). Keyboard ArrowLeft/Right call `setDetailWidth` directly per step (low frequency, persisting each step is fine).

### 5. `src/renderer/src/components/shell/TopToolbar.svelte` (modify)

- A toggle button shown only when `$workspaceStore.activeSection` is `library` or `cloud`.
- Lucide icon (`PanelRight` / `PanelRightClose` to reflect state), `aria-label="Toggle details panel"`, `aria-pressed={detailVisible}`, styled with existing Neon Arcade tokens.
- `onclick` → `preferencesStore.toggleDetail()` (persists immediately).

## Data Model

`~/.dtxweb/preferences.json`:

```json
{
	"detailPaneWidth": 420,
	"detailPaneVisible": true
}
```

Confirmed values: default width **420**, clamp **320–640px**, file **`~/.dtxweb/preferences.json`**, toggle button visible in **library/cloud** sections.

## Data Flow

- **Startup:** AppShell mounts → `preferencesStore.load()` → reads file → store hydrated → pane renders at saved width/visibility (defaults until load resolves; brief, no flicker of layout structure).
- **Resize:** drag the divider → live local width → on release `setDetailWidth(clamped)` → persists.
- **Toggle:** click toolbar button → `toggleDetail()` → store flips → pane shows/hides → persists.

## Behavior Details

- Resize handle exists only in wide mode; in medium/narrow the detail is a full-width overlay, but the width preference is preserved for when wide returns.
- Toggling visibility with no song selected still persists the preference; the pane only renders when `isListSection && selectedSong && detailVisible`.
- The master pane's existing `class:hidden={mode === 'narrow' && showDetail}` continues to work (when detail is hidden, `showDetail` is false, so master is never wrongly hidden).

## Error Handling

- Missing/corrupt `preferences.json` → defaults returned (Rust + service both guard); width clamped on read.
- `~/.dtxweb/` created on first write.
- Write failures are logged and non-fatal — the session continues with in-memory state.

## Testing

**Rust (`src-tauri/src/tests/preferences_tests.rs`, new; registered in `tests/mod.rs`):**

- Missing file → defaults.
- Write-then-read round-trip preserves values.
- Corrupt/partial JSON → defaults (per-field serde defaults).
- `preferences_path` builds `<home>/.dtxweb/preferences.json`; write creates the dir.
- Out-of-range width clamped on read.
  (Uses `tempfile` for home, like existing `songs.rs` tests.)

**Frontend (Vitest):**

- `preferencesStore.test.ts`: `load()` hydrates from a mocked `preferencesService`; `setDetailWidth` clamps + calls `savePreferences`; `toggleDetail` flips + persists.
- `AppShell.test.ts` additions: pane hidden when `detailPaneVisible=false`; inline width applied in wide mode; resize handle present in wide mode; `preferencesService` mocked so `load()` doesn't hit Tauri.
- `TopToolbar.test.ts` additions: toggle button present in library/cloud and absent otherwise; click flips visibility + persists.

## File Summary

- New: `src-tauri/src/preferences.rs`, `src-tauri/src/tests/preferences_tests.rs`, `services/preferencesService.ts`, `stores/preferencesStore.ts`, `stores/preferencesStore.test.ts`.
- Modify: `src-tauri/src/lib.rs` (register commands + `mod preferences`), `src-tauri/src/tests/mod.rs` (register tests), `components/shell/AppShell.svelte`, `components/shell/TopToolbar.svelte`, and their `.test.ts` files.
- Capabilities/`tauri.conf.json`: no changes (no new window; file IO is in-process Rust, not the FS plugin).
