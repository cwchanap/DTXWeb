import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

const mockDesktopHost = vi.hoisted(() => ({
	getDefaultDownloadsDir: vi.fn(async (): Promise<string | null> => '/home/testuser/Downloads')
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

// We re-import the store after each module reset, so keep a handle that the
// tests can reassign.
let settingsStore: (typeof import('./settingsStore'))['settingsStore'];
let __resetDefaultDownloadsCacheForTests: (typeof import('./settingsStore'))['__resetDefaultDownloadsCacheForTests'];

describe('settingsStore', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/home/testuser/Downloads');
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
		vi.resetModules();
		({ settingsStore, __resetDefaultDownloadsCacheForTests } = await import('./settingsStore'));
		__resetDefaultDownloadsCacheForTests();
		// The store eagerly kicks off a getDefaultDownloadsPath() promise on
		// import; let it resolve before assertions run.
		await vi.waitFor(() => {
			expect(mockDesktopHost.getDefaultDownloadsDir).toHaveBeenCalled();
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('initial state', () => {
		it('hydrates the default Downloads path from the Rust command on import', async () => {
			const state = get(settingsStore);
			expect(mockDesktopHost.getDefaultDownloadsDir).toHaveBeenCalled();
			expect(state.exportDirectory).toBe('/home/testuser/Downloads');
		});

		it('falls back to empty string when the Rust command fails', async () => {
			mockDesktopHost.getDefaultDownloadsDir.mockRejectedValue(new Error('IPC down'));
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			await vi.waitFor(() => expect(get(freshStore).exportDirectory).toBe(''));
		});

		it('falls back to empty string when the OS reports no Downloads dir', async () => {
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue(null);
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			await vi.waitFor(() => expect(get(freshStore).exportDirectory).toBe(''));
		});
	});

	describe('set', () => {
		it('should update the full settings object', () => {
			settingsStore.set({ exportDirectory: '/custom/export' });

			const state = get(settingsStore);
			expect(state.exportDirectory).toBe('/custom/export');
		});

		it('should persist settings to localStorage', () => {
			settingsStore.set({ exportDirectory: '/custom/export' });

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'app_settings',
				expect.stringContaining('/custom/export')
			);
		});
	});

	describe('update', () => {
		it('should apply updater function to current settings', () => {
			settingsStore.set({ exportDirectory: '/initial' });
			settingsStore.update((settings) => ({ ...settings, exportDirectory: '/updated' }));

			expect(get(settingsStore).exportDirectory).toBe('/updated');
		});

		it('should persist after update', () => {
			settingsStore.update((settings) => ({ ...settings, exportDirectory: '/updated' }));

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'app_settings',
				expect.stringContaining('/updated')
			);
		});
	});

	describe('updateExportDirectory', () => {
		it('should update only the export directory', () => {
			settingsStore.updateExportDirectory('/new/export/path');

			expect(get(settingsStore).exportDirectory).toBe('/new/export/path');
		});

		it('should persist to localStorage', () => {
			settingsStore.updateExportDirectory('/new/path');

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'app_settings',
				expect.stringContaining('/new/path')
			);
		});
	});

	describe('reset', () => {
		it('should reset to the OS default Downloads directory', async () => {
			__resetDefaultDownloadsCacheForTests();
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/reset/path/Downloads');
			settingsStore.updateExportDirectory('/custom/path');
			await settingsStore.reset();

			const state = get(settingsStore);
			expect(state.exportDirectory).toBe('/reset/path/Downloads');
		});

		it('should persist reset settings to localStorage', async () => {
			await settingsStore.reset();

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'app_settings',
				expect.any(String)
			);
		});

		it('should fall back to empty string when the OS reports no Downloads dir', async () => {
			__resetDefaultDownloadsCacheForTests();
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue(null);
			await settingsStore.reset();

			expect(get(settingsStore).exportDirectory).toBe('');
		});
	});

	describe('localStorage loading', () => {
		it('should load persisted export directory on initialization', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify({ exportDirectory: '/stored/export/path' })
			);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			expect(window.localStorage.getItem).toHaveBeenCalledWith('app_settings');
			expect(get(freshStore).exportDirectory).toBe('/stored/export/path');
		});

		it('should hydrate the OS default when stored data is missing exportDirectory', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify({})
			);
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/home/testuser/Downloads');

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			await vi.waitFor(() =>
				expect(get(freshStore).exportDirectory).toBe('/home/testuser/Downloads')
			);
		});

		it('should fall back to OS default when localStorage is empty', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/home/testuser/Downloads');

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			await vi.waitFor(() =>
				expect(get(freshStore).exportDirectory).toBe('/home/testuser/Downloads')
			);
		});

		it('should fall back to OS default when localStorage contains invalid JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				'not-valid-json{'
			);
			mockDesktopHost.getDefaultDownloadsDir.mockResolvedValue('/home/testuser/Downloads');

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			await vi.waitFor(() =>
				expect(get(freshStore).exportDirectory).toBe('/home/testuser/Downloads')
			);
		});
	});

	describe('saveSettings error handling', () => {
		it('should handle localStorage.setItem error gracefully', () => {
			(window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
				throw new Error('Storage full');
			});

			expect(() => settingsStore.set({ exportDirectory: '/test' })).not.toThrow();
		});
	});
});
