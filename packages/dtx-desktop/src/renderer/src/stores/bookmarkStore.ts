import { writable } from 'svelte/store';
import { desktopHost } from '../services/desktopHost';

/**
 * A workspace bookmark. The `id` is an opaque native identifier and is the
 * only value the renderer may send back to native (switch/remove/rename).
 * `path` is a display-only canonical path and must never be used to establish
 * trust. `name` is the user-supplied display label, persisted natively.
 */
export interface WorkspaceBookmark {
	id: string;
	path: string;
	name: string;
}

export const basename = (p: string): string => {
	const trimmed = p.replace(/[/\\]+$/, '');
	const parts = trimmed.split(/[/\\]/);
	return parts[parts.length - 1] || trimmed;
};

function createBookmarkStore() {
	const { subscribe, set } = writable<WorkspaceBookmark[]>([]);

	// Hydrates the cache from the native trust pool. Called at app startup and
	// after every native bookmark mutation so the renderer never owns the
	// authoritative bookmark set.
	const refresh = async (): Promise<void> => {
		const bookmarks = await desktopHost.listBookmarks();
		set(bookmarks);
	};

	return {
		subscribe,
		refresh,
		// Records the current trusted root as a bookmark. The native id is
		// generated natively; the renderer never supplies a path or id. Throws
		// with a native error message (e.g. "Maximum of 20 bookmarks reached")
		// when the operation cannot complete.
		addCurrent: async (name?: string): Promise<WorkspaceBookmark> => {
			const ref = await desktopHost.bookmarkCurrentRoot(name ?? '');
			await refresh();
			return ref;
		},
		rename: async (id: string, name: string): Promise<void> => {
			await desktopHost.renameBookmark(id, name);
			await refresh();
		},
		remove: async (id: string): Promise<void> => {
			await desktopHost.removeBookmark(id);
			await refresh();
		}
	};
}

export const bookmarkStore = createBookmarkStore();
