import { writable } from 'svelte/store';

export interface WorkspaceBookmark {
	path: string;
	name: string;
}

export type AddResult = { ok: true } | { ok: false; reason: 'duplicate' | 'cap-exceeded' };

const STORAGE_KEY = 'workspace_bookmarks';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_BOOKMARKS = 20;

export function basename(p: string): string {
	const trimmed = p.replace(/[/\\]+$/, '');
	const parts = trimmed.split(/[/\\]/);
	return parts[parts.length - 1] || trimmed;
}

function hydrate(): WorkspaceBookmark[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is WorkspaceBookmark =>
				item != null && typeof item.path === 'string' && typeof item.name === 'string'
		);
	} catch {
		return [];
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function persist(value: WorkspaceBookmark[]): void {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function createBookmarkStore() {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { subscribe, set, update } = writable<WorkspaceBookmark[]>(hydrate());

	return {
		subscribe
	};
}

export const bookmarkStore = createBookmarkStore();
