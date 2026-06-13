import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export type DesktopHostKind = 'electron' | 'tauri';

export type DesktopHostVersions = {
	app: string | null;
	tauri: string | null;
	electron: string | null;
	chrome?: string | null;
	node?: string | null;
};

export type DesktopHostRuntime = {
	kind: DesktopHostKind;
	invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>;
	send: (command: string, ...args: unknown[]) => void | Promise<void>;
	listen: <T = unknown>(event: string, callback: (payload: T) => void) => Promise<() => void>;
	removeAllListeners: (event?: string) => void | Promise<void>;
	getPlatform: () => string;
	getEnvironment: () => Record<string, string | undefined>;
	getVersions: () => DesktopHostVersions;
};

type SelectFolderResult = {
	canceled: boolean;
	filePaths: string[];
};

type ReadFileContent = string | ArrayBuffer | Uint8Array;
type TauriReadFileContent = ReadFileContent | number[];

type ReadFileResult = {
	error: string | null;
	content: ReadFileContent;
	isText?: boolean;
};

type HostReadFileResult = {
	error: string | null;
	content: TauriReadFileContent;
	isText?: boolean;
};

type PathExistsResult = {
	exists: boolean;
	error: string | null;
};

type OpenFolderResult = {
	success: boolean;
	error?: string;
};

type DirectoryListingResult = {
	files: Array<{
		name: string;
		path: string;
		type: 'file' | 'directory';
	}>;
	error: string | null;
};

type HostUnlisten = () => void;

let runtimeForTests: DesktopHostRuntime | null = null;

const tauriListeners = new Map<string, Set<HostUnlisten>>();

const hasTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI__' in window;

const getBrowserPlatform = (): string => {
	if (typeof navigator === 'undefined') return 'unknown';

	const platform = navigator.platform.toLowerCase();
	if (platform.includes('mac')) return 'darwin';
	if (platform.includes('win')) return 'win32';
	if (platform.includes('linux')) return 'linux';

	return platform || 'unknown';
};

const createTauriRuntime = (): DesktopHostRuntime => ({
	kind: 'tauri',
	invoke: async <T = unknown>(command: string, ...args: unknown[]): Promise<T> => {
		if (args.length === 0) {
			return await tauriInvoke<T>(command);
		}

		return await tauriInvoke<T>(command, args[0] as Record<string, unknown>);
	},
	send: async (command: string, ...args: unknown[]): Promise<void> => {
		if (args.length === 0) {
			await tauriInvoke(command);
			return;
		}

		await tauriInvoke(command, args[0] as Record<string, unknown>);
	},
	listen: async <T = unknown>(
		event: string,
		callback: (payload: T) => void
	): Promise<HostUnlisten> => {
		const unlisten = await tauriListen<T>(event, (event) => {
			callback(event.payload);
		});

		const listeners = tauriListeners.get(event) ?? new Set<HostUnlisten>();
		const trackedUnlisten = () => {
			unlisten();
			listeners.delete(trackedUnlisten);
		};
		listeners.add(trackedUnlisten);
		tauriListeners.set(event, listeners);

		return trackedUnlisten;
	},
	removeAllListeners: (event?: string): void => {
		const events = event ? [event] : [...tauriListeners.keys()];

		for (const eventName of events) {
			const listeners = tauriListeners.get(eventName);
			if (!listeners) continue;

			for (const unlisten of [...listeners]) {
				unlisten();
			}
			tauriListeners.delete(eventName);
		}
	},
	getPlatform: getBrowserPlatform,
	getEnvironment: () => ({}),
	getVersions: () => ({
		app: null,
		tauri: null,
		electron: null
	})
});

const getElectron = () => {
	if (typeof window === 'undefined' || !window.electron) {
		throw new Error('Electron host runtime is unavailable');
	}

	return window.electron;
};

const createElectronRuntime = (): DesktopHostRuntime => ({
	kind: 'electron',
	invoke: async <T = unknown>(command: string, ...args: unknown[]): Promise<T> => {
		const electron = getElectron();
		return await electron.ipcRenderer.invoke(command, ...args);
	},
	send: (command: string, ...args: unknown[]): void => {
		const electron = getElectron();
		electron.ipcRenderer.send(command, ...args);
	},
	listen: async <T = unknown>(
		event: string,
		callback: (payload: T) => void
	): Promise<HostUnlisten> => {
		const electron = getElectron();
		const listener = (_event: unknown, payload: T) => callback(payload);
		const removeFromOn = electron.ipcRenderer.on(event, listener);

		return () => {
			if (typeof removeFromOn === 'function') {
				removeFromOn();
				return;
			}

			electron.ipcRenderer.removeListener(event, listener);
		};
	},
	removeAllListeners: (event?: string): void => {
		const electron = getElectron();
		const removeAllListeners = electron.ipcRenderer.removeAllListeners as (
			event?: string
		) => void;
		removeAllListeners(event);
	},
	getPlatform: (): string => getElectron().process?.platform ?? getBrowserPlatform(),
	getEnvironment: (): Record<string, string | undefined> => getElectron().process?.env ?? {},
	getVersions: (): DesktopHostVersions => {
		const versions = getElectron().process?.versions ?? {};

		return {
			app: versions.app ?? null,
			tauri: null,
			electron: versions.electron ?? null,
			chrome: versions.chrome ?? null,
			node: versions.node ?? null
		};
	}
});

const getRuntime = (): DesktopHostRuntime => {
	if (runtimeForTests) return runtimeForTests;
	return hasTauriRuntime() ? createTauriRuntime() : createElectronRuntime();
};

const invokeHost = async <T>(
	tauriCommand: string,
	electronChannel: string,
	tauriArgs?: Record<string, unknown>,
	electronArgs: unknown[] = []
): Promise<T> => {
	const runtime = getRuntime();

	if (runtime.kind === 'tauri') {
		if (tauriArgs === undefined) {
			return await runtime.invoke<T>(tauriCommand);
		}

		return await runtime.invoke<T>(tauriCommand, tauriArgs);
	}

	return await runtime.invoke<T>(electronChannel, ...electronArgs);
};

const sendHost = async (
	tauriCommand: string,
	electronChannel: string,
	tauriArgs?: Record<string, unknown>,
	electronArgs: unknown[] = []
): Promise<void> => {
	const runtime = getRuntime();

	if (runtime.kind === 'tauri') {
		if (tauriArgs === undefined) {
			await runtime.send(tauriCommand);
			return;
		}

		await runtime.send(tauriCommand, tauriArgs);
		return;
	}

	await runtime.send(electronChannel, ...electronArgs);
};

const normalizeTauriReadFileResult = (result: HostReadFileResult): ReadFileResult => {
	if (result.error !== null || result.isText !== false || !Array.isArray(result.content)) {
		return result as ReadFileResult;
	}

	return {
		error: null,
		content: new Uint8Array(result.content),
		isText: false
	};
};

export const setDesktopHostRuntimeForTests = (runtime: DesktopHostRuntime | null): void => {
	runtimeForTests = runtime;
};

export const desktopHost = {
	selectFolder: async (): Promise<SelectFolderResult> =>
		await invokeHost<SelectFolderResult>('select_folder', 'select-folder'),

	pathExists: async (basePath: string, ...pathParts: string[]): Promise<PathExistsResult> =>
		await invokeHost<PathExistsResult>('path_exists', 'path-exists', { basePath, pathParts }, [
			basePath,
			...pathParts
		]),

	openExternalUrl: async (url: string): Promise<void> =>
		await sendHost('open_external_url', 'open-external-url', { url }, [url]),

	openFolder: async (folderPath: string): Promise<OpenFolderResult> =>
		await invokeHost<OpenFolderResult>(
			'open_folder',
			'open-folder-in-explorer',
			{ folderPath },
			[folderPath]
		),

	listDirectories: async (dirPath: string): Promise<string[]> => {
		const runtime = getRuntime();

		if (runtime.kind === 'tauri') {
			return await runtime.invoke<string[]>('list_directories', { dirPath });
		}

		const result = await runtime.invoke<DirectoryListingResult>('list-directory', dirPath);
		if (result.error) {
			throw new Error(result.error);
		}

		return result.files
			.filter((entry) => entry.type === 'directory')
			.map((entry) => entry.name);
	},

	listDirectory: async <T = unknown>(dirPath: string): Promise<T> =>
		await invokeHost<T>('list_directory', 'list-directory', { dirPath }, [dirPath]),

	loadTreeStructure: async <T = unknown>(basePath: string, ...pathParts: string[]): Promise<T> =>
		await invokeHost<T>('load_tree_structure', 'load-tree-structure', { basePath, pathParts }, [
			basePath,
			...pathParts
		]),

	listFiles: async <T = unknown>(dirPath: string): Promise<T> =>
		await invokeHost<T>('list_files', 'list-files', { dirPath }, [dirPath]),

	readFile: async (
		filePath: string,
		workspaceRoot: string | null = null
	): Promise<ReadFileResult> => {
		const runtime = getRuntime();

		if (runtime.kind === 'tauri') {
			const result = await runtime.invoke<HostReadFileResult>('read_file', {
				filePath,
				workspaceRoot
			});
			return normalizeTauriReadFileResult(result);
		}

		return await runtime.invoke<ReadFileResult>('read-file', filePath, workspaceRoot);
	},

	getSkinAsset: async <T = unknown>(assetPath: string): Promise<T> =>
		await invokeHost<T>('get_skin_asset', 'get-skin-asset', { assetPath }, [assetPath]),

	parseDtxFiles: async <T = unknown>(folderPath: string): Promise<T> =>
		await invokeHost<T>('parse_dtx_files', 'parse-dtx-files', { folderPath }, [folderPath]),

	validateSession: async <T = unknown>(sessionData: unknown): Promise<T> =>
		await invokeHost<T>('validate_session', 'validate-session', { sessionData }, [sessionData]),

	getCurrentSession: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('get_current_session', 'get-current-session'),

	logoutSession: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('logout_session', 'logout-session'),

	drainPendingAuthEvents: async (): Promise<void> => {
		const runtime = getRuntime();
		if (runtime.kind === 'tauri') {
			await runtime.invoke('drain_pending_auth_events');
		}
	},

	fetchUserSimfiles: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('fetch_user_simfiles', 'fetch-user-simfiles'),

	getPreviewUrl: async (simfileId: number): Promise<string> =>
		await invokeHost<string>('get_preview_url', 'get-preview-url', { simfileId }, [simfileId]),

	getSoundPreviewUrl: async (simfileId: number): Promise<string> =>
		await invokeHost<string>('get_sound_preview_url', 'get-sound-preview-url', { simfileId }, [
			simfileId
		]),

	loadAssetFiles: async <T = unknown>(simfileId: string): Promise<T> =>
		await invokeHost<T>('load_asset_files', 'load-asset-files', { simfileId }, [simfileId]),

	createSong: async <T = unknown>(options: unknown): Promise<T> =>
		await invokeHost<T>('create_song', 'create-song', { options }, [options]),

	createSimfileRecord: async <T = unknown>(simfileData: unknown): Promise<T> =>
		await invokeHost<T>('create_simfile_record', 'create-simfile-record', { simfileData }, [
			simfileData
		]),

	getNextDisplayId: async (): Promise<number> =>
		await invokeHost<number>('get_next_display_id', 'get-next-display-id'),

	searchCloudSongs: async <T = unknown>(params: {
		query: string;
		limit?: number;
		excludeLinkedSongIds?: Array<string | number>;
	}): Promise<T> =>
		await invokeHost<T>('search_cloud_songs', 'search-cloud-songs', params, [params]),

	fetchCloudSong: async <T = unknown>(
		params: { cloudSongId: string | number } | string | number
	): Promise<T> => {
		const payload = typeof params === 'object' ? params : { cloudSongId: params };
		return await invokeHost<T>('fetch_cloud_song', 'fetch-cloud-song', payload, [payload]);
	},

	updateSimfileRecord: async <T = unknown>(params: {
		simfileId: string | number;
		updateData: Record<string, unknown>;
	}): Promise<T> =>
		await invokeHost<T>('update_simfile_record', 'update-simfile-record', params, [params]),

	exportSongToZip: async <T = unknown>(params: {
		songPath: string;
		songTitle?: string;
		exportDirectory?: string;
	}): Promise<T> =>
		await invokeHost<T>('export_song_to_zip', 'export-song-to-zip', params, [params]),

	uploadFile: async <T = unknown>(
		fileName: string,
		songFolderPath: string,
		simfileId: string
	): Promise<T> =>
		await invokeHost<T>('upload_file', 'upload-file', { fileName, songFolderPath, simfileId }, [
			fileName,
			songFolderPath,
			simfileId
		]),

	checkForUpdate: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('check_for_update', 'check-for-update'),

	getPlatform: (): string => getRuntime().getPlatform(),

	getEnvironment: (): Record<string, string | undefined> => getRuntime().getEnvironment(),

	getVersions: (): DesktopHostVersions => getRuntime().getVersions(),

	onMagicLinkResult: async <T = unknown>(callback: (result: T) => void): Promise<HostUnlisten> =>
		await getRuntime().listen<T>('magic-link-result', callback),

	onAuthCallback: async <T = unknown>(callback: (tokens: T) => void): Promise<HostUnlisten> =>
		await getRuntime().listen<T>('auth-callback', callback),

	removeAllListeners: (event?: string): void | Promise<void> =>
		getRuntime().removeAllListeners(event)
};
