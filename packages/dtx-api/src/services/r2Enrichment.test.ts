import { describe, it, expect, vi } from 'vitest';
import { enrichFiles, enrichHasUploadedFiles } from './r2Enrichment';
import type { R2Bucket } from '@cloudflare/workers-types';

const makeBucket = (
	objectsPerCall: Array<Array<{ key: string; size: number; uploaded: Date }>>
): R2Bucket => {
	let call = 0;
	return {
		list: vi.fn(async () => {
			const objects = objectsPerCall[call++] ?? [];
			const truncated = call < objectsPerCall.length;
			return { objects, truncated, cursor: truncated ? `cursor-${call}` : undefined };
		})
	} as unknown as R2Bucket;
};

describe('enrichFiles', () => {
	it('returns mapped R2File entries with ISO uploaded strings', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/song.dtx', size: 1024, uploaded: new Date('2026-05-19T00:00:00Z') },
				{ key: '42/preview.jpg', size: 256, uploaded: new Date('2026-05-19T00:00:00Z') }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files).toEqual([
			{ key: '42/song.dtx', size: 1024, uploaded: '2026-05-19T00:00:00.000Z' },
			{ key: '42/preview.jpg', size: 256, uploaded: '2026-05-19T00:00:00.000Z' }
		]);
	});

	it('paginates via cursor and concatenates results', async () => {
		const bucket = makeBucket([
			[{ key: '42/a.dtx', size: 1, uploaded: new Date('2026-05-19T00:00:00Z') }],
			[{ key: '42/b.dtx', size: 2, uploaded: new Date('2026-05-19T00:00:00Z') }]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files.map((f) => f.key)).toEqual(['42/a.dtx', '42/b.dtx']);
	});

	it('filters out the prefix-only entry whose suffix is empty', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/', size: 0, uploaded: new Date() },
				{ key: '42/song.dtx', size: 10, uploaded: new Date() }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files.map((f) => f.key)).toEqual(['42/song.dtx']);
	});
});

describe('enrichHasUploadedFiles', () => {
	it('returns true when a non-preview object exists', async () => {
		const bucket = makeBucket([[{ key: '42/song.dtx', size: 100, uploaded: new Date() }]]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(true);
	});

	it('returns false when only preview keys exist', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/preview.jpg', size: 1, uploaded: new Date() },
				{ key: '42/preview.mp3', size: 1, uploaded: new Date() }
			]
		]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(false);
	});

	it('returns false on empty listing', async () => {
		const bucket = makeBucket([[]]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(false);
	});
});
