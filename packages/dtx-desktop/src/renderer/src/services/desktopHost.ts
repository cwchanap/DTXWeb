import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { getVersion, getTauriVersion } from '@tauri-apps/api/app';

export type DesktopHostVersions = {
	app: string | null;
	tauri: string | null;
};

/**
 * Shape returned by the Rust `check_for_update` command (`updater.rs`).
 * - `success: true, available: true`  -> `version`/`body`/`date` populated
 * - `success: true, available: false` -> no update
 * - `success: false`                  -> `error` populated, `available: false`
 */
export type UpdateCheckResult = {
	success: boolean;
	available: boolean;
	version?: string | null;
	body?: string | null;
	date?: string | null;
	error?: string | null;
};

export type DesktopHostRuntime = {
	kind: 'tauri';
	invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>;
	send: (command: string, ...args: unknown[]) => void | Promise<void>;
	listen: <T = unknown>(event: string, callback: (payload: T) => void) => Promise<() => void>;
	removeAllListeners: (event?: string) => void | Promise<void>;
	getPlatform: () => string;
	getDefaultDownloadsDir: () => Promise<string | null>;
	getVersions: () => Promise<DesktopHostVersions>;
};

type SelectFolderResult = {
	canceled: boolean;
	filePaths: string[];
};

type ReadFileContent = string | ArrayBuffer | Uint8Array;
type TauriReadFileContent = ReadFileContent | number[];

type ReadFileResult = {
	kind: 'error' | 'text' | 'binary';
	error: string | null;
	content: ReadFileContent;
};

type HostReadFileResult = {
	kind: 'error' | 'text' | 'binary';
	error: string | null;
	content: TauriReadFileContent;
};

type PathExistsResult = {
	exists: boolean;
	error: string | null;
};

type OpenFolderResult = {
	success: boolean;
	error?: string;
};

type HostUnlisten = () => void;

let runtimeForTests: DesktopHostRuntime | null = null;

const tauriListeners = new Map<string, Set<HostUnlisten>>();

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
	// Invoke the registered `get_default_downloads_dir` Rust command so the
	// native OS Downloads path is returned in a real Tauri window. Fall back
	// to null if the IPC layer is unavailable (e.g. headless/CI without the
	// command wired up) rather than throwing.
	getDefaultDownloadsDir: async (): Promise<string | null> => {
		try {
			return await tauriInvoke<string | null>('get_default_downloads_dir');
		} catch {
			return null;
		}
	},
	getVersions: async () => ({
		app: await getVersion().catch(() => null),
		tauri: await getTauriVersion().catch(() => null)
	})
});

const getRuntime = (): DesktopHostRuntime => {
	if (runtimeForTests) return runtimeForTests;
	return createTauriRuntime();
};

const invokeHost = async <T>(
	tauriCommand: string,
	tauriArgs?: Record<string, unknown>
): Promise<T> => {
	const runtime = getRuntime();

	if (tauriArgs === undefined) {
		return await runtime.invoke<T>(tauriCommand);
	}

	return await runtime.invoke<T>(tauriCommand, tauriArgs);
};

const sendHost = async (
	tauriCommand: string,
	tauriArgs: Record<string, unknown>
): Promise<void> => {
	const runtime = getRuntime();
	await runtime.send(tauriCommand, tauriArgs);
};

const normalizeTauriReadFileResult = (result: HostReadFileResult): ReadFileResult => {
	// Tauri serializes Vec<u8> as a plain JSON array (number[]), not a
	// Uint8Array. Convert binary content back to Uint8Array for consumers.
	if (result.kind === 'binary' && Array.isArray(result.content)) {
		return {
			kind: 'binary',
			error: result.error,
			content: new Uint8Array(result.content)
		};
	}
	return result as ReadFileResult;
};

export const setDesktopHostRuntimeForTests = (runtime: DesktopHostRuntime | null): void => {
	runtimeForTests = runtime;
};

export const desktopHost = {
	selectFolder: async (): Promise<SelectFolderResult> =>
		await invokeHost<SelectFolderResult>('select_folder'),

	pathExists: async (basePath: string, ...pathParts: string[]): Promise<PathExistsResult> =>
		await invokeHost<PathExistsResult>('path_exists', { basePath, pathParts }),

	openExternalUrl: async (url: string): Promise<void> =>
		await sendHost('open_external_url', { url }),

	openFolder: async (folderPath: string): Promise<OpenFolderResult> =>
		await invokeHost<OpenFolderResult>('open_folder', { folderPath }),

	listDirectories: async (
		dirPath: string,
		workspaceRoot: string | null = null
	): Promise<string[]> =>
		await invokeHost<string[]>('list_directories', { dirPath, workspaceRoot }),

	listDirectory: async <T = unknown>(
		dirPath: string,
		workspaceRoot: string | null = null
	): Promise<T> => await invokeHost<T>('list_directory', { dirPath, workspaceRoot }),

	loadTreeStructure: async <T = unknown>(basePath: string, ...pathParts: string[]): Promise<T> =>
		await invokeHost<T>('load_tree_structure', { basePath, pathParts }),

	listFiles: async <T = unknown>(
		dirPath: string,
		workspaceRoot: string | null = null
	): Promise<T> => await invokeHost<T>('list_files', { dirPath, workspaceRoot }),

	readFile: async (
		filePath: string,
		workspaceRoot: string | null = null
	): Promise<ReadFileResult> => {
		const runtime = getRuntime();
		const result = await runtime.invoke<HostReadFileResult>('read_file', {
			filePath,
			workspaceRoot
		});
		return normalizeTauriReadFileResult(result);
	},

	getSkinAsset: async <T = unknown>(assetPath: string): Promise<T> =>
		await invokeHost<T>('get_skin_asset', { assetPath }),

	parseDtxFiles: async <T = unknown>(folderPath: string): Promise<T> =>
		await invokeHost<T>('parse_dtx_files', { folderPath }),

	validateSession: async <T = unknown>(sessionData: unknown): Promise<T> =>
		await invokeHost<T>('validate_session', { sessionData }),

	getCurrentSession: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('get_current_session'),

	logoutSession: async <T = unknown>(): Promise<T> => await invokeHost<T>('logout_session'),

	drainPendingAuthEvents: async (): Promise<void> =>
		await invokeHost<void>('drain_pending_auth_events'),

	fetchUserSimfiles: async <T = unknown>(): Promise<T> =>
		await invokeHost<T>('fetch_user_simfiles'),

	getPreviewUrl: async (simfileId: number): Promise<string> =>
		await invokeHost<string>('get_preview_url', { simfileId }),

	getSoundPreviewUrl: async (simfileId: number): Promise<string> =>
		await invokeHost<string>('get_sound_preview_url', { simfileId }),

	loadAssetFiles: async <T = unknown>(simfileId: string): Promise<T> =>
		await invokeHost<T>('load_asset_files', { simfileId }),

	createSong: async <T = unknown>(options: unknown): Promise<T> =>
		await invokeHost<T>('create_song', { options }),

	createSimfileRecord: async <T = unknown>(simfileData: unknown): Promise<T> =>
		await invokeHost<T>('create_simfile_record', { simfileData }),

	getNextDisplayId: async (): Promise<number> => await invokeHost<number>('get_next_display_id'),

	searchCloudSongs: async <T = unknown>(params: {
		query: string;
		limit?: number;
		excludeLinkedSongIds?: Array<string | number>;
	}): Promise<T> => await invokeHost<T>('search_cloud_songs', params),

	fetchCloudSong: async <T = unknown>(
		params: { cloudSongId: string | number } | string | number
	): Promise<T> => {
		const payload = typeof params === 'object' ? params : { cloudSongId: params };
		return await invokeHost<T>('fetch_cloud_song', payload);
	},

	updateSimfileRecord: async <T = unknown>(params: {
		simfileId: string | number;
		updateData: Record<string, unknown>;
	}): Promise<T> => await invokeHost<T>('update_simfile_record', params),

	exportSongToZip: async <T = unknown>(params: {
		songPath: string;
		songTitle?: string;
		exportDirectory?: string;
	}): Promise<T> => await invokeHost<T>('export_song_to_zip', params),

	uploadFile: async <T = unknown>(
		fileName: string,
		songFolderPath: string,
		simfileId: string
	): Promise<T> => await invokeHost<T>('upload_file', { fileName, songFolderPath, simfileId }),

	checkForUpdate: async (): Promise<UpdateCheckResult> =>
		await invokeHost<UpdateCheckResult>('check_for_update'),

	getPlatform: (): string => getRuntime().getPlatform(),

	getDefaultDownloadsDir: (): Promise<string | null> => getRuntime().getDefaultDownloadsDir(),

	getVersions: (): Promise<DesktopHostVersions> => getRuntime().getVersions(),

	onMagicLinkResult: async <T = unknown>(callback: (result: T) => void): Promise<HostUnlisten> =>
		await getRuntime().listen<T>('magic-link-result', callback),

	removeAllListeners: (event?: string): void | Promise<void> =>
		getRuntime().removeAllListeners(event)
};
