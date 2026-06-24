import { invoke } from '@tauri-apps/api/core';

export interface Preferences {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
}

const DEFAULTS: Preferences = { detailPaneWidth: 420, detailPaneVisible: true };

export const loadPreferences = async (): Promise<Preferences> => {
	try {
		return await invoke<Preferences>('read_preferences');
	} catch (error) {
		console.error('Failed to load preferences:', error);
		return { ...DEFAULTS };
	}
};

export const savePreferences = async (prefs: Preferences): Promise<void> => {
	// Intentionally rethrows: callers (preferencesStore.persist) decide how to
	// surface the failure (toast). Swallowing here hides "settings don't stick".
	await invoke('write_preferences', { prefs });
};
