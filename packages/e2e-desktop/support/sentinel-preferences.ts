export type PreferencesShape = {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	scoreLinks: Record<string, string>;
};

export const SENTINEL_PREFERENCES = {
	detailPaneWidth: 537,
	detailPaneVisible: false,
	scoreLinks: {}
} as const satisfies PreferencesShape;
