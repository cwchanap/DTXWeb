import { writable } from 'svelte/store';
import { desktopHost } from '../services/desktopHost';

interface Settings {
	exportDirectory: string;
}

// Get OS-specific default Downloads directory
const getDefaultDownloadsPath = (): string => {
	// Get the actual Downloads path from the OS
	const os = desktopHost.getPlatform().toLowerCase();
	const environment = desktopHost.getEnvironment();
	const unixHome = environment.HOME;
	const windowsHome = environment.USERPROFILE || environment.HOME;

	if (os.includes('win')) {
		// Windows: C:\Users\[username]\Downloads
		return windowsHome ? `${windowsHome}\\Downloads` : '~/Downloads';
	} else if (os.includes('mac')) {
		// macOS: /Users/[username]/Downloads
		return unixHome ? `${unixHome}/Downloads` : '~/Downloads';
	} else {
		// Linux/Unix: /home/[username]/Downloads
		return unixHome ? `${unixHome}/Downloads` : '~/Downloads';
	}
};

// Load settings from localStorage
const loadSettings = (): Settings => {
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

	return { exportDirectory: getDefaultDownloadsPath() };
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
				exportDirectory: getDefaultDownloadsPath()
			};
			set(defaultSettings);
			saveSettings(defaultSettings);
		}
	};
};

export const settingsStore = createSettingsStore();
export type { Settings };
