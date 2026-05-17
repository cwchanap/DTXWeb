import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { isPreviewKey, listAllR2Objects } from '$lib/server/r2';

vi.mock('@dtx/common/server', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('isPreviewKey', () => {
	it('returns true for preview.jpg', () => {
		expect(isPreviewKey('preview.jpg')).toBe(true);
	});

	it('returns true for preview.mp3', () => {
		expect(isPreviewKey('preview.mp3')).toBe(true);
	});

	it('returns true for preview.jpg in a subdirectory', () => {
		expect(isPreviewKey('123/preview.jpg')).toBe(true);
	});

	it('returns true for preview.mp3 in a nested subdirectory', () => {
		expect(isPreviewKey('charts/42/preview.mp3')).toBe(true);
	});

	it('returns false for other filenames', () => {
		expect(isPreviewKey('song.dtx')).toBe(false);
		expect(isPreviewKey('cover.png')).toBe(false);
		expect(isPreviewKey('audio.ogg')).toBe(false);
	});

	it('returns false for files named similarly but not matching', () => {
		expect(isPreviewKey('preview.png')).toBe(false);
		expect(isPreviewKey('preview.wav')).toBe(false);
		expect(isPreviewKey('previewx.jpg')).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isPreviewKey('')).toBe(false);
	});

	it('returns false for just a directory path with no filename', () => {
		expect(isPreviewKey('123/')).toBe(false);
	});
});

const makeR2Object = (key: string, size = 100) => ({
	key,
	size,
	uploaded: new Date('2024-01-01')
});

const makeBucket = (pages: { objects: ReturnType<typeof makeR2Object>[]; cursor?: string }[]) => {
	let callCount = 0;
	return {
		list: vi.fn(async () => {
			const page = pages[callCount++];
			const hasNext = callCount < pages.length;
			return {
				objects: page.objects ?? [],
				truncated: hasNext,
				...(hasNext ? { cursor: page.cursor ?? `cursor-${callCount}` } : {})
			};
		})
	} as unknown as R2Bucket;
};

describe('listAllR2Objects', () => {
	it('returns empty array when bucket has no objects', async () => {
		const bucket = makeBucket([{ objects: [] }]);
		const result = await listAllR2Objects(bucket, 'prefix/');
		expect(result).toEqual([]);
	});

	it('returns mapped objects from a single page', async () => {
		const obj = makeR2Object('prefix/song.dtx', 512);
		const bucket = makeBucket([{ objects: [obj] }]);
		const result = await listAllR2Objects(bucket, 'prefix/');
		expect(result).toEqual([{ key: 'prefix/song.dtx', size: 512, uploaded: obj.uploaded }]);
	});

	it('passes prefix and limit to bucket.list', async () => {
		const bucket = makeBucket([{ objects: [] }]);
		await listAllR2Objects(bucket, 'charts/');
		expect(bucket.list).toHaveBeenCalledWith({
			prefix: 'charts/',
			limit: 1000,
			cursor: undefined
		});
	});

	it('handles multiple pages of results', async () => {
		const obj1 = makeR2Object('prefix/a.dtx', 100);
		const obj2 = makeR2Object('prefix/b.dtx', 200);
		const bucket = makeBucket([
			{ objects: [obj1], cursor: 'page1-cursor' },
			{ objects: [obj2] }
		]);

		const result = await listAllR2Objects(bucket, 'prefix/');
		expect(result).toHaveLength(2);
		expect(result[0].key).toBe('prefix/a.dtx');
		expect(result[1].key).toBe('prefix/b.dtx');
	});

	it('passes cursor to subsequent list calls', async () => {
		const obj1 = makeR2Object('prefix/a.dtx');
		const obj2 = makeR2Object('prefix/b.dtx');
		const bucket = makeBucket([{ objects: [obj1], cursor: 'my-cursor' }, { objects: [obj2] }]);

		await listAllR2Objects(bucket, 'prefix/');
		expect(bucket.list).toHaveBeenNthCalledWith(1, {
			prefix: 'prefix/',
			limit: 1000,
			cursor: undefined
		});
		expect(bucket.list).toHaveBeenNthCalledWith(2, {
			prefix: 'prefix/',
			limit: 1000,
			cursor: 'my-cursor'
		});
	});

	it('throws when truncated result has no cursor', async () => {
		const bucket = {
			list: vi.fn().mockResolvedValue({
				objects: [makeR2Object('a.dtx')],
				truncated: true
				// no cursor field
			})
		} as unknown as R2Bucket;

		await expect(listAllR2Objects(bucket, 'prefix/')).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
	});

	it('throws when cursor repeats (infinite loop guard)', async () => {
		let calls = 0;
		const bucket = {
			list: vi.fn(async () => {
				calls++;
				return {
					objects: [makeR2Object('a.dtx')],
					truncated: true,
					cursor: 'same-cursor'
				};
			})
		} as unknown as R2Bucket;

		await expect(listAllR2Objects(bucket, 'prefix/')).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
		// Should throw on the second call (cursor repeated)
		expect(calls).toBe(2);
	});

	it('maps object metadata (key, size, uploaded) correctly', async () => {
		const uploadDate = new Date('2024-06-15T12:00:00Z');
		const bucket = makeBucket([
			{
				objects: [
					{ key: 'charts/1/song.dtx', size: 4096, uploaded: uploadDate },
					{ key: 'charts/1/preview.mp3', size: 1024, uploaded: uploadDate }
				]
			}
		]);

		const result = await listAllR2Objects(bucket, 'charts/1/');
		expect(result).toEqual([
			{ key: 'charts/1/song.dtx', size: 4096, uploaded: uploadDate },
			{ key: 'charts/1/preview.mp3', size: 1024, uploaded: uploadDate }
		]);
	});

	it('handles three pages of results correctly', async () => {
		const pages = [
			{ objects: [makeR2Object('a.dtx')], cursor: 'c1' },
			{ objects: [makeR2Object('b.dtx')], cursor: 'c2' },
			{ objects: [makeR2Object('c.dtx')] }
		];
		const bucket = makeBucket(pages);

		const result = await listAllR2Objects(bucket, 'prefix/');
		expect(result).toHaveLength(3);
		expect(bucket.list).toHaveBeenCalledTimes(3);
	});
});
