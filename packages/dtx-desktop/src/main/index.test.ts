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
vi.mock('./window', () => ({ createWindow: vi.fn() }));

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
	describe('app window-all-closed', () => {
		it('calls app.quit on non-darwin platforms', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
			appListeners['window-all-closed']();
			expect(mockApp.quit).toHaveBeenCalled();
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true
			});
		});

		it('does not quit on darwin', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
			appListeners['window-all-closed']();
			expect(mockApp.quit).not.toHaveBeenCalled();
			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true
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
});
