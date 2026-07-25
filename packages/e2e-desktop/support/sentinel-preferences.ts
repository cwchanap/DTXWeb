export type PreferencesShape = {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	scoreLinks: Record<string, string>;
};

export const SENTINEL_PREFERENCES = {
	detailPaneWidth: 537,
	detailPaneVisible: true,
	scoreLinks: {}
} as const satisfies PreferencesShape;
