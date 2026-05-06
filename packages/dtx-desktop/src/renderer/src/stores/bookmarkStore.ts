import { writable } from 'svelte/store';

export interface WorkspaceBookmark {
	path: string;
	name: string;
}

export type AddResult = { ok: true } | { ok: false; reason: 'duplicate' | 'cap-exceeded' };

const STORAGE_KEY = 'workspace_bookmarks';
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

function persist(value: WorkspaceBookmark[]): void {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function createBookmarkStore() {
	const { subscribe, update } = writable<WorkspaceBookmark[]>(hydrate());

	return {
		subscribe,
		add(path: string, name?: string): AddResult {
			let result: AddResult = { ok: true };
			update((current) => {
				if (current.some((b) => b.path === path)) {
					result = { ok: false, reason: 'duplicate' };
					return current;
				}
				if (current.length >= MAX_BOOKMARKS) {
					result = { ok: false, reason: 'cap-exceeded' };
					return current;
				}
				const next = [...current, { path, name: name?.trim() || basename(path) }];
				persist(next);
				return next;
			});
			return result;
		}
	};
}

export const bookmarkStore = createBookmarkStore();
