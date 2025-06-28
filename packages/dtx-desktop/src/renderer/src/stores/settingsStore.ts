import { writable } from 'svelte/store';

interface Settings {
	exportDirectory: string;
}

const DEFAULT_SETTINGS: Settings = {
	exportDirectory: '~/Downloads'
};

// Get OS-specific default Downloads directory
const getDefaultDownloadsPath = (): string => {
	if (typeof window !== 'undefined' && window.electron) {
		// Try to get the actual Downloads path from the OS
		// For now, use a reasonable default
		const os = navigator.platform.toLowerCase();
		if (os.includes('win')) {
			return 'C:\\Users\\%USERNAME%\\Downloads';
		} else if (os.includes('mac')) {
			return '~/Downloads';
		} else {
			return '~/Downloads';
		}
	}
	return '~/Downloads';
};

// Load settings from localStorage
const loadSettings = (): Settings => {
	// Check if we're in a browser environment
	if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
		return { ...DEFAULT_SETTINGS, exportDirectory: getDefaultDownloadsPath() };
	}

	try {
		const stored = localStorage.getItem('app_settings');
		if (stored) {
			const parsed = JSON.parse(stored);
			return {
				exportDirectory: parsed.exportDirectory || getDefaultDownloadsPath()
			};
		}
	} catch (error) {
		console.warn('Failed to load settings from localStorage:', error);
	}

	return { ...DEFAULT_SETTINGS, exportDirectory: getDefaultDownloadsPath() };
};

// Save settings to localStorage
const saveSettings = (settings: Settings): void => {
	// Check if we're in a browser environment
	if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

	try {
		localStorage.setItem('app_settings', JSON.stringify(settings));
	} catch (error) {
		console.error('Failed to save settings to localStorage:', error);
	}
};

// Create the store
const createSettingsStore = () => {
	const { subscribe, set, update } = writable<Settings>(loadSettings());

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
		reset: () => {
			const defaultSettings = {
				...DEFAULT_SETTINGS,
				exportDirectory: getDefaultDownloadsPath()
			};
			set(defaultSettings);
			saveSettings(defaultSettings);
		}
	};
};

export const settingsStore = createSettingsStore();
export type { Settings };
