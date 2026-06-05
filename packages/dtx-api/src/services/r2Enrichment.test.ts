import { describe, it, expect, vi } from 'vitest';
import {
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles,
	batchDiscoverCatalogFiles,
	discoverCatalogFiles
} from './r2Enrichment';
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
				{ key: '42/cover.png', size: 512, uploaded: new Date('2026-05-19T00:00:00Z') }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files).toEqual([
			{ key: '42/song.dtx', size: 1024, uploaded: '2026-05-19T00:00:00.000Z' },
			{ key: '42/cover.png', size: 512, uploaded: '2026-05-19T00:00:00.000Z' }
		]);
	});

	it('includes preview files in results for asset management', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/song.dtx', size: 1024, uploaded: new Date('2026-05-19T00:00:00Z') },
				{ key: '42/preview.jpg', size: 256, uploaded: new Date('2026-05-19T00:00:00Z') },
				{ key: '42/preview.mp3', size: 128, uploaded: new Date('2026-05-19T00:00:00Z') }
			]
		]);
		const files = await enrichFiles(bucket, 42);
		expect(files).toEqual([
			{ key: '42/song.dtx', size: 1024, uploaded: '2026-05-19T00:00:00.000Z' },
			{ key: '42/preview.jpg', size: 256, uploaded: '2026-05-19T00:00:00.000Z' },
			{ key: '42/preview.mp3', size: 128, uploaded: '2026-05-19T00:00:00.000Z' }
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

	it('paginates and finds non-preview object on later page', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/preview.jpg', size: 1, uploaded: new Date() },
				{ key: '42/preview.mp3', size: 1, uploaded: new Date() }
			],
			[{ key: '42/song.dtx', size: 100, uploaded: new Date() }]
		]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(true);
	});

	it('returns false when all pages contain only preview keys', async () => {
		const bucket = makeBucket([
			[{ key: '42/preview.jpg', size: 1, uploaded: new Date() }],
			[{ key: '42/preview.mp3', size: 1, uploaded: new Date() }]
		]);
		expect(await enrichHasUploadedFiles(bucket, 42)).toBe(false);
	});

	it('throws when R2 returns truncated without a cursor (stall guard)', async () => {
		const listMock = vi.fn(async () => ({
			objects: [{ key: '42/preview.jpg', size: 1, uploaded: new Date() }],
			truncated: true,
			cursor: undefined
		}));
		const bucket = { list: listMock } as unknown as R2Bucket;
		await expect(enrichHasUploadedFiles(bucket, 42)).rejects.toThrow('R2 pagination stalled');
	});

	it('throws when R2 returns the same cursor twice (stall guard)', async () => {
		const listMock = vi.fn(async () => ({
			objects: [{ key: '42/preview.jpg', size: 1, uploaded: new Date() }],
			truncated: true,
			cursor: 'same-cursor'
		}));
		const bucket = { list: listMock } as unknown as R2Bucket;
		await expect(enrichHasUploadedFiles(bucket, 42)).rejects.toThrow('R2 pagination stalled');
	});
});

describe('batchEnrichHasUploadedFiles', () => {
	it('returns a Map with results for all simfile IDs', async () => {
		const listMock = vi.fn(async (opts: { prefix: string }) => {
			if (opts.prefix === '1/') {
				return {
					objects: [{ key: '1/song.dtx', size: 100, uploaded: new Date() }],
					truncated: false
				};
			}
			return { objects: [], truncated: false };
		});
		const bucket = { list: listMock } as unknown as R2Bucket;

		const result = await batchEnrichHasUploadedFiles(bucket, [1, 2]);
		expect(result).toBeInstanceOf(Map);
		expect(result.get(1)).toBe(true);
		expect(result.get(2)).toBe(false);
	});

	it('returns empty Map for empty input', async () => {
		const bucket = {} as unknown as R2Bucket;
		const result = await batchEnrichHasUploadedFiles(bucket, []);
		expect(result.size).toBe(0);
	});

	it('throws when R2 check fails for any simfile in the batch', async () => {
		const listMock = vi.fn(async (opts: { prefix: string }) => {
			if (opts.prefix === '1/') {
				throw new Error('R2 error');
			}
			return {
				objects: [{ key: '2/song.dtx', size: 100, uploaded: new Date() }],
				truncated: false
			};
		});
		const bucket = { list: listMock } as unknown as R2Bucket;

		await expect(batchEnrichHasUploadedFiles(bucket, [1, 2])).rejects.toThrow('R2 error');
	});
});

describe('batchEnrichFiles', () => {
	it('returns a Map with file entries for all simfile IDs', async () => {
		const listMock = vi.fn(async (opts: { prefix: string }) => {
			if (opts.prefix === '1/') {
				return {
					objects: [
						{ key: '1/song.dtx', size: 100, uploaded: new Date('2026-05-19T00:00:00Z') }
					],
					truncated: false
				};
			}
			return { objects: [], truncated: false };
		});
		const bucket = { list: listMock } as unknown as R2Bucket;

		const result = await batchEnrichFiles(bucket, [1, 2]);
		expect(result).toBeInstanceOf(Map);
		expect(result.get(1)).toEqual([
			{ key: '1/song.dtx', size: 100, uploaded: '2026-05-19T00:00:00.000Z' }
		]);
		expect(result.get(2)).toEqual([]);
	});

	it('returns empty Map for empty input', async () => {
		const bucket = {} as unknown as R2Bucket;
		const result = await batchEnrichFiles(bucket, []);
		expect(result.size).toBe(0);
	});

	it('throws when R2 check fails for any simfile in the batch', async () => {
		const listMock = vi.fn(async (opts: { prefix: string }) => {
			if (opts.prefix === '1/') {
				throw new Error('R2 listing failed');
			}
			return {
				objects: [{ key: '2/song.dtx', size: 100, uploaded: new Date() }],
				truncated: false
			};
		});
		const bucket = { list: listMock } as unknown as R2Bucket;

		await expect(batchEnrichFiles(bucket, [1, 2])).rejects.toThrow('R2 listing failed');
	});
});

describe('batchDiscoverCatalogFiles', () => {
	it('returns a Map with catalog discovery for all simfiles', async () => {
		const listMock = vi.fn(async (opts: { prefix: string }) => {
			if (opts.prefix === '1/') {
				return {
					objects: [{ key: '1/song.dtx', size: 100, uploaded: new Date() }],
					truncated: false
				};
			}
			return {
				objects: [{ key: '2/preview.mp3', size: 50, uploaded: new Date() }],
				truncated: false
			};
		});
		const bucket = { list: listMock } as unknown as R2Bucket;

		const result = await batchDiscoverCatalogFiles(bucket, [
			{ simfileId: 1, dtxFiles: [], publicBaseUrl: 'https://bucket.example' },
			{ simfileId: 2, dtxFiles: [], publicBaseUrl: 'https://bucket.example' }
		]);

		expect(result).toBeInstanceOf(Map);
		expect(result.get(1)).toBeDefined();
		expect(result.get(2)).toBeDefined();
	});

	it('returns empty Map for empty input', async () => {
		const bucket = {} as unknown as R2Bucket;
		const result = await batchDiscoverCatalogFiles(bucket, []);
		expect(result.size).toBe(0);
	});
});

describe('discoverCatalogFiles', () => {
	it('encodes each R2 key path segment against the public bucket URL', async () => {
		const bucket = makeBucket([
			[
				{
					key: '42/charts with space/basic#chart.dtx',
					size: 1234,
					uploaded: new Date()
				}
			]
		]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [{ label: 'Basic', level: 1 }],
			publicBaseUrl: 'https://cdn.example.test/simfiles/'
		});

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl:
					'https://cdn.example.test/simfiles/42/charts%20with%20space/basic%23chart.dtx',
				fileSizeBytes: 1234,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('selects preview.mp3 for previewUrl case-insensitively', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/assets/PREVIEW.MP3', size: 100, uploaded: new Date() },
				{ key: '42/song.dtx', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [{ label: 'Basic', level: 1 }],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/assets/PREVIEW.MP3');
	});

	it('selects non-preview ogg before mp3, wav, and flac for downloadUrl', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/preview.mp3', size: 10, uploaded: new Date() },
				{ key: '42/full.wav', size: 20, uploaded: new Date() },
				{ key: '42/full.mp3', size: 30, uploaded: new Date() },
				{ key: '42/full.flac', size: 40, uploaded: new Date() },
				{ key: '42/full.ogg', size: 50, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [],
			publicBaseUrl: 'https://cdn.example.test/'
		});

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/full.ogg');
	});

	it('excludes preview.mp3 case-insensitively from downloadUrl', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/PREVIEW.MP3', size: 10, uploaded: new Date() },
				{ key: '42/full.wav', size: 20, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/PREVIEW.MP3');
		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/full.wav');
	});

	it('skips fetching set.def when no dtx chart rows need matching', async () => {
		const getMock = vi.fn(async () => ({ text: async () => '' }));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/preview.mp3', size: 100, uploaded: new Date() }
				]
			]),
			get: getMock
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [],
			publicBaseUrl: 'https://cdn.example.test'
		});

		// previewUrl/downloadUrl still resolve from the listing, but set.def
		// must not be fetched because no chart rows need label-to-file matching.
		expect(getMock).not.toHaveBeenCalled();
		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/preview.mp3');
		expect(discovery.charts).toEqual([]);
	});

	it('matches dtx rows by sorted fallback when set.def is unavailable', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/z-advanced.dtx', size: 500, uploaded: new Date() },
				{ key: '42/a-basic.dtx', size: 300, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [
				{ label: 'Advanced', level: 5 },
				{ label: 'Basic', level: 1 }
			],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(discovery.charts).toEqual([
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/z-advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/a-basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('parses set.def and matches labels to filenames when available', async () => {
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/sub/advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				text: async () =>
					'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE sub/advanced.dtx\n'
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [
				{ label: 'Advanced', level: 5 },
				{ label: 'Basic', level: 1 }
			],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(bucket.get).toHaveBeenCalledWith('42/set.def');
		expect(discovery.charts).toEqual([
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/sub/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('parses set.def with case-insensitive filename discovery', async () => {
		const bucket = {
			...makeBucket([
				[
					{ key: '42/SET.DEF', size: 90, uploaded: new Date() },
					{ key: '42/a-advanced.dtx', size: 500, uploaded: new Date() },
					{ key: '42/z-basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				text: async () =>
					'#L1LABEL BASIC\n#L1FILE z-basic.dtx\n#L2LABEL ADVANCED\n#L2FILE a-advanced.dtx\n'
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [
				{ label: 'Advanced', level: 5 },
				{ label: 'Basic', level: 1 }
			],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(bucket.get).toHaveBeenCalledWith('42/SET.DEF');
		expect(discovery.charts).toEqual([
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/a-advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/z-basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('returns an unmatched chart entry when a required dtx object is missing', async () => {
		const bucket = makeBucket([[{ key: '42/basic.dtx', size: 300, uploaded: new Date() }]]);

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [
				{ label: 'Basic', level: 1 },
				{ label: 'Advanced', level: 5 }
			],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 5,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('falls back to sorted pairing when set.def read throws a transient R2 error', async () => {
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a-basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b-advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => {
				throw new Error('R2 transient error');
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [
				{ label: 'Advanced', level: 5 },
				{ label: 'Basic', level: 1 }
			],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(bucket.get).toHaveBeenCalledWith('42/set.def');
		// Should fall through to sorted-key fallback instead of throwing
		expect(discovery.charts).toEqual([
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/b-advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/a-basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('falls back to sorted pairing when set.def object.text() throws', async () => {
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				text: async () => {
					throw new Error('body read error');
				}
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(bucket, {
			simfileId: 42,
			dtxFiles: [{ label: 'Basic', level: 1 }],
			publicBaseUrl: 'https://cdn.example.test'
		});

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});
});
