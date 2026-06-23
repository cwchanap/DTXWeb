import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { loadPreferences, savePreferences } from './preferencesService';

describe('preferencesService', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the preferences from read_preferences', async () => {
		vi.mocked(invoke).mockResolvedValue({ detailPaneWidth: 500, detailPaneVisible: false });
		expect(await loadPreferences()).toEqual({ detailPaneWidth: 500, detailPaneVisible: false });
		expect(invoke).toHaveBeenCalledWith('read_preferences');
	});

	it('falls back to defaults when read_preferences rejects', async () => {
		vi.mocked(invoke).mockRejectedValue(new Error('no file'));
		expect(await loadPreferences()).toEqual({ detailPaneWidth: 420, detailPaneVisible: true });
	});

	it('passes prefs to write_preferences', async () => {
		vi.mocked(invoke).mockResolvedValue(undefined);
		await savePreferences({ detailPaneWidth: 360, detailPaneVisible: true });
		expect(invoke).toHaveBeenCalledWith('write_preferences', {
			prefs: { detailPaneWidth: 360, detailPaneVisible: true }
		});
	});
});
