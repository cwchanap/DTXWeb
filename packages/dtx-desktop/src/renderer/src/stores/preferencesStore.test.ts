import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../services/preferencesService', () => ({
	loadPreferences: vi.fn(),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

import { loadPreferences, savePreferences } from '../services/preferencesService';
import { preferencesStore, clampWidth } from './preferencesStore';

describe('preferencesStore', () => {
	beforeEach(() => {
		preferencesStore.reset();
		vi.clearAllMocks();
	});

	it('clampWidth rounds fractional pixels to integers and clamps to bounds', () => {
		// AppShell's drag path reuses this clamp, so mid-drag widths never paint
		// sub-pixel layout on high-DPI displays.
		expect(clampWidth(420.7)).toBe(421);
		expect(clampWidth(419.2)).toBe(419);
		expect(clampWidth(100)).toBe(320); // below min → clamped (after round)
		expect(clampWidth(9000)).toBe(640); // above max → clamped
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

	it('setDetailWidth clamps and persists', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: true
		});
		await preferencesStore.load();
		preferencesStore.setDetailWidth(10000);
		expect(get(preferencesStore).detailPaneWidth).toBe(640);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 640,
			detailPaneVisible: true
		});
	});

	it('toggleDetail flips visibility and persists', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: true
		});
		await preferencesStore.load();
		expect(get(preferencesStore).detailPaneVisible).toBe(true);
		preferencesStore.toggleDetail();
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('setDetailVisible sets and persists', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: true
		});
		await preferencesStore.load();
		preferencesStore.setDetailVisible(false);
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('ignores mutations issued while load() is still in-flight (race guard)', async () => {
		// load() blocks on the Rust IPC round-trip; a toggle fired in that window
		// must be a no-op so load() cannot later clobber it with the stale snapshot
		// it read before the mutation.
		let resolveLoad!: (v: { detailPaneWidth: number; detailPaneVisible: boolean }) => void;
		vi.mocked(loadPreferences).mockReturnValue(
			new Promise((r) => {
				resolveLoad = r;
			})
		);
		const loadPromise = preferencesStore.load();

		expect(get(preferencesStore).loaded).toBe(false);
		preferencesStore.toggleDetail();
		preferencesStore.setDetailWidth(10000);
		expect(get(preferencesStore).detailPaneVisible).toBe(true); // unchanged default
		expect(get(preferencesStore).detailPaneWidth).toBe(420);
		expect(savePreferences).not.toHaveBeenCalled();

		// Once load() resolves and flips `loaded`, mutations take effect again.
		resolveLoad({ detailPaneWidth: 420, detailPaneVisible: true });
		await loadPromise;
		preferencesStore.toggleDetail();
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledTimes(1);
	});
});
