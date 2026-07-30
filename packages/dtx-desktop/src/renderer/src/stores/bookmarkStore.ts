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
	const { subscribe, set, update } = writable<WorkspaceBookmark[]>([]);

	// Hydrates the cache from the native trust pool. Called at app startup and
	// after every native bookmark mutation so the renderer never owns the
	// authoritative bookmark set.
	const refresh = async (): Promise<void> => {
		const bookmarks = await desktopHost.listBookmarks();
		set(bookmarks);
	};

	// Best-effort reconciliation after a successful native mutation. The
	// authoritative change is already committed natively and applied to the
	// local store optimistically; a refresh failure must not be reported as a
	// mutation failure to callers.
	const reconcile = async (): Promise<void> => {
		try {
			await refresh();
		} catch {
			// best-effort — the local store already reflects the mutation
		}
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
			// Apply the new bookmark to the local store immediately so the
			// renderer reflects it even if the reconciliation refresh fails.
			update((bookmarks) =>
				bookmarks.some((b) => b.id === ref.id)
					? bookmarks
					: [...bookmarks, { id: ref.id, path: ref.path, name: ref.name }]
			);
			await reconcile();
			return ref;
		},
		rename: async (id: string, name: string): Promise<void> => {
			await desktopHost.renameBookmark(id, name);
			update((bookmarks) => bookmarks.map((b) => (b.id === id ? { ...b, name } : b)));
			await reconcile();
		},
		remove: async (id: string): Promise<void> => {
			await desktopHost.removeBookmark(id);
			update((bookmarks) => bookmarks.filter((b) => b.id !== id));
			await reconcile();
		}
	};
}

export const bookmarkStore = createBookmarkStore();
