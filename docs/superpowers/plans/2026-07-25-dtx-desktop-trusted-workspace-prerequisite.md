# DTX Desktop Trusted Workspace and Relaunch Prerequisite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete HPA-314 by making the native Tauri process the sole owner of the desktop workspace root, then add the controlled terminate-and-relaunch E2E primitive required before HPA-311 crash-recovery coverage.

**Architecture:** Extract the existing preferences persistence into one hardened native JSON primitive, load a canonical workspace root into managed Rust state at startup, and remove every renderer-supplied `workspaceRoot` IPC argument. The renderer keeps only a hydrated display copy. Desktop E2E pre-seeds the native store, proves renderer spoofing cannot broaden access, and uses the installed `@wdio/tauri-service` standalone session API to terminate and relaunch the same binary with the same native data directory.

**Tech Stack:** Tauri 2, Rust 1.77, Tokio, Serde, Svelte 5, TypeScript, Vitest, WebdriverIO 9, `@wdio/tauri-service` 1.2.0.

## Global Constraints

- Treat current source and the approved design at `docs/superpowers/specs/2026-07-22-dtx-desktop-google-drive-upload-design.md` as authoritative. HPA-314 defines the prerequisite boundary; HPA-311's renderer-supplied workspace examples are superseded.
- Implement this as a separately reviewable and shippable prerequisite. Do not add Google OAuth, Drive API, credential-store, or Drive UI code in this milestone.
- The dedicated native workspace-folder dialog is the only operation allowed to establish or replace the trusted root. Keep the generic export-directory dialog separate so selecting an export destination cannot mutate workspace trust. Never import the old `localStorage.workspace_path`, a bookmark path, or any other renderer value into native trust.
- Keep pure internal helpers parameterized by an explicit root when useful for unit tests, but all registered Tauri commands must read `WorkspaceRootState`.
- Preserve current manual-export rules, supported extensions, error shapes, and renderer behavior except where the workspace trust contract necessarily changes.
- Keep `DTX_E2E_DATA_DIR` gated by `feature = "e2e"` and keep all WebDriver automation gated by both `feature = "e2e"` and `debug_assertions`.
- Follow test-driven development for every task: add the failing focused test, run it to observe the expected failure, implement the minimum change, then rerun the focused test.
- Start implementation in an isolated `codex/` worktree using `superpowers:using-git-worktrees`.
- Do not run development servers, broad web E2E, or unrelated full builds.

## Source Map

### Native persistence and workspace ownership

- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.lock`
- Create: `packages/dtx-desktop/src-tauri/src/native_persistence.rs`
- Create: `packages/dtx-desktop/src-tauri/src/workspace.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/preferences.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/native_persistence_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/workspace_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/lib_tests.rs`

### Native command migration

- Modify: `packages/dtx-desktop/src-tauri/src/filesystem.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/songs.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/filesystem_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/songs_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

### Renderer migration

- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/workspaceService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopFileProvider.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopFileProvider.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/exportService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/exportService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/DesktopEditor.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/DesktopEditor.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Settings.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Settings.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/App.test.ts`

### Native E2E and relaunch infrastructure

- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/package.json`
- Modify: `packages/e2e-desktop/support/app.ts`
- Modify: `packages/e2e-desktop/support/native.ts`
- Modify: `packages/e2e-desktop/support/workspace-fixture.ts`
- Modify: `packages/e2e-desktop/specs/app-launch.e2e.ts`
- Modify: `packages/e2e-desktop/specs/native-filesystem.e2e.ts`
- Modify: `packages/e2e-desktop/specs/workspace-library.e2e.ts`
- Modify: `packages/e2e-desktop/specs/song-creation.e2e.ts`
- Create: `packages/e2e-desktop/support/standalone-session.ts`
- Create: `packages/e2e-desktop/scripts/relaunch-smoke.ts`
- Modify: `.github/workflows/desktop-e2e-test.yml`

---

### Task 1: Extract and harden native JSON persistence

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/native_persistence.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/native_persistence_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/preferences.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/preferences_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.lock`

- [ ] **Step 1: Write failing persistence tests**

Add `#[path = "tests/native_persistence_tests.rs"] mod tests;` in `native_persistence.rs`. Cover:

- missing or malformed JSON returns `T::default()`;
- partial JSON uses Serde field defaults;
- a write creates only the exact `<data_dir>/dtxweb/` directory;
- Unix directory mode is `0700` and file mode is `0600`;
- an existing broader `dtxweb` mode is narrowed without changing or deleting an existing `preferences.json`;
- concurrent writers never produce malformed JSON;
- successful writes leave no sibling temporary file;
- a failed replacement removes only its own temporary file;
- `resolve_dirs()` honors `DTX_E2E_DATA_DIR` only under the `e2e` feature.

Use a generic test record:

```rust
#[derive(Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct TestRecord {
    value: String,
    count: u32,
}
```

- [ ] **Step 2: Run the focused tests and confirm the module is absent**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib native_persistence::tests::
```

Expected: compilation fails because `native_persistence.rs` and its API do not exist.

- [ ] **Step 3: Implement the shared primitive**

Expose only crate-internal functions:

```rust
pub(crate) fn resolve_dirs() -> (Option<PathBuf>, Option<PathBuf>);
pub(crate) fn app_data_file(data_dir: &Path, file_name: &str) -> PathBuf;
pub(crate) fn resolve_app_data_file(file_name: &str) -> Result<PathBuf>;
pub(crate) fn read_json_or_default<T>(path: &Path, label: &str) -> T
where
    T: DeserializeOwned + Default;
pub(crate) fn write_json_atomic<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize;
pub(crate) fn lock_unpoisoned(
    lock: &'static OnceLock<Mutex<()>>,
) -> MutexGuard<'static, ()>;
```

Implementation requirements:

- use one validated sibling directory;
- create missing `dtxweb` with `0700` and narrow only that directory on Unix;
- generate a unique sibling temporary filename using process ID plus an `AtomicU64` counter;
- create the temp file with `create_new(true)` and Unix mode `0600`;
- `write_all`, `flush`, and `sync_all` before replacement;
- on Unix, use same-directory `rename` and then best-effort `sync_all` on the parent directory;
- on Windows, add a target-specific direct `windows-sys = "0.59"` dependency with `Win32_Storage_FileSystem`, and use `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`;
- remove only the unique temp file on failure;
- never fall back to a cross-directory move.

- [ ] **Step 4: Migrate preferences without changing its contract**

Keep the preferences-specific `OnceLock<Mutex<()>>` across each complete read-modify-write. Replace its duplicate directory resolution, JSON parsing, temp-file write, and poisoned-lock recovery with the shared functions. Preserve:

- legacy `~/.dtxweb/preferences.json` read fallback;
- clamping;
- score-link merge behavior;
- best-effort legacy-file cleanup;
- missing/corrupt fallback behavior.

Update the existing atomic-write test so it checks for any filename with the unique temp prefix rather than the obsolete fixed `preferences.json.tmp`.

- [ ] **Step 5: Run focused persistence and preference tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib native_persistence::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib preferences::tests::
```

Expected: both pass, including the migration-survival and Unix permission assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri
git commit -m "refactor(desktop): harden native JSON persistence"
```

---

### Task 2: Add persisted Rust-owned workspace state

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/workspace.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/workspace_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/filesystem.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/lib_tests.rs`

- [ ] **Step 1: Write failing workspace-state tests**

Cover:

- no file, malformed JSON, missing path, inaccessible path, or a file instead of a directory loads empty state;
- a valid saved directory is canonicalized on load;
- `set_from_dialog_selection` canonicalizes, writes `workspace.json`, and updates memory only after persistence succeeds;
- `clear` persists an empty setting and clears memory only after persistence succeeds;
- cancel leaves an existing state untouched and establishes nothing on first run;
- the state lock recovers from poisoning;
- startup uses `<data_dir>/dtxweb/workspace.json`.

Define the on-disk shape explicitly:

```rust
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct WorkspaceSettings {
    workspace_root: Option<String>,
}
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib workspace::tests::
```

Expected: compilation fails because `WorkspaceRootState` is not implemented.

- [ ] **Step 3: Implement `WorkspaceRootState`**

Use:

```rust
#[derive(Debug, Default)]
pub struct WorkspaceRootState {
    root: RwLock<Option<PathBuf>>,
}

impl WorkspaceRootState {
    pub(crate) fn load() -> Self;
    pub(crate) fn current(&self) -> Result<PathBuf>;
    pub(crate) fn current_optional(&self) -> Option<PathBuf>;
    pub(crate) fn set_from_dialog_selection(&self, selected: &Path) -> Result<PathBuf>;
    pub(crate) fn clear(&self) -> Result<()>;
}

#[tauri::command]
pub fn get_workspace_root(state: State<'_, WorkspaceRootState>) -> Option<String>;

#[tauri::command]
pub fn clear_workspace_root(state: State<'_, WorkspaceRootState>) -> Result<()>;
```

Return the same sanitized `"A workspace root is required"` error from `current()` when no trusted root exists. Never read renderer storage or accept a root argument.

- [ ] **Step 4: Add a dedicated native workspace selection command**

Add a distinct command in `workspace.rs`. Its signature must be:

```rust
#[tauri::command]
pub async fn select_workspace_folder(
    app: AppHandle,
    state: State<'_, WorkspaceRootState>,
) -> Result<DialogResult>;
```

Only after the user selects a folder:

1. convert the native `FilePath`;
2. require an existing directory;
3. canonicalize it;
4. atomically persist it;
5. replace managed state;
6. return the canonical path.

On dialog cancellation, return `canceled: true` and do not mutate state.

Keep `filesystem::select_folder(app)` as the generic folder dialog used by Export Settings. It may
return a user-selected directory, but it must never read or mutate `WorkspaceRootState`.

- [ ] **Step 5: Register and hydrate state at application startup**

In `lib.rs`:

```rust
mod native_persistence;
mod workspace;

let workspace_state = workspace::WorkspaceRootState::load();
let mut builder = tauri::Builder::default()
    .manage(AuthState::default())
    .manage(DtxmaniaDbState::default())
    .manage(workspace_state);
```

Register `workspace::select_workspace_folder`, `workspace::get_workspace_root`, and `workspace::clear_workspace_root`. Keep `filesystem::select_folder` registered for the unrelated export-directory chooser.

- [ ] **Step 6: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib workspace::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib extract_deep_link_args
```

Expected: startup/state tests pass and existing deep-link tests remain green.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri
git commit -m "feat(desktop): own workspace state in Rust"
```

---

### Task 3: Remove workspace-root arguments from filesystem commands

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/filesystem.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/filesystem_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Rewrite command-level tests to inject managed state**

Keep `canonicalize_within_workspace(target, Some(root))` and `read_file_path(path, Some(root))` as pure internal helpers for unit tests. Add command-wrapper coverage showing:

- `path_exists`, list, read, and tree commands succeed under managed state;
- every command returns the current missing-workspace error when state is empty;
- absolute and traversing targets outside the managed root fail even if an unused/deserialized `workspaceRoot` field is present in a raw IPC payload;
- symlinks outside the root remain rejected.

- [ ] **Step 2: Run the focused tests and observe signature failures**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib filesystem::tests::
```

Expected: the rewritten tests fail until commands accept `State<WorkspaceRootState>`.

- [ ] **Step 3: Change every registered filesystem command**

Use these IPC signatures:

```rust
pub async fn path_exists(
    state: State<'_, WorkspaceRootState>,
    base_path: String,
    path_parts: Vec<String>,
) -> PathExistsResult;

pub async fn list_directories(
    state: State<'_, WorkspaceRootState>,
    dir_path: String,
) -> Result<Vec<String>>;

pub async fn list_directory(
    state: State<'_, WorkspaceRootState>,
    dir_path: String,
) -> Result<Value>;

pub async fn list_files(
    state: State<'_, WorkspaceRootState>,
    dir_path: String,
) -> Result<ListFilesResult>;

pub async fn read_file(
    state: State<'_, WorkspaceRootState>,
    file_path: String,
) -> ReadFileResult;

pub async fn load_tree_structure(
    state: State<'_, WorkspaceRootState>,
    base_path: String,
    path_parts: Vec<String>,
) -> Result<Vec<TreeNode>>;
```

Read and stringify the managed root once per command, then delegate to the existing containment helpers. Do not change `open_folder`, Downloads lookup, or the separately validated DTXMania DB flow.

- [ ] **Step 4: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib filesystem::tests::
```

Expected: all filesystem tests pass with no command-level renderer root.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/filesystem.rs packages/dtx-desktop/src-tauri/src/tests/filesystem_tests.rs packages/dtx-desktop/src-tauri/src/lib.rs
git commit -m "fix(desktop): enforce managed workspace in filesystem IPC"
```

---

### Task 4: Migrate song, export, and API file access to managed state

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/songs.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/songs_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

- [ ] **Step 1: Add failing command-contract tests**

Update tests so:

- `export_song_to_zip(song_path, song_title, export_directory, state)` has no root argument;
- `parse_dtx_files(folder_path, state)` has no root argument;
- `upload_file(file_name, song_folder_path, simfile_id, state, auth)` has no root argument;
- `create_simfile_record` preview handling ignores/removes `workspaceRoot` from its JSON input and uses managed state;
- empty managed state fails before any file read or HTTP request;
- managed-root containment and current error/result shapes are preserved.

- [ ] **Step 2: Run focused tests and observe failures**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib songs::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib api::tests::
```

- [ ] **Step 3: Migrate `songs.rs` command wrappers**

Change registered commands to receive `State<'_, WorkspaceRootState>`, call `state.current()?`, and pass that root to existing internal collection/parsing helpers. Do not change ZIP contents, extension filtering, ordering, or local filename validation.

- [ ] **Step 4: Migrate `api.rs` file-reading wrappers**

Keep `read_preview_within_workspace(song_path, workspace_root, file_name)` as an internal tested helper. Remove `workspaceRoot` from renderer/JSON extraction and derive it from state at command entry. Ensure no network request occurs when workspace validation fails.

- [ ] **Step 5: Prove no registered Rust command accepts the old contract**

Run:

```bash
rg -n "workspace_root: (Option<)?String|workspaceRoot" packages/dtx-desktop/src-tauri/src
```

Expected: matches remain only in internal helper parameters, test fixture JSON explicitly proving ignored legacy input, or comments explaining the removed contract. No `#[tauri::command]` accepts it.

- [ ] **Step 6: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib songs::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib api::tests::
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs packages/dtx-desktop/src-tauri/src/songs.rs packages/dtx-desktop/src-tauri/src/tests
git commit -m "fix(desktop): use trusted workspace for song file access"
```

---

### Task 5: Hydrate the renderer from native state and remove root IPC payloads

**Files:**

- Modify all renderer files listed in the Renderer migration source map.

- [ ] **Step 1: Add failing host/store tests**

Update `desktopHost.test.ts` to require:

```ts
desktopHost.getWorkspaceRoot();      // invoke('get_workspace_root')
desktopHost.clearWorkspaceRoot();    // invoke('clear_workspace_root')
desktopHost.selectWorkspaceFolder(); // invoke('select_workspace_folder')
desktopHost.selectFolder();          // generic export-directory dialog; never changes trust
desktopHost.pathExists(basePath, ...pathParts);
desktopHost.listDirectories(dirPath);
desktopHost.listDirectory(dirPath);
desktopHost.loadTreeStructure(basePath, ...pathParts);
desktopHost.listFiles(dirPath);
desktopHost.readFile(filePath);
desktopHost.parseDtxFiles(folderPath);
desktopHost.exportSongToZip({ songPath, songTitle?, exportDirectory? });
desktopHost.uploadFile(fileName, songFolderPath, simfileId);
```

Assert no invocation payload contains `workspaceRoot`.

Update `workspaceStore.test.ts` to prove:

- import/creation never reads `localStorage.workspace_path`;
- `setPath` updates memory only;
- `clearWorkspace` does not establish trust and removes any stale legacy key as cleanup only;
- `hydratePath(path)` replaces the display copy returned by native code.

- [ ] **Step 2: Run focused host/store tests and observe failures**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts src/renderer/src/stores/workspaceStore.test.ts
```

- [ ] **Step 3: Implement typed host wrappers and memory-only store**

Remove every `workspaceRoot` parameter and payload from `desktopHost.ts`. Add:

```ts
getWorkspaceRoot: async (): Promise<string | null> =>
    await invokeHost<string | null>('get_workspace_root'),
clearWorkspaceRoot: async (): Promise<void> =>
    await invokeHost<void>('clear_workspace_root')
```

In `workspaceStore.ts`, initialize `path: null`, delete the import-time `localStorage` read, make `setPath` memory-only, and expose `hydratePath(path: string | null)`. Removing the stale legacy key is allowed only as cleanup; its value must never be read or sent native.

- [ ] **Step 4: Update startup hydration**

In `App.svelte`, request the native root during `onMount` before loading sub-workspaces or the tree:

```ts
const nativeWorkspace = await desktopHost.getWorkspaceRoot();
workspaceStore.hydratePath(nativeWorkspace);
if (nativeWorkspace) {
	await workspaceService.loadSubWorkspaces();
	await workspaceService.loadTreeStructure();
}
```

Add `App.test.ts` cases for a restored root, empty root, and rejected hydration call. An error must leave the store empty and show the existing workspace-selection state; it must not consult renderer storage.

- [ ] **Step 5: Update workspace selection and bookmarks**

`selectWorkspace` calls `desktopHost.selectWorkspaceFolder()`, then copies the returned canonical path into the store. `Settings.svelte` continues using the generic `desktopHost.selectFolder()` for the export directory and must have a regression test proving it does not call `select_workspace_folder`.

`switchToBookmark` must no longer call `pathExists(bookmark.path, bookmark.path)` or set a bookmark path as trusted. Clicking a bookmark opens `selectWorkspaceFolder()` and only uses the path actually returned by that dialog. Cancellation retains the current trusted root. Update the menu copy/test so the user understands that a saved bookmark is a convenience label and the folder must be reselected after this security migration.

- [ ] **Step 6: Update every renderer consumer**

Remove root payloads from:

- `workspaceService.ts`;
- `desktopFileProvider.ts` (retain `_workspaceRoot` only for local display/path composition);
- `exportService.ts`;
- `DesktopEditor.svelte` (replace direct `localStorage.getItem('workspace_path')`);
- `SongDetails.svelte` parse, list, read, upload, and export calls.

Update their focused tests. Replace assertions that a root is forwarded with assertions that no root is forwarded.

- [ ] **Step 7: Run all targeted renderer tests**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts src/renderer/src/stores/workspaceStore.test.ts src/renderer/src/services/workspaceService.test.ts src/renderer/src/services/desktopFileProvider.test.ts src/renderer/src/services/exportService.test.ts src/renderer/src/components/DesktopEditor.test.ts src/renderer/src/components/SongDetails.test.ts src/renderer/src/components/WorkspaceBookmarksMenu.test.ts src/renderer/src/components/Settings.test.ts src/renderer/src/App.test.ts
bun run --filter=dtx-desktop typecheck
```

- [ ] **Step 8: Prove renderer root forwarding is gone**

```bash
rg -n "workspaceRoot|workspace_path" packages/dtx-desktop/src/renderer/src
```

Expected: `workspaceRoot` remains only as a local display/path-composition name in `DesktopFileProvider` if retained; `workspace_path` remains only in a one-way legacy-key removal and spoofing regression test. No value is read and no IPC payload carries either.

- [ ] **Step 9: Commit**

```bash
git add packages/dtx-desktop/src/renderer
git commit -m "fix(desktop): hydrate workspace trust from Tauri"
```

---

### Task 6: Pre-seed the trusted root and add native containment E2E

**Files:**

- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/support/app.ts`
- Modify: `packages/e2e-desktop/support/native.ts`
- Modify: `packages/e2e-desktop/support/workspace-fixture.ts`
- Modify: `packages/e2e-desktop/specs/app-launch.e2e.ts`
- Modify: `packages/e2e-desktop/specs/native-filesystem.e2e.ts`
- Modify: `packages/e2e-desktop/specs/workspace-library.e2e.ts`
- Modify: `packages/e2e-desktop/specs/song-creation.e2e.ts`

- [ ] **Step 1: Refactor the fixture so it exists before the app starts**

Add a synchronous fixture builder that can place `workspace/` and `outside/` under a caller-provided parent. In `wdio.conf.ts`:

1. create `isolatedDataDir`;
2. create the fixture under that directory;
3. write `dtxweb/preferences.json`;
4. write:

```json
{
	"workspaceRoot": "<canonical fixture workspace path>"
}
```

to `dtxweb/workspace.json`; 5. expose the fixture paths to the WDIO worker through `DTX_E2E_WORKSPACE_ROOT` and `DTX_E2E_OUTSIDE_ROOT`; 6. keep the Tauri app environment limited to `DTX_E2E_DATA_DIR`.

All fixture paths disappear through the existing best-effort `isolatedDataDir` cleanup.

- [ ] **Step 2: Remove renderer workspace seeding**

Change:

```ts
resetApp(): Promise<void>
openWorkspace(): Promise<void>
```

`resetApp` may clear renderer storage and refresh, but must never write `workspace_path`. `openWorkspace` waits for the library restored from native state.

- [ ] **Step 3: Update native E2E helpers to the new IPC contract**

Expose:

```ts
type ExportSongResult = {
    success: boolean;
    zipPath?: string;
    filesCount?: number;
    error?: string;
};

getWorkspaceRoot(): Promise<string | null>;
pathExists(basePath: string, ...pathParts: string[]): Promise<PathExistsResult>;
readFile(filePath: string): Promise<ReadFileResult>;
loadTree(basePath: string): Promise<TreeNode[]>;
listFiles(folderPath: string): Promise<ListFilesResult>;
exportSongToZip(input: {
    songPath: string;
    songTitle?: string;
    exportDirectory?: string;
}): Promise<ExportSongResult>;
```

No helper accepts or serializes `workspaceRoot`.

- [ ] **Step 4: Add the spoofing and containment scenario**

In `native-filesystem.e2e.ts`:

1. assert `getWorkspaceRoot()` equals the pre-seeded canonical fixture root;
2. execute:

```ts
localStorage.setItem('workspace_path', JSON.stringify('/'));
```

3. refresh the app;
4. prove the native root is unchanged;
5. prove reads of the outside fixture fail;
6. prove absolute, `..`, alternate-separator, and symlink escape paths fail;
7. prove `path_exists`, `list_files`, tree loading, parsing, and ZIP export cannot escape.

Update the old test description from “caller-supplied workspace root” to “Rust-owned workspace root.”

- [ ] **Step 5: Update library and song-creation specs**

Use the environment-provided pre-seeded fixture and the no-argument `openWorkspace()`. Keep existing song discovery, editor mapping, and creation assertions.

- [ ] **Step 6: Run the E2E typecheck**

```bash
bun run --filter=dtx-e2e-desktop check
```

Expected: all helper and spec contracts compile without a renderer root.

- [ ] **Step 7: Commit**

```bash
git add packages/e2e-desktop
git commit -m "test(desktop): prove native workspace containment"
```

---

### Task 7: Add a controlled terminate-and-relaunch E2E primitive

**Files:**

- Create: `packages/e2e-desktop/support/standalone-session.ts`
- Create: `packages/e2e-desktop/scripts/relaunch-smoke.ts`
- Modify: `packages/e2e-desktop/package.json`
- Modify: `.github/workflows/desktop-e2e-test.yml`

- [ ] **Step 1: Implement a reusable standalone session helper**

Use the installed, source-verified `@wdio/tauri-service` 1.2.0 exports:

```ts
import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from '@wdio/tauri-service';
```

Expose:

```ts
startStandaloneTauriSession(input: {
    appBinaryPath: string;
    dataDir: string;
    logDir: string;
}): Promise<WebdriverIO.Browser>;

terminateStandaloneTauriSession(
    browser: WebdriverIO.Browser,
    code?: number
): Promise<void>;
```

`startStandaloneTauriSession` creates Tauri capabilities for the binary and passes
`DTX_E2E_DATA_DIR` through the standalone global `env` option.
`terminateStandaloneTauriSession` requests controlled termination with the already-permitted
Tauri process command:

```ts
core.invoke('plugin:process|exit', { code });
```

It treats the expected WebDriver disconnect as termination, then best-effort calls
`cleanupWdioSession`. This helper is the reusable primitive consumed later by the HPA-311
post-create crash-recovery spec.

- [ ] **Step 2: Write the standalone relaunch smoke script**

The script must:

1. resolve the same debug E2E binary as `wdio.conf.ts`;
2. create one fixed temporary `DTX_E2E_DATA_DIR`;
3. start a first session through `startStandaloneTauriSession`;
4. invoke `write_preferences` with a distinctive sentinel;
5. terminate it through `terminateStandaloneTauriSession(browser, 86)`;
6. start a second standalone session with the same binary and data directory;
7. invoke `read_preferences` and assert the sentinel survived;
8. clean the second session and temp directory in `finally`.

Do not add a product-only “restart for tests” command. The existing `process:default` capability and supported standalone WDIO API are sufficient.

- [ ] **Step 3: Add scripts without rebuilding twice**

Set:

```json
{
	"e2e": "bun run e2e:build && bun run e2e:run",
	"e2e:run": "wdio run wdio.conf.ts && bun run e2e:relaunch",
	"e2e:relaunch": "bun run scripts/relaunch-smoke.ts"
}
```

This keeps the root `bun run e2e:desktop` contract unchanged and makes the existing CI `e2e:run` step execute both normal specs and the relaunch smoke against one build.

- [ ] **Step 4: Make CI intent explicit**

Rename the workflow run step to “Run desktop integration and relaunch tests.” No second build or external service is added.

- [ ] **Step 5: Run the E2E typecheck**

```bash
bun run --filter=dtx-e2e-desktop check
```

- [ ] **Step 6: Run the relaunch smoke against an existing E2E binary**

If `packages/dtx-desktop/src-tauri/target-e2e/debug/dtx-desktop` already exists:

```bash
bun run --filter=dtx-e2e-desktop e2e:relaunch
```

Otherwise defer runtime execution to Task 8's single authorized `bun run e2e:desktop`, which builds once.

- [ ] **Step 7: Commit**

```bash
git add packages/e2e-desktop .github/workflows/desktop-e2e-test.yml
git commit -m "test(desktop): add terminate and relaunch harness"
```

---

### Task 8: Verify the prerequisite as a shippable boundary

**Files:**

- Verify only; fix failures in the task-owned files above.

- [ ] **Step 1: Scan the removed trust contract**

```bash
rg -n "workspaceRoot|workspace_path" packages/dtx-desktop/src packages/dtx-desktop/src-tauri/src packages/e2e-desktop
```

Expected: only internal test-helper terminology, one-way legacy-key cleanup, and explicit spoofing regression tests remain. No registered IPC command or renderer invocation accepts a root.

- [ ] **Step 2: Run Rust formatting, unit tests, and lints**

```bash
cargo fmt --check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

- [ ] **Step 3: Run desktop renderer verification**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bunx eslint packages/dtx-desktop/src/renderer/src packages/e2e-desktop
bunx prettier --check packages/dtx-desktop/src packages/dtx-desktop/src-tauri/src packages/e2e-desktop .github/workflows/desktop-e2e-test.yml
```

- [ ] **Step 4: Run E2E type verification**

```bash
bun run --filter=dtx-e2e-desktop check
```

- [ ] **Step 5: Run the full native desktop E2E suite**

```bash
bun run e2e:desktop
```

Expected: the build runs once; normal Tauri/WebDriver specs prove native workspace restoration and containment; the standalone smoke then terminates and relaunches the binary against the same native state.

- [ ] **Step 6: Review the final diff**

```bash
git status --short
git diff --check
git diff --stat origin/main...
```

Confirm there is no Google Drive implementation, no imported renderer root, no broad test-package move, and no unrelated file change.

- [ ] **Step 7: Final prerequisite commit if verification fixes were needed**

```bash
git add packages/dtx-desktop packages/e2e-desktop .github/workflows/desktop-e2e-test.yml
git commit -m "test(desktop): complete trusted workspace prerequisite"
```

Do not create an empty commit when verification required no fixes.

## Completion Gate

HPA-311 implementation must not begin until:

- HPA-314's native workspace contract is merged or otherwise present in the implementation branch;
- renderer local storage cannot establish trust;
- every affected Rust command reads managed state;
- targeted Rust and renderer checks pass;
- `bun run e2e:desktop` passes, including both the containment scenario and the explicit terminate/relaunch sentinel smoke.
