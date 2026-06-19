import { writable } from 'svelte/store';
import { desktopHost } from '../services/desktopHost';

interface Settings {
	exportDirectory: string;
}

// Default export directory when no user preference is stored. We cache the
// IPC result because the OS path never changes during a session and we don't
// want to make `loadSettings()` async just to await the same path repeatedly.
let cachedDefaultDownloadsPath: string | null | undefined;

/**
 * Test-only escape hatch: clears the memoized default Downloads path so a
 * fresh IPC call is made on the next `getDefaultDownloadsPath()`. Production
 * code never needs this because the OS path doesn't change mid-session.
 */
export const __resetDefaultDownloadsCacheForTests = (): void => {
	cachedDefaultDownloadsPath = undefined;
};

const getDefaultDownloadsPath = async (): Promise<string> => {
	if (cachedDefaultDownloadsPath === undefined) {
		try {
			cachedDefaultDownloadsPath = await desktopHost.getDefaultDownloadsDir();
		} catch {
			cachedDefaultDownloadsPath = null;
		}
	}
	// Fallback when the OS reports no Downloads directory (rare; usually a
	// headless / misconfigured env). Avoid literal `~/Downloads` since the
	// renderer can't expand `~`.
	return cachedDefaultDownloadsPath ?? '';
};

// Load settings from localStorage. localStorage may have been written by an
// older build that lazily resolved the default path, so we still fall back to
// an empty string and let the UI prompt for a directory when one is needed.
const loadSettings = (): Settings => {
	try {
		const stored = localStorage.getItem('app_settings');
		if (stored) {
			const parsed = JSON.parse(stored);
			return {
				exportDirectory: parsed.exportDirectory || ''
			};
		}
	} catch (error) {
		console.warn('Failed to load settings from localStorage:', error);
	}

	return { exportDirectory: '' };
};

// Save settings to localStorage
const saveSettings = (settings: Settings): void => {
	try {
		localStorage.setItem('app_settings', JSON.stringify(settings));
	} catch (error) {
		console.error('Failed to save settings to localStorage:', error);
	}
};

// Create the store
const createSettingsStore = () => {
	const { subscribe, set, update } = writable<Settings>(loadSettings());

	// Eagerly hydrate the default Downloads path on first import so the store
	// reflects the real OS path as soon as the IPC round-trip completes,
	// without forcing every consumer to await it.
	void getDefaultDownloadsPath().then((defaultPath) => {
		update((settings) => {
			if (settings.exportDirectory) return settings;
			return { ...settings, exportDirectory: defaultPath };
		});
	});

	return {
		subscribe,
		set: (settings: Settings) => {
			set(settings);
			saveSettings(settings);
		},
		update: (updater: (settings: Settings) => Settings) => {
			update((settings) => {
				const newSettings = updater(settings);
				saveSettings(newSettings);
				return newSettings;
			});
		},
		updateExportDirectory: (directory: string) => {
			update((settings) => {
				const newSettings = { ...settings, exportDirectory: directory };
				saveSettings(newSettings);
				return newSettings;
			});
		},
		reset: async () => {
			const defaultPath = await getDefaultDownloadsPath();
			const defaultSettings = { exportDirectory: defaultPath };
			set(defaultSettings);
			saveSettings(defaultSettings);
		}
	};
};

export const settingsStore = createSettingsStore();
export type { Settings };
