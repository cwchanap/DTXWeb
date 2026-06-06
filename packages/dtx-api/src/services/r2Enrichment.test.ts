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
import type { WorkerLogger } from '@dtx/common/server';

const silentLogger: WorkerLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn()
};

const encodeToBuffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

const encodeUtf8WithBom = (text: string): ArrayBuffer => {
	const bytes = new TextEncoder().encode(text);
	return new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]).buffer;
};

const encodeUtf16LeWithBom = (text: string): ArrayBuffer => {
	const utf16Bytes = new Uint8Array(text.length * 2);
	for (let i = 0; i < text.length; i++) {
		const codeUnit = text.charCodeAt(i);
		utf16Bytes[i * 2] = codeUnit & 0xff;
		utf16Bytes[i * 2 + 1] = (codeUnit >> 8) & 0xff;
	}
	return new Uint8Array([0xff, 0xfe, ...utf16Bytes]).buffer;
};

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

		const result = await batchDiscoverCatalogFiles(
			bucket,
			[
				{ simfileId: 1, dtxFiles: [], publicBaseUrl: 'https://bucket.example' },
				{ simfileId: 2, dtxFiles: [], publicBaseUrl: 'https://bucket.example' }
			],
			silentLogger
		);

		expect(result).toBeInstanceOf(Map);
		expect(result.get(1)).toBeDefined();
		expect(result.get(2)).toBeDefined();
	});

	it('returns empty Map for empty input', async () => {
		const bucket = {} as unknown as R2Bucket;
		const result = await batchDiscoverCatalogFiles(bucket, [], silentLogger);
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

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test/simfiles/'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('selects preview.mp3 for previewUrl case-insensitively', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/assets/PREVIEW.MP3', size: 100, uploaded: new Date() },
				{ key: '42/song.dtx', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/assets/PREVIEW.MP3');
	});

	it('selects non-preview .ogg before .mp3, .wav, and .flac for downloadUrl', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/song.mp3', size: 200, uploaded: new Date() },
				{ key: '42/music.ogg', size: 150, uploaded: new Date() },
				{ key: '42/song.wav', size: 300, uploaded: new Date() },
				{ key: '42/song.flac', size: 400, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/music.ogg');
	});

	it('ignores preview.mp3 when selecting full audio for downloadUrl', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/preview.mp3', size: 100, uploaded: new Date() },
				{ key: '42/song.mp3', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/song.mp3');
	});

	it('prefers top-level full audio over a nested sample with the same extension for downloadUrl', async () => {
		// DTX simfiles ship individual drum sample chips under assets/
		// (e.g. 42/assets/kick.ogg). When a top-level full-audio file
		// (e.g. 42/song.ogg) exists alongside a nested sample, the
		// downloadUrl must point at the full-audio file — not the sample
		// chip. Lexicographic sort alone would return the nested asset
		// first because '42/assets/kick.ogg' sorts before '42/song.ogg'.
		const bucket = makeBucket([
			[
				{ key: '42/assets/kick.ogg', size: 10, uploaded: new Date() },
				{ key: '42/assets/snare.ogg', size: 10, uploaded: new Date() },
				{ key: '42/song.ogg', size: 5000, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/song.ogg');
	});

	it('prefers a top-level .mp3 backing track over nested .ogg/.wav sample chips for downloadUrl', async () => {
		// Extension priority (.ogg < .mp3 < .wav) must not override the
		// top-level preference. A top-level .mp3 is the full backing
		// track; nested .ogg/.wav files under assets/ are individual drum
		// sample chips. Checking extension first would return the nested
		// .ogg chip; the top-level check must win.
		const bucket = makeBucket([
			[
				{ key: '42/assets/kick.ogg', size: 10, uploaded: new Date() },
				{ key: '42/assets/snare.wav', size: 10, uploaded: new Date() },
				{ key: '42/song.mp3', size: 5000, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/song.mp3');
	});

	it('falls back to a nested sample when no top-level audio exists for downloadUrl', async () => {
		// Backward compat: legacy uploads that only have nested audio
		// still resolve to that key rather than null.
		const bucket = makeBucket([
			[
				{ key: '42/assets/kick.ogg', size: 10, uploaded: new Date() },
				{ key: '42/song.dtx', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/assets/kick.ogg');
	});

	it('returns null downloadUrl when no suitable audio object exists', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/song.dtx', size: 200, uploaded: new Date() },
				{ key: '42/preview.mp3', size: 100, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.downloadUrl).toBeNull();
	});

	it('prefers the canonical top-level preview.mp3 over a nested asset with the same basename', async () => {
		// DTX simfiles routinely ship packaged `#WAV` samples under
		// `assets/` (e.g. 42/assets/preview.mp3). The public preview
		// contract is the canonical top-level key {simfileId}/preview.mp3,
		// so when both exist the top-level key must win — selecting by
		// basename alone plus alphabetic sort would return the nested
		// asset first because '42/assets/preview.mp3' sorts before
		// '42/preview.mp3'.
		const bucket = makeBucket([
			[
				{ key: '42/assets/preview.mp3', size: 10, uploaded: new Date() },
				{ key: '42/preview.mp3', size: 100, uploaded: new Date() },
				{ key: '42/song.dtx', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/preview.mp3');
	});

	it('falls back to a nested preview.mp3 when the canonical top-level key is missing', async () => {
		// Backward compat: existing simfiles that only have a nested
		// preview.mp3 (e.g. legacy uploads under assets/) still resolve
		// to that key.
		const bucket = makeBucket([
			[
				{ key: '42/assets/preview.mp3', size: 100, uploaded: new Date() },
				{ key: '42/song.dtx', size: 200, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/assets/preview.mp3');
	});

	it('matches the canonical preview.mp3 case-insensitively', async () => {
		//Uploader and desktop export may write PREVIEW.MP3 or preview.mp3;
		//both must be treated as canonical.
		const bucket = makeBucket([
			[
				{ key: '42/PREVIEW.MP3', size: 100, uploaded: new Date() },
				{ key: '42/assets/preview.mp3', size: 10, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/PREVIEW.MP3');
	});

	it('skips fetching set.def when no dtx chart rows need matching', async () => {
		const getMock = vi.fn(async () => ({ arrayBuffer: async () => encodeToBuffer('') }));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/preview.mp3', size: 100, uploaded: new Date() }
				]
			]),
			get: getMock
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// previewUrl still resolves from the listing, but set.def
		// must not be fetched because no chart rows need label-to-file matching.
		expect(getMock).not.toHaveBeenCalled();
		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/preview.mp3');
		expect(discovery.charts).toEqual([]);
		expect(discovery.chartsPopulated).toBe(false);
	});

	it('skips fetching set.def for URL-only discovery even with .dtx files in R2', async () => {
		// Simulates the list-page scenario: the caller passes dtxFiles: []
		// because the client only selected previewUrl, but R2
		// contains set.def and .dtx files. SET.DEF must not be fetched.
		const getMock = vi.fn(async () => ({ arrayBuffer: async () => encodeToBuffer('') }));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/preview.mp3', size: 100, uploaded: new Date() }
				]
			]),
			get: getMock
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(getMock).not.toHaveBeenCalled();
		expect(discovery.previewUrl).toBe('https://cdn.example.test/42/preview.mp3');
		expect(discovery.charts).toEqual([]);
		expect(discovery.chartsPopulated).toBe(false);
	});

	it('matches dtx rows by sorted fallback when set.def is unavailable', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/z-advanced.dtx', size: 500, uploaded: new Date() },
				{ key: '42/a-basic.dtx', size: 300, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
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
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE sub/advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('prefers the canonical top-level set.def over a nested asset with the same basename', async () => {
		// DTX simfiles routinely ship packaged assets under `assets/`.
		// When both `42/set.def` and `42/assets/set.def` exist, R2 lists
		// them in lexicographic order (`assets/` < `set.def`), so
		// basename-only matching would pick the nested (possibly empty
		// or wrong) copy first. The canonical top-level key must win.
		const bucket = {
			...makeBucket([
				[
					// nested copy intentionally placed first in array to
					// match R2's lexicographic ordering and prove that
					// basename-first find() would return it.
					{ key: '42/assets/set.def', size: 10, uploaded: new Date() },
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => {
				// Only the canonical top-level key has real content;
				// the nested copy is empty (simulating a stray asset).
				if (key === '42/set.def') {
					return {
						arrayBuffer: async () =>
							encodeToBuffer(
								'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE advanced.dtx\n'
							)
					};
				}
				return { arrayBuffer: async () => encodeToBuffer('') };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(bucket.get).toHaveBeenCalledWith('42/set.def');
		expect(bucket.get).not.toHaveBeenCalledWith('42/assets/set.def');
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
				fileUrl: 'https://cdn.example.test/42/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('falls back to a nested set.def when the canonical top-level key is missing', async () => {
		// Backward compat: legacy uploads that only have a nested
		// set.def still resolve to that key.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/assets/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => encodeToBuffer('#L1LABEL BASIC\n#L1FILE basic.dtx\n')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(bucket.get).toHaveBeenCalledWith('42/assets/set.def');
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

	it('resolves relative #LxFILE references against the nested set.def directory', async () => {
		// Uploads preserve directory structure, so when the canonical
		// top-level set.def is absent and discovery falls back to a nested
		// copy (e.g. 42/song/set.def), sibling chart files live next to it
		// (e.g. 42/song/basic.dtx). Relative references must resolve against
		// the set.def's directory — not the simfile root — otherwise the
		// chart is marked claimed-but-missing and the fileUrl resolver
		// throws an INTERNAL error even though the object exists in R2.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 90, uploaded: new Date() },
					{ key: '42/song/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/song/advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(bucket.get).toHaveBeenCalledWith('42/song/set.def');
		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/song/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/song/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('resolves deeply nested relative set.def references with sub-paths', async () => {
		// set.def at 42/song/set.def references a chart in a deeper
		// sub-folder via a relative path (sub/normal.dtx). The reference
		// is relative to the set.def's own directory, so it should resolve
		// to 42/song/sub/normal.dtx — not 42/sub/normal.dtx.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 90, uploaded: new Date() },
					{ key: '42/song/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/song/sub/normal.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL NORMAL\n#L2FILE sub/normal.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Normal', level: 3 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/song/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Normal',
				level: 3,
				fileUrl: 'https://cdn.example.test/42/song/sub/normal.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('falls back to the simfile root for legacy flat uploads with a nested set.def', async () => {
		// Backward compat: legacy uploads where chart files were flattened
		// to the root (42/basic.dtx) despite a nested set.def
		// (42/assets/set.def). The root-prefix fallback ensures these
		// legacy uploads still resolve after the baseDir fix.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/assets/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => encodeToBuffer('#L1LABEL BASIC\n#L1FILE basic.dtx\n')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE z-basic.dtx\n#L2LABEL ADVANCED\n#L2FILE a-advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('matches SET.DEF FILE references case-insensitively against R2 keys', async () => {
		// SET.DEF says BASIC.DTX (uppercase) but R2 stores basic.dtx (lowercase).
		// This is common with uploads from case-insensitive filesystems
		// (Windows, default macOS). Without the case-insensitive fallback
		// the chart would be marked as claimed-by-SET.DEF but missing,
		// raising an INTERNAL error even though the object exists.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => encodeToBuffer('#L1LABEL BASIC\n#L1FILE BASIC.DTX\n')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('parses set.def using colon separator (matches editor loader)', async () => {
		// The editor loader at packages/dtx-web/.../editor/+page.server.ts
		// accepts both `#L1LABEL BASIC` and `#L1LABEL: BASIC`. Catalog
		// discovery must accept the same forms; otherwise filesByLabel
		// stays empty and falls back to sorted-key matching, which can
		// pair the wrong chart when key order differs from level order.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/z-basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/a-advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL: BASIC\n#L1FILE: z-basic.dtx\n#L2LABEL:ADVANCED\n#L2FILE :a-advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('returns an unmatched chart entry when a required dtx object is missing', async () => {
		const bucket = makeBucket([[{ key: '42/basic.dtx', size: 300, uploaded: new Date() }]]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('does not remap set.def-referenced rows via fallback when the object is missing', async () => {
		// set.def maps ADVANCED → advanced.dtx, but advanced.dtx is absent
		// from R2. The sorted-key fallback must NOT assign another .dtx
		// key (other.dtx) to the Advanced row — it should return null so
		// the client sees the chart as unavailable.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/other.dtx', size: 999, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('falls back to sorted pairing when set.def read throws a transient R2 error', async () => {
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		};
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

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			logger
		);

		expect(bucket.get).toHaveBeenCalledWith('42/set.def');
		expect(logger.warn).toHaveBeenCalledWith(
			'set.def read failed; falling back to sorted-key matching',
			expect.objectContaining({ setDefKey: '42/set.def', error: 'R2 transient error' })
		);
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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('falls back to sorted pairing when set.def body read throws', async () => {
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => {
					throw new Error('body read error');
				}
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 1 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			logger
		);

		expect(logger.warn).toHaveBeenCalledWith(
			'set.def read failed; falling back to sorted-key matching',
			expect.objectContaining({ setDefKey: '42/set.def', error: 'body read error' })
		);
		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('parses set.def encoded with UTF-8 BOM (strips BOM before regex match)', async () => {
		// Without BOM stripping, the first directive would start with \uFEFF
		// and the label regex `^#L(\d+)LABEL\s+(.+)$` would silently miss it,
		// causing row 1 to fall back to sorted-key pairing.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeUtf8WithBom(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

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
				fileUrl: 'https://cdn.example.test/42/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('parses set.def encoded with UTF-16LE BOM (matches desktop export format)', async () => {
		// The desktop app writes set.def with UTF-16LE BOM
		// (see packages/dtx-desktop/src/main/index.ts). Without BOM-aware
		// decoding, every ASCII byte interleaves with 0x00 and the regex
		// matches nothing, silently falling back to sorted-key pairing.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/z-basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/a-advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeUtf16LeWithBom(
						'#L1LABEL BASIC\n#L1FILE z-basic.dtx\n#L2LABEL ADVANCED\n#L2FILE a-advanced.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Advanced', level: 5 },
					{ label: 'Basic', level: 1 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// Labels intentionally assigned in reverse key-sort order so the test
		// fails if BOM detection is broken (sorted fallback would pair
		// Advanced→z-basic and Basic→a-advanced).
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
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('preserves duplicate set.def labels matching distinct DB rows to distinct files', async () => {
		// SET.def legitimately uses the same label "BASIC" on two L-slots
		// pointing at different files. Without per-label accumulation the
		// second entry overwrites the first and both DB rows resolve to the
		// same R2 object (orphaning the other file). Each row must claim a
		// distinct file.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic2.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL BASIC\n#L2FILE basic2.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 50 },
					{ label: 'Basic', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 50,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 70,
				fileUrl: 'https://cdn.example.test/42/basic2.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		expect(discovery.chartsPopulated).toBe(true);
	});

	it('falls extra duplicate-label rows through to sorted-key fallback when SET.def entries are exhausted', async () => {
		// Three DB rows share label "BASIC" but SET.def only defines two
		// L-slots for that label. The third row has no remaining SET.def
		// entry to consume and must fall through to the sorted-key fallback.
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic2.dtx', size: 500, uploaded: new Date() },
					{ key: '42/basic3.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () =>
					encodeToBuffer(
						'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL BASIC\n#L2FILE basic2.dtx\n'
					)
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 50 },
					{ label: 'Basic', level: 60 },
					{ label: 'Basic', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// Rows 0 and 1 are claimed by SET.def (basic.dtx, basic2.dtx).
		// Row 2 is not claimed by SET.def — it falls through to sorted-key
		// fallback and gets the only remaining unused key: basic3.dtx.
		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 50,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/basic2.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 70,
				fileUrl: 'https://cdn.example.test/42/basic3.dtx',
				fileSizeBytes: 700,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});
});
