import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../services/desktopHost', () => ({
	desktopHost: {
		listBookmarks: vi.fn(),
		bookmarkCurrentRoot: vi.fn(),
		renameBookmark: vi.fn(),
		removeBookmark: vi.fn()
	}
}));

import { bookmarkStore, basename } from './bookmarkStore';
import { desktopHost } from '../services/desktopHost';

const host = vi.mocked(desktopHost);

describe('bookmarkStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		host.listBookmarks.mockResolvedValue([]);
		host.bookmarkCurrentRoot.mockResolvedValue({ id: 'native-id', path: '/foo', name: 'Foo' });
		host.renameBookmark.mockResolvedValue(undefined);
		host.removeBookmark.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.resetModules();
	});

	it('refresh hydrates the cache from the native trust pool', async () => {
		const native = [
			{ id: 'a', path: '/a', name: 'A' },
			{ id: 'b', path: '/b', name: 'B' }
		];
		host.listBookmarks.mockResolvedValue(native);

		await bookmarkStore.refresh();

		expect(host.listBookmarks).toHaveBeenCalledOnce();
		expect(get(bookmarkStore)).toEqual(native);
	});

	it('addCurrent delegates to bookmarkCurrentRoot and refreshes from native', async () => {
		host.bookmarkCurrentRoot.mockResolvedValue({ id: 'new-id', path: '/foo', name: 'Foo' });
		host.listBookmarks.mockResolvedValueOnce([{ id: 'new-id', path: '/foo', name: 'Foo' }]);

		const ref = await bookmarkStore.addCurrent('Foo');

		expect(host.bookmarkCurrentRoot).toHaveBeenCalledWith('Foo');
		expect(ref).toEqual({ id: 'new-id', path: '/foo', name: 'Foo' });
		expect(get(bookmarkStore)).toEqual([{ id: 'new-id', path: '/foo', name: 'Foo' }]);
	});

	it('addCurrent forwards an empty name so native applies the basename default', async () => {
		host.bookmarkCurrentRoot.mockResolvedValue({
			id: 'new-id',
			path: '/foo/MySongs',
			name: 'MySongs'
		});

		await bookmarkStore.addCurrent();

		expect(host.bookmarkCurrentRoot).toHaveBeenCalledWith('');
	});

	it('addCurrent propagates a native cap-exceeded error', async () => {
		host.bookmarkCurrentRoot.mockRejectedValue(new Error('Maximum of 20 bookmarks reached'));

		await expect(bookmarkStore.addCurrent('X')).rejects.toThrow(
			'Maximum of 20 bookmarks reached'
		);
	});

	it('rename delegates to renameBookmark by id and refreshes', async () => {
		host.listBookmarks.mockResolvedValueOnce([{ id: 'a', path: '/a', name: 'Renamed' }]);

		await bookmarkStore.rename('a', 'Renamed');

		expect(host.renameBookmark).toHaveBeenCalledWith('a', 'Renamed');
		expect(get(bookmarkStore)).toEqual([{ id: 'a', path: '/a', name: 'Renamed' }]);
	});

	it('remove delegates to removeBookmark by id and refreshes', async () => {
		host.listBookmarks.mockResolvedValueOnce([]);

		await bookmarkStore.remove('a');

		expect(host.removeBookmark).toHaveBeenCalledWith('a');
		expect(get(bookmarkStore)).toEqual([]);
	});

	it('basename extracts the final path segment', () => {
		expect(basename('/foo/bar/MySongs')).toBe('MySongs');
		expect(basename('C:\\Users\\jack\\Songs')).toBe('Songs');
		expect(basename('/foo/bar/')).toBe('bar');
	});
});
