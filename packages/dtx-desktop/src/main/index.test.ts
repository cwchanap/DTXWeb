import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

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
	apiGet: vi.fn(),
	apiPatch: vi.fn()
};

vi.mock('./api-client', () => mockApiClient);

const mockSimfileService = {
	fetchUserSimFiles: vi.fn(),
	getPreviewUrl: vi.fn(),
	getSoundPreviewUrl: vi.fn(),
	createSimfileRecord: vi.fn(),
	parseDtxFiles: vi.fn(),
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
	});

	// ── open-external-url ────────────────────────────────────────────────────
	describe('open-external-url listener', () => {
		it('calls shell.openExternal with the provided URL', () => {
			ipcListeners['open-external-url']({}, 'https://example.com');
			expect(mockShell.openExternal).toHaveBeenCalledWith('https://example.com');
		});
	});

	// ── path-exists ──────────────────────────────────────────────────────────
	describe('path-exists handler', () => {
		it('returns true when path is accessible', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			const result = await ipcHandlers['path-exists']({}, '/some/path');
			expect(result).toBe(true);
		});

		it('returns false when path is not accessible', async () => {
			mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));
			const result = await ipcHandlers['path-exists']({}, '/missing/path');
			expect(result).toBe(false);
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
		it('returns empty array for empty simfileId', async () => {
			const result = await ipcHandlers['load-asset-files']({}, '');
			expect(result).toEqual([]);
		});

		it('returns empty array for simfileId "0"', async () => {
			const result = await ipcHandlers['load-asset-files']({}, '0');
			expect(result).toEqual([]);
		});

		it('returns empty array for null/undefined simfileId', async () => {
			const result = await ipcHandlers['load-asset-files']({}, null);
			expect(result).toEqual([]);
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

	// ── search-cloud-songs ───────────────────────────────────────────────────
	describe('search-cloud-songs handler', () => {
		it('returns results from apiGet on success', async () => {
			mockApiClient.apiGet.mockResolvedValue({
				success: true,
				data: { data: [{ id: 1, title: 'Hit Song' }] }
			});
			const result = (await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'hit', limit: 5, excludeLinkedSongIds: [] }
			)) as { success: boolean; data: unknown[] };
			expect(result.success).toBe(true);
			expect(result.data).toHaveLength(1);
		});

		it('returns failure when apiGet fails', async () => {
			mockApiClient.apiGet.mockResolvedValue({
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

		it('includes excludeLinkedSongIds in query params', async () => {
			mockApiClient.apiGet.mockResolvedValue({ success: true, data: { data: [] } });
			await ipcHandlers['search-cloud-songs'](
				{},
				{ query: 'song', limit: 8, excludeLinkedSongIds: [1, 2] }
			);
			const callUrl = (mockApiClient.apiGet as Mock).mock.calls[0][0] as string;
			expect(callUrl).toContain('exclude=1%2C2');
		});

		it('handles thrown errors in search-cloud-songs', async () => {
			mockApiClient.apiGet.mockRejectedValue(new Error('Fetch failed'));
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
		it('returns cloud song data on success', async () => {
			mockApiClient.apiGet.mockResolvedValue({
				success: true,
				data: { id: 5, title: 'Song' }
			});
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				cloudSongData: unknown;
			};
			expect(result.success).toBe(true);
			expect(result.cloudSongData).toEqual({ id: 5, title: 'Song' });
		});

		it('returns failure when apiGet returns no data', async () => {
			mockApiClient.apiGet.mockResolvedValue({ success: true, data: null });
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toBe('Cloud song not found');
		});

		it('returns failure when apiGet itself fails', async () => {
			mockApiClient.apiGet.mockResolvedValue({ success: false, error: 'Not found' });
			const result = (await ipcHandlers['fetch-cloud-song']({}, { cloudSongId: 5 })) as {
				success: boolean;
				error: string;
			};
			expect(result.success).toBe(false);
		});

		it('handles thrown errors in fetch-cloud-song', async () => {
			mockApiClient.apiGet.mockRejectedValue(new Error('Connection refused'));
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
		it('returns success on successful patch', async () => {
			mockApiClient.apiPatch.mockResolvedValue({ success: true, data: { updated: true } });
			const result = (await ipcHandlers['update-simfile-record'](
				{},
				{ simfileId: 3, updateData: { title: 'New Title' } }
			)) as { success: boolean };
			expect(result.success).toBe(true);
		});

		it('returns failure when patch fails', async () => {
			mockApiClient.apiPatch.mockResolvedValue({ success: false, error: 'Forbidden' });
			const result = (await ipcHandlers['update-simfile-record'](
				{},
				{ simfileId: 3, updateData: {} }
			)) as { success: boolean; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toBe('Forbidden');
		});

		it('handles thrown errors in update-simfile-record', async () => {
			mockApiClient.apiPatch.mockRejectedValue(new Error('Timeout'));
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
			vi.unstubAllEnvs();
		});

		afterEach(() => {
			vi.unstubAllGlobals();
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

		it('returns error when user is not authenticated', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockAuth.getCurrentSession.mockReturnValue(null);
			mockAuth.getSupabaseClient.mockReturnValue(null);

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('not authenticated');
		});

		it('returns error when session refresh fails', async () => {
			mockFs.promises.access.mockResolvedValue(undefined);
			mockAuth.getCurrentSession.mockReturnValue({ access_token: 'tok' });
			const mockClient = {
				auth: {
					getSession: vi.fn().mockResolvedValue({
						data: { session: null },
						error: new Error('session expired')
					})
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to get valid session');
		});

		it('returns error when VITE_DTX_SERVER_URL is not set', async () => {
			vi.stubEnv('VITE_DTX_SERVER_URL', '');
			mockFs.promises.access.mockResolvedValue(undefined);
			const session = {
				access_token: 'tok',
				refresh_token: 'ref',
				expires_at: 9999,
				expires_in: 3600,
				token_type: 'bearer',
				user: { id: 'u1' }
			};
			mockAuth.getCurrentSession.mockReturnValue(session);
			const mockClient = {
				auth: {
					getSession: vi.fn().mockResolvedValue({ data: { session }, error: null })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio'));

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; error: string };

			expect(result.success).toBe(false);
			expect(result.error).toContain('VITE_DTX_SERVER_URL');
		});

		it('uploads file successfully', async () => {
			vi.stubEnv('VITE_DTX_SERVER_URL', 'http://localhost:5173');
			mockFs.promises.access.mockResolvedValue(undefined);
			const session = {
				access_token: 'tok',
				refresh_token: 'ref',
				expires_at: 9999,
				expires_in: 3600,
				token_type: 'bearer',
				user: { id: 'u1' }
			};
			mockAuth.getCurrentSession.mockReturnValue(session);
			const mockClient = {
				auth: {
					getSession: vi.fn().mockResolvedValue({ data: { session }, error: null })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio data'));

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ id: 99 })
				}) as unknown as typeof fetch
			);

			const result = (await ipcHandlers['upload-file'](
				{},
				'kick.wav',
				'/songs/my-song',
				'42'
			)) as { success: boolean; data: unknown };

			expect(result.success).toBe(true);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/simFile/upload'),
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('returns error when upload response is not ok', async () => {
			vi.stubEnv('VITE_DTX_SERVER_URL', 'http://localhost:5173');
			mockFs.promises.access.mockResolvedValue(undefined);
			const session = {
				access_token: 'tok',
				refresh_token: 'ref',
				expires_at: 9999,
				expires_in: 3600,
				token_type: 'bearer',
				user: { id: 'u1' }
			};
			mockAuth.getCurrentSession.mockReturnValue(session);
			const mockClient = {
				auth: {
					getSession: vi.fn().mockResolvedValue({ data: { session }, error: null })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio'));

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					statusText: 'Bad Request',
					text: vi.fn().mockResolvedValue('Invalid file')
				}) as unknown as typeof fetch
			);

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
			vi.stubEnv('VITE_DTX_SERVER_URL', 'http://localhost:5173');
			mockFs.promises.access.mockResolvedValue(undefined);
			const session = {
				access_token: 'tok',
				refresh_token: 'ref',
				expires_at: 9999,
				expires_in: 3600,
				token_type: 'bearer',
				user: { id: 'u1' }
			};
			mockAuth.getCurrentSession.mockReturnValue(session);
			const mockClient = {
				auth: {
					getSession: vi.fn().mockResolvedValue({ data: { session }, error: null })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);
			mockFs.promises.readFile.mockResolvedValue(Buffer.from('audio'));

			const capturedFormData: FormData[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
					capturedFormData.push(opts.body as FormData);
					return Promise.resolve({
						ok: true,
						json: vi.fn().mockResolvedValue({})
					});
				}) as unknown as typeof fetch
			);

			await ipcHandlers['upload-file']({}, 'dir/kick.wav', '/songs/my-song', '42');

			// The fileName sent should strip the leading "dir/" prefix
			expect(capturedFormData.length).toBeGreaterThan(0);
			const uploadedFile = capturedFormData[0].get('file') as File;
			expect(uploadedFile.name).toBe('kick.wav');
		});
	});

	// ── load-asset-files (full fetch path) ───────────────────────────────────
	describe('load-asset-files handler (authenticated fetch path)', () => {
		const validSession = {
			access_token: 'tok',
			refresh_token: 'ref',
			expires_at: 9999,
			expires_in: 3600,
			token_type: 'bearer',
			user: { id: 'u1' }
		};

		beforeEach(() => {
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
			vi.stubEnv('VITE_DTX_SERVER_URL', 'http://localhost:5173');
			mockAuth.getCurrentSession.mockReturnValue(validSession);
			const mockClient = {
				auth: {
					getSession: vi
						.fn()
						.mockResolvedValue({ data: { session: validSession }, error: null })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
		});

		it('returns files array on successful fetch', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({ files: [{ fileName: 'song.dtx' }] })
				}) as unknown as typeof fetch
			);

			const result = (await ipcHandlers['load-asset-files']({}, '42')) as {
				fileName: string;
			}[];
			expect(result).toEqual([{ fileName: 'song.dtx' }]);
		});

		it('returns empty array when response files is missing', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({})
				}) as unknown as typeof fetch
			);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array for 404 response', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 404,
					statusText: 'Not Found',
					text: vi.fn().mockResolvedValue('Not found')
				}) as unknown as typeof fetch
			);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array when error text contains "Failed to list files"', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 500,
					statusText: 'Server Error',
					text: vi.fn().mockResolvedValue('Failed to list files: storage error')
				}) as unknown as typeof fetch
			);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array when fetch throws', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch
			);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array for non-404 non-"Failed to list files" error response', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 403,
					statusText: 'Forbidden',
					text: vi.fn().mockResolvedValue('Access denied')
				}) as unknown as typeof fetch
			);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array when VITE_DTX_SERVER_URL is not set', async () => {
			vi.stubEnv('VITE_DTX_SERVER_URL', '');

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array when user is not authenticated', async () => {
			mockAuth.getCurrentSession.mockReturnValue(null);
			mockAuth.getSupabaseClient.mockReturnValue(null);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
		});

		it('returns empty array when session refresh fails', async () => {
			const mockClient = {
				auth: {
					getSession: vi
						.fn()
						.mockResolvedValue({ data: { session: null }, error: new Error('expired') })
				}
			};
			mockAuth.getSupabaseClient.mockReturnValue(mockClient);

			const result = await ipcHandlers['load-asset-files']({}, '42');
			expect(result).toEqual([]);
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
			expect(result.zipPath).toContain('/custom/export');
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
			expect(result.zipPath).toContain('Music/Exports');
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
