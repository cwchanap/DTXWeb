import { writable, get } from 'svelte/store';
import { loadPreferences, savePreferences } from '../services/preferencesService';

export const MIN_DETAIL_WIDTH = 320;
export const MAX_DETAIL_WIDTH = 640;
export const DEFAULT_DETAIL_WIDTH = 420;

export interface PreferencesState {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	loaded: boolean;
}

const initialState: PreferencesState = {
	detailPaneWidth: DEFAULT_DETAIL_WIDTH,
	detailPaneVisible: true,
	loaded: false
};

const clampWidth = (px: number): number =>
	Math.min(Math.max(Math.round(px), MIN_DETAIL_WIDTH), MAX_DETAIL_WIDTH);
export { clampWidth };

const createPreferencesStore = () => {
	const store = writable<PreferencesState>(initialState);
	const { subscribe, set, update } = store;

	const persist = () => {
		const s = get(store);
		void savePreferences({
			detailPaneWidth: s.detailPaneWidth,
			detailPaneVisible: s.detailPaneVisible
		});
	};

	return {
		subscribe,
		load: async () => {
			const prefs = await loadPreferences();
			update((s) => ({
				...s,
				detailPaneWidth: clampWidth(prefs.detailPaneWidth),
				detailPaneVisible: prefs.detailPaneVisible,
				loaded: true
			}));
		},
		// Race guard: ignore mutations issued while load() is still in-flight.
		// Otherwise a pre-load toggle/resize would be overwritten when load()
		// resolves with the stale on-disk snapshot it read before the mutation.
		setDetailWidth: (px: number) => {
			if (!get(store).loaded) return;
			update((s) => ({ ...s, detailPaneWidth: clampWidth(px) }));
			persist();
		},
		setDetailVisible: (visible: boolean) => {
			if (!get(store).loaded) return;
			update((s) => ({ ...s, detailPaneVisible: visible }));
			persist();
		},
		toggleDetail: () => {
			if (!get(store).loaded) return;
			update((s) => ({ ...s, detailPaneVisible: !s.detailPaneVisible }));
			persist();
		},
		reset: () => set(initialState)
	};
};

export const preferencesStore = createPreferencesStore();
