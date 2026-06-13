# DTX Desktop Tauri Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `packages/dtx-desktop`'s Electron host with a Rust-native Tauri v2 host while preserving current macOS and Windows desktop behavior.

**Architecture:** Keep the existing Svelte renderer, insert a typed TypeScript `desktopHost` adapter, and move privileged desktop work into focused Rust/Tauri modules. Electron stays usable only while the adapter and Tauri host are being introduced; the final tasks remove Electron runtime, preload, main-process, builder, and updater dependencies.

**Tech Stack:** Svelte 5, Vite 6, Bun workspaces, Vitest/jsdom, Tauri v2, Rust, Tokio, Reqwest, Serde, GraphQL over HTTP, Supabase auth, Tauri dialog/opener/deep-link/single-instance/updater plugins.

---

## Scope Check

The approved spec is one migration project with coupled boundaries: renderer host API, Rust commands, desktop packaging, local data import, and verification. It should stay a single implementation plan because every subsystem serves the same shippable milestone: Tauri replaces Electron for `packages/dtx-desktop` on macOS and Windows.

Linux packaging is outside this plan. UI redesign is outside this plan. `dtx-web` changes are outside this plan unless the existing `dtx://auth-callback` flow is found broken during verification.

## File Structure

Create or modify these files during the migration:

- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`: typed renderer host adapter. Renderer feature code calls this file, not Electron or Tauri globals.
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`: adapter tests for Electron compatibility and Tauri command/event mapping.
- `packages/dtx-desktop/src/tests/setup.ts`: shared test mock moves from raw Electron IPC to host adapter-friendly mocks.
- `packages/dtx-desktop/src/renderer/src/services/*.ts`: replace direct `window.electron.ipcRenderer` use with `desktopHost`.
- `packages/dtx-desktop/src/renderer/src/components/*.svelte`: replace remaining direct `window.electron` use with `desktopHost`.
- `packages/dtx-desktop/src/renderer/src/scenes/DesktopPreview.ts`: load skin assets through `desktopHost`.
- `packages/dtx-desktop/vite.config.ts`: renderer Vite config replacing the renderer section of `electron.vite.config.ts`.
- `packages/dtx-desktop/tsconfig.web.json`: remove Electron toolkit inheritance and preload typings.
- `packages/dtx-desktop/package.json`: add Tauri scripts/dependencies, then remove Electron scripts/dependencies in the final cleanup task.
- `packages/dtx-desktop/src-tauri/Cargo.toml`: Rust crate dependencies for the Tauri host.
- `packages/dtx-desktop/src-tauri/build.rs`: Tauri build script.
- `packages/dtx-desktop/src-tauri/tauri.conf.json`: app identity, build settings, resources, bundle, updater, and deep-link config.
- `packages/dtx-desktop/src-tauri/capabilities/main.json`: Tauri v2 permissions for the main window.
- `packages/dtx-desktop/src-tauri/src/lib.rs`: Tauri builder, plugins, shared state, command registration, and deep-link wiring.
- `packages/dtx-desktop/src-tauri/src/main.rs`: desktop entrypoint.
- `packages/dtx-desktop/src-tauri/src/error.rs`: backend error type and renderer-safe error conversion.
- `packages/dtx-desktop/src-tauri/src/models.rs`: shared command request/response types matching renderer-facing shapes.
- `packages/dtx-desktop/src-tauri/src/filesystem.rs`: filesystem commands and pure path/file helpers.
- `packages/dtx-desktop/src-tauri/src/songs.rs`: create song, parse DTX metadata, export zip, and skin asset commands.
- `packages/dtx-desktop/src-tauri/src/auth.rs`: Supabase session state, deep-link parsing, validation, logout, and magic-link verification.
- `packages/dtx-desktop/src-tauri/src/api.rs`: GraphQL and upload commands using bearer auth.
- `packages/dtx-desktop/src-tauri/src/migration.rs`: first-run Electron local data import.
- `packages/dtx-desktop/src-tauri/src/updater.rs`: updater check/install commands with non-blocking failures.
- `packages/dtx-desktop/src-tauri/tests/*.rs`: integration tests for Rust modules when unit tests need temp directories or HTTP mocks.
- Remove in final cleanup: `packages/dtx-desktop/src/main`, `packages/dtx-desktop/src/preload`, `packages/dtx-desktop/electron.vite.config.ts`, `packages/dtx-desktop/electron-builder.yml`, `packages/dtx-desktop/dev-app-update.yml`, `packages/dtx-desktop/tsconfig.node.json`, Electron generated GraphQL TypeScript output, and Electron-only tests.

---

### Task 1: Add Renderer Host Adapter While Electron Still Runs

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Create: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/env.d.ts`
- Modify: `packages/dtx-desktop/src/tests/setup.ts`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `bun.lock`

- [x] **Step 1: Write failing adapter tests**

Create `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopHost, setDesktopHostRuntimeForTests, type DesktopHostRuntime } from './desktopHost';

const makeRuntime = (kind: DesktopHostRuntime['kind'] = 'tauri'): DesktopHostRuntime => ({
	kind,
	invoke: vi.fn(),
	send: vi.fn(),
	listen: vi.fn(),
	removeAllListeners: vi.fn(),
	getPlatform: vi.fn(() => 'darwin'),
	getVersions: vi.fn(() => ({ app: '1.0.0', tauri: null, electron: '35.0.0' }))
});

describe('desktopHost', () => {
	let runtime: DesktopHostRuntime;

	beforeEach(() => {
		runtime = makeRuntime();
		setDesktopHostRuntimeForTests(runtime);
	});

	it('maps selectFolder to the Tauri command', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({ canceled: false, filePaths: ['/songs'] });

		await expect(desktopHost.selectFolder()).resolves.toEqual({
			canceled: false,
			filePaths: ['/songs']
		});
		expect(runtime.invoke).toHaveBeenCalledWith('select_folder');
	});

	it('maps selectFolder to the Electron channel while Electron is the runtime', async () => {
		runtime = makeRuntime('electron');
		setDesktopHostRuntimeForTests(runtime);
		vi.mocked(runtime.invoke).mockResolvedValue({ canceled: true, filePaths: [] });

		await desktopHost.selectFolder();

		expect(runtime.invoke).toHaveBeenCalledWith('select-folder');
	});

	it('maps readFile to the host command with workspaceRoot', async () => {
		vi.mocked(runtime.invoke).mockResolvedValue({
			error: null,
			content: '#TITLE: Song',
			isText: true
		});

		await expect(desktopHost.readFile('/songs/a.dtx', '/songs')).resolves.toEqual({
			error: null,
			content: '#TITLE: Song',
			isText: true
		});
		expect(runtime.invoke).toHaveBeenCalledWith('read_file', {
			filePath: '/songs/a.dtx',
			workspaceRoot: '/songs'
		});
	});

	it('uses send for external URLs', async () => {
		await desktopHost.openExternalUrl('https://example.com/login');
		expect(runtime.send).toHaveBeenCalledWith('open_external_url', {
			url: 'https://example.com/login'
		});
	});

	it('registers and removes magic-link listeners', async () => {
		const unlisten = vi.fn();
		vi.mocked(runtime.listen).mockResolvedValue(unlisten);
		const callback = vi.fn();

		const stop = await desktopHost.onMagicLinkResult(callback);
		expect(runtime.listen).toHaveBeenCalledWith('magic-link-result', callback);

		stop();
		expect(unlisten).toHaveBeenCalledTimes(1);
	});
});
```

- [x] **Step 2: Run the failing test**

Run: `bun run --filter=dtx-desktop test -- desktopHost.test.ts`

Expected: FAIL because `src/renderer/src/services/desktopHost.ts` does not exist.

- [x] **Step 3: Implement the adapter**

Install the Tauri JS API that the adapter imports:

```bash
bun add --filter=dtx-desktop @tauri-apps/api@^2
```

Create `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`:

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

type EventCallback<T> = (payload: T) => void | Promise<void>;

type HostVersions = {
	app: string | null;
	tauri: string | null;
	electron: string | null;
	chrome?: string | null;
	node?: string | null;
};

type SelectFolderResult = { canceled: boolean; filePaths: string[] };
type PathExistsResult = { exists: boolean; error: string | null };
type ReadFileResult =
	| { error: string; content: '' }
	| { error: null; content: string; isText: true }
	| { error: null; content: number[]; isText: false };

export type DesktopHostRuntime = {
	kind: 'electron' | 'tauri';
	invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>;
	send: (command: string, ...args: unknown[]) => Promise<void>;
	listen: <T = unknown>(event: string, callback: EventCallback<T>) => Promise<UnlistenFn>;
	removeAllListeners: (event: string) => void;
	getPlatform: () => string;
	getVersions: () => HostVersions;
};

const hasTauri = (): boolean => typeof window !== 'undefined' && '__TAURI__' in window;

const createRuntime = (): DesktopHostRuntime => {
	if (hasTauri()) {
		return {
			kind: 'tauri',
			invoke: (command, args) => tauriInvoke(command, args),
			send: (command, args) => tauriInvoke(command, args).then(() => undefined),
			listen: async (event, callback) =>
				tauriListen(event, (tauriEvent) => callback(tauriEvent.payload)),
			removeAllListeners: () => undefined,
			getPlatform: () => navigator.platform,
			getVersions: () => ({ app: null, tauri: '2', electron: null })
		};
	}

	return {
		kind: 'electron',
		invoke: (command, ...args) => window.electron.ipcRenderer.invoke(command, ...args),
		send: (command, ...args) => window.electron.ipcRenderer.send(command, ...args),
		listen: async (event, callback) => {
			const handler = (_event: unknown, payload: unknown) => callback(payload);
			window.electron.ipcRenderer.on(event, handler);
			return () => window.electron.ipcRenderer.removeListener(event, handler);
		},
		removeAllListeners: (event) => window.electron.ipcRenderer.removeAllListeners(event),
		getPlatform: () => window.electron.process?.platform ?? navigator.platform,
		getVersions: () => ({
			app: null,
			tauri: null,
			electron: window.electron.process?.versions?.electron ?? null,
			chrome: window.electron.process?.versions?.chrome ?? null,
			node: window.electron.process?.versions?.node ?? null
		})
	};
};

let runtime: DesktopHostRuntime = createRuntime();

export const setDesktopHostRuntimeForTests = (nextRuntime: DesktopHostRuntime): void => {
	runtime = nextRuntime;
};

const invokeMapped = <T>(
	tauriCommand: string,
	tauriArgs: Record<string, unknown> | undefined,
	electronChannel: string,
	electronArgs: unknown[] = []
) => {
	if (runtime.kind === 'tauri') {
		return runtime.invoke<T>(tauriCommand, tauriArgs);
	}
	return runtime.invoke<T>(electronChannel, ...electronArgs);
};

const sendMapped = (
	tauriCommand: string,
	tauriArgs: Record<string, unknown> | undefined,
	electronChannel: string,
	electronArgs: unknown[] = []
) => {
	if (runtime.kind === 'tauri') {
		return runtime.send(tauriCommand, tauriArgs);
	}
	return runtime.send(electronChannel, ...electronArgs);
};

export const desktopHost = {
	selectFolder: () =>
		invokeMapped<SelectFolderResult>('select_folder', undefined, 'select-folder'),
	pathExists: (basePath: string, ...pathParts: string[]) =>
		invokeMapped<PathExistsResult>('path_exists', { basePath, pathParts }, 'path-exists', [
			basePath,
			...pathParts
		]),
	openExternalUrl: (url: string) =>
		sendMapped('open_external_url', { url }, 'open-external-url', [url]),
	openFolder: (folderPath: string) =>
		invokeMapped<{ success: boolean; error?: string }>(
			'open_folder',
			{ folderPath },
			'open-folder-in-explorer',
			[folderPath]
		),
	listDirectories: (dirPath: string) =>
		invokeMapped<string[]>('list_directories', { dirPath }, 'list-directories', [dirPath]),
	listDirectory: (dirPath: string) =>
		invokeMapped<{
			files: Array<{ name: string; path: string; type: string }>;
			error: string | null;
		}>('list_directory', { dirPath }, 'list-directory', [dirPath]),
	loadTreeStructure: (basePath: string, ...pathParts: string[]) =>
		invokeMapped<unknown[]>(
			'load_tree_structure',
			{ basePath, pathParts },
			'load-tree-structure',
			[basePath, ...pathParts]
		),
	listFiles: (dirPath: string) =>
		invokeMapped<{ files: unknown[]; error?: string }>(
			'list_files',
			{ dirPath },
			'list-files',
			[dirPath]
		),
	readFile: (filePath: string, workspaceRoot: string | null = null) =>
		invokeMapped<ReadFileResult>('read_file', { filePath, workspaceRoot }, 'read-file', [
			filePath,
			workspaceRoot
		]),
	getSkinAsset: (assetPath: string) =>
		invokeMapped<{ success: boolean; dataUrl?: string; error?: string }>(
			'get_skin_asset',
			{ assetPath },
			'get-skin-asset',
			[assetPath]
		),
	parseDtxFiles: (folderPath: string) =>
		invokeMapped('parse_dtx_files', { folderPath }, 'parse-dtx-files', [folderPath]),
	validateSession: (sessionData: { accessToken: string; refreshToken: string }) =>
		invokeMapped<boolean>('validate_session', { sessionData }, 'validate-session', [
			sessionData
		]),
	getCurrentSession: () => invokeMapped('get_current_session', undefined, 'get-current-session'),
	logoutSession: () => invokeMapped<boolean>('logout_session', undefined, 'logout-session'),
	fetchUserSimfiles: () => invokeMapped('fetch_user_simfiles', undefined, 'fetch-user-simfiles'),
	getPreviewUrl: (simfileId: number) =>
		invokeMapped<string>('get_preview_url', { simfileId }, 'get-preview-url', [simfileId]),
	getSoundPreviewUrl: (simfileId: number) =>
		invokeMapped<string>('get_sound_preview_url', { simfileId }, 'get-sound-preview-url', [
			simfileId
		]),
	loadAssetFiles: (simfileId: string) =>
		invokeMapped('load_asset_files', { simfileId }, 'load-asset-files', [simfileId]),
	createSong: (options: unknown) =>
		invokeMapped('create_song', { options }, 'create-song', [options]),
	createSimfileRecord: (simfileData: unknown) =>
		invokeMapped('create_simfile_record', { simfileData }, 'create-simfile-record', [
			simfileData
		]),
	getNextDisplayId: () =>
		invokeMapped<number>('get_next_display_id', undefined, 'get-next-display-id'),
	searchCloudSongs: (query: string, limit = 8, excludeLinkedSongIds: string[] = []) =>
		invokeMapped(
			'search_cloud_songs',
			{ query, limit, excludeLinkedSongIds },
			'search-cloud-songs',
			[{ query, limit, excludeLinkedSongIds }]
		),
	fetchCloudSong: (cloudSongId: string | number) =>
		invokeMapped('fetch_cloud_song', { cloudSongId }, 'fetch-cloud-song', [{ cloudSongId }]),
	updateSimfileRecord: (simfileId: string | number, updateData: Record<string, unknown>) =>
		invokeMapped('update_simfile_record', { simfileId, updateData }, 'update-simfile-record', [
			{ simfileId, updateData }
		]),
	exportSongToZip: (input: { songPath: string; songTitle: string; exportDirectory?: string }) =>
		invokeMapped('export_song_to_zip', input, 'export-song-to-zip', [input]),
	uploadFile: (fileName: string, songFolderPath: string, simfileId: string) =>
		invokeMapped('upload_file', { fileName, songFolderPath, simfileId }, 'upload-file', [
			fileName,
			songFolderPath,
			simfileId
		]),
	checkForUpdate: () => invokeMapped('check_for_update', undefined, 'check-for-update'),
	getPlatform: () => runtime.getPlatform(),
	getVersions: () => runtime.getVersions(),
	onMagicLinkResult: async (callback: EventCallback<unknown>) =>
		runtime.listen('magic-link-result', callback),
	onAuthCallback: async (callback: EventCallback<unknown>) =>
		runtime.listen('auth-callback', callback),
	removeAllListeners: (event: string) => runtime.removeAllListeners(event)
};
```

Modify `packages/dtx-desktop/src/renderer/src/env.d.ts`:

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DTX_SERVER_URL: string;
	readonly VITE_DTX_API_URL: string;
	readonly PUBLIC_SUPABASE_URL: string;
	readonly PUBLIC_SUPABASE_ANON_KEY: string;
	readonly PUBLIC_SIMFILE_BUCKET_URL: string;
}

interface Window {
	__TAURI__?: unknown;
	electron: {
		ipcRenderer: {
			invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
			send: (channel: string, ...args: unknown[]) => Promise<void>;
			on: (channel: string, listener: (...args: unknown[]) => void) => void;
			removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
			removeAllListeners: (channel: string) => void;
		};
		process?: {
			platform?: string;
			env?: Record<string, string | undefined>;
			versions?: Record<string, string | undefined>;
		};
	};
}
```

- [x] **Step 4: Update test setup for listener removal**

Modify the Electron mock in `packages/dtx-desktop/src/tests/setup.ts`:

```ts
Object.defineProperty(window, 'electron', {
	configurable: true,
	writable: true,
	value: {
		ipcRenderer: {
			send: vi.fn(),
			on: vi.fn(),
			invoke: vi.fn(),
			removeListener: vi.fn(),
			removeAllListeners: vi.fn()
		},
		process: {
			platform: 'darwin',
			env: {
				HOME: '/Users/Test',
				USERPROFILE: 'C:\\Users\\Test',
				USERNAME: 'Test'
			},
			versions: {
				electron: '35.0.0',
				chrome: '130.0.0',
				node: '20.0.0'
			}
		}
	}
});
```

- [x] **Step 5: Run adapter tests**

Run: `bun run --filter=dtx-desktop test -- desktopHost.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add bun.lock packages/dtx-desktop/package.json packages/dtx-desktop/src/renderer/src/services/desktopHost.ts packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts packages/dtx-desktop/src/renderer/src/env.d.ts packages/dtx-desktop/src/tests/setup.ts
git commit -m "feat(desktop): add typed host adapter"
```

---

### Task 2: Move Renderer Services To `desktopHost`

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/services/assetFileService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/supabaseService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopFileProvider.ts`
- Modify tests beside each service.

- [x] **Step 1: Update service tests to mock `desktopHost`**

At the top of each affected service test, replace raw `window.electron` setup with this pattern:

```ts
import { vi } from 'vitest';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		selectFolder: vi.fn(),
		pathExists: vi.fn(),
		openExternalUrl: vi.fn(),
		openFolder: vi.fn(),
		listDirectories: vi.fn(),
		listDirectory: vi.fn(),
		loadTreeStructure: vi.fn(),
		listFiles: vi.fn(),
		readFile: vi.fn(),
		validateSession: vi.fn(),
		getCurrentSession: vi.fn(),
		logoutSession: vi.fn(),
		fetchUserSimfiles: vi.fn(),
		getPreviewUrl: vi.fn(),
		getSoundPreviewUrl: vi.fn(),
		loadAssetFiles: vi.fn()
	}
}));
```

In tests that need the mock object, import it:

```ts
import { desktopHost } from './desktopHost';

const host = vi.mocked(desktopHost);
```

- [x] **Step 2: Run one service test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- workspaceService.test.ts`

Expected: FAIL because service implementation still calls `window.electron`.

- [x] **Step 3: Replace direct service calls**

Use these replacements:

```ts
// assetFileService.ts
import { desktopHost } from './desktopHost';

export const loadAssetFiles = async (simfileId: string) => {
	return await desktopHost.loadAssetFiles(simfileId);
};
```

```ts
// supabaseService.ts
import { desktopHost } from './desktopHost';

const isValid = await desktopHost.validateSession(sessionData);
const session = await desktopHost.getCurrentSession();
```

```ts
// simFileService.ts
import { desktopHost } from './desktopHost';

const result = (await desktopHost.fetchUserSimfiles()) as MainProcessSimFileResult;
const result = await desktopHost.getNextDisplayId();
return await desktopHost.getPreviewUrl(simfileId);
return await desktopHost.getSoundPreviewUrl(simfileId);
```

```ts
// authService.ts
import { desktopHost } from './desktopHost';

await desktopHost.openExternalUrl(WEB_APP_LOGIN_URL);
await desktopHost.logoutSession();
```

```ts
// desktopFileProvider.ts
import { desktopHost } from './desktopHost';

const result = await desktopHost.readFile(filePath, workspaceRoot);
```

```ts
// workspaceService.ts
import { desktopHost } from './desktopHost';

const result = await desktopHost.selectFolder();
const pathResult = await desktopHost.pathExists(bookmark.path);
const folders = await desktopHost.listDirectories(currentPath);
const treeData = await desktopHost.loadTreeStructure(currentPath, currentSubWorkspace);
const children = await desktopHost.loadTreeStructure(nodePath);
```

Keep the existing service-level error messages unchanged unless a test already expects a better message.

- [x] **Step 4: Run focused service tests**

Run:

```bash
bun run --filter=dtx-desktop test -- assetFileService.test.ts supabaseService.test.ts simFileService.test.ts authService.test.ts workspaceService.test.ts desktopFileProvider.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/services packages/dtx-desktop/src/renderer/src/stores/settingsStore.test.ts
git commit -m "refactor(desktop): route services through host adapter"
```

---

### Task 3: Move Renderer Components And Phaser Preview To `desktopHost`

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongAutocomplete.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/NewSong.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Templates.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Settings.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/DesktopEditor.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Versions.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/VersionsModal.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/scenes/DesktopPreview.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/settingsStore.ts`
- Modify if needed: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify related tests.

- [x] **Step 1: Update component tests to mock `desktopHost`**

For component tests with IPC assertions, mock the adapter:

```ts
vi.mock('../services/desktopHost', () => ({
	desktopHost: {
		selectFolder: vi.fn(),
		openFolder: vi.fn(),
		listFiles: vi.fn(),
		listDirectory: vi.fn(),
		readFile: vi.fn(),
		getSkinAsset: vi.fn(),
		loadAssetFiles: vi.fn(),
		createSong: vi.fn(),
		createSimfileRecord: vi.fn(),
		searchCloudSongs: vi.fn(),
		fetchCloudSong: vi.fn(),
		updateSimfileRecord: vi.fn(),
		exportSongToZip: vi.fn(),
		uploadFile: vi.fn(),
		getVersions: vi.fn(() => ({ app: '1.0.0', tauri: '2', electron: null })),
		getPlatform: vi.fn(() => 'darwin'),
		getEnvironment: vi.fn(() => ({
			HOME: '/Users/Test',
			USERPROFILE: 'C:\\Users\\Test',
			USERNAME: 'Test'
		})),
		onMagicLinkResult: vi.fn(),
		onAuthCallback: vi.fn(),
		removeAllListeners: vi.fn()
	}
}));
```

- [x] **Step 2: Run component tests to verify failures are tied to direct Electron use**

Run:

```bash
bun run --filter=dtx-desktop test -- NewSong.test.ts SongDetails.test.ts Templates.test.ts Settings.test.ts settingsStore.test.ts DesktopPreview.test.ts Versions.test.ts VersionsModal.test.ts CloudSongAutocomplete.test.ts
```

Expected: FAIL in tests that still assert `window.electron.ipcRenderer` calls.

- [x] **Step 3: Replace component and scene calls**

Use these concrete replacements:

```ts
// App.svelte script
import { desktopHost } from './services/desktopHost';

let stopMagicLinkListener: (() => void) | null = null;
let stopAuthCallbackListener: (() => void) | null = null;

stopMagicLinkListener = await desktopHost.onMagicLinkResult(async (result) => {
	await authService.handleMagicLinkResult(result as never);
});

stopAuthCallbackListener = await desktopHost.onAuthCallback(async (tokens) => {
	await authService.handleAuthCallback(tokens as never);
});

onDestroy(() => {
	stopAuthCallbackListener?.();
	stopMagicLinkListener?.();
	window.removeEventListener('hashchange', handleRouteChange);
});
```

```ts
// DesktopPreview.ts
import { desktopHost } from '../services/desktopHost';

const laneIconsResult = await desktopHost.getSkinAsset('default/Graphics/7_pads.png');
const drumChipsResult = await desktopHost.getSkinAsset('default/Graphics/7_chips_drums.png');
```

```ts
// CloudSongAutocomplete.svelte
import { desktopHost } from '../services/desktopHost';

const result = await desktopHost.searchCloudSongs({
	query: searchQuery.trim(),
	limit: 20,
	excludeLinkedSongIds
});
```

```ts
// NewSong.svelte, Templates.svelte, Settings.svelte
import { desktopHost } from '../services/desktopHost';

const result = await desktopHost.selectFolder();
const created = await desktopHost.createSong({
	selectedPath,
	sanitizedFolderName,
	sanitizedSongName,
	templateFolderPath
});
await desktopHost.openFolder(folderPath);
```

```ts
// SongDetails.svelte
import { desktopHost } from '../services/desktopHost';

const result = await desktopHost.listFiles(song.path);
const response = await desktopHost.readFile(filePath, song.path);
const cloud = await desktopHost.fetchCloudSong({ cloudSongId });
const updated = await desktopHost.updateSimfileRecord({ simfileId, updateData });
const exported = await desktopHost.exportSongToZip({ songPath, songTitle, exportDirectory });
const uploaded = await desktopHost.uploadFile(fileName, song.path, simfileId);
```

```ts
// DesktopEditor.svelte
import { desktopHost } from '../services/desktopHost';

const setDefResult = await desktopHost.readFile(`${folderPath}/SET.def`, folderPath);
const folderContents = await desktopHost.listFiles(folderPath);
```

```ts
// settingsStore.ts
import { desktopHost } from '../services/desktopHost';

const platform = desktopHost.getPlatform();
const env = desktopHost.getEnvironment?.() ?? {};
```

If `settingsStore.ts` needs environment access to preserve existing default Downloads path behavior, add a small synchronous `desktopHost.getEnvironment()` adapter method:

- Electron: return `window.electron.process?.env ?? {}`.
- Tauri: return `{}` until Task 4/5 can wire a real Rust/path command.
- Preserve a useful Tauri fallback such as `~/Downloads`, which current export code already expands.

```ts
// Versions.svelte and VersionsModal.svelte
import { desktopHost } from '../services/desktopHost';

const versions = desktopHost.getVersions();
```

- [x] **Step 4: Run focused component tests**

Run:

```bash
bun run --filter=dtx-desktop test -- NewSong.test.ts SongDetails.test.ts Templates.test.ts Settings.test.ts settingsStore.test.ts DesktopPreview.test.ts Versions.test.ts VersionsModal.test.ts CloudSongAutocomplete.test.ts
```

Expected: PASS.

- [x] **Step 5: Verify no renderer feature code calls `window.electron`**

Run:

```bash
rg -n "window\\.electron|ipcRenderer" packages/dtx-desktop/src/renderer/src --glob '!**/services/desktopHost.ts' --glob '!**/services/desktopHost.test.ts' --glob '!**/*.test.ts'
```

Expected: no renderer feature-code matches outside the `desktopHost` Electron compatibility boundary. Test files may still contain compatibility mocks only where the test subject requires them.

- [x] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src
git commit -m "refactor(desktop): remove renderer electron ipc calls"
```

---

### Task 4: Add Vite Renderer Config And Tauri Scaffold

**Files:**

- Create: `packages/dtx-desktop/vite.config.ts`
- Create: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Create: `packages/dtx-desktop/src-tauri/build.rs`
- Create: `packages/dtx-desktop/src-tauri/tauri.conf.json`
- Create: `packages/dtx-desktop/src-tauri/capabilities/main.json`
- Create: `packages/dtx-desktop/src-tauri/src/main.rs`
- Create: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Create generated scaffold artifacts: `packages/dtx-desktop/src-tauri/Cargo.lock`, `packages/dtx-desktop/src-tauri/gen/schemas/*.json`, `packages/dtx-desktop/src-tauri/icons/icon.png`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/dtx-desktop/tsconfig.web.json`
- Modify: `.gitignore`

- [x] **Step 1: Add Tauri packages**

Run:

```bash
bun add --filter=dtx-desktop @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-opener@^2 @tauri-apps/plugin-updater@^2
bun add --filter=dtx-desktop -d @tauri-apps/cli@^2
```

Expected: `packages/dtx-desktop/package.json` and `bun.lock` gain Tauri JS dependencies.

- [x] **Step 2: Create Vite config**

Create `packages/dtx-desktop/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
	root: 'src/renderer',
	envDir: workspaceRoot,
	envPrefix: ['VITE_', 'PUBLIC_'],
	publicDir: '../../static',
	plugins: [wasm(), tailwindcss(), svelte()],
	server: {
		port: 5174,
		strictPort: true
	},
	build: {
		outDir: '../../dist',
		emptyOutDir: true
	},
	optimizeDeps: {
		exclude: ['xa_decoder']
	},
	resolve: {
		alias: {
			'@dtx/ui-components': path.resolve(__dirname, '../ui-components/src/lib'),
			'@dtx/common/components': path.resolve(__dirname, '../common/src/lib/components.ts'),
			'@dtx/common/game': path.resolve(__dirname, '../common/src/lib/game.ts'),
			'@dtx/common/server': path.resolve(__dirname, '../common/src/lib/server.ts'),
			'@dtx/common': path.resolve(__dirname, '../common/src/lib')
		}
	}
});
```

- [x] **Step 3: Update package scripts without deleting Electron scripts yet**

Modify `packages/dtx-desktop/package.json` scripts:

```json
{
	"scripts": {
		"typecheck": "svelte-check --tsconfig ./tsconfig.web.json",
		"svelte-check": "svelte-check --tsconfig ./tsconfig.web.json",
		"dev": "tauri dev",
		"dev:renderer": "vite --config vite.config.ts",
		"build": "bun run typecheck && tauri build",
		"build:renderer": "vite build --config vite.config.ts",
		"build:debug": "bun run typecheck && tauri build --debug",
		"build:mac": "bun run build",
		"build:win": "bun run build",
		"tauri": "tauri",
		"test": "vitest --run",
		"test:watch": "vitest",
		"test:coverage": "vitest --run --coverage"
	}
}
```

Keep `codegen` and `lint:codegen` until the Rust API task removes the TypeScript GraphQL client.

- [x] **Step 4: Update web tsconfig**

Modify `packages/dtx-desktop/tsconfig.web.json`:

```json
{
	"include": [
		"src/renderer/src/env.d.ts",
		"src/renderer/src/**/*",
		"src/renderer/src/**/*.svelte",
		"../ui-components/src/lib/**/*.svelte",
		"../ui-components/src/lib/**/*.ts"
	],
	"exclude": [
		"**/*.test.ts",
		"**/*.spec.ts",
		"../ui-components/src/lib/**/*.test.ts",
		"../ui-components/src/lib/**/*.spec.ts"
	],
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"verbatimModuleSyntax": true,
		"useDefineForClassFields": true,
		"strict": false,
		"allowJs": true,
		"checkJs": true,
		"composite": true,
		"skipLibCheck": true,
		"lib": ["ESNext", "DOM", "DOM.Iterable"],
		"baseUrl": ".",
		"paths": {
			"@/*": ["src/renderer/src/*"],
			"@dtx/ui-components/*": ["../ui-components/src/lib/*"]
		},
		"types": ["vite/client"]
	}
}
```

- [x] **Step 5: Create Rust crate files**

Create `packages/dtx-desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "dtx-desktop"
version = "1.0.0"
description = "Drumery desktop app"
authors = ["Hapadona"]
edition = "2021"
rust-version = "1.77"

[lib]
name = "dtx_desktop"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "dtx-desktop"
path = "src/main.rs"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
async-recursion = "1"
base64 = "0.22"
encoding_rs = "0.8"
reqwest = { version = "0.12", default-features = false, features = ["json", "multipart", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-deep-link = "2"
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-process = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-updater = "2"
thiserror = "2"
tokio = { version = "1", features = ["fs", "io-util", "macros", "rt-multi-thread", "sync"] }
url = "2"
zip = "2"

[dev-dependencies]
tempfile = "3"
wiremock = "0.6"
```

Create `packages/dtx-desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

Create `packages/dtx-desktop/src-tauri/src/main.rs`:

```rust
fn main() {
    dtx_desktop::run();
}
```

Create minimal `packages/dtx-desktop/src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
```

- [x] **Step 6: Create Tauri config**

Create `packages/dtx-desktop/src-tauri/tauri.conf.json`:

```json
{
	"$schema": "https://schema.tauri.app/config/2",
	"productName": "Drumery",
	"version": "1.0.0",
	"identifier": "com.hapadona.drumery",
	"build": {
		"beforeDevCommand": "bun run dev:renderer",
		"beforeBuildCommand": "bun run build:renderer",
		"devUrl": "http://localhost:5174",
		"frontendDist": "../dist"
	},
	"app": {
		"windows": [
			{
				"label": "main",
				"title": "Drumery",
				"width": 900,
				"height": 670,
				"resizable": true
			}
		],
		"security": {
			"csp": null
		}
	},
	"bundle": {
		"active": true,
		"targets": ["dmg", "nsis"],
		"createUpdaterArtifacts": true,
		"resources": ["../static/skin"],
		"macOS": {
			"minimumSystemVersion": "10.13",
			"entitlements": "../build/entitlements.mac.plist"
		},
		"windows": {
			"webviewInstallMode": {
				"type": "downloadBootstrapper"
			}
		}
	},
	"plugins": {
		"deep-link": {
			"desktop": {
				"schemes": ["dtx"]
			}
		},
		"updater": {
			"pubkey": "",
			"endpoints": []
		}
	}
}
```

Create `packages/dtx-desktop/src-tauri/capabilities/main.json`:

```json
{
	"$schema": "../gen/schemas/desktop-schema.json",
	"identifier": "main-capability",
	"description": "Main window desktop capability",
	"windows": ["main"],
	"permissions": [
		"core:event:default",
		"core:path:default",
		"core:window:default",
		"core:app:default",
		"core:resources:default",
		"dialog:default",
		"opener:default",
		"deep-link:default",
		"updater:default",
		"process:default"
	]
}
```

- [x] **Step 7: Run static verification**

Run:

```bash
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
bun run --filter=dtx-desktop test -- desktopHost.test.ts
```

Expected: `cargo check` compiles the minimal crate; adapter tests still pass.

- [x] **Step 8: Commit**

```bash
git add bun.lock packages/dtx-desktop/package.json packages/dtx-desktop/vite.config.ts packages/dtx-desktop/tsconfig.web.json packages/dtx-desktop/src-tauri
git commit -m "feat(desktop): add tauri scaffold"
```

---

### Task 5: Add Rust Models And Error Types

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/error.rs`
- Create: `packages/dtx-desktop/src-tauri/src/models.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`

- [x] **Step 1: Add model serialization tests**

Create a unit test module in `models.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_text_serializes_renderer_shape() {
        let result = ReadFileResult::Text {
            error: None,
            content: "#TITLE: Song".to_string(),
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["error"], serde_json::Value::Null);
        assert_eq!(json["content"], "#TITLE: Song");
        assert_eq!(json["isText"], true);
    }

    #[test]
    fn api_error_serializes_success_false() {
        let result: ApiResult<Vec<String>> = ApiResult::Err {
            success: false,
            error: "User not authenticated".to_string(),
            code: Some("UNAUTHORIZED".to_string()),
        };

        let json = serde_json::to_value(result).expect("serializes");
        assert_eq!(json["success"], false);
        assert_eq!(json["error"], "User not authenticated");
        assert_eq!(json["code"], "UNAUTHORIZED");
    }
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml models::tests`

Expected: FAIL because `models.rs` does not exist or types are missing.

- [x] **Step 3: Implement shared types**

Create `packages/dtx-desktop/src-tauri/src/models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogResult {
    pub canceled: bool,
    #[serde(rename = "filePaths")]
    pub file_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PathExistsResult {
    pub exists: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum ReadFileResult {
    Error { error: String, content: String },
    Text {
        error: Option<String>,
        content: String,
    },
    Binary {
        error: Option<String>,
        content: Vec<u8>,
    },
}

impl Serialize for ReadFileResult {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Error { error, content } => {
                #[derive(Serialize)]
                struct ErrorResult<'a> {
                    error: &'a str,
                    content: &'a str,
                }

                ErrorResult { error, content }.serialize(serializer)
            }
            Self::Text { error, content } => {
                #[derive(Serialize)]
                struct TextResult<'a> {
                    error: &'a Option<String>,
                    content: &'a str,
                    #[serde(rename = "isText")]
                    is_text: bool,
                }

                TextResult {
                    error,
                    content,
                    is_text: true,
                }
                .serialize(serializer)
            }
            Self::Binary { error, content } => {
                #[derive(Serialize)]
                struct BinaryResult<'a> {
                    error: &'a Option<String>,
                    content: &'a [u8],
                    #[serde(rename = "isText")]
                    is_text: bool,
                }

                BinaryResult {
                    error,
                    content,
                    is_text: false,
                }
                .serialize(serializer)
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isExpanded")]
    pub is_expanded: bool,
    #[serde(rename = "isLoading")]
    pub is_loading: bool,
    pub children: Vec<TreeNode>,
    #[serde(rename = "hasChildren")]
    pub has_children: bool,
    #[serde(rename = "containsDtxFiles")]
    pub contains_dtx_files: bool,
    #[serde(rename = "songTitle")]
    pub song_title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ListedFile {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub size: u64,
    #[serde(rename = "lastModified")]
    pub last_modified: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ApiResult<T> {
    Ok { success: bool, data: T },
    Err {
        success: bool,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuccessResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
```

Create `packages/dtx-desktop/src-tauri/src/error.rs`:

```rust
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("{0}")]
    Message(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL error: {0}")]
    Url(#[from] url::ParseError),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
}

impl Serialize for DesktopError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DesktopError>;
```

Modify `lib.rs`:

```rust
mod error;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
```

- [x] **Step 4: Normalize Tauri read-file binary payloads in the renderer adapter**

Modify `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` so the host-only
Tauri read-file response accepts `number[]` for binary `content` and converts it to
`Uint8Array` before returning to renderer feature code. Add adapter tests that prove
Tauri `readFile` normalizes `{ error: null, content: [1, 2, 3], isText: false }` to
`Uint8Array` while preserving Electron binary payloads unchanged.

- [x] **Step 5: Run Rust and adapter tests**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml models::tests`

Also run: `bun run --filter=dtx-desktop test -- desktopHost.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/error.rs packages/dtx-desktop/src-tauri/src/models.rs packages/dtx-desktop/src-tauri/src/lib.rs packages/dtx-desktop/src/renderer/src/services/desktopHost.ts packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts
git commit -m "feat(desktop): add tauri backend shared models"
```

---

### Task 6: Port Filesystem Commands

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/filesystem.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.lock`

- [x] **Step 1: Write filesystem tests**

Create tests in `filesystem.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn read_file_rejects_path_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let file = outside.path().join("song.dtx");
        fs::write(&file, "#TITLE: Bad").await.expect("write");

        let result = read_file_path(&file, Some(root.path())).await;

        assert!(matches!(result, ReadFileResult::Error { .. }));
    }

    #[tokio::test]
    async fn read_file_rejects_unknown_extension() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("notes.txt");
        fs::write(&file, "hello").await.expect("write");

        let result = read_file_path(&file, Some(root.path())).await;

        assert_eq!(
            serde_json::to_value(result).expect("json")["error"],
            "File type not allowed"
        );
    }

    #[tokio::test]
    async fn load_tree_includes_dtx_folder_with_set_def_title() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("DTXFiles.Test");
        fs::create_dir(&song).await.expect("mkdir");
        fs::write(song.join("main.dtx"), "#TITLE: Chart").await.expect("dtx");
        fs::write(song.join("SET.def"), "#TITLE: Song Title").await.expect("def");

        let nodes = load_tree_structure_path(root.path()).await.expect("tree");

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "DTXFiles.Test");
        assert!(nodes[0].contains_dtx_files);
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml filesystem::tests`

Expected: FAIL because `filesystem.rs` and helper functions are missing.

- [x] **Step 3: Implement filesystem helpers and commands**

Create `packages/dtx-desktop/src-tauri/src/filesystem.rs`:

```rust
use crate::error::{DesktopError, Result};
use crate::models::{DialogResult, FileEntry, ListedFile, PathExistsResult, ReadFileResult, SuccessResult, TreeNode};
use encoding_rs::{SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::fs;

const TEXT_LIMIT_BYTES: u64 = 1024 * 1024;
const AUDIO_LIMIT_BYTES: u64 = 10 * 1024 * 1024;
const TEXT_EXTENSIONS: &[&str] = &["dtx", "def"];
const AUDIO_EXTENSIONS: &[&str] = &["xa", "ogg", "wav", "mp3"];

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<DialogResult> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(match picked {
        Some(path) => DialogResult {
            canceled: false,
            file_paths: vec![path.to_string()],
        },
        None => DialogResult {
            canceled: true,
            file_paths: Vec::new(),
        },
    })
}

#[tauri::command]
pub async fn path_exists(base_path: String, path_parts: Vec<String>) -> PathExistsResult {
    let full_path = path_parts.iter().fold(PathBuf::from(base_path), |acc, part| acc.join(part));
    match fs::metadata(full_path).await {
        Ok(_) => PathExistsResult { exists: true, error: None },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => PathExistsResult {
            exists: false,
            error: Some("not-found".to_string()),
        },
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => PathExistsResult {
            exists: false,
            error: Some("permission-denied".to_string()),
        },
        Err(err) => PathExistsResult {
            exists: false,
            error: Some(err.kind().to_string()),
        },
    }
}

#[tauri::command]
pub async fn list_directories(dir_path: String) -> Result<Vec<String>> {
    let mut entries = fs::read_dir(dir_path).await?;
    let mut directories = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            directories.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    directories.sort();
    Ok(directories)
}

#[tauri::command]
pub async fn list_directory(dir_path: String) -> Result<serde_json::Value> {
    let mut entries = fs::read_dir(dir_path).await?;
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        let entry_type = if file_type.is_dir() { "directory" } else { "file" };
        files.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            entry_type: entry_type.to_string(),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(serde_json::json!({ "files": files, "error": null }))
}

#[tauri::command]
pub async fn list_files(dir_path: String) -> Result<serde_json::Value> {
    let mut entries = fs::read_dir(dir_path).await?;
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_file() {
            let metadata = entry.metadata().await?;
            files.push(ListedFile {
                file_name: entry.file_name().to_string_lossy().to_string(),
                size: metadata.len(),
                last_modified: "1970-01-01T00:00:00.000Z".to_string(),
                key: entry.path().to_string_lossy().to_string(),
            });
        }
    }
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(serde_json::json!({ "files": files }))
}

#[tauri::command]
pub async fn read_file(file_path: String, workspace_root: Option<String>) -> ReadFileResult {
    read_file_path(Path::new(&file_path), workspace_root.as_deref().map(Path::new)).await
}

pub async fn read_file_path(file_path: &Path, workspace_root: Option<&Path>) -> ReadFileResult {
    let resolved = match file_path.canonicalize() {
        Ok(path) => path,
        Err(err) => return ReadFileResult::Error { error: err.to_string(), content: String::new() },
    };
    let allowed_root = workspace_root.unwrap_or_else(|| resolved.parent().unwrap_or(Path::new("/")));
    let allowed_root = match allowed_root.canonicalize() {
        Ok(path) => path,
        Err(err) => return ReadFileResult::Error { error: err.to_string(), content: String::new() },
    };
    if !resolved.starts_with(&allowed_root) {
        return ReadFileResult::Error { error: "Invalid file path".to_string(), content: String::new() };
    }

    let extension = resolved.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase();
    let is_text = TEXT_EXTENSIONS.contains(&extension.as_str());
    let is_audio = AUDIO_EXTENSIONS.contains(&extension.as_str());
    if !is_text && !is_audio {
        return ReadFileResult::Error { error: "File type not allowed".to_string(), content: String::new() };
    }

    let metadata = match fs::metadata(&resolved).await {
        Ok(metadata) => metadata,
        Err(err) => return ReadFileResult::Error { error: err.to_string(), content: String::new() },
    };
    let limit = if is_audio { AUDIO_LIMIT_BYTES } else { TEXT_LIMIT_BYTES };
    if metadata.len() > limit {
        return ReadFileResult::Error { error: "File too large".to_string(), content: String::new() };
    }

    let bytes = match fs::read(&resolved).await {
        Ok(bytes) => bytes,
        Err(err) => return ReadFileResult::Error { error: err.to_string(), content: String::new() },
    };
    if is_audio {
        return ReadFileResult::Binary { error: None, content: bytes, is_text: false };
    }

    let content = decode_text(&extension, &bytes);
    ReadFileResult::Text { error: None, content, is_text: true }
}

fn decode_text(extension: &str, bytes: &[u8]) -> String {
    let encodings = if extension == "dtx" {
        [SHIFT_JIS, UTF_8, UTF_16LE, UTF_16BE]
    } else {
        [UTF_16LE, UTF_16BE, UTF_8, SHIFT_JIS]
    };
    for encoding in encodings {
        let (decoded, _, had_errors) = encoding.decode(bytes);
        if !had_errors && !decoded.trim_matches('\u{feff}').is_empty() {
            return decoded.trim_matches('\u{feff}').to_string();
        }
    }
    String::from_utf8_lossy(bytes).trim_matches('\u{feff}').to_string()
}

#[tauri::command]
pub async fn load_tree_structure(base_path: String, path_parts: Vec<String>) -> Result<Vec<TreeNode>> {
    let full_path = path_parts.iter().fold(PathBuf::from(base_path), |acc, part| acc.join(part));
    load_tree_structure_path(&full_path).await
}

pub async fn load_tree_structure_path(dir_path: &Path) -> Result<Vec<TreeNode>> {
    let mut entries = fs::read_dir(dir_path).await?;
    let mut nodes = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if !entry.file_type().await?.is_dir() {
            continue;
        }
        let full_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let sub_entries = read_child_names(&full_path).await?;
        let contains_dtx_files = sub_entries.iter().any(|item| item.is_file && item.name.to_ascii_lowercase().ends_with(".dtx"));
        let has_children = !contains_dtx_files && sub_entries.iter().any(|item| !item.is_file);
        if !name.starts_with("DTXFiles.") && !contains_dtx_files {
            continue;
        }
        let song_title = if contains_dtx_files {
            read_set_def_title(&full_path).await
        } else {
            None
        };
        nodes.push(TreeNode {
            name,
            path: full_path.to_string_lossy().to_string(),
            is_expanded: false,
            is_loading: false,
            children: Vec::new(),
            has_children,
            contains_dtx_files,
            song_title,
        });
    }
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(nodes)
}

struct ChildName {
    name: String,
    is_file: bool,
}

async fn read_child_names(path: &Path) -> Result<Vec<ChildName>> {
    let mut entries = fs::read_dir(path).await?;
    let mut children = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        children.push(ChildName {
            name: entry.file_name().to_string_lossy().to_string(),
            is_file: entry.file_type().await?.is_file(),
        });
    }
    Ok(children)
}

async fn read_set_def_title(path: &Path) -> Option<String> {
    let set_def = path.join("SET.def");
    let bytes = fs::read(set_def).await.ok()?;
    let content = decode_text("def", &bytes);
    content
        .lines()
        .find_map(|line| line.strip_prefix("#TITLE:").map(|title| title.trim().to_string()))
        .filter(|title| !title.is_empty())
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, folder_path: String) -> Result<SuccessResult> {
    app.opener()
        .open_path(folder_path, None::<&str>)
        .map_err(|err| DesktopError::Message(err.to_string()))?;
    Ok(SuccessResult { success: true, error: None })
}
```

Final implementation notes from review:

- Keep Task 5 `ReadFileResult` variants without caller-provided `is_text`; serialization derives `isText` from the variant.
- SET.def title parsing accepts both `#TITLE: Song Title` and generated `#TITLE Song Title` forms.
- `.def` validation accepts generated SET.def directives including `#TITLE`, `#ARTIST`, `#BPM`, `#L<n>LABEL`, and `#L<n>FILE`.
- `list_directory` and `list_files` preserve Electron-style `{ files: [], error }` envelopes on listing errors.
- `list_files` returns real RFC3339 UTC `lastModified` values from filesystem metadata using a direct `time` dependency.
- Existing deep-link, dialog, opener, process, and updater plugin initialization stays registered in `lib.rs`.

- [x] **Step 4: Register filesystem commands**

Modify `lib.rs`:

```rust
mod filesystem;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            filesystem::select_folder,
            filesystem::path_exists,
            filesystem::list_directories,
            filesystem::list_directory,
            filesystem::list_files,
            filesystem::read_file,
            filesystem::load_tree_structure,
            filesystem::open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
```

- [x] **Step 5: Run Rust filesystem tests and adapter tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml filesystem::tests
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
rustfmt --edition 2021 --check packages/dtx-desktop/src-tauri/src/filesystem.rs
bun run --filter=dtx-desktop test -- workspaceService.test.ts desktopFileProvider.test.ts desktopHost.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/filesystem.rs packages/dtx-desktop/src-tauri/src/lib.rs packages/dtx-desktop/src-tauri/Cargo.toml packages/dtx-desktop/src-tauri/Cargo.lock
git commit -m "feat(desktop): port filesystem commands to tauri"
```

---

### Task 7: Port Song, Asset, And Zip Commands

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/songs.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`

- [x] **Step 1: Write song command tests**

Create tests in `songs.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn create_song_writes_utf16le_set_def_with_bom() {
        let root = tempdir().expect("tempdir");
        let input = CreateSongOptions {
            selected_path: root.path().to_string_lossy().to_string(),
            sanitized_folder_name: "Song".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: None,
        };

        let result = create_song_folder(input).await.expect("created");
        let bytes = fs::read(root.path().join("Song").join("SET.def")).await.expect("set def");

        assert_eq!(result.success, true);
        assert_eq!(&bytes[0..2], &[0xff, 0xfe]);
    }

    #[tokio::test]
    async fn copy_template_rejects_copy_into_descendant() {
        let root = tempdir().expect("tempdir");
        let template = root.path().join("Template");
        let dest_parent = template.join("Child");
        fs::create_dir_all(&dest_parent).await.expect("mkdir");
        let input = CreateSongOptions {
            selected_path: dest_parent.to_string_lossy().to_string(),
            sanitized_folder_name: "Song".to_string(),
            sanitized_song_name: "Song".to_string(),
            template_folder_path: Some(template.to_string_lossy().to_string()),
        };

        let err = create_song_folder(input).await.expect_err("rejects");
        assert!(err.to_string().contains("Cannot copy directory into itself"));
    }

    #[tokio::test]
    async fn export_zip_filters_invalid_files() {
        let root = tempdir().expect("tempdir");
        fs::write(root.path().join("main.dtx"), "#TITLE: Song").await.expect("dtx");
        fs::write(root.path().join("ignored.txt"), "ignore").await.expect("txt");
        let out = tempdir().expect("out");

        let result = export_song_folder_to_zip(
            root.path(),
            "Song",
            out.path(),
        )
        .await
        .expect("zip");

        assert_eq!(result.success, true);
        assert_eq!(result.files_count, 1);
    }
}
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml songs::tests`

Expected: FAIL because `songs.rs` and command helpers are missing.

- [x] **Step 3: Implement songs module**

Create `packages/dtx-desktop/src-tauri/src/songs.rs` with these public command signatures:

```rust
use crate::error::{DesktopError, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::fs;
use zip::write::FileOptions;

const VALID_EXPORT_EXTENSIONS: &[&str] = &[
    "dtx", "def", "xa", "ogg", "wav", "mp3", "jpg", "jpeg", "png", "avi", "mpg", "mpeg", "mp4",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongOptions {
    pub selected_path: String,
    pub sanitized_folder_name: String,
    pub sanitized_song_name: String,
    pub template_folder_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSongResult {
    pub success: bool,
    pub song_folder_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSongResult {
    pub success: bool,
    pub zip_path: String,
    pub files_count: usize,
}

#[tauri::command]
pub async fn create_song(options: CreateSongOptions) -> Result<CreateSongResult> {
    create_song_folder(options).await
}

pub async fn create_song_folder(options: CreateSongOptions) -> Result<CreateSongResult> {
    let song_folder = PathBuf::from(&options.selected_path).join(&options.sanitized_folder_name);
    if fs::metadata(&song_folder).await.is_ok() {
        return Err(DesktopError::Message(format!(
            "A folder named \"{}\" already exists in the selected location",
            options.sanitized_folder_name
        )));
    }
    fs::create_dir_all(&song_folder).await?;
    if let Some(template) = options.template_folder_path.as_deref() {
        copy_template(Path::new(template), &song_folder).await?;
    }
    let content = format!("#TITLE: {}\r\n", options.sanitized_song_name);
    let mut bytes = vec![0xff, 0xfe];
    for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(song_folder.join("SET.def"), bytes).await?;
    Ok(CreateSongResult {
        success: true,
        song_folder_path: song_folder.to_string_lossy().to_string(),
    })
}

async fn copy_template(source: &Path, destination: &Path) -> Result<()> {
    let source = source.canonicalize()?;
    let destination = destination.canonicalize().unwrap_or_else(|_| destination.to_path_buf());
    if destination == source || destination.starts_with(&source) {
        return Err(DesktopError::Message(
            "Cannot copy directory into itself or its subdirectory.".to_string(),
        ));
    }
    copy_dir_recursive(&source, &destination).await
}

#[async_recursion::async_recursion]
async fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination).await?;
    let mut entries = fs::read_dir(source).await?;
    while let Some(entry) = entries.next_entry().await? {
        let dest = destination.join(entry.file_name());
        if entry.file_type().await?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest).await?;
        } else {
            fs::copy(entry.path(), dest).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn export_song_to_zip(
    song_path: String,
    song_title: String,
    export_directory: Option<String>,
) -> Result<ExportSongResult> {
    let directory = export_directory.unwrap_or_else(default_downloads_dir);
    export_song_folder_to_zip(Path::new(&song_path), &song_title, Path::new(&directory)).await
}

pub async fn export_song_folder_to_zip(
    song_path: &Path,
    song_title: &str,
    export_directory: &Path,
) -> Result<ExportSongResult> {
    fs::create_dir_all(export_directory).await?;
    let zip_path = export_directory.join(format!("{}.zip", if song_title.is_empty() { "song" } else { song_title }));
    let mut entries = fs::read_dir(song_path).await?;
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_file() && is_exportable(&entry.path()) {
            files.push(entry.path());
        }
    }
    files.sort();
    if files.is_empty() {
        return Err(DesktopError::Message("No valid files found to export".to_string()));
    }

    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = FileOptions::default();
    for file in &files {
        let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        writer.start_file(name, options)?;
        let bytes = fs::read(file).await?;
        std::io::Write::write_all(&mut writer, &bytes)?;
    }
    let cursor = writer.finish()?;
    fs::write(&zip_path, cursor.into_inner()).await?;
    Ok(ExportSongResult {
        success: true,
        zip_path: zip_path.to_string_lossy().to_string(),
        files_count: files.len(),
    })
}

fn is_exportable(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VALID_EXPORT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn default_downloads_dir() -> String {
    std::env::var("HOME")
        .map(|home| format!("{home}/Downloads"))
        .unwrap_or_else(|_| ".".to_string())
}

#[tauri::command]
pub async fn get_skin_asset(app: AppHandle, asset_path: String) -> Result<serde_json::Value> {
    let resource_path = app
        .path()
        .resolve(format!("skin/{asset_path}"), tauri::path::BaseDirectory::Resource)?;
    let bytes = fs::read(resource_path).await?;
    let mime = if asset_path.ends_with(".png") { "image/png" } else { "image/jpeg" };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let data_url = format!("data:{mime};base64,{encoded}");
    Ok(serde_json::json!({
        "success": true,
        "dataUrl": data_url
    }))
}

#[tauri::command]
pub async fn parse_dtx_files(folder_path: String) -> Result<serde_json::Value> {
    let mut entries = fs::read_dir(folder_path).await?;
    let mut dtx_files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.to_ascii_lowercase().ends_with(".dtx") {
            dtx_files.push(serde_json::json!({ "fileName": name, "level": 0, "label": "" }));
        }
    }
    dtx_files.sort_by(|a, b| a["fileName"].as_str().cmp(&b["fileName"].as_str()));
    Ok(serde_json::json!({ "success": true, "data": dtx_files }))
}
```

- [x] **Step 4: Register song commands**

Modify `lib.rs`:

```rust
mod songs;

.invoke_handler(tauri::generate_handler![
    filesystem::select_folder,
    filesystem::path_exists,
    filesystem::list_directories,
    filesystem::list_directory,
    filesystem::list_files,
    filesystem::read_file,
    filesystem::load_tree_structure,
    filesystem::open_folder,
    songs::create_song,
    songs::export_song_to_zip,
    songs::get_skin_asset,
    songs::parse_dtx_files
])
```

- [x] **Step 5: Run tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml songs::tests
bun run --filter=dtx-desktop test -- NewSong.test.ts Templates.test.ts SongDetails.test.ts DesktopPreview.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/songs.rs packages/dtx-desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): port local song commands to tauri"
```

---

### Task 8: Port Auth And Deep-Link Flow

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Write auth parsing tests**

Create tests in `auth.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_magic_link_from_dtx_auth_callback() {
        let parsed = parse_auth_callback("dtx://auth-callback?magic_link=https%3A%2F%2Fexample.com%2Fmagic")
            .expect("parsed");

        assert_eq!(parsed.magic_link.as_deref(), Some("https://example.com/magic"));
        assert_eq!(parsed.access_token, None);
        assert_eq!(parsed.refresh_token, None);
    }

    #[test]
    fn extracts_legacy_tokens_from_dtx_auth_callback() {
        let parsed = parse_auth_callback("dtx://auth-callback?access_token=a&refresh_token=b")
            .expect("parsed");

        assert_eq!(parsed.access_token.as_deref(), Some("a"));
        assert_eq!(parsed.refresh_token.as_deref(), Some("b"));
    }

    #[test]
    fn rejects_non_auth_callback_host() {
        let parsed = parse_auth_callback("dtx://other?magic_link=x");
        assert!(parsed.is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml auth::tests`

Expected: FAIL because `auth.rs` is missing.

- [ ] **Step 3: Implement auth state and commands**

Create `packages/dtx-desktop/src-tauri/src/auth.rs`:

```rust
use crate::error::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct AuthState {
    current_session: Arc<Mutex<Option<serde_json::Value>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub accessToken: Option<String>,
    pub refreshToken: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkResult {
    pub success: bool,
    pub error: Option<String>,
    pub session: Option<serde_json::Value>,
    pub user: Option<serde_json::Value>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AuthCallback {
    pub magic_link: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

pub fn parse_auth_callback(raw_url: &str) -> Option<AuthCallback> {
    let url = Url::parse(raw_url).ok()?;
    if url.scheme() != "dtx" || url.host_str() != Some("auth-callback") {
        return None;
    }
    Some(AuthCallback {
        magic_link: url.query_pairs().find(|(key, _)| key == "magic_link").map(|(_, value)| value.into_owned()),
        access_token: url.query_pairs().find(|(key, _)| key == "access_token").map(|(_, value)| value.into_owned()),
        refresh_token: url.query_pairs().find(|(key, _)| key == "refresh_token").map(|(_, value)| value.into_owned()),
    })
}

#[tauri::command]
pub async fn validate_session(app: AppHandle, session_data: SessionData) -> Result<bool> {
    let access_token = session_data.accessToken.or(session_data.access_token);
    let refresh_token = session_data.refreshToken.or(session_data.refresh_token);
    if access_token.as_deref().unwrap_or("").is_empty() || refresh_token.as_deref().unwrap_or("").is_empty() {
        return Ok(false);
    }
    let state = app.state::<AuthState>();
    let session = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token
    });
    *state.current_session.lock().await = Some(session);
    Ok(true)
}

#[tauri::command]
pub async fn get_current_session(app: AppHandle) -> Result<Option<serde_json::Value>> {
    Ok(app.state::<AuthState>().current_session.lock().await.clone())
}

#[tauri::command]
pub async fn logout_session(app: AppHandle) -> Result<bool> {
    *app.state::<AuthState>().current_session.lock().await = None;
    Ok(true)
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<()> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| DesktopError::Message(err.to_string()))
}

pub async fn handle_deep_link(app: &AppHandle, raw_url: &str) -> Result<()> {
    let Some(callback) = parse_auth_callback(raw_url) else {
        return Ok(());
    };
    if let Some(magic_link) = callback.magic_link {
        let result = verify_magic_link(app, &magic_link).await;
        app.emit("magic-link-result", result)?;
    } else if let (Some(access_token), Some(refresh_token)) = (callback.access_token, callback.refresh_token) {
        app.emit("auth-callback", serde_json::json!({
            "accessToken": access_token,
            "refreshToken": refresh_token
        }))?;
    }
    Ok(())
}

async fn verify_magic_link(_app: &AppHandle, magic_link: &str) -> MagicLinkResult {
    MagicLinkResult {
        success: false,
        error: Some(format!("Magic link verification is not configured for {magic_link}")),
        session: None,
        user: None,
    }
}
```

The first implementation may return a controlled failure from `verify_magic_link`. The next API/auth task replaces it with a real Supabase OTP call before Electron is removed.

- [ ] **Step 4: Wire deep-link and single-instance plugins**

Modify `lib.rs`:

```rust
mod auth;

use auth::AuthState;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().manage(AuthState::default());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                if arg.starts_with("dtx://") {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::auth::handle_deep_link(&handle, &arg).await;
                    });
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::auth::handle_deep_link(&handle, url.as_str()).await;
                    });
                }
            }
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let handle = handle.clone();
                    let raw = url.to_string();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::auth::handle_deep_link(&handle, &raw).await;
                    });
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::open_external_url,
            auth::validate_session,
            auth::get_current_session,
            auth::logout_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running Drumery desktop");
}
```

Keep all previously registered filesystem and song commands in the same `generate_handler!` list.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml auth::tests
bun run --filter=dtx-desktop test -- authService.test.ts App.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/auth.rs packages/dtx-desktop/src-tauri/src/lib.rs packages/dtx-desktop/src-tauri/tauri.conf.json
git commit -m "feat(desktop): wire tauri auth deep links"
```

---

### Task 9: Port API, GraphQL, Upload, And Real Magic-Link Verification

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Remove after parity: `packages/dtx-desktop/src/main/graphql/generated/graphql.ts`
- Keep until cleanup: `packages/dtx-desktop/src/main/graphql/operations/*.graphql`

- [ ] **Step 1: Write API mapping tests**

Create tests in `api.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn graphql_error_maps_to_api_result_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "errors": [{ "message": "Denied", "extensions": { "code": "FORBIDDEN" } }]
            })))
            .mount(&server)
            .await;

        let result = run_graphql_value(
            &server.uri(),
            "token",
            "query { me { id } }",
            serde_json::json!({})
        )
        .await;

        assert!(matches!(result, ApiCallResult::Err { ref error, ref code } if error.contains("Denied") && code.as_deref() == Some("FORBIDDEN")));
    }

    #[tokio::test]
    async fn upload_sends_bearer_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/upload"))
            .and(header("authorization", "Bearer token"))
            .and(body_string_contains("simFileId"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "message": "ok",
                "file": {
                    "fileName": "main.dtx",
                    "key": "42/main.dtx",
                    "size": 12,
                    "contentType": "text/plain",
                    "status": "uploaded"
                }
            })))
            .mount(&server)
            .await;

        let response = upload_bytes(&server.uri(), "token", "main.dtx", b"#TITLE: Song".to_vec(), "42")
            .await
            .expect("upload");

        assert_eq!(response["file"]["key"], "42/main.dtx");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api::tests`

Expected: FAIL because `api.rs` and helpers are missing.

- [ ] **Step 3: Implement API module**

Create `packages/dtx-desktop/src-tauri/src/api.rs`:

```rust
use crate::auth::AuthState;
use crate::error::{DesktopError, Result};
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(Debug)]
pub enum ApiCallResult {
    Ok(Value),
    Err { error: String, code: Option<String> },
}

fn api_base_url() -> Result<String> {
    std::env::var("VITE_DTX_API_URL")
        .or_else(|_| std::env::var("VITE_DTX_SERVER_URL"))
        .map(|url| url.trim_end_matches('/').to_string())
        .map_err(|_| DesktopError::Message("VITE_DTX_API_URL environment variable is not set".to_string()))
}

async fn access_token(app: &AppHandle) -> Result<String> {
    let session = app.state::<AuthState>().current_session().await;
    session
        .and_then(|value| value.get("access_token").and_then(|token| token.as_str()).map(str::to_string))
        .ok_or_else(|| DesktopError::Message("User not authenticated".to_string()))
}

pub async fn run_graphql_value(base_url: &str, token: &str, query: &str, variables: Value) -> ApiCallResult {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/graphql", base_url.trim_end_matches('/')))
        .bearer_auth(token)
        .header("User-Agent", "DTXDesktopApp")
        .header("X-Requested-With", "DTXDesktopApp")
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await;
    let Ok(response) = response else {
        return ApiCallResult::Err { error: "Network request failed".to_string(), code: None };
    };
    let json: Value = match response.json().await {
        Ok(json) => json,
        Err(err) => return ApiCallResult::Err { error: err.to_string(), code: None },
    };
    if let Some(first) = json.get("errors").and_then(|errors| errors.as_array()).and_then(|errors| errors.first()) {
        let message = first.get("message").and_then(|m| m.as_str()).unwrap_or("GraphQL error");
        let code = first.get("extensions").and_then(|e| e.get("code")).and_then(|c| c.as_str()).map(str::to_string);
        return ApiCallResult::Err { error: message.to_string(), code };
    }
    ApiCallResult::Ok(json.get("data").cloned().unwrap_or(Value::Null))
}

fn api_result_json(result: ApiCallResult, data_key: &str) -> Value {
    match result {
        ApiCallResult::Ok(data) => serde_json::json!({ "success": true, "data": data.get(data_key).cloned().unwrap_or(data) }),
        ApiCallResult::Err { error, code } => serde_json::json!({ "success": false, "error": error, "code": code }),
    }
}

#[tauri::command]
pub async fn fetch_user_simfiles(app: AppHandle) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "query ListSimfiles($scope: SimfileScope!) { simfiles(scope: $scope) { data { id title artist bpm isPublished publishDate createdAt updatedAt dtxFiles { level label } } count } }", serde_json::json!({ "scope": "MINE" })).await;
    Ok(match result {
        ApiCallResult::Ok(data) => serde_json::json!({ "success": true, "data": data["simfiles"]["data"], "fromCache": false }),
        ApiCallResult::Err { error, .. } => serde_json::json!({ "success": false, "error": error, "data": [], "fromCache": false }),
    })
}

#[tauri::command]
pub async fn get_next_display_id(app: AppHandle) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "query NextDisplayId { nextDisplayId }", serde_json::json!({})).await;
    Ok(match result {
        ApiCallResult::Ok(data) => data["nextDisplayId"].clone(),
        ApiCallResult::Err { error, .. } => return Err(DesktopError::Message(error)),
    })
}

#[tauri::command]
pub async fn search_cloud_songs(app: AppHandle, query: String, limit: i64, exclude_linked_song_ids: Vec<String>) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "query SimfileSearch($query: String!, $limit: Int, $excludeIds: [ID!]) { simfileSearch(query: $query, limit: $limit, excludeIds: $excludeIds) { id title artist bpm isPublished } }", serde_json::json!({ "query": query, "limit": limit, "excludeIds": exclude_linked_song_ids })).await;
    Ok(api_result_json(result, "simfileSearch"))
}

#[tauri::command]
pub async fn fetch_cloud_song(app: AppHandle, cloud_song_id: String) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "query GetSimfile($id: ID!) { simfile(id: $id) { id title artist bpm isPublished publishDate createdAt updatedAt dtxFiles { level label } } }", serde_json::json!({ "id": cloud_song_id })).await;
    Ok(match result {
        ApiCallResult::Ok(data) => serde_json::json!({ "success": true, "cloudSongData": data["simfile"] }),
        ApiCallResult::Err { error, code } => serde_json::json!({ "success": false, "error": error, "code": code }),
    })
}

#[tauri::command]
pub async fn update_simfile_record(app: AppHandle, simfile_id: String, update_data: Value) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "mutation UpdateSimfile($id: ID!, $input: UpdateSimfileInput!) { updateSimfile(id: $id, input: $input) { id title artist bpm isPublished publishDate createdAt updatedAt dtxFiles { level label } } }", serde_json::json!({ "id": simfile_id, "input": update_data })).await;
    Ok(api_result_json(result, "updateSimfile"))
}

#[tauri::command]
pub async fn create_simfile_record(app: AppHandle, simfile_data: Value) -> Result<Value> {
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "mutation CreateSimfile($input: CreateSimfileInput!) { createSimfile(input: $input) { id title artist bpm isPublished publishDate createdAt updatedAt dtxFiles { level label } } }", serde_json::json!({ "input": simfile_data })).await;
    Ok(api_result_json(result, "createSimfile"))
}

#[tauri::command]
pub async fn load_asset_files(app: AppHandle, simfile_id: String) -> Result<Value> {
    if simfile_id.is_empty() || simfile_id == "0" {
        return Ok(serde_json::json!({ "success": true, "data": [] }));
    }
    let token = access_token(&app).await?;
    let result = run_graphql_value(&api_base_url()?, &token, "query GetSimfileWithFiles($id: ID!) { simfile(id: $id) { files { key size uploaded } } }", serde_json::json!({ "id": simfile_id })).await;
    Ok(api_result_json(result, "simfile"))
}

#[tauri::command]
pub async fn get_preview_url(simfile_id: i64) -> Result<String> {
    let bucket = std::env::var("PUBLIC_SIMFILE_BUCKET_URL").unwrap_or_default();
    Ok(format!("{}/{}/preview.jpg", bucket.trim_end_matches('/'), simfile_id))
}

#[tauri::command]
pub async fn get_sound_preview_url(simfile_id: i64) -> Result<String> {
    let bucket = std::env::var("PUBLIC_SIMFILE_BUCKET_URL").unwrap_or_default();
    Ok(format!("{}/{}/preview.mp3", bucket.trim_end_matches('/'), simfile_id))
}

#[tauri::command]
pub async fn upload_file(app: AppHandle, file_name: String, song_folder_path: String, simfile_id: String) -> Result<Value> {
    let token = access_token(&app).await?;
    let path = std::path::Path::new(&song_folder_path).join(&file_name);
    let bytes = fs::read(path).await?;
    let file_name_without_dir = file_name.split('/').last().unwrap_or(&file_name).to_string();
    let data = upload_bytes(&api_base_url()?, &token, &file_name_without_dir, bytes, &simfile_id).await?;
    Ok(serde_json::json!({ "success": true, "data": data }))
}

pub async fn upload_bytes(base_url: &str, token: &str, file_name: &str, bytes: Vec<u8>, simfile_id: &str) -> Result<Value> {
    let part = Part::bytes(bytes).file_name(file_name.to_string());
    let form = Form::new()
        .part("file", part)
        .text("simFileId", simfile_id.to_string());
    let response = reqwest::Client::new()
        .post(format!("{}/upload", base_url.trim_end_matches('/')))
        .bearer_auth(token)
        .header("User-Agent", "DTXDesktopApp")
        .header("X-Requested-With", "DTXDesktopApp")
        .multipart(form)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(DesktopError::Message(format!("HTTP {}", response.status())));
    }
    Ok(response.json().await?)
}
```

- [ ] **Step 4: Add session accessors and real magic-link request**

Modify `auth.rs`:

```rust
impl AuthState {
    pub async fn current_session(&self) -> Option<serde_json::Value> {
        self.current_session.lock().await.clone()
    }

    pub async fn set_current_session(&self, session: Option<serde_json::Value>) {
        *self.current_session.lock().await = session;
    }
}

async fn verify_magic_link(app: &AppHandle, magic_link: &str) -> MagicLinkResult {
    let supabase_url = match std::env::var("PUBLIC_SUPABASE_URL") {
        Ok(value) => value,
        Err(err) => {
            return MagicLinkResult {
                success: false,
                error: Some(err.to_string()),
                session: None,
                user: None,
            };
        }
    };
    let anon_key = match std::env::var("PUBLIC_SUPABASE_ANON_KEY") {
        Ok(value) => value,
        Err(err) => {
            return MagicLinkResult {
                success: false,
                error: Some(err.to_string()),
                session: None,
                user: None,
            };
        }
    };
    let parsed = match Url::parse(magic_link) {
        Ok(url) => url,
        Err(err) => {
            return MagicLinkResult {
                success: false,
                error: Some(err.to_string()),
                session: None,
                user: None,
            };
        }
    };
    let token_hash = parsed
        .query_pairs()
        .find(|(key, _)| key == "token_hash")
        .or_else(|| parsed.query_pairs().find(|(key, _)| key == "token"))
        .map(|(_, value)| value.into_owned());
    let Some(token_hash) = token_hash else {
        return MagicLinkResult {
            success: false,
            error: Some("No token found in magic link".to_string()),
            session: None,
            user: None,
        };
    };
    let response = reqwest::Client::new()
        .post(format!("{}/auth/v1/verify", supabase_url.trim_end_matches('/')))
        .apikey(anon_key.clone())
        .bearer_auth(anon_key)
        .json(&serde_json::json!({ "token_hash": token_hash, "type": "magiclink" }))
        .send()
        .await;
    let Ok(response) = response else {
        return MagicLinkResult {
            success: false,
            error: Some("Failed to verify magic link".to_string()),
            session: None,
            user: None,
        };
    };
    let json: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(err) => {
            return MagicLinkResult {
                success: false,
                error: Some(err.to_string()),
                session: None,
                user: None,
            };
        }
    };
    let session = json.get("session").cloned();
    if session.is_none() {
        return MagicLinkResult {
            success: false,
            error: Some("No session created from magic link".to_string()),
            session: None,
            user: json.get("user").cloned(),
        };
    }
    app.state::<AuthState>().set_current_session(session.clone()).await;
    MagicLinkResult {
        success: true,
        error: None,
        session,
        user: json.get("user").cloned(),
    }
}
```

- [ ] **Step 5: Register API commands**

Modify `lib.rs`:

```rust
mod api;

.invoke_handler(tauri::generate_handler![
    api::fetch_user_simfiles,
    api::get_next_display_id,
    api::search_cloud_songs,
    api::fetch_cloud_song,
    api::update_simfile_record,
    api::create_simfile_record,
    api::load_asset_files,
    api::get_preview_url,
    api::get_sound_preview_url,
    api::upload_file
])
```

Keep all previous commands in the same handler list.

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api::tests auth::tests
bun run --filter=dtx-desktop test -- simFileService.test.ts assetFileService.test.ts CloudSongAutocomplete.test.ts SongDetails.test.ts authService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs packages/dtx-desktop/src-tauri/src/auth.rs packages/dtx-desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): port cloud api commands to tauri"
```

---

### Task 10: Add First-Run Electron Data Migration

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/migration.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`

- [ ] **Step 1: Write migration tests**

Create tests in `migration.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn migrates_known_local_storage_keys_once() {
        let electron = tempdir().expect("electron");
        let tauri = tempdir().expect("tauri");
        fs::write(
            electron.path().join("local-storage.json"),
            serde_json::json!({
                "workspace_path": "/songs",
                "workspace_bookmarks": "[{\"name\":\"Songs\",\"path\":\"/songs\"}]",
                "song_templates": "[]",
                "app_settings": "{\"exportDirectory\":\"/exports\"}"
            })
            .to_string(),
        )
        .await
        .expect("write");

        let result = migrate_from_paths(electron.path(), tauri.path()).await.expect("migrate");

        assert_eq!(result.migrated, true);
        assert!(tauri.path().join("migration-v1.json").exists());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml migration::tests`

Expected: FAIL because `migration.rs` does not exist.

- [ ] **Step 3: Implement migration module**

Create `packages/dtx-desktop/src-tauri/src/migration.rs`:

```rust
use crate::error::Result;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::fs;

const MIGRATION_MARKER: &str = "migration-v1.json";
const KEYS: &[&str] = &[
    "workspace_path",
    "workspace_bookmarks",
    "song_templates",
    "app_settings",
    "simfiles_cache",
    "simfiles_cache_timestamp",
    "linkage_cache",
    "auth_session",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated: bool,
    pub imported_keys: Vec<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn migrate_electron_data(app: AppHandle) -> Result<MigrationResult> {
    let app_data = app.path().app_data_dir()?;
    let electron_data = default_electron_data_dir();
    migrate_from_paths(&electron_data, &app_data).await
}

pub async fn migrate_from_paths(electron_dir: &Path, tauri_dir: &Path) -> Result<MigrationResult> {
    fs::create_dir_all(tauri_dir).await?;
    let marker = tauri_dir.join(MIGRATION_MARKER);
    if marker.exists() {
        return Ok(MigrationResult {
            migrated: false,
            imported_keys: Vec::new(),
            warnings: Vec::new(),
        });
    }

    let source = electron_dir.join("local-storage.json");
    let mut imported_keys = Vec::new();
    let mut warnings = Vec::new();
    if let Ok(text) = fs::read_to_string(&source).await {
        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        let mut imported = serde_json::Map::new();
        for key in KEYS {
            if let Some(value) = parsed.get(*key) {
                imported.insert((*key).to_string(), value.clone());
                imported_keys.push((*key).to_string());
            }
        }
        fs::write(
            tauri_dir.join("imported-local-storage.json"),
            serde_json::to_vec_pretty(&serde_json::Value::Object(imported))?,
        )
        .await?;
    } else {
        warnings.push(format!("Electron storage not found at {}", source.display()));
    }

    fs::write(
        marker,
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": 1,
            "importedKeys": imported_keys,
            "warnings": warnings
        }))?,
    )
    .await?;

    Ok(MigrationResult {
        migrated: true,
        imported_keys,
        warnings,
    })
}

fn default_electron_data_dir() -> std::path::PathBuf {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("Library/Application Support/dtx-desktop")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("dtx-desktop")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::path::PathBuf::from(".")
    }
}
```

- [ ] **Step 4: Register migration command**

Modify `lib.rs`:

```rust
mod migration;

.invoke_handler(tauri::generate_handler![
    migration::migrate_electron_data
])
```

Keep all previous commands in the same handler list.

- [ ] **Step 5: Add adapter and startup call**

Modify `desktopHost.ts`:

```ts
migrateElectronData: () =>
	invoke<{ migrated: boolean; importedKeys: string[]; warnings: string[] }>(
		'migrate_electron_data'
	),
```

Modify `App.svelte` before `authService.restoreSession()`:

```ts
try {
	await desktopHost.migrateElectronData();
} catch (error) {
	console.warn('Electron data migration did not complete:', error);
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml migration::tests
bun run --filter=dtx-desktop test -- App.test.ts desktopHost.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/migration.rs packages/dtx-desktop/src-tauri/src/lib.rs packages/dtx-desktop/src/renderer/src/services/desktopHost.ts packages/dtx-desktop/src/renderer/src/App.svelte
git commit -m "feat(desktop): import electron local data on first run"
```

---

### Task 11: Add Updater Commands

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/updater.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/tauri.conf.json`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`

- [ ] **Step 1: Write updater result tests**

Create tests in `updater.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_result_is_non_blocking() {
        let value = unavailable_update_result("release endpoint is not configured");

        assert_eq!(value["success"], false);
        assert_eq!(value["available"], false);
        assert_eq!(value["error"], "release endpoint is not configured");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml updater::tests`

Expected: FAIL because `updater.rs` does not exist.

- [ ] **Step 3: Implement updater module**

Create `packages/dtx-desktop/src-tauri/src/updater.rs`:

```rust
use crate::error::Result;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<serde_json::Value> {
    match app.updater()?.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "success": true,
            "available": true,
            "version": update.version,
            "body": update.body,
            "date": update.date
        })),
        Ok(None) => Ok(serde_json::json!({
            "success": true,
            "available": false
        })),
        Err(err) => Ok(unavailable_update_result(&err.to_string())),
    }
}

pub fn unavailable_update_result(error: &str) -> serde_json::Value {
    serde_json::json!({
        "success": false,
        "available": false,
        "error": error
    })
}
```

- [ ] **Step 4: Register updater plugin and command**

Modify `lib.rs`:

```rust
mod updater;

.plugin(tauri_plugin_updater::Builder::new().build())

.invoke_handler(tauri::generate_handler![
    updater::check_for_update
])
```

Keep all previous commands in the same handler list.

Modify `tauri.conf.json` updater block:

```json
"updater": {
	"pubkey": "",
	"endpoints": []
}
```

The empty values intentionally make update checks non-blocking until release signing is configured.

- [ ] **Step 5: Run tests**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml updater::tests
bun run --filter=dtx-desktop test -- desktopHost.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/updater.rs packages/dtx-desktop/src-tauri/src/lib.rs packages/dtx-desktop/src-tauri/tauri.conf.json packages/dtx-desktop/src/renderer/src/services/desktopHost.ts
git commit -m "feat(desktop): add tauri updater check command"
```

---

### Task 12: Switch Adapter To Tauri Command Names And Verify Renderer

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Modify: `packages/dtx-desktop/src/tests/setup.ts`

- [ ] **Step 1: Update adapter tests for Tauri command names**

Ensure every method in `desktopHost.test.ts` expects snake_case Tauri command names:

```ts
expect(runtime.invoke).toHaveBeenCalledWith('load_tree_structure', {
	basePath: '/songs',
	pathParts: ['DTXFiles.A']
});
expect(runtime.invoke).toHaveBeenCalledWith('update_simfile_record', {
	simfileId: '42',
	updateData: { title: 'New' }
});
expect(runtime.invoke).toHaveBeenCalledWith('upload_file', {
	fileName: 'main.dtx',
	songFolderPath: '/songs/A',
	simfileId: '42'
});
```

- [ ] **Step 2: Run adapter and all renderer tests**

Run:

```bash
bun run --filter=dtx-desktop test
```

Expected: PASS. If failures mention old kebab-case Electron channels such as `select-folder`, update the test to assert the typed method behavior instead of raw channel names.

- [ ] **Step 3: Run Svelte check**

Run: `bun run --filter=dtx-desktop check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/services/desktopHost.ts packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts packages/dtx-desktop/src/tests/setup.ts packages/dtx-desktop/src/renderer/src/**/*.test.ts
git commit -m "test(desktop): align renderer tests with tauri host adapter"
```

---

### Task 13: Remove Electron Main, Preload, Builder, And TypeScript API Client

**Files:**

- Delete: `packages/dtx-desktop/src/main`
- Delete: `packages/dtx-desktop/src/preload`
- Delete: `packages/dtx-desktop/electron.vite.config.ts`
- Delete: `packages/dtx-desktop/electron-builder.yml`
- Delete: `packages/dtx-desktop/dev-app-update.yml`
- Delete: `packages/dtx-desktop/tsconfig.node.json`
- Delete or archive through git removal: `packages/dtx-desktop/codegen.ts`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/dtx-desktop/tsconfig.json`
- Modify: `packages/dtx-desktop/vitest.config.ts`
- Modify: `turbo.json`

- [ ] **Step 1: Remove Electron-only files**

Run:

```bash
git rm -r packages/dtx-desktop/src/main packages/dtx-desktop/src/preload
git rm packages/dtx-desktop/electron.vite.config.ts packages/dtx-desktop/electron-builder.yml packages/dtx-desktop/dev-app-update.yml packages/dtx-desktop/tsconfig.node.json packages/dtx-desktop/codegen.ts
```

Expected: files are staged for deletion.

- [ ] **Step 2: Remove Electron dependencies and metadata**

Modify `packages/dtx-desktop/package.json`:

```json
{
	"name": "dtx-desktop",
	"version": "1.0.0",
	"description": "Drumery desktop app",
	"author": "Hapadona",
	"scripts": {
		"typecheck": "svelte-check --tsconfig ./tsconfig.web.json",
		"svelte-check": "svelte-check --tsconfig ./tsconfig.web.json",
		"dev": "tauri dev",
		"dev:renderer": "vite --config vite.config.ts",
		"build": "bun run typecheck && tauri build",
		"build:renderer": "vite build --config vite.config.ts",
		"build:debug": "bun run typecheck && tauri build --debug",
		"build:mac": "bun run build",
		"build:win": "bun run build",
		"tauri": "tauri",
		"test": "vitest --run",
		"test:watch": "vitest",
		"test:coverage": "vitest --run --coverage"
	},
	"dependencies": {
		"@dtx/common": "*",
		"@dtx/ui-components": "*",
		"@lucide/svelte": "^0.511.0",
		"@tauri-apps/api": "^2",
		"@tauri-apps/plugin-dialog": "^2",
		"@tauri-apps/plugin-opener": "^2",
		"@tauri-apps/plugin-updater": "^2",
		"@supabase/supabase-js": "^2.49.8",
		"dayjs": "^1.11.13",
		"phaser": "^3.88.0",
		"xa_decoder": "^0.1.2"
	},
	"type": "module",
	"devDependencies": {
		"@skeletonlabs/skeleton": "^3.1.2",
		"@skeletonlabs/skeleton-svelte": "^1.2.3",
		"@sveltejs/vite-plugin-svelte": "^5.0.3",
		"@tailwindcss/vite": "^4.1.4",
		"@tauri-apps/cli": "^2",
		"@testing-library/jest-dom": "^6.6.3",
		"@vitest/coverage-v8": "^3.0.0",
		"jsdom": "^26.1.0",
		"svelte": "^5.28.1",
		"svelte-check": "^4.1.6",
		"tailwindcss": "^4.1.4",
		"typescript": "^5.8.3",
		"vite": "^6.3.2",
		"vite-plugin-wasm": "^3.5.0",
		"vitest": "^3.1.4"
	}
}
```

Preserve any dependency already used by renderer code. Remove `graphql`, `graphql-request`, and GraphQL codegen packages only after `rg -n "graphql-request|generated/graphql|@graphql-codegen" packages/dtx-desktop` returns no source references outside deleted files.

- [ ] **Step 3: Update tsconfig root**

Modify `packages/dtx-desktop/tsconfig.json`:

```json
{
	"files": [],
	"references": [{ "path": "./tsconfig.web.json" }]
}
```

- [ ] **Step 4: Update Vitest excludes**

Modify `packages/dtx-desktop/vitest.config.ts` coverage excludes:

```ts
exclude: [
	'**/node_modules/**',
	'**/dist/**',
	'**/src-tauri/**',
	'**/tests/**',
	'**/test/**',
	'**/*.test.ts',
	'**/*.spec.ts',
	'**/vite.config.ts',
	'**/vitest.config.ts',
	'**/e2e/**'
];
```

- [ ] **Step 5: Update Turbo outputs**

Modify `turbo.json` build outputs:

```json
"outputs": ["dist/**", ".svelte-kit/**", "build/**", "out/**", "src-tauri/target/**"]
```

- [ ] **Step 6: Install dependency changes**

Run: `bun install`

Expected: `bun.lock` removes Electron packages and keeps Tauri packages.

- [ ] **Step 7: Verify no Electron source remains**

Run:

```bash
rg -n "electron|electron-vite|electron-builder|electron-updater|@electron-toolkit|window\\.electron|ipcRenderer" packages/dtx-desktop package.json turbo.json
```

Expected: no matches except historical text in docs outside `packages/dtx-desktop`.

- [ ] **Step 8: Run checks**

Run:

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add bun.lock turbo.json packages/dtx-desktop
git commit -m "refactor(desktop): remove electron host"
```

---

### Task 14: Final Build And Manual Smoke Handoff

**Files:**

- Modify: `docs/superpowers/plans/2026-06-13-dtx-desktop-tauri-migration.md` if implementation notes need command corrections.

- [ ] **Step 1: Run final automated verification**

Run:

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 2: Run macOS Tauri build only when the user explicitly approves build execution**

Run after approval: `bun run --filter=dtx-desktop build:mac`

Expected: Tauri produces a macOS bundle under `packages/dtx-desktop/src-tauri/target`.

- [ ] **Step 3: Document Windows verification command in final handoff**

Use this command on a Windows machine or Windows CI runner:

```bash
bun install
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
bun run --filter=dtx-desktop build:win
```

Expected: tests/checks pass and Tauri produces a Windows installer.

- [ ] **Step 4: Manual smoke checklist**

Verify manually:

```text
1. Launch the Tauri app.
2. Log in through dtx-web redirect=desktop.
3. Confirm dtx://auth-callback reaches the app.
4. Select a workspace.
5. Load the workspace tree.
6. Open a song.
7. Confirm DTX, DEF, and audio file reads.
8. Confirm bundled skin assets render in preview.
9. Create a song from scratch.
10. Create a song from a template.
11. Upload a local file to a cloud simfile.
12. Search, link, fetch, and update cloud simfile data.
13. Export a song folder to zip.
14. Open a song folder in Finder or Explorer.
15. Confirm update check failure is non-blocking while release signing is not configured.
16. Confirm old Electron workspace/bookmark/template/settings data imports or the fresh-login fallback is clear.
```

- [ ] **Step 5: Final commit if smoke notes changed files**

```bash
git add docs/superpowers/plans/2026-06-13-dtx-desktop-tauri-migration.md
git commit -m "docs: record desktop tauri verification notes"
```

Skip this commit if no files changed.
