import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

const mockDesktopHost = vi.hoisted(() => ({
	getPlatform: vi.fn(() => 'linux'),
	getEnvironment: vi.fn(() => ({
		HOME: '/home/testuser',
		USERPROFILE: 'C:\\Users\\TestUser',
		USERNAME: 'TestUser'
	}))
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

// Pin navigator.platform to Linux so getDefaultDownloadsPath() always takes
// the Linux branch during this test file, regardless of the host OS.
Object.defineProperty(window.navigator, 'platform', {
	value: 'Linux x86_64',
	configurable: true
});

const { settingsStore } = await import('./settingsStore');

describe('settingsStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDesktopHost.getPlatform.mockReturnValue('linux');
		mockDesktopHost.getEnvironment.mockReturnValue({
			HOME: '/home/testuser',
			USERPROFILE: 'C:\\Users\\TestUser',
			USERNAME: 'TestUser'
		});
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
		settingsStore.reset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should initialize with a default export directory', () => {
		const state = get(settingsStore);
		expect(state.exportDirectory).toBeDefined();
		expect(typeof state.exportDirectory).toBe('string');
		expect(state.exportDirectory.length).toBeGreaterThan(0);
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
		it('should reset to default export directory', () => {
			settingsStore.updateExportDirectory('/custom/path');
			settingsStore.reset();

			const state = get(settingsStore);
			expect(state.exportDirectory).toBeDefined();
			// Should be a default path (not the custom one)
			expect(state.exportDirectory).not.toBe('/custom/path');
		});

		it('should persist reset settings to localStorage', () => {
			settingsStore.reset();

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'app_settings',
				expect.any(String)
			);
		});
	});

	describe('localStorage loading', () => {
		it('should load persisted export directory on initialization', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify({ exportDirectory: '/stored/export/path' })
			);

			// Reset module cache so the store re-initializes from localStorage
			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			expect(window.localStorage.getItem).toHaveBeenCalledWith('app_settings');
			expect(get(freshStore).exportDirectory).toBe('/stored/export/path');
		});

		it('should fall back to default when exportDirectory is missing in stored data', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify({})
			);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			expect(window.localStorage.getItem).toHaveBeenCalledWith('app_settings');
			// exportDirectory key is absent — should fall back to OS default
			const state = get(freshStore);
			expect(state.exportDirectory).toBeDefined();
			expect(state.exportDirectory).toBe('/home/testuser/Downloads');
		});

		it('should use default path when localStorage is empty', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			expect(window.localStorage.getItem).toHaveBeenCalledWith('app_settings');
			expect(get(freshStore).exportDirectory).toBe('/home/testuser/Downloads');
		});

		it('should use default path when localStorage contains invalid JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				'not-valid-json{'
			);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			expect(window.localStorage.getItem).toHaveBeenCalledWith('app_settings');
			// Parse error falls back to default
			expect(get(freshStore).exportDirectory).toBe('/home/testuser/Downloads');
		});

		it('should return Windows download path when platform is Win32', async () => {
			mockDesktopHost.getPlatform.mockReturnValue('win32');
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			const state = get(freshStore);
			expect(state.exportDirectory).toContain('C:\\Users');
			expect(state.exportDirectory).toContain('Downloads');
		});

		it('should return macOS download path when platform is Mac and HOME is set', async () => {
			mockDesktopHost.getPlatform.mockReturnValue('mac');
			mockDesktopHost.getEnvironment.mockReturnValue({ HOME: '/Users/testuser' });
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			const state = get(freshStore);
			expect(state.exportDirectory).toBe('/Users/testuser/Downloads');
		});

		it('should return macOS fallback path when platform is Mac and HOME is not set', async () => {
			mockDesktopHost.getPlatform.mockReturnValue('darwin');
			mockDesktopHost.getEnvironment.mockReturnValue({});
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			const state = get(freshStore);
			expect(state.exportDirectory).toBe('~/Downloads');
		});

		it('should return fallback when platform is Windows and neither USERPROFILE nor HOME is set', async () => {
			mockDesktopHost.getPlatform.mockReturnValue('win32');
			mockDesktopHost.getEnvironment.mockReturnValue({});
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			const state = get(freshStore);
			expect(state.exportDirectory).toBe('~/Downloads');
		});

		it('should return fallback when platform is Linux and HOME is not set', async () => {
			mockDesktopHost.getPlatform.mockReturnValue('linux');
			mockDesktopHost.getEnvironment.mockReturnValue({});
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			vi.resetModules();
			const { settingsStore: freshStore } = await import('./settingsStore');

			const state = get(freshStore);
			expect(state.exportDirectory).toBe('~/Downloads');
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
