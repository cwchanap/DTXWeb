import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import path from 'path';

// IPC handler registry — populated when the module is imported
const ipcHandlers: Record<string, (...args: unknown[]) => unknown> = {};
const ipcListeners: Record<string, (...args: unknown[]) => unknown> = {};
const appListeners: Record<string, (...args: unknown[]) => unknown> = {};

// Stable mock references
const mockFs = {
	promises: {
		access: vi.fn(),
		readdir: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		copyFile: vi.fn(),
		stat: vi.fn()
	}
};

const mockShell = {
	openExternal: vi.fn(),
	openPath: vi.fn().mockResolvedValue('')
};

const mockApp = {
	requestSingleInstanceLock: vi.fn().mockReturnValue(true),
	whenReady: vi.fn().mockReturnValue({
		then: (fn: () => void) => {
			fn();
			return { catch: vi.fn() };
		}
	}),
	quit: vi.fn(),
	isPackaged: false,
	on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
		appListeners[event] = handler;
	}),
	setAppUserModelId: vi.fn(),
	isDefaultProtocolClient: vi.fn().mockReturnValue(false),
	setAsDefaultProtocolClient: vi.fn()
};

const mockBrowserWindow = {
	getAllWindows: vi.fn().mockReturnValue([]),
	isMinimized: vi.fn().mockReturnValue(false),
	restore: vi.fn(),
	focus: vi.fn()
};

vi.mock('electron', () => ({
	app: mockApp,
	shell: mockShell,
	BrowserWindow: Object.assign(vi.fn().mockReturnValue({}), mockBrowserWindow),
	ipcMain: {
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			ipcListeners[event] = handler;
		}),
		handle: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			ipcHandlers[event] = handler;
		})
	}
}));

const mockAutoUpdater = {
	checkForUpdates: vi.fn()
};

vi.mock('electron-updater', () => ({
	autoUpdater: mockAutoUpdater
}));

vi.mock('fs', () => ({ default: mockFs }));

vi.mock('@dtx/common/server', () => ({
	SimFile: vi.fn().mockImplementation(() => ({
		generateDefFileContent: vi.fn().mockReturnValue('#TITLE:Test\n'),
		title: ''
	})),
	VALID_DTX_FILE_EXTENSIONS: ['.dtx', '.gda', '.bms', '.wav', '.ogg', '.png']
}));

const mockAuth = {
	validateSession: vi.fn(),
	getCurrentSession: vi.fn().mockReturnValue(null),
	logoutSession: vi.fn(),
	handleProtocolUrl: vi.fn(),
	getSupabaseClient: vi.fn().mockReturnValue(null)
};

vi.mock('./auth', () => mockAuth);

const mockApiClient = {
	getSimfile: vi.fn(),
	getSimfileWithFiles: vi.fn(),
	updateSimfile: vi.fn(),
	simfileSearch: vi.fn()
};

vi.mock('./api-client', () => mockApiClient);

const mockUpload = {
	uploadFile: vi.fn()
};

vi.mock('./upload', () => mockUpload);

const mockSimfileService = {
	fetchUserSimFiles: vi.fn(),
	getPreviewUrl: vi.fn(),
	getSoundPreviewUrl: vi.fn(),
	createSimfileRecord: vi.fn(),
	parseDtxFiles: vi.fn(),
	getNextDisplayId: vi.fn(),
	CreateSimfileData: {}
};

vi.mock('./simfile-service', () => mockSimfileService);

const mockFilesystem = {
	loadTreeStructure: vi.fn(),
	selectDirectory: vi.fn(),
	readFile: vi.fn()
};

vi.mock('./filesystem', () => mockFilesystem);
const mockCreateWindow = vi.hoisted(() => vi.fn());
vi.mock('./window', () => ({ createWindow: mockCreateWindow }));

// Import the module — all top-level code and handler registration runs here
await import('./index');

describe('index.ts IPC handlers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApp.isPackaged = false;
	});

	// ── open-external-url ────────────────────────────────────────────────────
	describe('open-external-url listener', () => {
		it('calls shell.openExternal with the provided URL', () => {
			ipcListeners['open-external-url']({}, 'https://example.com');
			expect(mockShell.openExternal).toHaveBeenCalledWith('https://example.com');
		});
	});

	// ── check-for-update ─────────────────────────────────────────────────────
	describe('check-for-update handler', () => {
		it('returns a non-crashing skipped result for unpackaged builds', async () => {
			expect(ipcHandlers['check-for-update']).toBeTypeOf('function');

			const result = await ipcHandlers['check-for-update']({});

			expect(result).toEqual({
				success: true,
				updateAvailable: false,
				updateInfo: null,
				skipped: true,
				reason: 'not-packaged'
			});
			expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
		});

		it('reports an available update from packaged builds', async () => {
			mockApp.isPackaged = true;
			const updateInfo = { version: '1.2.0' };
			mockAutoUpdater.checkForUpdates.mockResolvedValue({
				isUpdateAvailable: true,
				updateInfo
			});

			const result = await ipcHandlers['check-for-update']({});

			expect(result).toEqual({
				success: true,
				updateAvailable: true,
				updateInfo
			});
			expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
		});

		it('reports no update when electron-updater returns updateInfo without availability', async () => {
			mockApp.isPackaged = true;
			const updateInfo = { version: '1.0.0' };
			mockAutoUpdater.checkForUpdates.mockResolvedValue({
				isUpdateAvailable: false,
				updateInfo
			});

			const result = await ipcHandlers['check-for-update']({});

			expect(result).toEqual({
				success: true,
				updateAvailable: false,
				updateInfo
			});
		});

		it('returns failure details when electron-updater rejects', async () => {
			mockApp.isPackaged = true;
			mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('update feed missing'));

			const result = await ipcHandlers['check-for-update']({});

			expect(result).toEqual({
				success: false,
				updateAvailable: false,
				updateInfo: null,
				error: 'update feed missing'
			});
		});
	});

	// ── path-exists ──────────────────────────────────────────────────────────
	describe('path-exists handler', () => {
		it('returns { exists: true } when path is accessible', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			const result = (await ipcHandlers['path-exists']({}, '/some/path')) as {
				exists: boolean;
			};
			expect(result.exists).toBe(true);
		});

		it('returns { exists: false, error: "not-found" } for ENOENT', async () => {
			const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			mockFs.promises.access.mockRejectedValue(enoentError);
			const result = (await ipcHandlers['path-exists']({}, '/missing/path')) as {
				exists: boolean;
				error: string;
			};
			expect(result.exists).toBe(false);
			expect(result.error).toBe('not-found');
		});

		it('returns { exists: false, error: "permission-denied" } for EACCES', async () => {
			const eaccesError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
			mockFs.promises.access.mockRejectedValue(eaccesError);
			const result = (await ipcHandlers['path-exists']({}, '/locked/path')) as {
				exists: boolean;
				error: string;
			};
			expect(result.exists).toBe(false);
			expect(result.error).toBe('permission-denied');
		});

		it('returns { exists: false, error: <code> } for other errno codes', async () => {
			const loopError = Object.assign(new Error('ELOOP'), { code: 'ELOOP' });
			mockFs.promises.access.mockRejectedValue(loopError);
			const result = (await ipcHandlers['path-exists']({}, '/loop/path')) as {
				exists: boolean;
				error: string;
			};
			expect(result.exists).toBe(false);
			expect(result.error).toBe('ELOOP');
		});

		it('returns { exists: false, error: "unknown" } for non-errno errors', async () => {
			mockFs.promises.access.mockRejectedValue(new Error('something unexpected'));
			const result = (await ipcHandlers['path-exists']({}, '/unknown/path')) as {
				exists: boolean;
				error: string;
			};
			expect(result.exists).toBe(false);
			expect(result.error).toBe('unknown');
		});

		it('joins multiple path parts', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			await ipcHandlers['path-exists']({}, '/base', 'sub', 'file.dtx');
			expect(mockFs.promises.access).toHaveBeenCalledWith(expect.stringContaining('sub'));
		});

		it('uses basePath directly when no extra parts', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			await ipcHandlers['path-exists']({}, '/only/path');
			expect(mockFs.promises.access).toHaveBeenCalledWith('/only/path');
		});
	});

	// ── list-directory ───────────────────────────────────────────────────────
	describe('list-directory handler', () => {
		it('returns files and directories on success', async () => {
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true, isDirectory: () => false },
				{ name: 'assets', isFile: () => false, isDirectory: () => true }
			]);

			const result = (await ipcHandlers['list-directory']({}, '/music')) as {
				files: unknown[];
				error: null;
			};
			expect(result.error).toBeNull();
			expect(result.files).toHaveLength(2);
		});

		it('returns empty files with error message on failure', async () => {
			mockFs.promises.readdir.mockRejectedValue(new Error('EACCES'));
			const result = (await ipcHandlers['list-directory']({}, '/no-access')) as {
				files: unknown[];
				error: string;
			};
			expect(result.files).toEqual([]);
			expect(result.error).toBe('EACCES');
		});

		it('handles non-Error rejections in list-directory', async () => {
			mockFs.promises.readdir.mockRejectedValue('string error');
			const result = (await ipcHandlers['list-directory']({}, '/bad')) as {
				error: string;
			};
			expect(result.error).toBe('Unknown error');
		});
	});

	// ── open-folder-in-explorer ──────────────────────────────────────────────
	describe('open-folder-in-explorer handler', () => {
		it('returns success when openPath resolves with empty string', async () => {
			mockShell.openPath.mockResolvedValue('');
			const result = (await ipcHandlers['open-folder-in-explorer']({}, '/music')) as {
				success: boolean;
			};
			expect(result.success).toBe(true);
		});

		it('returns error when openPath resolves with a non-empty string', async () => {
			mockShell.openPath.mockResolvedValue('Cannot open folder');
			const result = (await ipcHandlers['open-folder-in-explorer']({}, '/bad')) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cannot open folder');
		});
	});

	// ── load-tree-structure ──────────────────────────────────────────────────
	describe('load-tree-structure handler', () => {
		it('delegates to loadTreeStructure with single path', async () => {
			mockFilesystem.loadTreeStructure.mockResolvedValue([]);
			await ipcHandlers['load-tree-structure']({}, '/music');
			expect(mockFilesystem.loadTreeStructure).toHaveBeenCalledWith('/music');
		});

		it('joins path parts before delegating', async () => {
			mockFilesystem.loadTreeStructure.mockResolvedValue([]);
			await ipcHandlers['load-tree-structure']({}, '/base', 'sub');
			expect(mockFilesystem.loadTreeStructure).toHaveBeenCalledWith(
				expect.stringContaining('sub')
			);
		});
	});

	// ── list-files ───────────────────────────────────────────────────────────
	describe('list-files handler', () => {
		it('returns file list with stats', async () => {
			const mtime = new Date('2024-01-01');
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true, isDirectory: () => false }
			]);
			mockFs.promises.stat.mockResolvedValue({ size: 1024, mtime });

			const result = (await ipcHandlers['list-files']({}, '/music')) as {
				files: { fileName: string; size: number; lastModified: string; key: string }[];
			};
			expect(result.files).toHaveLength(1);
			expect(result.files[0].fileName).toBe('song.dtx');
			expect(result.files[0].size).toBe(1024);
		});

		it('returns empty files with error on failure', async () => {
			mockFs.promises.readdir.mockRejectedValue(new Error('ENOENT'));
			const result = (await ipcHandlers['list-files']({}, '/missing')) as {
				files: unknown[];
				error: string;
			};
			expect(result.files).toEqual([]);
			expect(result.error).toBe('ENOENT');
		});

		it('handles non-Error rejections in list-files', async () => {
			mockFs.promises.readdir.mockRejectedValue('raw error');
			const result = (await ipcHandlers['list-files']({}, '/bad')) as { error: string };
			expect(result.error).toBe('Unknown error');
		});
	});

	// ── read-file ────────────────────────────────────────────────────────────
	describe('read-file handler', () => {
		it('delegates to readFile', async () => {
			mockFilesystem.readFile.mockResolvedValue({ content: 'data', encoding: 'utf-8' });
			const result = await ipcHandlers['read-file']({}, '/file.dtx', '/workspace');
			expect(mockFilesystem.readFile).toHaveBeenCalledWith('/file.dtx', '/workspace');
			expect(result).toEqual({ content: 'data', encoding: 'utf-8' });
		});
	});

	// ── get-skin-asset ───────────────────────────────────────────────────────
	describe('get-skin-asset handler', () => {
		it('returns base64 data URL for a PNG asset', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('imgdata'));

			const result = (await ipcHandlers['get-skin-asset'](
				{},
				'default/Graphics/7_chips.png'
			)) as { success: boolean; dataUrl: string };
			expect(result.success).toBe(true);
			expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
		});

		it('returns error when asset not found', async () => {
			mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));

			const result = (await ipcHandlers['get-skin-asset']({}, 'missing.png')) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('ENOENT');
		});

		it('uses image/jpeg MIME type for non-PNG files', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('jpgdata'));

			const result = (await ipcHandlers['get-skin-asset'](
				{},
				'default/Graphics/backdrop.jpg'
			)) as { dataUrl: string };
			expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
		});
	});

	// ── parse-dtx-files ──────────────────────────────────────────────────────
	describe('parse-dtx-files handler', () => {
		it('delegates to parseDtxFiles', async () => {
			mockSimfileService.parseDtxFiles.mockResolvedValue([]);
			await ipcHandlers['parse-dtx-files']({}, '/songs/folder');
			expect(mockSimfileService.parseDtxFiles).toHaveBeenCalledWith('/songs/folder');
		});
	});

	// ── validate-session ─────────────────────────────────────────────────────
	describe('validate-session handler', () => {
		it('delegates to validateSession', async () => {
			mockAuth.validateSession.mockResolvedValue({ valid: true });
			const result = await ipcHandlers['validate-session']({}, { token: 'tok' });
			expect(mockAuth.validateSession).toHaveBeenCalledWith({ token: 'tok' });
			expect(result).toEqual({ valid: true });
		});
	});

	// ── get-current-session ──────────────────────────────────────────────────
	describe('get-current-session handler', () => {
		it('delegates to getCurrentSession', async () => {
			mockAuth.getCurrentSession.mockReturnValue({ user: 'alice' });
			const result = await ipcHandlers['get-current-session']();
			expect(result).toEqual({ user: 'alice' });
		});
	});

	// ── logout-session ───────────────────────────────────────────────────────
	describe('logout-session handler', () => {
		it('delegates to logoutSession', async () => {
			mockAuth.logoutSession.mockResolvedValue({ success: true });
			const result = await ipcHandlers['logout-session']();
			expect(mockAuth.logoutSession).toHaveBeenCalled();
			expect(result).toEqual({ success: true });
		});
	});

	// ── fetch-user-simfiles ──────────────────────────────────────────────────
	describe('fetch-user-simfiles handler', () => {
		it('delegates to fetchUserSimFiles', async () => {
			mockSimfileService.fetchUserSimFiles.mockResolvedValue([{ id: 1 }]);
			const result = await ipcHandlers['fetch-user-simfiles']();
			expect(result).toEqual([{ id: 1 }]);
		});
	});

	// ── get-preview-url ──────────────────────────────────────────────────────
	describe('get-preview-url handler', () => {
		it('throws on non-positive simfileId', async () => {
			await expect(ipcHandlers['get-preview-url']({}, 0)).rejects.toThrow(
				'Invalid simfileId'
			);
			await expect(ipcHandlers['get-preview-url']({}, -5)).rejects.toThrow(
				'Invalid simfileId'
			);
		});

		it('delegates to getPreviewUrl for valid id', async () => {
			mockSimfileService.getPreviewUrl.mockResolvedValue('https://cdn.example.com/preview');
			const result = await ipcHandlers['get-preview-url']({}, 42);
			expect(mockSimfileService.getPreviewUrl).toHaveBeenCalledWith(42);
			expect(result).toBe('https://cdn.example.com/preview');
		});
	});

	// ── get-sound-preview-url ────────────────────────────────────────────────
	describe('get-sound-preview-url handler', () => {
		it('throws on non-positive simfileId', async () => {
			await expect(ipcHandlers['get-sound-preview-url']({}, 0)).rejects.toThrow(
				'Invalid simfileId'
			);
		});

		it('delegates to getSoundPreviewUrl for valid id', async () => {
			mockSimfileService.getSoundPreviewUrl.mockResolvedValue(
				'https://cdn.example.com/sound'
			);
			const result = await ipcHandlers['get-sound-preview-url']({}, 7);
			expect(mockSimfileService.getSoundPreviewUrl).toHaveBeenCalledWith(7);
			expect(result).toBe('https://cdn.example.com/sound');
		});
	});

	// ── load-asset-files ─────────────────────────────────────────────────────
	describe('load-asset-files handler', () => {
		it('returns { success: true, data: [] } for empty simfileId', async () => {
			const result = await ipcHandlers['load-asset-files']({}, '');
			expect(result).toEqual({ success: true, data: [] });
		});

		it('returns { success: true, data: [] } for simfileId "0"', async () => {
			const result = await ipcHandlers['load-asset-files']({}, '0');
			expect(result).toEqual({ success: true, data: [] });
		});

		it('returns { success: true, data: [] } for null/undefined simfileId', async () => {
			const result = await ipcHandlers['load-asset-files']({}, null);
			expect(result).toEqual({ success: true, data: [] });
		});
	});

	// ── create-simfile-record ────────────────────────────────────────────────
	describe('create-simfile-record handler', () => {
		it('delegates to createSimfileRecord', async () => {
			mockSimfileService.createSimfileRecord.mockResolvedValue({ id: 99 });
			const data = { title: 'Test Song' };
			const result = await ipcHandlers['create-simfile-record']({}, data);
			expect(mockSimfileService.createSimfileRecord).toHaveBeenCalledWith(data);
			expect(result).toEqual({ id: 99 });
		});
	});

	describe('get-next-display-id handler', () => {
		it('delegates to getNextDisplayId', async () => {
			mockSimfileService.getNextDisplayId.mockResolvedValue(42);
			const result = await ipcHandlers['get-next-display-id']();
			expect(mockSimfileService.getNextDisplayId).toHaveBeenCalled();
			expect(result).toBe(42);
		});
	});

	// ── search-cloud-songs ───────────────────────────────────────────────────
	describe('search-cloud-songs handler', () => {
		it('returns mapped results from simfileSearch on success', async () => {
			mockApiClient.simfileSearch.mockResolvedValue({
				success: true,
				data: {
					simfileSearch: [
						{
							id: '1',
							title: 'Hit Song',
							artist: 'Artist',
							bpm: 140,
							isPublished: true
						}
					]
				}
			});
			const result = (await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'hit', limit: 5, excludeLinkedSongIds: [] }
			)) as { success: boolean; data: { id: string; is_published: boolean }[] };
			expect(result.success).toBe(true);
			expect(result.data).toHaveLength(1);
			expect(result.data[0].is_published).toBe(true);
		});

		it('returns failure when simfileSearch fails', async () => {
			mockApiClient.simfileSearch.mockResolvedValue({
				success: false,
				error: 'Network error'
			});
			const result = (await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'hit', limit: 5, excludeLinkedSongIds: [] }
			)) as { success: boolean; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toBe('Network error');
		});

		it('passes excludeLinkedSongIds as excludeIds to simfileSearch', async () => {
			mockApiClient.simfileSearch.mockResolvedValue({
				success: true,
				data: { simfileSearch: [] }
			});
			await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'song', limit: 8, excludeLinkedSongIds: ['1', '2'] }
			);
			expect(mockApiClient.simfileSearch).toHaveBeenCalledWith(
				expect.objectContaining({ excludeIds: ['1', '2'] })
			);
		});

		it('omits excludeIds when excludeLinkedSongIds is empty', async () => {
			mockApiClient.simfileSearch.mockResolvedValue({
				success: true,
				data: { simfileSearch: [] }
			});
			await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'song', limit: 8, excludeLinkedSongIds: [] }
			);
			expect(mockApiClient.simfileSearch).toHaveBeenCalledWith(
				expect.objectContaining({ excludeIds: undefined })
			);
		});

		it('handles thrown errors in search-cloud-songs', async () => {
			mockApiClient.simfileSearch.mockRejectedValue(new Error('Fetch failed'));
			const result = (await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'song', limit: 8, excludeLinkedSongIds: [] }
			)) as { success: boolean; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toBe('Fetch failed');
		});
	});

	// ── fetch-cloud-song ─────────────────────────────────────────────────────
	describe('fetch-cloud-song handler', () => {
		const gqlSimfile = {
			id: '5',
			title: 'Song',
			artist: 'Artist',
			bpm: 130,
			userId: 'u1',
			isPublished: true,
			displayId: 42,
			downloadUrl: null,
			previewUrl: null,
			videoPreviewUrl: null,
			publishDate: '2024-01-01',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
			dtxFiles: [{ level: 5, label: 'DTX' }]
		};

		it('returns mapped snake_case cloud song data on success', async () => {
			mockApiClient.getSimfile.mockResolvedValue({
				success: true,
				data: gqlSimfile
			});
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				cloudSongData: { id: number; is_published: boolean; dtx_files: unknown[] };
			};
			expect(result.success).toBe(true);
			expect(result.cloudSongData.id).toBe(5);
			expect(result.cloudSongData.is_published).toBe(true);
			expect(result.cloudSongData.dtx_files).toHaveLength(1);
		});

		it('returns failure when simfile is null (NOT_FOUND from API)', async () => {
			mockApiClient.getSimfile.mockResolvedValue({
				success: false,
				error: 'Simfile not found',
				code: 'NOT_FOUND'
			});
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Simfile not found');
		});

		it('returns failure when getSimfile itself fails', async () => {
			mockApiClient.getSimfile.mockResolvedValue({ success: false, error: 'Not found' });
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Not found');
		});

		it('handles thrown errors in fetch-cloud-song', async () => {
			mockApiClient.getSimfile.mockRejectedValue(new Error('Connection refused'));
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Connection refused');
		});
	});

	// ── update-simfile-record ────────────────────────────────────────────────
	describe('update-simfile-record handler', () => {
		const gqlUpdatedSimfile = {
			id: '3',
			title: 'New Title',
			artist: 'Artist',
			bpm: 130,
			userId: 'u1',
			isPublished: false,
			displayId: 10,
			downloadUrl: null,
			previewUrl: null,
			videoPreviewUrl: null,
			publishDate: '2024-01-01',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-02-01T00:00:00Z',
			dtxFiles: []
		};

		it('returns mapped snake_case data on successful update', async () => {
			mockApiClient.updateSimfile.mockResolvedValue({
				success: true,
				data: { updateSimfile: gqlUpdatedSimfile }
			});
			const result = (await ipcHandlers['update-simfile-record'](
				{},
				{ simfileId: 3, updateData: { title: 'New Title' } }
			)) as { success: boolean; data: { id: number; is_published: boolean } };
			expect(result.success).toBe(true);
			expect(result.data.id).toBe(3);
			expect(result.data.is_published).toBe(false);
		});

		it('converts snake_case keys to camelCase before calling updateSimfile', async () => {
			mockApiClient.updateSimfile.mockResolvedValue({
				success: true,
				data: { updateSimfile: gqlUpdatedSimfile }
			});
			await ipcHandlers['update-simfile-record'](
				{},
				{
					simfileId: 3,
					updateData: {
						display_id: 10,
						publish_date: '2024-01-01',
						is_published: true,
						download_url: 'https://example.com',
						video_preview_url: 'https://vid.example.com'
					}
				}
			);
			expect(mockApiClient.updateSimfile).toHaveBeenCalledWith(
				'3',
				expect.objectContaining({
					displayId: 10,
					publishDate: '2024-01-01',
					isPublished: true,
					downloadUrl: 'https://example.com',
					videoPreviewUrl: 'https://vid.example.com'
				})
			);
		});

		it('returns failure when updateSimfile fails', async () => {
			mockApiClient.updateSimfile.mockResolvedValue({ success: false, error: 'Forbidden' });
			const result = (await ipcHandlers['update-simfile-record'](
				{},
				{ simfileId: 3, updateData: {} }
			)) as { success: boolean; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toBe('Forbidden');
		});

		it('handles thrown errors in update-simfile-record', async () => {
			mockApiClient.updateSimfile.mockRejectedValue(new Error('Timeout'));
			const result = (await ipcHandlers['update-simfile-record'](
				{},
				{ simfileId: 3, updateData: {} }
			)) as { success: boolean; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toBe('Timeout');
		});
	});

	// ── app lifecycle ────────────────────────────────────────────────────────
	const originalPlatform = process.platform;
	const withPlatform = (platform: NodeJS.Platform, run: () => void) => {
		Object.defineProperty(process, 'platform', { value: platform, configurable: true });
		try {
			run();
		} finally {
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true
			});
		}
	};

	describe('app window-all-closed', () => {
		it('calls app.quit on non-darwin platforms', () => {
			withPlatform('win32', () => {
				appListeners['window-all-closed']();
				expect(mockApp.quit).toHaveBeenCalled();
			});
		});

		it('does not quit on darwin', () => {
			withPlatform('darwin', () => {
				appListeners['window-all-closed']();
				expect(mockApp.quit).not.toHaveBeenCalled();
			});
		});
	});

	describe('open-url app event', () => {
		it('calls handleProtocolUrl and prevents default', () => {
			const preventDefault = vi.fn();
			appListeners['open-url']({ preventDefault }, 'dtx://token/abc123');
			expect(preventDefault).toHaveBeenCalled();
			expect(mockAuth.handleProtocolUrl).toHaveBeenCalledWith('dtx://token/abc123');
		});
	});

	describe('second-instance app event', () => {
		it('focuses existing window on second instance', () => {
			const mockWin = {
				isMinimized: vi.fn().mockReturnValue(false),
				restore: vi.fn(),
				focus: vi.fn()
			};
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([mockWin]);

			appListeners['second-instance']({}, ['app', '--flag']);
			expect(mockWin.focus).toHaveBeenCalled();
		});

		it('restores minimised window on second instance', () => {
			const mockWin = {
				isMinimized: vi.fn().mockReturnValue(true),
				restore: vi.fn(),
				focus: vi.fn()
			};
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([mockWin]);

			appListeners['second-instance']({}, ['app']);
			expect(mockWin.restore).toHaveBeenCalled();
		});

		it('handles protocol URL in command line args', () => {
			const mockWin = {
				isMinimized: vi.fn().mockReturnValue(false),
				restore: vi.fn(),
				focus: vi.fn()
			};
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([mockWin]);

			appListeners['second-instance']({}, ['app', 'dtx://token/xyz']);
			expect(mockAuth.handleProtocolUrl).toHaveBeenCalledWith('dtx://token/xyz');
		});

		it('does nothing when no windows are open', () => {
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([]);
			appListeners['second-instance']({}, ['app']);
			expect(mockAuth.handleProtocolUrl).not.toHaveBeenCalled();
		});
	});

	// ── activate app event ───────────────────────────────────────────────────
	describe('activate app event', () => {
		it('creates a new window when no windows are open', () => {
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([]);
			appListeners['activate']();
			expect(mockCreateWindow).toHaveBeenCalled();
		});

		it('does not create a window when windows already exist', () => {
			(mockBrowserWindow.getAllWindows as Mock).mockReturnValue([{}]);
			appListeners['activate']();
			expect(mockCreateWindow).not.toHaveBeenCalled();
		});
	});

	// ── select-folder handler ────────────────────────────────────────────────
	describe('select-folder handler', () => {
		it('delegates to selectDirectory', async () => {
			mockFilesystem.selectDirectory.mockResolvedValue('/selected/path');
			const result = await ipcHandlers['select-folder']({});
			expect(mockFilesystem.selectDirectory).toHaveBeenCalled();
			expect(result).toBe('/selected/path');
		});
	});

	// ── create-song handler ──────────────────────────────────────────────────
	describe('create-song handler', () => {
		beforeEach(() => {
			// Default: folder does not exist (ENOENT error on access)
			const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
			mockFs.promises.access.mockRejectedValue(enoentError);
			mockFs.promises.mkdir.mockResolvedValue(undefined);
			mockFs.promises.writeFile.mockResolvedValue(undefined);
		});

		it('creates a song folder without a template', async () => {
			const result = (await ipcHandlers['create-song'](
				{},
				{
					selectedPath: '/workspace',
					sanitizedFolderName: 'my-song',
					sanitizedSongName: 'My Song',
					templateFolderPath: ''
				}
			)) as { success: boolean; songFolderPath: string };

			expect(mockFs.promises.mkdir).toHaveBeenCalledWith(expect.stringContaining('my-song'), {
				recursive: true
			});
			expect(mockFs.promises.writeFile).toHaveBeenCalled();
			expect(result.success).toBe(true);
		});

		it('throws when the folder already exists', async () => {
			// Override: access resolves (folder exists), so the handler throws a non-ENOENT error
			mockFs.promises.access.mockResolvedValue(undefined);

			await expect(
				ipcHandlers['create-song'](
					{},
					{
						selectedPath: '/workspace',
						sanitizedFolderName: 'existing-song',
						sanitizedSongName: 'Existing Song',
						templateFolderPath: ''
					}
				)
			).rejects.toThrow('already exists');
		});

		it('copies template files when templateFolderPath is provided', async () => {
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'SET.def', isDirectory: () => false, isFile: () => true },
				{ name: 'song.dtx', isDirectory: () => false, isFile: () => true }
			]);
			mockFs.promises.copyFile.mockResolvedValue(undefined);

			const result = (await ipcHandlers['create-song'](
				{},
				{
					selectedPath: '/workspace',
					sanitizedFolderName: 'new-song',
					sanitizedSongName: 'New Song',
					templateFolderPath: '/templates/rock'
				}
			)) as { success: boolean };

			expect(mockFs.promises.copyFile).toHaveBeenCalledTimes(2);
			expect(result.success).toBe(true);
		});

		it('recursively copies subdirectories from template', async () => {
			mockFs.promises.readdir
				.mockResolvedValueOnce([
					{ name: 'subfolder', isDirectory: () => true, isFile: () => false }
				])
				.mockResolvedValueOnce([
					{ name: 'asset.wav', isDirectory: () => false, isFile: () => true }
				]);
			mockFs.promises.copyFile.mockResolvedValue(undefined);

			await ipcHandlers['create-song'](
				{},
				{
					selectedPath: '/workspace',
					sanitizedFolderName: 'new-song',
					sanitizedSongName: 'New Song',
					templateFolderPath: '/templates/rock'
				}
			);

			expect(mockFs.promises.mkdir).toHaveBeenCalledTimes(2); // song folder + subfolder
			expect(mockFs.promises.copyFile).toHaveBeenCalledTimes(1);
		});

		it('throws when templateFolderPath is the same as destination', async () => {
			// Both resolve to the same absolute path
			await expect(
				ipcHandlers['create-song'](
					{},
					{
						selectedPath: '/workspace',
						sanitizedFolderName: 'my-song',
						sanitizedSongName: 'My Song',
						templateFolderPath: '/workspace/my-song'
					}
				)
			).rejects.toThrow('Cannot copy directory into itself');
		});

		it('throws when destination is a subdirectory of template', async () => {
			await expect(
				ipcHandlers['create-song'](
					{},
					{
						selectedPath: '/templates/rock',
						sanitizedFolderName: 'sub',
						sanitizedSongName: 'Sub',
						templateFolderPath: '/templates/rock'
					}
				)
			).rejects.toThrow('Cannot copy directory into itself');
		});
	});

	// ── upload-file handler ──────────────────────────────────────────────────
	describe('upload-file handler', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('returns error when file does not exist', async () => {
			mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));

			const result = (await ipcHandlers['upload-file'](
				{},
				'missing.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('File not found');
		});

		it('uploads file successfully via uploadFile', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio data'));
			mockUpload.uploadFile.mockResolvedValue({ success: true, data: { id: 99 } });

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; data: unknown };

			expect(result.success).toBe(true);
			expect(mockUpload.uploadFile).toHaveBeenCalled();
		});

		it('returns error when uploadFile returns failure', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio'));
			mockUpload.uploadFile.mockResolvedValue({ success: false, error: 'HTTP 413' });

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('Upload failed');
		});

		it('strips leading directory from nested fileName', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio'));

			const capturedFormData: FormData[] = [];
			mockUpload.uploadFile.mockImplementation((fd: FormData) => {
				capturedFormData.push(fd);
				return Promise.resolve({ success: true, data: {} });
			});

			await ipcHandlers['upload-file']({}, 'dir/kick.wav', '/songs/my-song', '42');

			expect(capturedFormData.length).toBeGreaterThan(0);
			const uploadedFile = capturedFormData[0].get('file') as File;
			expect(uploadedFile.name).toBe('kick.wav');
		});
	});

	// ── load-asset-files (GraphQL path) ─────────────────────────────────────
	describe('load-asset-files handler (GraphQL path)', () => {
		it('returns { success: true, data } on successful getSimfileWithFiles', async () => {
			mockApiClient.getSimfileWithFiles.mockResolvedValue({
				success: true,
				data: { files: [{ key: 'song.dtx', size: 1024, uploaded: '2024-01-01' }] }
			});

			const result = (await ipcHandlers['load-asset-files']({}, '42')) as {
				success: boolean;
				data: { fileName: string; size: number; lastModified: string; key: string }[];
			};
			expect(result).toEqual({
				success: true,
				data: [
					{
						fileName: 'song.dtx',
						size: 1024,
						lastModified: '2024-01-01',
						key: 'song.dtx'
					}
				]
			});
		});

		it('extracts fileName from nested key path', async () => {
			mockApiClient.getSimfileWithFiles.mockResolvedValue({
				success: true,
				data: {
					files: [
						{ key: '42/song.dtx', size: 2048, uploaded: '2024-06-15' },
						{ key: '42/samples/audio.wav', size: 512, uploaded: '2024-07-20' },
						{ key: 'other/path/file.dtx', size: 128, uploaded: '2024-08-01' }
					]
				}
			});

			const result = (await ipcHandlers['load-asset-files']({}, '42')) as {
				success: boolean;
				data: { fileName: string; key: string }[];
			};
			expect(result.success).toBe(true);
			expect(result.data).toEqual([
				{
					fileName: 'song.dtx',
					size: 2048,
					lastModified: '2024-06-15',
					key: '42/song.dtx'
				},
				{
					fileName: 'samples/audio.wav',
					size: 512,
					lastModified: '2024-07-20',
					key: '42/samples/audio.wav'
				},
				{
					fileName: 'other/path/file.dtx',
					size: 128,
					lastModified: '2024-08-01',
					key: 'other/path/file.dtx'
				}
			]);
		});

		it('returns { success: true, data: [] } for empty simfileId', async () => {
			const result = await ipcHandlers['load-asset-files']({}, '');
			expect(result).toEqual({ success: true, data: [] });
		});

		it('returns { success: true, data: [] } for NOT_FOUND error', async () => {
			mockApiClient.getSimfileWithFiles.mockResolvedValue({
				success: false,
				error: 'NOT_FOUND: simfile not found',
				code: 'NOT_FOUND'
			});

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual({ success: true, data: [] });
		});

		it('returns { success: true, data: [] } when error contains "Failed to list files"', async () => {
			mockApiClient.getSimfileWithFiles.mockResolvedValue({
				success: false,
				error: 'Failed to list files: storage error'
			});

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual({ success: true, data: [] });
		});

		it('returns { success: false, error } when getSimfileWithFiles throws', async () => {
			mockApiClient.getSimfileWithFiles.mockRejectedValue(new Error('Network error'));

			const result = (await ipcHandlers['load-asset-files']({}, '42')) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Network error');
		});

		it('returns { success: false, error } for other API errors', async () => {
			mockApiClient.getSimfileWithFiles.mockResolvedValue({
				success: false,
				error: 'INTERNAL_SERVER_ERROR: something went wrong'
			});

			const result = (await ipcHandlers['load-asset-files']({}, '42')) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toContain('INTERNAL_SERVER_ERROR');
		});
	});

	// ── export-song-to-zip ───────────────────────────────────────────────────
	describe('export-song-to-zip handler', () => {
		beforeEach(() => {
			vi.resetModules();
			mockFs.promises.access.mockResolvedValue(undefined);
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true, isDirectory: () => false },
				{ name: 'hi_hat.wav', isFile: () => true, isDirectory: () => false },
				{ name: 'image.png', isFile: () => true, isDirectory: () => false }
			]);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('content'));
			mockFs.promises.writeFile.mockResolvedValue(undefined);
			mockFs.promises.mkdir.mockResolvedValue(undefined);
		});

		it('exports successfully to default Downloads directory', async () => {
			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: null
				}
			)) as { success: boolean; zipPath: string; filesCount: number };

			expect(result.success).toBe(true);
			expect(result.filesCount).toBeGreaterThan(0);
			expect(result.zipPath).toContain('My Song.zip');
		});

		it('exports successfully with explicit exportDirectory', async () => {
			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; zipPath: string; filesCount: number };

			expect(result.success).toBe(true);
			expect(result.zipPath).toContain(path.join('custom', 'export'));
		});

		it('expands ~/Downloads to actual home directory', async () => {
			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '~/Downloads'
				}
			)) as { success: boolean };

			expect(result.success).toBe(true);
		});

		it('expands custom tilde path to home directory', async () => {
			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '~/Music/Exports'
				}
			)) as { success: boolean; zipPath: string };

			expect(result.success).toBe(true);
			expect(result.zipPath).toContain(path.join('Music', 'Exports'));
		});

		it('creates export directory when it does not exist', async () => {
			// access rejects (directory doesn't exist), mkdir succeeds
			mockFs.promises.access.mockRejectedValueOnce(new Error('ENOENT'));

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/nonexistent/exports'
				}
			)) as { success: boolean; zipPath: string };

			expect(result.success).toBe(true);
			expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/nonexistent/exports', {
				recursive: true
			});
		});

		it('returns error when export directory cannot be created', async () => {
			mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));
			mockFs.promises.mkdir.mockRejectedValue(new Error('Permission denied'));

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/readonly/exports'
				}
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('Cannot access or create export directory');
		});

		it('returns error when no valid files are found', async () => {
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'readme.txt', isFile: () => true, isDirectory: () => false },
				{ name: 'notes.doc', isFile: () => true, isDirectory: () => false }
			]);

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toBe('No valid files found to export');
		});

		it('uses "song" as default zip filename when songTitle is empty', async () => {
			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: '',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; zipPath: string };

			expect(result.success).toBe(true);
			expect(result.zipPath).toContain('song.zip');
		});

		it('handles unexpected errors and returns failure', async () => {
			mockFs.promises.readdir.mockRejectedValue(new Error('Disk I/O error'));

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toBe('Disk I/O error');
		});

		it('handles non-Error exceptions', async () => {
			mockFs.promises.readdir.mockRejectedValue('raw error string');

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toBe('Unknown error');
		});

		it('filters out non-DTX files and only zips valid ones', async () => {
			mockFs.promises.readdir.mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true, isDirectory: () => false },
				{ name: 'hi_hat.wav', isFile: () => true, isDirectory: () => false },
				{ name: 'README.txt', isFile: () => true, isDirectory: () => false },
				{ name: 'notes.docx', isFile: () => true, isDirectory: () => false }
			]);

			const result = (await ipcHandlers['export-song-to-zip'](
				{},
				{
					songPath: '/music/my-song',
					songTitle: 'My Song',
					exportDirectory: '/custom/export'
				}
			)) as { success: boolean; filesCount: number };

			expect(result.success).toBe(true);
			// Only song.dtx and hi_hat.wav have valid extensions in this test's fixture
			expect(result.filesCount).toBe(2);
		});
	});
});
