export const BASE_URL = 'http://localhost:5173';

export const PAGES = {
	BLOG: `${BASE_URL}/blog`,
	EDITOR: `${BASE_URL}/editor`,
	EDITOR_WITH_SIMFILE: (simfileId: string) => `${BASE_URL}/editor/${simfileId}`
} as const;
