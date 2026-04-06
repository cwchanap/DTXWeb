import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPreviewKey, listAllR2Objects } from './r2';
import type { R2ObjectMeta } from './r2';

vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

import logger from '$lib/server/logger';

const makeR2Object = (key: string, size = 100): { key: string; size: number; uploaded: Date } => ({
	key,
	size,
	uploaded: new Date('2024-01-01')
});

const makeBucket = (
	pages: Array<{ objects: ReturnType<typeof makeR2Object>[]; cursor?: string }>
) => {
	let callCount = 0;
	return {
		list: vi.fn(async () => {
			const page = pages[callCount++];
			const isLast = callCount >= pages.length;
			return {
				objects: page.objects,
				truncated: !isLast,
				cursor: page.cursor
			};
		})
	};
};

describe('isPreviewKey', () => {
	it('returns true for preview.jpg at root', () => {
		expect(isPreviewKey('preview.jpg')).toBe(true);
	});

	it('returns true for preview.mp3 at root', () => {
		expect(isPreviewKey('preview.mp3')).toBe(true);
	});

	it('returns true for preview.jpg inside a folder', () => {
		expect(isPreviewKey('simfiles/123/preview.jpg')).toBe(true);
	});

	it('returns true for preview.mp3 inside a nested folder', () => {
		expect(isPreviewKey('a/b/c/preview.mp3')).toBe(true);
	});

	it('returns false for non-preview files', () => {
		expect(isPreviewKey('song.dtx')).toBe(false);
		expect(isPreviewKey('track.wav')).toBe(false);
		expect(isPreviewKey('image.png')).toBe(false);
	});

	it('returns false for files that partially match preview names', () => {
		expect(isPreviewKey('preview.jpg.bak')).toBe(false);
		expect(isPreviewKey('old_preview.jpg')).toBe(false);
		expect(isPreviewKey('my_preview.mp3')).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isPreviewKey('')).toBe(false);
	});

	it('is case-sensitive (uppercase not matched)', () => {
		expect(isPreviewKey('PREVIEW.JPG')).toBe(false);
		expect(isPreviewKey('Preview.mp3')).toBe(false);
	});
});

describe('listAllR2Objects', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns an empty array when bucket has no objects', async () => {
		const bucket = makeBucket([{ objects: [] }]);
		const result = await listAllR2Objects(bucket as never, 'prefix/');
		expect(result).toEqual([]);
		expect(bucket.list).toHaveBeenCalledTimes(1);
	});

	it('returns objects from a single non-truncated page', async () => {
		const obj1 = makeR2Object('prefix/file1.dtx');
		const obj2 = makeR2Object('prefix/file2.wav', 200);
		const bucket = makeBucket([{ objects: [obj1, obj2] }]);

		const result = await listAllR2Objects(bucket as never, 'prefix/');

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual<R2ObjectMeta>({
			key: 'prefix/file1.dtx',
			size: 100,
			uploaded: obj1.uploaded
		});
		expect(result[1]).toEqual<R2ObjectMeta>({
			key: 'prefix/file2.wav',
			size: 200,
			uploaded: obj2.uploaded
		});
	});

	it('handles multiple pages by following cursors', async () => {
		const obj1 = makeR2Object('prefix/file1.dtx');
		const obj2 = makeR2Object('prefix/file2.wav');
		const obj3 = makeR2Object('prefix/file3.mp3');

		const bucket = makeBucket([
			{ objects: [obj1], cursor: 'cursor-1' },
			{ objects: [obj2], cursor: 'cursor-2' },
			{ objects: [obj3] }
		]);

		const result = await listAllR2Objects(bucket as never, 'prefix/');

		expect(result).toHaveLength(3);
		expect(bucket.list).toHaveBeenCalledTimes(3);
		expect(bucket.list).toHaveBeenNthCalledWith(1, {
			prefix: 'prefix/',
			limit: 1000,
			cursor: undefined
		});
		expect(bucket.list).toHaveBeenNthCalledWith(2, {
			prefix: 'prefix/',
			limit: 1000,
			cursor: 'cursor-1'
		});
		expect(bucket.list).toHaveBeenNthCalledWith(3, {
			prefix: 'prefix/',
			limit: 1000,
			cursor: 'cursor-2'
		});
	});

	it('throws and logs a warning when truncated page has no cursor', async () => {
		const bucket = {
			list: vi.fn().mockResolvedValue({
				objects: [makeR2Object('prefix/file.dtx')],
				truncated: true
				// no cursor field
			})
		};

		await expect(listAllR2Objects(bucket as never, 'prefix/')).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('R2 list truncated without valid cursor')
		);
	});

	it('throws when cursor repeats (broken pagination state)', async () => {
		const bucket = {
			list: vi.fn().mockResolvedValue({
				objects: [makeR2Object('prefix/file.dtx')],
				truncated: true,
				cursor: 'same-cursor'
			})
		};

		// First call provides cursor; second call would see the same cursor → throw
		let calls = 0;
		bucket.list = vi.fn().mockImplementation(async ({ cursor }: { cursor?: string }) => {
			calls++;
			if (calls === 1) {
				return {
					objects: [makeR2Object('prefix/file.dtx')],
					truncated: true,
					cursor: 'c1'
				};
			}
			// Second call: simulate repeating cursor
			return { objects: [], truncated: true, cursor: 'c1' };
		});

		await expect(listAllR2Objects(bucket as never, 'prefix/')).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
	});

	it('maps R2 object properties correctly (key, size, uploaded)', async () => {
		const uploaded = new Date('2024-06-15T12:00:00Z');
		const bucket = {
			list: vi.fn().mockResolvedValue({
				objects: [{ key: 'my/key.wav', size: 512, uploaded }],
				truncated: false
			})
		};

		const result = await listAllR2Objects(bucket as never, 'my/');
		expect(result[0]).toEqual({ key: 'my/key.wav', size: 512, uploaded });
	});

	it('handles pages with null/undefined objects array gracefully', async () => {
		const bucket = {
			list: vi.fn().mockResolvedValue({
				objects: null,
				truncated: false
			})
		};

		const result = await listAllR2Objects(bucket as never, 'prefix/');
		expect(result).toEqual([]);
	});
});
