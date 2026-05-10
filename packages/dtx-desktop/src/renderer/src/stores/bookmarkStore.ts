import { writable } from 'svelte/store';

export interface WorkspaceBookmark {
	path: string;
	name: string;
}

export type AddResult = { ok: true } | { ok: false; reason: 'duplicate' | 'cap-exceeded' };

const STORAGE_KEY = 'workspace_bookmarks';
const MAX_BOOKMARKS = 20;

export const basename = (p: string): string => {
	const trimmed = p.replace(/[/\\]+$/, '');
	const parts = trimmed.split(/[/\\]/);
	return parts[parts.length - 1] || trimmed;
};

const hydrate = (): WorkspaceBookmark[] => {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		return parsed
			.filter(
				(item): item is WorkspaceBookmark =>
					item != null &&
					typeof item.path === 'string' &&
					item.path !== '' &&
					typeof item.name === 'string'
			)
			.filter((item) => {
				if (seen.has(item.path)) return false;
				seen.add(item.path);
				return true;
			})
			.slice(0, MAX_BOOKMARKS);
	} catch (error) {
		console.warn('Failed to hydrate bookmarks from localStorage:', error);
		return [];
	}
};

const persist = (value: WorkspaceBookmark[]): void => {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch (error) {
		console.error('Failed to persist bookmarks to localStorage:', error);
	}
};

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
		},
		remove(path: string): void {
			update((current) => {
				if (!current.some((b) => b.path === path)) return current;
				const next = current.filter((b) => b.path !== path);
				persist(next);
				return next;
			});
		},
		rename(path: string, newName: string): void {
			update((current) => {
				const idx = current.findIndex((b) => b.path === path);
				if (idx === -1) return current;
				const trimmed = newName.trim();
				const finalName = trimmed === '' ? basename(path) : trimmed;
				if (current[idx].name === finalName) return current;
				const next = current.map((b, i) => (i === idx ? { ...b, name: finalName } : b));
				persist(next);
				return next;
			});
		}
	};
}

export const bookmarkStore = createBookmarkStore();
