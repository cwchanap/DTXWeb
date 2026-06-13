# DTX Desktop Tauri Migration Design

## Context

`packages/dtx-desktop` is currently an Electron desktop app with a Svelte 5
renderer. Electron owns the privileged desktop boundary through `src/main`,
`src/preload`, `electron.vite.config.ts`, and `electron-builder.yml`.

The renderer calls `window.electron.ipcRenderer` directly from services and a
small number of components. The Electron main process handles filesystem
access, folder selection, shell actions, local song creation, DTX metadata
parsing, skin asset loading, Supabase magic-link authentication, GraphQL API
calls, upload, zip export, custom `dtx://` protocol handling, and window
lifecycle.

The migration target is a full replacement of Electron with Tauri v2. The first
shipping targets are macOS and Windows. Linux parity is deferred.

## Decisions

- Migrate `packages/dtx-desktop` in place instead of creating a long-lived
  sibling package.
- Use a Rust-native Tauri host. Do not bundle a Node, Bun, or TypeScript
  sidecar for privileged desktop work.
- Keep the Svelte renderer as the UI/runtime surface.
- Add a typed renderer-side host adapter before removing Electron-specific
  renderer calls.
- Preserve the existing `dtx://auth-callback` web-to-desktop login handoff.
- Include Tauri updater parity in the first migration scope.
- Use corrected app identity in Tauri and perform best-effort import from old
  Electron storage on first run.

## Goals

- Remove Electron runtime, builder, preload, and main-process dependencies from
  `packages/dtx-desktop`.
- Preserve current desktop user workflows on macOS and Windows.
- Keep renderer behavior stable by replacing raw IPC channel calls with a
  typed host boundary.
- Port privileged host behavior to Rust/Tauri commands and plugins.
- Preserve current cloud API contracts and renderer-facing result shapes.
- Import useful Electron-era local data into the new Tauri storage namespace.
- Build Tauri artifacts for macOS and Windows with updater configuration
  present.

## Non-Goals

- No Linux packaging parity in the first migration milestone.
- No redesign of desktop UI, workspace UX, editor UX, or cloud linking flows.
- No changes to `dtx-web` login behavior beyond fixes required to preserve the
  existing `dtx://` flow.
- No GraphQL schema changes.
- No new production update service. Tauri updater config is included, but the
  real signed release endpoint can be finalized separately.

## Architecture

The final package has three layers:

1. **Renderer**: existing Svelte/Phaser application code.
2. **Renderer host adapter**: TypeScript module that exposes desktop operations
   as named methods and events.
3. **Tauri host**: Rust commands, state, plugins, and app configuration.

The renderer should not call `window.electron`, `window.__TAURI__`, or raw
Tauri `invoke` directly from feature code. Feature code calls the adapter. The
adapter calls Tauri APIs and converts responses into existing renderer-facing
shapes.

This allows the migration to happen in controlled steps:

1. Introduce the host adapter while Electron still works.
2. Move renderer services and components to the adapter.
3. Add Tauri configuration and Rust command modules.
4. Implement Tauri commands behind the adapter.
5. Remove Electron main/preload/build files and dependencies.

## Renderer Host Contract

The adapter keeps the current desktop capability surface, but exposes methods
instead of channel strings:

- `selectFolder`
- `pathExists`
- `openFolder`
- `loadTreeStructure`
- `listFiles`
- `listDirectory`
- `readFile`
- `getSkinAsset`
- `parseDtxFiles`
- `validateSession`
- `getCurrentSession`
- `logoutSession`
- `fetchUserSimfiles`
- `getPreviewUrl`
- `getSoundPreviewUrl`
- `loadAssetFiles`
- `createSong`
- `createSimfileRecord`
- `getNextDisplayId`
- `searchCloudSongs`
- `fetchCloudSong`
- `updateSimfileRecord`
- `exportSongToZip`
- `uploadFile`

The adapter also exposes auth callback events compatible with today's renderer
flow:

- `magic-link-result`
- `auth-callback`

The preferred final event is `magic-link-result`. Legacy `auth-callback` support
stays only to preserve existing behavior while tests and renderer code are
migrated.

## Rust Backend Modules

The Tauri backend should be split by responsibility:

### `commands::filesystem`

Owns directory picker, path existence checks, directory listing, tree loading,
guarded file reads, and opening folders in the OS file manager.

Tree loading preserves the current desktop behavior:

- Show directories named `DTXFiles.*`.
- Show directories containing `.dtx` files.
- Hide children for directories containing `.dtx` files.
- Read `SET.def` when present to expose a song title.

### `commands::songs`

Owns local song and asset workflows:

- Create song folders.
- Copy template contents safely.
- Write `SET.def` with UTF-16LE BOM.
- Parse DTX files for metadata.
- Export valid DTX-related files to zip.
- Load bundled skin assets from Tauri resources.

### `commands::auth`

Owns Supabase client state, current session state, magic-link verification,
session validation, logout, and deep-link handling.

The web app remains the source of desktop login handoff. It redirects to:

```text
dtx://auth-callback?magic_link=<encoded-magic-link>
```

Tauri handles the deep link on cold start and warm start. After verification,
Rust emits a `magic-link-result` event to the renderer with the same result
shape the renderer expects today.

### `commands::api`

Owns authenticated calls to the existing `dtx-api` GraphQL and REST endpoints:

- List user simfiles.
- Fetch simfile data.
- Fetch simfile file listings.
- Search cloud songs.
- Create and update simfile records.
- Get next display id.
- Resolve preview and sound preview URLs.
- Upload local files with bearer authentication.

Renderer-facing error envelopes stay compatible with the current TypeScript
main-process wrappers.

### `commands::migration`

Owns first-run best-effort import from Electron-era desktop storage into the
new Tauri app storage namespace.

### `commands::updater`

Owns Tauri updater plugin setup and graceful runtime behavior when the configured
endpoint is unavailable or still placeholder.

## Security And File Handling

The Rust backend preserves the current file guardrails:

- Resolve paths before use.
- Prevent path traversal outside the allowed workspace root.
- Allow file reads only for `.dtx`, `.def`, `.xa`, `.ogg`, `.wav`, and `.mp3`.
- Enforce a 1 MB limit for text files.
- Enforce a 10 MB limit for audio files.
- Return binary audio content in a renderer-consumable shape.
- Decode `.dtx` with Shift-JIS priority.
- Decode `.def` with UTF-16 priority.

Folder copy for song templates must reject copying a directory into itself or a
descendant. Zip export includes only valid DTX-related file extensions from
`@dtx/common`'s existing `VALID_DTX_FILE_EXTENSIONS` equivalent. If that
constant cannot be reused from Rust, the allowed list must be mirrored in Rust
and covered by tests.

## Packaging And Scripts

The Tauri app keeps the workspace package location:

```text
packages/dtx-desktop
```

The Electron build surface is removed:

- `electron.vite.config.ts`
- `electron-builder.yml`
- `dev-app-update.yml`
- `src/main`
- `src/preload`
- Electron-specific output assumptions
- Electron runtime and dev dependencies

Tauri adds:

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/*`
- Tauri capability and permission files as required by v2
- Tauri npm packages for JS API/plugin bindings

Root and package scripts should preserve command intent:

- `bun run --filter=dtx-desktop dev` launches Tauri dev.
- `bun run dev:desktop` launches Tauri dev.
- `bun run --filter=dtx-desktop build` performs renderer checks/build and
  Tauri packaging.
- Existing macOS and Windows package commands are replaced with Tauri
  equivalents.

The Electron-era TypeScript GraphQL client and generated TypeScript output are
removed with `src/main`. Rust owns desktop API calls. GraphQL operation
documents may be retained as source files only if the Rust API module consumes
or mirrors them directly; otherwise the operations are ported into Rust-owned
queries with tests covering the same result mapping.

## App Identity

Tauri should correct the Electron placeholder identity:

```json
{
	"productName": "Drumery",
	"identifier": "com.hapadona.drumery"
}
```

The deep-link scheme remains:

```text
dtx://
```

macOS and Windows protocol registration must preserve the existing desktop login
flow.

## Local Data Migration

On first run, Tauri performs best-effort import from old Electron storage into
the new Tauri storage namespace.

Data to import:

- Workspace path.
- Workspace bookmarks.
- Templates.
- Settings.
- Simfile cache metadata and data when format-compatible.
- Local-cloud linkage cache.
- Auth/session-adjacent data when it can be validated safely.

Auth migration must not block startup. If migrated Supabase tokens cannot be
validated, Tauri keeps non-auth data and requires fresh login.

Migration should be idempotent. The app records a migration marker after a
successful attempt so repeated launches do not overwrite newer Tauri state with
older Electron state. If migration partially fails, the command reports a
non-blocking warning to the renderer and preserves whatever data was imported
successfully.

## Updater

Tauri updater parity is included for macOS and Windows.

The migration should:

- Add the Tauri updater plugin.
- Configure updater bundle artifact generation.
- Configure updater permissions/capabilities.
- Add a typed command and adapter method for checking update status. No visible
  update UI is required in the first migration unless existing renderer code
  calls one.
- Fail gracefully when the release endpoint or public key is not production
  ready.

The existing Electron updater URL is placeholder configuration. The Tauri config
must not imply production updates are ready until a real signed update endpoint
and key are available.

## Error Handling

Command errors should map to stable renderer-facing results:

- File reads return the existing `ReadFileResult` shape.
- Asset listing and loading return `{ success, data }` or `{ success, error }`.
- Cloud API helpers return the current `ApiResult<T>` envelope.
- Upload failures include timeout, auth, missing file, and server error cases.
- Export failures return user-actionable messages for missing files, invalid
  destination, and write failures.
- Updater failures are non-blocking unless the user explicitly initiates an
  update install.

Rust logs should include enough context for debugging while avoiding secrets,
tokens, magic-link contents, and local file contents.

## Testing

Renderer unit tests stay in Vitest/jsdom. Tests that currently mock
`window.electron.ipcRenderer` should move toward mocking the typed host adapter.
This keeps renderer tests independent from Electron and Tauri globals.

Rust tests should cover pure logic and command behavior:

- Path resolution and traversal rejection.
- Allowed extension and file-size guards.
- Text/audio file read results.
- Tree filtering and `SET.def` title extraction.
- `SET.def` UTF-16LE BOM writing.
- Template copy self/descendant rejection.
- Zip export filtering.
- Deep-link URL parsing.
- Magic-link result mapping with mocked Supabase behavior.
- GraphQL result mapping with mocked API responses.
- Upload error mapping.
- Migration parsing and idempotency.
- Updater unavailable/placeholder handling.

Network-dependent behavior should use mockable clients or local test doubles,
not real Supabase or `dtx-api` calls in unit tests.

## Verification

Required local verification after implementation:

```bash
bun run --filter=dtx-desktop check
bun run --filter=dtx-desktop test
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Build verification:

- macOS Tauri build succeeds locally.
- Windows Tauri packaging path is documented and verified on a Windows machine
  or CI runner before release.

Manual parity smoke:

1. Launch the Tauri app.
2. Log in through `redirect=desktop`.
3. Confirm the `dtx://` handoff reaches the app.
4. Select a workspace.
5. Load the workspace tree.
6. Open a song.
7. Verify DTX/text/audio reads through the editor and preview path.
8. Verify bundled skin assets load.
9. Create a song from scratch and from a template.
10. Upload a local file to cloud simfile storage.
11. Search, link, edit, and fetch cloud simfile data.
12. Export a song folder to zip.
13. Open a folder in the OS file manager.
14. Confirm updater checks fail gracefully when endpoint config is placeholder.
15. Confirm migrated Electron local data is present or fresh-login fallback is
    clear.

## Rollout Notes

Because this is a full replacement, Electron removal happens only after Tauri
parity is implemented and verified. The final migration should leave no
Electron runtime, preload, or builder dependencies in `dtx-desktop`.

The implementation plan should sequence work so the typed host adapter lands
before the Rust command port. That keeps renderer churn reviewable and gives
tests a stable boundary while the host changes underneath.
