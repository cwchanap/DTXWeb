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
		setDetailWidth: (px: number) => {
			update((s) => ({ ...s, detailPaneWidth: clampWidth(px) }));
			persist();
		},
		setDetailVisible: (visible: boolean) => {
			update((s) => ({ ...s, detailPaneVisible: visible }));
			persist();
		},
		toggleDetail: () => {
			update((s) => ({ ...s, detailPaneVisible: !s.detailPaneVisible }));
			persist();
		},
		reset: () => set(initialState)
	};
};

export const preferencesStore = createPreferencesStore();
