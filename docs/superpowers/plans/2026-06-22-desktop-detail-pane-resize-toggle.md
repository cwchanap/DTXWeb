# Desktop Detail-Pane Resize + Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop song-detail pane drag-resizable and hide/show-toggleable, persisting both preferences to `~/.dtxweb/preferences.json` and restoring them on launch.

**Architecture:** A Rust command pair reads/writes `~/.dtxweb/preferences.json` (via `dirs` + `serde_json`); a thin TS service wraps the Tauri invokes; a Svelte store is the single source of truth for `detailPaneWidth` + `detailPaneVisible`; `AppShell` renders the pane at the stored width with a drag handle (wide mode) and gates visibility, while `TopToolbar` adds a list-section-only toggle button.

**Tech Stack:** Tauri 2 (Rust, `dirs`/`serde_json`/`thiserror`), Svelte 5 runes, TypeScript, Vitest + `@testing-library/svelte`, TailwindCSS 4 Neon Arcade tokens.

## Global Constraints

- Desktop-only: all changes are under `packages/dtx-desktop`. NO changes to `@dtx/common`, `dtx-web`, or `dtx-api`. Do not build `@dtx/common`.
- No new runtime dependencies (`dirs`, `serde`, `serde_json`, `thiserror`, `tempfile` already present). No `tauri.conf.json` / capability changes (no new window; in-process Rust file IO).
- Persistence file is exactly `~/.dtxweb/preferences.json`; JSON keys are camelCase: `detailPaneWidth`, `detailPaneVisible`. Defaults: width `420`, visible `true`. Width clamp: `320`–`640`.
- CLAUDE.md conventions: `const` over `function` (TS); event handlers named `handle*`; `class:` directive over ternary-in-class; early returns; top-level imports. Interactive non-button elements need `tabindex`/`aria-label`/keydown — the resize handle uses a `<button type="button">` (matches the existing `DesktopEditor` sidebar handle) so it is inherently accessible.
- Colors via Neon Arcade tokens only (`bg-surface-2`, `text-dim`, `text-hi`, `text-cyan`, `bg-cyan`, `hover:bg-cyan/40`, etc.) — no raw palette names, no hardcoded hex.
- Vitest: reuse the shared `__mocks__/@lucide/svelte/index.ts`; mock services/children rather than installing packages; tests assert real behavior. Run commands from the repo root.
- This feature extends `feat/desktop-ui-redesign` components (`AppShell`/`TopToolbar`/`DetailPane`), so it is developed on that branch (those files are not on `main`).
- Use the EXACT commit message given in each task's Commit step, with no extra trailers.

## File Structure

- **Create** `packages/dtx-desktop/src-tauri/src/preferences.rs` — `Preferences` struct + read/write commands + testable core fns.
- **Create** `packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs` — Rust unit tests (tempfile).
- **Modify** `packages/dtx-desktop/src-tauri/src/lib.rs` — `mod preferences;` + register the two commands.
- **Create** `packages/dtx-desktop/src/renderer/src/services/preferencesService.ts` + `.test.ts` — invoke wrapper.
- **Create** `packages/dtx-desktop/src/renderer/src/stores/preferencesStore.ts` + `.test.ts` — Svelte store.
- **Modify** `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte` + `AppShell.test.ts` — width/visibility/resize handle.
- **Modify** `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte` + `TopToolbar.test.ts` — toggle button.
- **Modify** `__mocks__/@lucide/svelte/index.ts` (repo root) — add `PanelRight`.

---

### Task 1: Rust preferences persistence (`~/.dtxweb/preferences.json`)

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/preferences.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Produces (Tauri commands): `read_preferences() -> Preferences`, `write_preferences(prefs: Preferences) -> Result<()>`. `Preferences` serializes camelCase: `{ detailPaneWidth: number, detailPaneVisible: boolean }`.
- Produces (testable core, private): `preferences_path(home: &Path) -> PathBuf`, `read_preferences_from(path: &Path) -> Preferences`, `write_preferences_to(path: &Path, prefs: &Preferences) -> Result<()>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs`:

```rust
use super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn read_missing_file_returns_defaults() {
    let dir = TempDir::new().unwrap();
    let prefs = read_preferences_from(&preferences_path(dir.path()));
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(prefs.detail_pane_visible);
}

#[test]
fn write_then_read_round_trips() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    write_preferences_to(
        &path,
        &Preferences { detail_pane_width: 500.0, detail_pane_visible: false },
    )
    .unwrap();
    let read = read_preferences_from(&path);
    assert_eq!(read.detail_pane_width, 500.0);
    assert!(!read.detail_pane_visible);
}

#[test]
fn write_creates_dtxweb_directory_and_file() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    assert!(!path.exists());
    write_preferences_to(&path, &Preferences::default()).unwrap();
    assert!(path.exists());
    assert_eq!(dir.path().join(".dtxweb").join("preferences.json"), path);
}

#[test]
fn corrupt_json_returns_defaults() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ not valid json ").unwrap();
    let prefs = read_preferences_from(&path);
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(prefs.detail_pane_visible);
}

#[test]
fn partial_json_fills_missing_field_defaults() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, r#"{"detailPaneVisible": false}"#).unwrap();
    let prefs = read_preferences_from(&path);
    assert_eq!(prefs.detail_pane_width, 420.0);
    assert!(!prefs.detail_pane_visible);
}

#[test]
fn read_clamps_out_of_range_width() {
    let dir = TempDir::new().unwrap();
    let path = preferences_path(dir.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, r#"{"detailPaneWidth": 5000, "detailPaneVisible": true}"#).unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 640.0);

    fs::write(&path, r#"{"detailPaneWidth": 10, "detailPaneVisible": true}"#).unwrap();
    assert_eq!(read_preferences_from(&path).detail_pane_width, 320.0);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml preferences`
Expected: FAIL — `preferences.rs` does not exist / unresolved module.

- [ ] **Step 3: Implement `preferences.rs`**

Create `packages/dtx-desktop/src-tauri/src/preferences.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{DesktopError, Result};

const MIN_DETAIL_WIDTH: f64 = 320.0;
const MAX_DETAIL_WIDTH: f64 = 640.0;

fn default_detail_pane_width() -> f64 {
    420.0
}

fn default_detail_pane_visible() -> bool {
    true
}

/// UI preferences persisted to `~/.dtxweb/preferences.json`. Every field has a
/// serde default so older/partial files load cleanly as the schema grows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_detail_pane_width")]
    pub detail_pane_width: f64,
    #[serde(default = "default_detail_pane_visible")]
    pub detail_pane_visible: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            detail_pane_width: default_detail_pane_width(),
            detail_pane_visible: default_detail_pane_visible(),
        }
    }
}

fn clamp_width(width: f64) -> f64 {
    width.clamp(MIN_DETAIL_WIDTH, MAX_DETAIL_WIDTH)
}

fn preferences_path(home: &Path) -> PathBuf {
    home.join(".dtxweb").join("preferences.json")
}

/// Returns defaults if the file is missing or unparseable; clamps width.
fn read_preferences_from(path: &Path) -> Preferences {
    let mut prefs = match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str::<Preferences>(&contents).unwrap_or_default(),
        Err(_) => Preferences::default(),
    };
    prefs.detail_pane_width = clamp_width(prefs.detail_pane_width);
    prefs
}

/// Creates `~/.dtxweb/` if absent, then writes pretty JSON.
fn write_preferences_to(path: &Path, prefs: &Preferences) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(prefs)?)?;
    Ok(())
}

#[tauri::command]
pub fn read_preferences() -> Preferences {
    match dirs::home_dir() {
        Some(home) => read_preferences_from(&preferences_path(&home)),
        None => Preferences::default(),
    }
}

#[tauri::command]
pub fn write_preferences(prefs: Preferences) -> Result<()> {
    match dirs::home_dir() {
        Some(home) => write_preferences_to(&preferences_path(&home), &prefs),
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "tests/preferences_tests.rs"]
mod tests;
```

- [ ] **Step 4: Register the module + commands in `lib.rs`**

In `packages/dtx-desktop/src-tauri/src/lib.rs`, add the module declaration after `mod models;` (line 8):

```rust
mod models;
mod preferences;
mod songs;
```

And inside `tauri::generate_handler![ … ]`, add the two commands after the `filesystem::*` block (after `filesystem::get_default_downloads_dir,`):

```rust
            filesystem::get_default_downloads_dir,
            preferences::read_preferences,
            preferences::write_preferences,
            songs::create_song,
```

- [ ] **Step 5: Run the tests to verify they pass + format/clippy**

Run:

```
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml preferences
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Expected: all 6 preferences tests PASS; fmt clean; no new clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/preferences.rs packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs packages/dtx-desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add ~/.dtxweb preferences read/write (Rust)"
```

---

### Task 2: `preferencesService` (Tauri invoke wrapper)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/services/preferencesService.ts`
- Test: `packages/dtx-desktop/src/renderer/src/services/preferencesService.test.ts`

**Interfaces:**

- Consumes: Tauri commands `read_preferences` / `write_preferences` (Task 1) via `invoke` from `@tauri-apps/api/core`.
- Produces: `Preferences = { detailPaneWidth: number; detailPaneVisible: boolean }`; `loadPreferences(): Promise<Preferences>` (defaults on error); `savePreferences(prefs: Preferences): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-desktop/src/renderer/src/services/preferencesService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadPreferences, savePreferences } from './preferencesService';

describe('preferencesService', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the preferences from read_preferences', async () => {
		vi.mocked(invoke).mockResolvedValue({ detailPaneWidth: 500, detailPaneVisible: false });
		expect(await loadPreferences()).toEqual({ detailPaneWidth: 500, detailPaneVisible: false });
		expect(invoke).toHaveBeenCalledWith('read_preferences');
	});

	it('falls back to defaults when read_preferences rejects', async () => {
		vi.mocked(invoke).mockRejectedValue(new Error('no file'));
		expect(await loadPreferences()).toEqual({ detailPaneWidth: 420, detailPaneVisible: true });
	});

	it('passes prefs to write_preferences', async () => {
		vi.mocked(invoke).mockResolvedValue(undefined);
		await savePreferences({ detailPaneWidth: 360, detailPaneVisible: true });
		expect(invoke).toHaveBeenCalledWith('write_preferences', {
			prefs: { detailPaneWidth: 360, detailPaneVisible: true }
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- preferencesService.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `packages/dtx-desktop/src/renderer/src/services/preferencesService.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface Preferences {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
}

const DEFAULTS: Preferences = { detailPaneWidth: 420, detailPaneVisible: true };

export const loadPreferences = async (): Promise<Preferences> => {
	try {
		return await invoke<Preferences>('read_preferences');
	} catch (error) {
		console.error('Failed to load preferences:', error);
		return { ...DEFAULTS };
	}
};

export const savePreferences = async (prefs: Preferences): Promise<void> => {
	try {
		await invoke('write_preferences', { prefs });
	} catch (error) {
		console.error('Failed to save preferences:', error);
	}
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- preferencesService.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/services/preferencesService.ts packages/dtx-desktop/src/renderer/src/services/preferencesService.test.ts
git commit -m "feat(desktop): add preferencesService (Tauri invoke wrapper)"
```

---

### Task 3: `preferencesStore` (Svelte store)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/stores/preferencesStore.ts`
- Test: `packages/dtx-desktop/src/renderer/src/stores/preferencesStore.test.ts`

**Interfaces:**

- Consumes: `loadPreferences` / `savePreferences` (Task 2).
- Produces: `preferencesStore` with `subscribe`, `load(): Promise<void>`, `setDetailWidth(px: number)`, `setDetailVisible(visible: boolean)`, `toggleDetail()`, `reset()`. State: `{ detailPaneWidth: number; detailPaneVisible: boolean; loaded: boolean }`. Exports `MIN_DETAIL_WIDTH = 320`, `MAX_DETAIL_WIDTH = 640`, `DEFAULT_DETAIL_WIDTH = 420`. `setDetailWidth` clamps; all mutators persist via `savePreferences`.

- [ ] **Step 1: Write the failing test**

Create `packages/dtx-desktop/src/renderer/src/stores/preferencesStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../services/preferencesService', () => ({
	loadPreferences: vi.fn(),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

import { loadPreferences, savePreferences } from '../services/preferencesService';
import { preferencesStore } from './preferencesStore';

describe('preferencesStore', () => {
	beforeEach(() => {
		preferencesStore.reset();
		vi.clearAllMocks();
	});

	it('hydrates from loadPreferences (clamping width)', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 9000,
			detailPaneVisible: false
		});
		await preferencesStore.load();
		const s = get(preferencesStore);
		expect(s.detailPaneWidth).toBe(640); // clamped
		expect(s.detailPaneVisible).toBe(false);
		expect(s.loaded).toBe(true);
	});

	it('setDetailWidth clamps and persists', () => {
		preferencesStore.setDetailWidth(10000);
		expect(get(preferencesStore).detailPaneWidth).toBe(640);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 640,
			detailPaneVisible: true
		});
	});

	it('toggleDetail flips visibility and persists', () => {
		expect(get(preferencesStore).detailPaneVisible).toBe(true);
		preferencesStore.toggleDetail();
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('setDetailVisible sets and persists', () => {
		preferencesStore.setDetailVisible(false);
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- preferencesStore.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `packages/dtx-desktop/src/renderer/src/stores/preferencesStore.ts`:

```ts
import { writable, get } from 'svelte/store';
import { loadPreferences, savePreferences } from '../services/preferencesService';

export const MIN_DETAIL_WIDTH = 320;
export const MAX_DETAIL_WIDTH = 640;
export const DEFAULT_DETAIL_WIDTH = 420;

export interface PreferencesState {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	loaded: boolean;
}

const initialState: PreferencesState = {
	detailPaneWidth: DEFAULT_DETAIL_WIDTH,
	detailPaneVisible: true,
	loaded: false
};

const clampWidth = (px: number): number =>
	Math.min(Math.max(Math.round(px), MIN_DETAIL_WIDTH), MAX_DETAIL_WIDTH);

const createPreferencesStore = () => {
	const store = writable<PreferencesState>(initialState);
	const { subscribe, set, update } = store;

	const persist = () => {
		const s = get(store);
		void savePreferences({
			detailPaneWidth: s.detailPaneWidth,
			detailPaneVisible: s.detailPaneVisible
		});
	};

	return {
		subscribe,
		load: async () => {
			const prefs = await loadPreferences();
			update((s) => ({
				...s,
				detailPaneWidth: clampWidth(prefs.detailPaneWidth),
				detailPaneVisible: prefs.detailPaneVisible,
				loaded: true
			}));
		},
		setDetailWidth: (px: number) => {
			update((s) => ({ ...s, detailPaneWidth: clampWidth(px) }));
			persist();
		},
		setDetailVisible: (visible: boolean) => {
			update((s) => ({ ...s, detailPaneVisible: visible }));
			persist();
		},
		toggleDetail: () => {
			update((s) => ({ ...s, detailPaneVisible: !s.detailPaneVisible }));
			persist();
		},
		reset: () => set(initialState)
	};
};

export const preferencesStore = createPreferencesStore();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- preferencesStore.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/preferencesStore.ts packages/dtx-desktop/src/renderer/src/stores/preferencesStore.test.ts
git commit -m "feat(desktop): add preferencesStore for detail-pane prefs"
```

---

### Task 4: AppShell — resizable + visibility-gated detail pane

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.test.ts`

**Interfaces:**

- Consumes: `preferencesStore` (Task 3) — `load()`, `setDetailWidth`, `$preferencesStore.detailPaneWidth/detailPaneVisible`. `resolveShellMode(width)` returns `'wide'` at `width >= 1100`.
- Produces: detail pane rendered only when `isListSection && selectedSong && detailPaneVisible`; in wide mode it gets inline `width` and a left-edge resize handle (`aria-label="Resize details panel"`).

- [ ] **Step 1: Update the test (add resize/visibility coverage)**

Replace the contents of `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({
	simFileService: { clearCache: vi.fn(), fetchUserSimFiles: vi.fn() }
}));
vi.mock('../../services/preferencesService', () => ({
	loadPreferences: vi.fn().mockResolvedValue({ detailPaneWidth: 420, detailPaneVisible: true }),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../Workspace.svelte', () => ({ default: vi.fn() }));
vi.mock('./DetailPane.svelte', () => ({ default: vi.fn() }));
vi.mock('../Templates.svelte', () => ({ default: vi.fn() }));
vi.mock('../Settings.svelte', () => ({ default: vi.fn() }));
vi.mock('../SimFileList.svelte', () => ({ default: vi.fn() }));
vi.mock('../NewSong.svelte', () => ({ default: vi.fn() }));
vi.mock('./CommandPalette.svelte', () => ({ default: vi.fn() }));

import AppShell from './AppShell.svelte';
import Workspace from '../Workspace.svelte';
import Templates from '../Templates.svelte';
import { loadPreferences, savePreferences } from '../../services/preferencesService';

const selectAnySong = () =>
	workspaceStore.selectSong({
		name: 'S',
		path: '/s',
		children: [],
		isExpanded: false,
		isLoading: false,
		hasChildren: false,
		containsDtxFiles: true
	});

describe('AppShell', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		preferencesStore.reset();
		vi.clearAllMocks();
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: true
		});
		window.innerWidth = 1024;
	});
	afterEach(() => cleanup());

	it('renders toolbar, rail and library master content by default', () => {
		render(AppShell);
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Library/i })).toBeInTheDocument();
		expect(vi.mocked(Workspace)).toHaveBeenCalled();
		expect(vi.mocked(Templates)).not.toHaveBeenCalled();
	});

	it('renders Templates content when section is templates', () => {
		workspaceStore.setActiveSection('templates');
		render(AppShell);
		expect(vi.mocked(Templates)).toHaveBeenCalled();
		expect(vi.mocked(Workspace)).not.toHaveBeenCalled();
	});

	it('renders the detail pane at the stored width with a resize handle in wide mode', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 480,
			detailPaneVisible: true
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => expect(handle.parentElement?.style.width).toBe('480px'));
	});

	it('hides the detail pane (and handle) when stored visibility is false', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: /Resize details panel/i })).toBeNull()
		);
	});

	it('ArrowLeft on the handle widens the pane and persists', async () => {
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => expect(handle.parentElement?.style.width).toBe('420px'));
		await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
		expect(get(preferencesStore).detailPaneWidth).toBe(440);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 440,
			detailPaneVisible: true
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- AppShell.test.ts`
Expected: FAIL — no resize handle / width not applied yet.

- [ ] **Step 3: Implement AppShell changes**

Edit `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte`.

(a) Add the store import after the `workspaceStore` import (line 11):

```ts
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';
```

(b) Update the `showDetail` derived and add resize state/handlers. Replace the derived block (lines 17–20) with:

```ts
const mode = $derived(resolveShellMode(width));
const section = $derived($workspaceStore.activeSection);
const isListSection = $derived(section === 'library' || section === 'cloud');
const detailVisible = $derived($preferencesStore.detailPaneVisible);
const showDetail = $derived(isListSection && !!$workspaceStore.selectedSong && detailVisible);

const MIN_DETAIL = 320;
const MAX_DETAIL = 640;
const clampDetail = (w: number) => Math.min(Math.max(w, MIN_DETAIL), MAX_DETAIL);
let isDraggingDetail = $state(false);
let dragDetailWidth = $state(420);
const detailRenderWidth = $derived(
	isDraggingDetail ? dragDetailWidth : $preferencesStore.detailPaneWidth
);

const handleDetailResizeMove = (e: MouseEvent) => {
	if (!isDraggingDetail) return;
	dragDetailWidth = clampDetail(window.innerWidth - e.clientX);
};
const handleDetailResizeUp = () => {
	isDraggingDetail = false;
	document.removeEventListener('mousemove', handleDetailResizeMove);
	document.removeEventListener('mouseup', handleDetailResizeUp);
	document.body.style.cursor = '';
	document.body.style.userSelect = '';
	preferencesStore.setDetailWidth(dragDetailWidth);
};
const handleDetailResizeDown = (e: MouseEvent) => {
	e.preventDefault();
	dragDetailWidth = $preferencesStore.detailPaneWidth;
	isDraggingDetail = true;
	document.addEventListener('mousemove', handleDetailResizeMove);
	document.addEventListener('mouseup', handleDetailResizeUp);
	document.body.style.cursor = 'col-resize';
	document.body.style.userSelect = 'none';
};
const handleDetailResizeKey = (e: KeyboardEvent) => {
	if (e.key === 'ArrowLeft') {
		e.preventDefault();
		preferencesStore.setDetailWidth($preferencesStore.detailPaneWidth + 20);
	} else if (e.key === 'ArrowRight') {
		e.preventDefault();
		preferencesStore.setDetailWidth($preferencesStore.detailPaneWidth - 20);
	}
};
```

(c) Load preferences on mount. Replace the `onMount` body (lines 23–29) with:

```ts
let rootEl: HTMLElement;
onMount(() => {
	void preferencesStore.load();
	const ro = new ResizeObserver((entries) => {
		width = entries[0].contentRect.width;
	});
	ro.observe(rootEl);
	return () => ro.disconnect();
});
```

(d) Replace the detail-pane block in the template (lines 60–69) with:

```svelte
<!-- detail pane -->
{#if showDetail}
	<div
		class="reveal reveal-1 relative min-w-0"
		class:flex-1={mode !== 'wide'}
		style={mode === 'wide' ? `width:${detailRenderWidth}px` : ''}
	>
		{#if mode === 'wide'}
			<button
				type="button"
				class="hover:bg-cyan/40 absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize"
				class:bg-cyan={isDraggingDetail}
				onmousedown={handleDetailResizeDown}
				onkeydown={handleDetailResizeKey}
				tabindex="0"
				aria-label="Resize details panel"
			></button>
		{/if}
		<DetailPane />
	</div>
{/if}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `bun run --filter=dtx-desktop test -- AppShell.test.ts && bun run --filter=dtx-desktop typecheck`
Expected: PASS (5/5); typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte packages/dtx-desktop/src/renderer/src/components/shell/AppShell.test.ts
git commit -m "feat(desktop): make detail pane resizable + visibility-gated"
```

---

### Task 5: TopToolbar — detail-pane toggle button

**Files:**

- Modify: `__mocks__/@lucide/svelte/index.ts` (repo root)
- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.test.ts`

**Interfaces:**

- Consumes: `preferencesStore.toggleDetail()` + `$preferencesStore.detailPaneVisible` (Task 3); `$workspaceStore.activeSection` (`library`/`cloud`). Lucide `PanelRight`.
- Produces: a toggle button (`aria-label="Toggle details panel"`, `aria-pressed={detailVisible}`) shown only in list sections.

- [ ] **Step 1: Add `PanelRight` to the shared lucide mock**

In `__mocks__/@lucide/svelte/index.ts`, add (after the existing `export const Square = vi.fn();` line):

```ts
export const PanelRight = vi.fn();
```

- [ ] **Step 2: Update the test (add toggle coverage)**

Replace the contents of `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({
	authService: {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));
vi.mock('../../services/preferencesService', () => ({
	loadPreferences: vi.fn().mockResolvedValue({ detailPaneWidth: 420, detailPaneVisible: true }),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

import TopToolbar from './TopToolbar.svelte';
import { authService } from '../../services/authService';
import { simFileService } from '../../services/simFileService';
import { savePreferences } from '../../services/preferencesService';

describe('TopToolbar', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		preferencesStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('shows brand', () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
	});

	it('calls onOpenPalette when the search trigger is clicked', async () => {
		const onOpenPalette = vi.fn();
		render(TopToolbar, { onOpenPalette });
		await fireEvent.click(screen.getByRole('button', { name: /Open command palette/i }));
		expect(onOpenPalette).toHaveBeenCalled();
	});

	it('shows Login when unauthenticated and calls authService.login', async () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		const btn = screen.getByRole('button', { name: /Login to access cloud features/i });
		await fireEvent.click(btn);
		expect(authService.login).toHaveBeenCalled();
	});

	it('shows the details toggle in a list section and toggles + persists visibility', async () => {
		// default section after reset is 'library'
		render(TopToolbar, { onOpenPalette: vi.fn() });
		const toggle = screen.getByRole('button', { name: /Toggle details panel/i });
		expect(get(preferencesStore).detailPaneVisible).toBe(true);
		await fireEvent.click(toggle);
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('hides the details toggle outside list sections', () => {
		workspaceStore.setActiveSection('settings');
		render(TopToolbar, { onOpenPalette: vi.fn() });
		expect(screen.queryByRole('button', { name: /Toggle details panel/i })).toBeNull();
	});

	describe('authenticated', () => {
		beforeEach(() =>
			authStore.setUser({ id: 'u1', email: 'test@example.com', name: 'Test User' })
		);

		it('shows user name and email', () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			expect(screen.getByText('Test User')).toBeInTheDocument();
			expect(screen.getByText('test@example.com')).toBeInTheDocument();
		});
		it('calls logout', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
			expect(authService.logout).toHaveBeenCalled();
		});
		it('calls clearCache and removes song_templates', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }));
			expect(simFileService.clearCache).toHaveBeenCalled();
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('song_templates');
		});
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- TopToolbar.test.ts`
Expected: FAIL — no toggle button yet.

- [ ] **Step 4: Implement TopToolbar changes**

Edit `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte`.

(a) Update imports (lines 2–5):

```ts
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';
import { authService } from '../../services/authService';
import { simFileService } from '../../services/simFileService';
import { Music, LogOut, User, RefreshCw, Search, PanelRight } from '@lucide/svelte';
```

(b) Add a derived after `let isClearing = $state(false);` (line 12):

```ts
let isClearing = $state(false);
const isListSection = $derived(
	$workspaceStore.activeSection === 'library' || $workspaceStore.activeSection === 'cloud'
);
```

(c) Add the toggle button as the FIRST child of the right-hand cluster. Change the opening of `<div class="ml-auto flex items-center gap-3">` (line 43) to insert the button:

```svelte
	<div class="ml-auto flex items-center gap-3">
		{#if isListSection}
			<button
				class="bg-surface-2 text-dim hover:text-hi flex items-center rounded-lg px-2 py-1 text-xs"
				class:text-cyan={$preferencesStore.detailPaneVisible}
				onclick={() => preferencesStore.toggleDetail()}
				aria-label="Toggle details panel"
				aria-pressed={$preferencesStore.detailPaneVisible}
			>
				<PanelRight size={14} />
			</button>
		{/if}
		{#if $authStore.isAuthenticated}
```

(Leave the rest of the cluster unchanged.)

- [ ] **Step 5: Run the test + full desktop suite + typecheck**

Run: `bun run --filter=dtx-desktop test && bun run --filter=dtx-desktop typecheck`
Expected: full suite PASS (existing + new tests; the AppShell suite renders the real TopToolbar, which now needs `PanelRight` from the shared mock added in Step 1); typecheck 0 errors.

- [ ] **Step 6: Commit**

```bash
git add "__mocks__/@lucide/svelte/index.ts" packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.test.ts
git commit -m "feat(desktop): add detail-pane toggle button to TopToolbar"
```

---

## Self-Review

**Spec coverage:**

- `~/.dtxweb/preferences.json` read/write w/ defaults + clamp → Task 1. ✓
- TS service wrapper → Task 2. ✓
- Store (width/visible, load/persist) → Task 3. ✓
- Resizable pane (wide mode), width persist on drag-end + keyboard → Task 4. ✓
- Visibility gating → Task 4 (`showDetail`). ✓
- TopToolbar toggle (library/cloud only) → Task 5. ✓
- Error handling (missing/corrupt→defaults; write non-fatal) → Task 1 (Rust) + Task 2 (service try/catch). ✓
- Tests (Rust + Vitest) → every task. ✓
- No window/capability changes; no new deps; desktop-only → Global Constraints. ✓

**Type consistency:** `Preferences { detailPaneWidth, detailPaneVisible }` identical across Rust (camelCase serde), service, store, and command args (`{ prefs }`). `read_preferences`/`write_preferences` command names match service invokes. `preferencesStore` method names (`load`/`setDetailWidth`/`setDetailVisible`/`toggleDetail`/`reset`) consistent across Tasks 3–5. Clamp range 320–640 identical in Rust `clamp_width`, store `clampWidth`, and AppShell `clampDetail`. `resolveShellMode` wide cutoff (1100) reflected in tests (`window.innerWidth = 1400`).

**Placeholder scan:** none — every step has complete code and exact commands.
