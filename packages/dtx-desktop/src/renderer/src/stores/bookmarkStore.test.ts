import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('bookmarkStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	describe('hydration', () => {
		it('hydrates from valid JSON in localStorage', async () => {
			const stored = [
				{ path: '/a', name: 'A' },
				{ path: '/b', name: 'B' }
			];
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify(stored)
			);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual(stored);
		});

		it('initializes empty when localStorage has no entry', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});

		it('initializes empty when localStorage has malformed JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('not-json');

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});

		it('initializes empty when localStorage has non-array JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				'{"foo":"bar"}'
			);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});
	});

	describe('add', () => {
		it('appends a bookmark and returns ok', async () => {
			const { bookmarkStore } = await import('./bookmarkStore');
			const result = bookmarkStore.add('/foo/bar', 'My Folder');
			expect(result).toEqual({ ok: true });
			expect(get(bookmarkStore)).toEqual([{ path: '/foo/bar', name: 'My Folder' }]);
		});

		it('defaults name to basename of path when name omitted', async () => {
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.add('/foo/bar/MySongs');
			expect(get(bookmarkStore)).toEqual([{ path: '/foo/bar/MySongs', name: 'MySongs' }]);
		});

		it('handles Windows-style paths in basename default', async () => {
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.add('C:\\Users\\jack\\Songs');
			expect(get(bookmarkStore)).toEqual([{ path: 'C:\\Users\\jack\\Songs', name: 'Songs' }]);
		});

		it('returns duplicate and does not mutate when path already exists', async () => {
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.add('/foo', 'First');
			const result = bookmarkStore.add('/foo', 'Second');
			expect(result).toEqual({ ok: false, reason: 'duplicate' });
			expect(get(bookmarkStore)).toEqual([{ path: '/foo', name: 'First' }]);
		});

		it('returns cap-exceeded and does not mutate when at 20 entries', async () => {
			const stored = Array.from({ length: 20 }, (_, i) => ({
				path: `/p${i}`,
				name: `n${i}`
			}));
			// Use the test's localStorage mocking convention to seed the hydrated state.
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify(stored)
			);
			const { bookmarkStore } = await import('./bookmarkStore');
			const result = bookmarkStore.add('/new', 'New');
			expect(result).toEqual({ ok: false, reason: 'cap-exceeded' });
			expect(get(bookmarkStore)).toEqual(stored);
		});

		it('persists to localStorage on successful add', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
			vi.clearAllMocks();
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.add('/foo', 'Foo');
			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'workspace_bookmarks',
				JSON.stringify([{ path: '/foo', name: 'Foo' }])
			);
		});
	});

	describe('remove', () => {
		it('removes the matching path', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify([
					{ path: '/a', name: 'A' },
					{ path: '/b', name: 'B' }
				])
			);
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.remove('/a');
			expect(get(bookmarkStore)).toEqual([{ path: '/b', name: 'B' }]);
		});

		it('is a no-op when path is not present', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify([{ path: '/a', name: 'A' }])
			);
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.remove('/missing');
			expect(get(bookmarkStore)).toEqual([{ path: '/a', name: 'A' }]);
		});

		it('persists remaining entries to localStorage', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify([
					{ path: '/a', name: 'A' },
					{ path: '/b', name: 'B' }
				])
			);
			const { bookmarkStore } = await import('./bookmarkStore');
			bookmarkStore.remove('/a');
			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'workspace_bookmarks',
				JSON.stringify([{ path: '/b', name: 'B' }])
			);
		});
	});
});
