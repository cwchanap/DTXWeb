import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../services/preferencesService', () => ({
	loadPreferences: vi.fn(),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

import { loadPreferences, savePreferences } from '../services/preferencesService';
import { preferencesStore } from './preferencesStore';

describe('preferencesStore', () => {
	beforeEach(() => {
		preferencesStore.reset();
		vi.clearAllMocks();
	});

	it('hydrates from loadPreferences (clamping width)', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 9000,
			detailPaneVisible: false
		});
		await preferencesStore.load();
		const s = get(preferencesStore);
		expect(s.detailPaneWidth).toBe(640); // clamped
		expect(s.detailPaneVisible).toBe(false);
		expect(s.loaded).toBe(true);
	});

	it('setDetailWidth clamps and persists', () => {
		preferencesStore.setDetailWidth(10000);
		expect(get(preferencesStore).detailPaneWidth).toBe(640);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 640,
			detailPaneVisible: true
		});
	});

	it('toggleDetail flips visibility and persists', () => {
		expect(get(preferencesStore).detailPaneVisible).toBe(true);
		preferencesStore.toggleDetail();
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('setDetailVisible sets and persists', () => {
		preferencesStore.setDetailVisible(false);
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});
});
