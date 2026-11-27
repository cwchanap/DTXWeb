import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles,
	batchDiscoverCatalogFiles,
	discoverCatalogFiles
} from './r2Enrichment';
import { parseSetDef } from '@dtx/common/encoding';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { WorkerLogger } from '../lib/workerLogger';
import { workerLogger } from '../lib/workerLogger';

vi.mock('../lib/workerLogger', () => ({
	workerLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

const mockedWarn = vi.mocked(workerLogger.warn);

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

const encodeUtf16BeWithBom = (text: string): ArrayBuffer => {
	const utf16Bytes = new Uint8Array(text.length * 2);
	for (let i = 0; i < text.length; i++) {
		const codeUnit = text.charCodeAt(i);
		utf16Bytes[i * 2] = (codeUnit >> 8) & 0xff;
		utf16Bytes[i * 2 + 1] = codeUnit & 0xff;
	}
	return new Uint8Array([0xfe, 0xff, ...utf16Bytes]).buffer;
};

const encodeUtf16LeNoBom = (text: string): ArrayBuffer => encodeUtf16LeWithBom(text).slice(2);

const encodeUtf16BeNoBom = (text: string): ArrayBuffer => encodeUtf16BeWithBom(text).slice(2);

const makeBucket = (
	objectsPerCall: Array<Array<{ key: string; size: number; uploaded: Date; etag?: string }>>
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

	it('throws and warns when R2 returns truncated without a cursor (stall guard)', async () => {
		const listMock = vi.fn(async () => ({
			objects: [{ key: '42/preview.jpg', size: 1, uploaded: new Date() }],
			truncated: true,
			cursor: undefined
		}));
		const bucket = { list: listMock } as unknown as R2Bucket;
		await expect(enrichHasUploadedFiles(bucket, 42)).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
		expect(mockedWarn).toHaveBeenCalledWith(
			'R2 list truncated without valid cursor for prefix "42/"'
		);
	});

	it('throws and warns when R2 returns the same cursor twice (stall guard)', async () => {
		const listMock = vi.fn(async () => ({
			objects: [{ key: '42/preview.jpg', size: 1, uploaded: new Date() }],
			truncated: true,
			cursor: 'same-cursor'
		}));
		const bucket = { list: listMock } as unknown as R2Bucket;
		await expect(enrichHasUploadedFiles(bucket, 42)).rejects.toThrow(
			'R2 pagination cursor unavailable'
		);
		expect(mockedWarn).toHaveBeenCalledWith(
			'R2 list truncated without valid cursor for prefix "42/"'
		);
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
		// The nested song dir holds the selected set.def, so its sibling
		// chart is catalog-eligible — a deeper-nested key with no anchoring
		// set.def would instead stay out of the positional pairing.
		const bucket = makeBucket([
			[
				{
					key: '42/charts with space/set.def',
					size: 60,
					uploaded: new Date()
				},
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

	it('supports authored m4a while excluding canonical generated bgm.m4a from downloadUrl', async () => {
		const bucket = makeBucket([
			[
				{ key: '42/bgm.m4a', size: 200, uploaded: new Date() },
				{ key: '42/music.m4a', size: 150, uploaded: new Date() }
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

		expect(discovery.downloadUrl).toBe('https://cdn.example.test/42/music.m4a');
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
				// Rows are listed in uploader (filename-sorted) order —
				// parse_dtx_folder emits catalog rows in files.sort()
				// order — because the fallback pairs positionally.
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
				fileUrl: 'https://cdn.example.test/42/a-basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/z-advanced.dtx',
				fileSizeBytes: 500,
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

	it('strips ./ and .\\ prefixes from set.def file references before matching R2 keys', async () => {
		// Windows-authored SET.def references like `.\basic.dtx` normalize
		// to `./basic.dtx` after backslash conversion; without stripping the
		// `./` prefix the candidate key becomes `42/./basic.dtx`, which never
		// matches the stored `42/basic.dtx` — and because the row is claimed
		// by set.def, the sorted-key fallback is suppressed and fileUrl is
		// null even though the chart exists.
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
						'#L1LABEL BASIC\n#L1FILE .\\basic.dtx\n#L2LABEL ADVANCED\n#L2FILE .\\sub\\advanced.dtx\n'
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
				fileUrl: 'https://cdn.example.test/42/sub/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('resolves ./<id>/ set.def references relative to the set.def directory, not as bucket keys', async () => {
		// `.\42\basic.dtx` is explicitly relative: it points inside a `42/`
		// subfolder next to set.def, at `42/42/basic.dtx`. Normalization
		// strips the `.\` marker, so the name collides with the
		// already-prefixed-key shortcut — without preserving the marker the
		// row binds the root-level `42/basic.dtx` decoy instead. A bare
		// `42/advanced.dtx` (no `./`) still takes the already-prefixed path.
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE .\\42\\basic.dtx\n#L2LABEL ADVANCED\n#L2FILE 42/advanced.dtx\n',
			'42/42/basic.dtx': '#TITLE: Song\n#DLEVEL: 1\n',
			'42/advanced.dtx': '#TITLE: Song\n#DLEVEL: 5\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/42/basic.dtx', size: 700, uploaded: new Date() },
					{ key: '42/advanced.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
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
				fileUrl: 'https://cdn.example.test/42/42/basic.dtx',
				fileSizeBytes: 700,
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
	});

	it('falls back to the simfile-relative key when a bare ID-prefixed ref misses the direct key', async () => {
		// `#L1FILE 42/lead.dtx` is ambiguous: a bucket key verbatim, or a
		// `42/` subfolder beside set.def. No `42/lead.dtx` object exists —
		// the chart lives at `42/42/lead.dtx` — so direct-key-only
		// resolution returns nothing while the non-exact claim still marks
		// the row claimed, suppressing the fallback and yielding a null
		// fileUrl. Mirrors the retry SimFile.parseFromRemoteURLWithMetadata
		// applies on 404 for the same bare ID-named subfolder fixture.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL LEAD\n#L1FILE 42/lead.dtx\n',
			'42/42/lead.dtx': '#TITLE: Song\n#DLEVEL: 7\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/42/lead.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Lead', level: 7 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Lead',
				level: 7,
				fileUrl: 'https://cdn.example.test/42/42/lead.dtx',
				fileSizeBytes: 700,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers a directly resolved ref over a nested object reached only through the ID-prefixed fallback', async () => {
		// Repeated label, one catalog row, two path-qualified refs probing
		// the same #DLEVEL. `42/alternate.dtx` resolves only via the bare
		// ID-prefixed fallback (no direct key exists) to `42/42/…` — a
		// subfolder the uploader's top-level-only catalog never scanned,
		// so it cannot be the row's chart. Ranking the refs by resolved
		// key alone sorts `42/42/alternate.dtx` before `42/novice.dtx` and
		// hands the claim to the alternate, stealing the cataloged chart.
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL NOVICE\n#L1FILE ./novice.dtx\n#L2LABEL NOVICE\n#L2FILE 42/alternate.dtx\n',
			'42/novice.dtx': '#TITLE: Song\n#DLEVEL: 10\n',
			'42/42/alternate.dtx': '#TITLE: Song\n#DLEVEL: 10\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/42/alternate.dtx', size: 700, uploaded: new Date() },
					{ key: '42/novice.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Novice', level: 10 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Novice',
				level: 10,
				fileUrl: 'https://cdn.example.test/42/novice.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not penalize an ID-prefixed fallback ref that resolves directly beside a same-ID nested set.def', async () => {
		const chartBodies: Record<string, string> = {
			'42/42/set.def':
				'#L1LABEL NOVICE\n#L1FILE 42/novice.dtx\n#L2LABEL NOVICE\n#L2FILE ./z-extras/alternate.dtx\n',
			'42/42/novice.dtx': '#TITLE: Song\n#DLEVEL: 10\n',
			'42/42/z-extras/alternate.dtx': '#TITLE: Song\n#DLEVEL: 10\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/42/novice.dtx', size: 300, uploaded: new Date() },
					{ key: '42/42/z-extras/alternate.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Novice', level: 10 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Novice',
				level: 10,
				fileUrl: 'https://cdn.example.test/42/42/novice.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
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
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL ADVANCED\n#L2FILE advanced.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 1\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/other.dtx', size: 999, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
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
				// Rows in uploader (filename-sorted) order — the chart
				// probes also fail (same throwing get), so pairing is
				// positional and position is the uploader's file order.
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Advanced', level: 5 }
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
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/a-basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 5,
				fileUrl: 'https://cdn.example.test/42/b-advanced.dtx',
				fileSizeBytes: 500,
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
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL BASIC\n#L2FILE basic2.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 50\n',
			'42/basic2.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic2.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
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
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE basic.dtx\n#L2LABEL BASIC\n#L2FILE basic2.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 50\n',
			'42/basic2.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/basic3.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic2.dtx', size: 500, uploaded: new Date() },
					{ key: '42/basic3.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
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

	it('matches set.def levels beyond L5', async () => {
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/maniac.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => encodeToBuffer('#L6LABEL MANIAC\n#L6FILE maniac.dtx\n')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Maniac', level: 6 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Maniac',
				level: 6,
				fileUrl: 'https://cdn.example.test/42/maniac.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('ignores non-positive L0 slots instead of letting them claim a label queue', async () => {
		// #L0 is not a real chart slot. If it entered the label queue it would
		// shift()-claim the first matching row's file ahead of the real L1 entry.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L0LABEL BASIC\n#L0FILE ghost.dtx\n#L1LABEL BASIC\n#L1FILE basic.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 1\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/ghost.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
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

	it('orders duplicate-label queues by numeric L-slot, not set.def line order', async () => {
		// Two rows share label "DUP". L1 is written after L2 in the file, but
		// the first matching DB row must still claim L1's file — queues are
		// accumulated in sorted L-slot order.
		// The probed #DLEVELs match no row's level, so claiming exercises
		// the non-exact path — L-slot order decides which file each row
		// takes, which is the mechanism under test.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L2LABEL DUP\n#L2FILE b.dtx\n#L1LABEL DUP\n#L1FILE a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 9\n',
			'42/b.dtx': '#TITLE: Song\n#DLEVEL: 9\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Dup', level: 50 },
					{ label: 'Dup', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Dup',
				level: 50,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Dup',
				level: 70,
				fileUrl: 'https://cdn.example.test/42/b.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('lets the sorted-key fallback bind charts for directory-only #LxFILE references', async () => {
		// `#L1FILE ./` / `.\` normalize to no filename — claiming the row
		// would suppress the fallback even though unclaimed charts exist.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./\n#L2LABEL ADV\n#L2FILE .\\\n',
			'42/aaa.dtx': '#TITLE: Song\n#DLEVEL: 1\n',
			'42/bbb.dtx': '#TITLE: Song\n#DLEVEL: 2\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/aaa.dtx', size: 300, uploaded: new Date() },
					{ key: '42/bbb.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 1 },
					{ label: 'Adv', level: 2 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 1,
				fileUrl: 'https://cdn.example.test/42/aaa.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Adv',
				level: 2,
				fileUrl: 'https://cdn.example.test/42/bbb.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('pairs duplicate-label rows by the referenced charts #DLEVEL, not slot order', async () => {
		// L1 holds the HARDER chart: nothing enforces ascending #DLEVEL
		// across slots, so pairing must use each referenced chart's own
		// #DLEVEL — identical metadata means that file is the row's chart.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL BASIC\n#L2FILE b.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
			'42/b.dtx': '#TITLE: Song\n#DLEVEL: 40\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		// Rows arrive in uploader (filename) order — a.dtx's row first.
		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 80 },
					{ label: 'Basic', level: 40 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/b.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('binds a duplicate-label row to its own missing file instead of stealing a higher-level one', async () => {
		// L2's chart is absent from R2, so its level is unprobable. The
		// level-40 row must still claim it (fileUrl null) rather than
		// taking the level-80 row's existing a.dtx and leaving that row
		// wrongly chart-less.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL BASIC\n#L2FILE b.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 80 },
					{ label: 'Basic', level: 40 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 40,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('pairs duplicate-label rows correctly when a directory placeholder leaves one ref', async () => {
		// SET.def's L1 slot is a directory placeholder (`./`) that
		// normalizes away, leaving a single ref shared by two BASIC rows.
		// Probing the lone ref's #DLEVEL proves it belongs to the level-80
		// row; the level-40 row must fall through to the unreferenced
		// basic.dtx instead of claiming hard.dtx and forcing a swap.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./\n#L2LABEL BASIC\n#L2FILE hard.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
			'42/hard.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/hard.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 40 },
					{ label: 'Basic', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// The probe is a bounded header read, not a full-body download —
		// it asks for one byte past the window to detect EOF.
		expect(bucket.get).toHaveBeenCalledWith('42/hard.dtx', {
			range: { offset: 0, length: 16385 }
		});
		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/hard.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps slot-order claiming when probed levels match no row in the label', async () => {
		// Fixture files whose embedded #DLEVEL agrees with no stored row
		// level still carry the SET.def label→file binding — a mismatch
		// against every row means the file's header disagrees with the
		// upload metadata, not that the file belongs elsewhere. Only a
		// probed level equal to a DIFFERENT row's level disqualifies.
		// L-slot order deliberately runs against alphabetical filename
		// order so the assertions cannot pass on a sorted implementation.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE z.dtx\n#L2LABEL BASIC\n#L2FILE a.dtx\n',
			'42/z.dtx': '#TITLE: Song\n#DLEVEL: 5\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 5\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/z.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 40 },
					{ label: 'Basic', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/z.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it.each([
		['fraction with colon', '#DLEVEL: 4.5', 4.5],
		['whitespace separator', '#DLEVEL 60', 60]
	])(
		'pairs same-label charts whose #DLEVEL uses %s over an earlier nonmatching slot',
		async (_desc, directive, rowLevel) => {
			// Place a nonmatching rated file in L1 before the matching file in L2:
			// if the probe fails to parse either #DLEVEL syntax, non-exact claim
			// falls back to slot order and picks L1 instead of L2.
			const chartBodies: Record<string, string> = {
				'42/set.def':
					'#L1LABEL BASIC\n#L1FILE other.dtx\n#L2LABEL BASIC\n#L2FILE match.dtx\n',
				'42/other.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/match.dtx': `#TITLE: Song\n${directive}\n`
			};
			const bucket = {
				...makeBucket([
					[
						{ key: '42/set.def', size: 90, uploaded: new Date() },
						{ key: '42/other.dtx', size: 300, uploaded: new Date() },
						{ key: '42/match.dtx', size: 500, uploaded: new Date() }
					]
				]),
				get: vi.fn(async (key: string) => ({
					arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
				}))
			} as unknown as R2Bucket;

			const discovery = await discoverCatalogFiles(
				bucket,
				{
					simfileId: 42,
					dtxFiles: [{ label: 'Basic', level: rowLevel }],
					publicBaseUrl: 'https://cdn.example.test'
				},
				silentLogger
			);

			expect(discovery.charts).toEqual([
				{
					label: 'Basic',
					level: rowLevel,
					fileUrl: 'https://cdn.example.test/42/match.dtx',
					fileSizeBytes: 500,
					fileEncoding: 'SHIFT_JIS'
				}
			]);
		}
	);

	it('does not let a zero-rated set.def file displace an unlisted rated chart', async () => {
		// parse_dtx_folder skips #DLEVEL 0 files, so no row owns the
		// placeholder. The non-exact claim must leave it reserved rather
		// than bind it over the row's real (unlisted) file.
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE placeholder.dtx\n#L2LABEL BASIC\n#L2FILE hard.dtx\n',
			'42/placeholder.dtx': '#TITLE: Song\n#DLEVEL: 0\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
			'42/hard.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/hard.dtx', size: 500, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 100, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 40 },
					{ label: 'BASIC', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/hard.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('probes a one-row/one-ref label when an unlisted chart can supply the row', async () => {
		// set.def names placeholder.dtx for the only BASIC slot, but the
		// file is #DLEVEL 0 — parse_dtx_folder skipped it and cataloged
		// the unlisted basic.dtx under the stem label instead. The
		// one-row/one-ref skip treats the group as deterministic, so the
		// row claims the placeholder and suppresses the fallback that
		// holds its real chart. The probe must still run so a zero level
		// can disqualify the ref.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE placeholder.dtx\n',
			'42/placeholder.dtx': '#TITLE: Song\n#DLEVEL: 0\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 100, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('disqualifies a one-row/one-ref placeholder whose header omits #DLEVEL', async () => {
		// Same one-row/one-ref layout as the zero-rated test, but the
		// placeholder's complete read finds no #DLEVEL at all. That is a
		// proven unrated chart — not an unprobed one — so it must be
		// disqualified like an explicit `#DLEVEL 0` instead of staying
		// eligible to claim the row over the unlisted real chart.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE placeholder.dtx\n',
			'42/placeholder.dtx': '#TITLE: Song\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 100, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('binds unclaimed rows to unlisted charts by filename stem when level and name orders disagree', async () => {
		// The placeholder's #DLEVEL 0 disqualifies the only SET.def ref,
		// leaving both rows unclaimed. The uploader cataloged the unlisted
		// files under their filename stems, so a unique stem match is the
		// row's own chart — the positional fallback would pair level-sorted
		// rows with name-sorted keys and swap the previews because
		// advanced.dtx sorts before basic.dtx.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE placeholder.dtx\n',
			'42/placeholder.dtx': '#TITLE: Song\n#DLEVEL: 0\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 30\n',
			'42/advanced.dtx': '#TITLE: Song\n#DLEVEL: 50\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/advanced.dtx', size: 500, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 100, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'ADVANCED', level: 50 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'ADVANCED',
				level: 50,
				fileUrl: 'https://cdn.example.test/42/advanced.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('treats a probe-window-truncated #DLEVEL line as unprobed', async () => {
		// a.dtx's header is cut mid-value at the 16 KiB window end:
		// '#DLEVEL: 45' of a full '455' reads as level 4.50 — row-45's
		// level — so the truncated probe would disqualify a.dtx for its
		// own row and let row-45 steal it. Dropping the partial line
		// leaves a.dtx unprobed so slot order keeps each row's file.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL BASIC\n#L2FILE b.dtx\n',
			'42/a.dtx': `${'#TITLE: ' + 'x'.repeat(16365)}\n#DLEVEL: 455\n#BPM: 120\n`,
			'42/b.dtx': '#TITLE: Song\n#DLEVEL: 450\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 16397, uploaded: new Date() },
					{ key: '42/b.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return { arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer) };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 40 },
					{ label: 'BASIC', level: 45 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 16397,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 45,
				fileUrl: 'https://cdn.example.test/42/b.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('binds a leftover set.def ref to an unclaimed row by filename stem', async () => {
		// The desktop keys its SET.def label lookup by the raw #LxFILE
		// value, so './solo.dtx' misses the actual filename 'solo.dtx' and
		// the row stores the stem label SOLO. The API normalizes the
		// prefix away, so the ref resolves but no row owns label BASIC —
		// reserving the object hid the row's own chart from preview.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('leaves a leftover stem object available when its rating names another row', async () => {
		// SET.def names basic.dtx only under EXTRA, so no row exact-claims it.
		// The file stem names Basic/30, but its header rates 80 — Expert's
		// level — while 01.dtx rates 30. The stem heuristic must not consume
		// Expert's exact-rated chart before exact matching runs.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXTRA\n#L1FILE ./basic.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
			'42/01.dtx': '#TITLE: Song\n#DLEVEL: 30\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers the root chart when a leftover rating also matches another row', async () => {
		// Both rows rate 60 and the nested EXTRA ref's chart also rates 60.
		// That shared rating is not evidence that the nested copy belongs to
		// the other row: Basic must keep its own root basic.dtx instead of
		// previewing the alternate copy, which sorts first.
		const chartBodies: Record<string, string> = {
			'42/assets/set.def': '#L1LABEL EXTRA\n#L1FILE basic.dtx\n',
			'42/assets/basic.dtx': '#TITLE: Alternate\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/assets/set.def', size: 60, uploaded: new Date() },
					{ key: '42/assets/basic.dtx', size: 200, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() },
					{ key: '42/expert.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Expert', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/expert.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps a leftover set.def ref reserved when its stem matches multiple rows', async () => {
		// Two unclaimed rows can share the stem label — the leftover
		// object could belong to either, so reserving it beats guessing.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 40 },
					{ label: 'SOLO', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 40,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'SOLO',
				level: 80,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps a nested leftover ref reserved when a top-level chart shares its stem', async () => {
		// The uploader only catalogs top-level .dtx files, so a nested
		// leftover object that shares a row's stem is never that row's
		// chart — 42/extras/solo.dtx must not displace 42/solo.dtx. The
		// nested object stays reserved and the row binds its real file
		// through the sorted fallback.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXTRA\n#L1FILE extras/solo.dtx\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/extras/solo.dtx': '#TITLE: Extra\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('binds a leftover set.def ref beside a nested set.def by filename stem', async () => {
		const chartBodies: Record<string, string> = {
			'42/song/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/song/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 60, uploaded: new Date() },
					{ key: '42/song/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/song/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not bind a probed zero-level leftover ref by filename stem', async () => {
		// #L1LABEL BASIC shares the label with #L2LABEL BASIC, so levelProbes
		// reads both headers and records 0 for solo.dtx. parse_dtx_folder
		// skips #DLEVEL 0 files, so solo.dtx must stay reserved rather than
		// matching an unclaimed SOLO row by stem.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n#L2LABEL BASIC\n#L2FILE basic.dtx\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 0\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 40\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 100, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 40 },
					{ label: 'SOLO', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'SOLO',
				level: 60,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not bind a probed zero-level leftover ref beside a nested set.def', async () => {
		// Same ambiguous-label probe as the root-layout test, but the song
		// folder sits under 42/song/: the nested set.def's leftover
		// solo.dtx probes at #DLEVEL 0 and must stay reserved rather than
		// matching the unclaimed SOLO row by stem.
		const chartBodies: Record<string, string> = {
			'42/song/set.def':
				'#L1LABEL BASIC\n#L1FILE ./solo.dtx\n#L2LABEL BASIC\n#L2FILE basic.dtx\n',
			'42/song/solo.dtx': '#TITLE: Song\n#DLEVEL: 0\n',
			'42/song/basic.dtx': '#TITLE: Song\n#DLEVEL: 40\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 90, uploaded: new Date() },
					{ key: '42/song/solo.dtx', size: 100, uploaded: new Date() },
					{ key: '42/song/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 40 },
					{ label: 'SOLO', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 40,
				fileUrl: 'https://cdn.example.test/42/song/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'SOLO',
				level: 60,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers an unused root chart over a nested set.def sibling sharing its stem', async () => {
		// The only set.def is nested (42/extras/) and labels ./solo.dtx
		// EXTRA, so resolution finds 42/extras/solo.dtx first. The SOLO
		// row's real chart is the root 42/solo.dtx the uploader cataloged —
		// the nested copy must not steal the row, even though its #DLEVEL
		// 0 went unprobed (no EXTRA rows exist to trigger levelProbes).
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers a re-rated root chart over an unrated nested leftover for a level-zero row', async () => {
		// Legacy/manual rows can carry level 0, so an unrated nested leftover is
		// allowed to claim one by stem. When the same-stem root file was re-rated
		// in place, though, the root location is the row's original chart and the
		// nested copy must not displace it.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 0 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('leaves a re-rated root chart for the row its rating names', async () => {
		// The root same-stem file is not automatically the level-zero row's
		// re-rated replacement: when its probe exactly matches another catalog
		// row, that rating is stronger ownership evidence. The nested unrated
		// leftover remains the level-zero row's positional candidate while the
		// rated row claims the root file.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 0 },
					{ label: 'BASIC', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/extras/solo.dtx',
				fileSizeBytes: 200,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers a root chart when its stem and rating agree despite a shared row rating', async () => {
		// SOLO and BASIC share a rating, but the root file's stem and probe both
		// agree with the SOLO row. That agreement is stronger than the nested
		// extra's different rating, even though BASIC shares the root rating too.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 40\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/basic.dtx', size: 400, uploaded: new Date() },
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'BASIC', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps an unrated root chart available for another level-zero row', async () => {
		// The nested unrated leftover claims SOLO by stem. The unrated root file
		// cannot claim that row too, but a second level-zero row can still use it
		// as the remaining exact-level candidate. The root omits #DLEVEL entirely,
		// so its complete-read probe must surface null as normalized level zero.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 0 },
					{ label: 'BASIC', level: 0 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/extras/solo.dtx',
				fileSizeBytes: 200,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers an ordinary zero-level chart over a retained same-stem root copy', async () => {
		// The nested file claims SOLO by stem, leaving root solo.dtx as a
		// retained duplicate candidate for the second zero-level row. The
		// ordinary unrated standard.dtx is a better BASIC candidate than the
		// SOLO copy even though the copy sorts first.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n',
			'42/standard.dtx': '#TITLE: Basic\n#DLEVEL: 0\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/standard.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 0 },
					{ label: 'BASIC', level: 0 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/extras/solo.dtx',
				fileSizeBytes: 200,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'BASIC',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/standard.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});
	it('prefers a rated nested set.def sibling over an unrated root chart sharing its stem', async () => {
		// Same layout as the root-preference test with the ratings swapped:
		// the nested sibling of the leftover ref carries #DLEVEL 60, while
		// the root same-stem copy probes #DLEVEL 0. parse_dtx_folder skips
		// unrated charts, so the root copy can never be a row's source —
		// the set.def sibling keeps the claim. The unclaimed ZEN row still
		// needs the sorted fallback, and the zero-probed root must not be
		// in it: 42/solo.dtx sorts before 42/zen.dtx, so a leaked unrated
		// root would bind ZEN to a chart no row can own.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/zen.dtx': '#TITLE: Zen\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/zen.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'ZEN', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/extras/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'ZEN',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/zen.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps a root chart whose header omits #DLEVEL out of the sorted fallback', async () => {
		// Same layout as the zero-rated root test, but the root same-stem
		// copy carries no #DLEVEL at all. parse_dtx_folder only catalogs
		// charts whose level parses non-zero, so an unrated copy — absent
		// directive or explicit 0 — can never be a row's source. It still
		// sorts before 42/zen.dtx and would bind the ZEN row if it leaked
		// into the fallback pool.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/solo.dtx': '#TITLE: Copy\n',
			'42/zen.dtx': '#TITLE: Zen\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 200, uploaded: new Date() },
					{ key: '42/zen.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'ZEN', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/extras/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'ZEN',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/zen.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers a rated UTF-16BE root chart over a nested set.def sibling sharing its stem', async () => {
		// Same layout as the root-preference test, but the root same-stem
		// copy is UTF-16BE — an encoding the desktop uploader's decode_bom
		// catalogs (songs.rs decode_bom handles FE FF). A probe that reads
		// it as UTF-8 finds no #DLEVEL and misjudges the chart as unrated:
		// the nested sibling then steals the SOLO row and the rated root
		// copy is dropped from the sorted fallback.
		const chartBodies: Record<string, string> = {
			'42/extras/set.def': '#L1LABEL EXTRA\n#L1FILE ./solo.dtx\n',
			'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/zen.dtx': '#TITLE: Zen\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/set.def', size: 60, uploaded: new Date() },
					{ key: '42/extras/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 400, uploaded: new Date() },
					{ key: '42/zen.dtx', size: 200, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () =>
					key === '42/solo.dtx'
						? encodeUtf16BeWithBom(chartBodies[key] ?? '')
						: encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'ZEN', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'ZEN',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/zen.dtx',
				fileSizeBytes: 200,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('prefers a root chart whose #DLEVEL sits beyond the probe window over a nested set.def sibling', async () => {
		// Same root-vs-nested stem layout as the root-preference tests,
		// but the root chart's #DLEVEL sits past the 16-KiB probe window
		// behind a long header. A bounded probe sees no level and
		// misjudges the chart as unrated — reserving the row's real chart
		// and letting the nested sibling steal the claim. Only a complete
		// read can prove "no #DLEVEL anywhere".
		const chartBodies: Record<string, string> = {
			'42/song/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/song/solo.dtx': '#TITLE: Copy\n#DLEVEL: 0\n',
			'42/solo.dtx': `#TITLE: Song\n#COMMENT ${'x'.repeat(16400)}\n#DLEVEL: 60\n`
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 60, uploaded: new Date() },
					{ key: '42/song/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 17000, uploaded: new Date() }
				]
			]),
			get: vi.fn(
				async (key: string, options?: { range?: { offset: number; length: number } }) => {
					const full = encodeToBuffer(chartBodies[key] ?? '');
					const range = options?.range;
					return {
						arrayBuffer: async () =>
							range ? full.slice(range.offset, range.offset + range.length) : full
					};
				}
			)
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// The ambiguous root candidate gets the deep bounded read that
		// reaches past the 16-KiB pairing window to its #DLEVEL.
		expect(bucket.get).toHaveBeenCalledWith('42/solo.dtx', {
			range: { offset: 0, length: 1024 * 1024 + 1 }
		});
		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/solo.dtx',
				fileSizeBytes: 17000,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('never buffers a multi-MiB root stem-claim candidate whole', async () => {
		// Same root-vs-nested layout, but the root chart is 1.5 MiB and its
		// #DLEVEL sits past the deep window: the probe reports unprobed
		// rather than downloading the whole object, so the nested sibling
		// keeps the row while the unprobed root stays reserved — nothing
		// proves it is not the row's real chart.
		const rootBody = `#TITLE: Song\n#COMMENT ${'x'.repeat(1530000)}\n#DLEVEL: 60\n`;
		const chartBodies: Record<string, string> = {
			'42/song/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/song/solo.dtx': '#TITLE: Copy\n#DLEVEL: 60\n',
			'42/solo.dtx': rootBody
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 60, uploaded: new Date() },
					{ key: '42/song/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: rootBody.length, uploaded: new Date() }
				]
			]),
			get: vi.fn(
				async (key: string, options?: { range?: { offset: number; length: number } }) => {
					const full = encodeToBuffer(chartBodies[key] ?? '');
					const range = options?.range;
					return {
						arrayBuffer: async () =>
							range ? full.slice(range.offset, range.offset + range.length) : full
					};
				}
			)
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		// The read stays bounded by the deep window even though the object
		// is larger — no unbounded get() of an owner-uploaded file.
		expect(vi.mocked(bucket.get)).toHaveBeenCalledWith('42/solo.dtx', {
			range: { offset: 0, length: 1024 * 1024 + 1 }
		});
		expect(vi.mocked(bucket.get)).not.toHaveBeenCalledWith('42/solo.dtx');
		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/song/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps an unprobed root stem-claim candidate out of the sorted fallback', async () => {
		// Same long-header layout as the multi-MiB test plus an unrelated
		// ZEN row. The root chart outgrows the deep window, so nothing is
		// proven: the nested sibling keeps the SOLO claim, but the root
		// must stay reserved — 42/solo.dtx sorts before 42/zen.dtx, so a
		// leaked candidate would bind the ZEN row to the wrong chart.
		const rootBody = `#TITLE: Song\n#COMMENT ${'x'.repeat(1530000)}\n#DLEVEL: 60\n`;
		const chartBodies: Record<string, string> = {
			'42/song/set.def': '#L1LABEL BASIC\n#L1FILE ./solo.dtx\n',
			'42/song/solo.dtx': '#TITLE: Copy\n#DLEVEL: 60\n',
			'42/solo.dtx': rootBody,
			'42/zen.dtx': '#TITLE: Zen\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/song/set.def', size: 60, uploaded: new Date() },
					{ key: '42/song/solo.dtx', size: 300, uploaded: new Date() },
					{ key: '42/solo.dtx', size: rootBody.length, uploaded: new Date() },
					{ key: '42/zen.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(
				async (key: string, options?: { range?: { offset: number; length: number } }) => {
					const full = encodeToBuffer(chartBodies[key] ?? '');
					const range = options?.range;
					return {
						arrayBuffer: async () =>
							range ? full.slice(range.offset, range.offset + range.length) : full
					};
				}
			)
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'ZEN', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/song/solo.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'ZEN',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/zen.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps a set.def claim when a blank #DLEVEL precedes the rating', async () => {
		// parse_dtx_metadata keeps scanning for the first parseable
		// #DLEVEL — a blank directive leaves the level unset rather than
		// making the chart unrated. A probe that stops at the blank
		// directive reports unrated, disqualifies the ref, and the
		// fallback hands the row an unlisted chart instead.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE chart01.dtx\n',
			'42/chart01.dtx': '#TITLE: Song\n#DLEVEL:\n#DLEVEL: 60\n',
			'42/advanced.dtx': '#TITLE: Song\n#DLEVEL: 85\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/advanced.dtx', size: 500, uploaded: new Date() },
					{ key: '42/chart01.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/chart01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('honours an indented set.def directive like the uploader does', async () => {
		// parse_set_def_labels trims each line before matching, so the
		// uploader applied this indented #L1 mapping when it cataloged
		// the BASIC row. Dropping the mapping leaves the row to the
		// stem/fallback paths, which bound the unrated basic.dtx instead
		// of the chart the SET.def named.
		const chartBodies: Record<string, string> = {
			'42/set.def': '  #L1LABEL BASIC\n\t#L1FILE a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 0\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/a.dtx', size: 500, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not let a confirmed unrated same-stem file claim the row', async () => {
		// A unique stem match is only a name hint: basic.dtx probes as
		// #DLEVEL 0 — parse_dtx_folder never catalogs unrated charts, so
		// it cannot be the row's source. It must stay reserved rather than
		// claim the row or be bound to it by the sorted fallback.
		const chartBodies: Record<string, string> = {
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 0\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/a.dtx', size: 500, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('orders sorted-fallback rows on the normalized level scale', async () => {
		// Raw row levels mix encodings: 450 decodes to 4.50 while 60
		// decodes to 6.00, so NOVICE is the easier row. Sorting on the raw
		// value (60 < 450) hands EXPERT the first key and swaps the
		// previews; the normalized scale keeps the intended pairing.
		const bucket = makeBucket([
			[
				{ key: '42/a-easy.dtx', size: 300, uploaded: new Date() },
				{ key: '42/b-hard.dtx', size: 500, uploaded: new Date() }
			]
		]);

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'NOVICE', level: 450 },
					{ label: 'EXPERT', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'NOVICE',
				level: 450,
				fileUrl: 'https://cdn.example.test/42/a-easy.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'EXPERT',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/b-hard.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	describe('e2e mixed-set.def fixture', () => {
		// The committed e2e fixture (packages/e2e-web/fixtures/mixed-set.def)
		// backs the chart-1004 catalog-pairing spec. It must stay valid
		// SET.def for the shared parser — mixed colon/whitespace directive
		// forms, a duplicate label, an >L5 slot and a subdirectory file.
		const fixtureText = readFileSync(
			join(
				__dirname,
				'..',
				'..',
				'..',
				'..',
				'packages',
				'e2e-web',
				'fixtures',
				'mixed-set.def'
			),
			'utf-8'
		);

		it('parses through the shared parser to the seeded label/file pairs', () => {
			expect(parseSetDef(fixtureText)).toEqual({
				title: 'E2E Mixed Set',
				levels: [
					{ level: 1, label: 'Basic Easy', fileName: 'basic.dtx' },
					{ level: 2, label: 'Basic Multi', fileName: 'maniac.dtx' },
					{ level: 3, label: 'Basic Multi', fileName: 'extra.dtx' },
					{ level: 6, label: 'Extreme L6', fileName: 'sub/lead.dtx' }
				]
			});
		});

		it('pairs seeded duplicate-label rows by level with the fixture slots', async () => {
			// The decoy key sorts first alphabetically: if set.def matching
			// silently failed, the sorted-key fallback would hand it to the
			// first row instead of leaving it unused — making this test fail
			// rather than pass by coincidence.
			const chartBodies: Record<string, string> = {
				'1004/set.def': fixtureText,
				'1004/aaa-decoy.dtx': '#TITLE: Decoy\n#DLEVEL: 40\n',
				'1004/basic.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
				'1004/extra.dtx': '#TITLE: Song\n#DLEVEL: 50\n',
				'1004/maniac.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'1004/sub/lead.dtx': '#TITLE: Song\n#DLEVEL: 85\n'
			};
			const bucket = {
				...makeBucket([
					[
						{ key: '1004/set.def', size: 90, uploaded: new Date() },
						{ key: '1004/aaa-decoy.dtx', size: 50, uploaded: new Date() },
						{ key: '1004/basic.dtx', size: 300, uploaded: new Date() },
						{ key: '1004/extra.dtx', size: 500, uploaded: new Date() },
						{ key: '1004/maniac.dtx', size: 700, uploaded: new Date() },
						{ key: '1004/sub/lead.dtx', size: 900, uploaded: new Date() }
					]
				]),
				get: vi.fn(async (key: string) => ({
					arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
				}))
			} as unknown as R2Bucket;

			// Seeded insert order (seed.sql chart 1004): the level-60 'Basic
			// Multi' row precedes the level-50 row, so row order disagrees
			// with slot order. Claiming by level still binds L2 -> level 50
			// and L3 -> level 60.
			const discovery = await discoverCatalogFiles(
				bucket,
				{
					simfileId: 1004,
					dtxFiles: [
						{ label: 'Basic Easy', level: 40 },
						{ label: 'Basic Multi', level: 60 },
						{ label: 'Basic Multi', level: 50 },
						{ label: 'Extreme L6', level: 85 }
					],
					publicBaseUrl: 'https://cdn.example.test'
				},
				silentLogger
			);

			expect(discovery.charts).toEqual([
				{
					label: 'Basic Easy',
					level: 40,
					fileUrl: 'https://cdn.example.test/1004/basic.dtx',
					fileSizeBytes: 300,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'Basic Multi',
					level: 60,
					fileUrl: 'https://cdn.example.test/1004/maniac.dtx',
					fileSizeBytes: 700,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'Basic Multi',
					level: 50,
					fileUrl: 'https://cdn.example.test/1004/extra.dtx',
					fileSizeBytes: 500,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'Extreme L6',
					level: 85,
					fileUrl: 'https://cdn.example.test/1004/sub/lead.dtx',
					fileSizeBytes: 900,
					fileEncoding: 'SHIFT_JIS'
				}
			]);
			expect(discovery.chartsPopulated).toBe(true);
		});

		it('compares duplicate-label rows on normalized level across raw encodings', async () => {
			// Raw #DLEVEL values mix two scales: 450 decodes to 4.50 while 60
			// decodes to 6.00, so the 450 row is the easier chart and must
			// claim the earlier L2 slot even though 60 < 450 numerically.
			// Use valid ratings (400, 70) that match neither row's raw rating so
			// exact-match claiming cannot bypass normalized sorting.
			const chartBodies: Record<string, string> = {
				'1004/set.def':
					'#L2LABEL Basic Multi\n#L2FILE extra.dtx\n#L3LABEL Basic Multi\n#L3FILE maniac.dtx\n',
				'1004/extra.dtx': '#TITLE: Song\n#DLEVEL: 400\n',
				'1004/maniac.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
			};
			const bucket = {
				...makeBucket([
					[
						{ key: '1004/set.def', size: 90, uploaded: new Date() },
						{ key: '1004/extra.dtx', size: 500, uploaded: new Date() },
						{ key: '1004/maniac.dtx', size: 700, uploaded: new Date() }
					]
				]),
				get: vi.fn(async (key: string) => ({
					arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
				}))
			} as unknown as R2Bucket;

			const discovery = await discoverCatalogFiles(
				bucket,
				{
					simfileId: 1004,
					dtxFiles: [
						{ label: 'Basic Multi', level: 450 },
						{ label: 'Basic Multi', level: 60 }
					],
					publicBaseUrl: 'https://cdn.example.test'
				},
				silentLogger
			);

			expect(discovery.charts).toEqual([
				{
					label: 'Basic Multi',
					level: 450,
					fileUrl: 'https://cdn.example.test/1004/extra.dtx',
					fileSizeBytes: 500,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'Basic Multi',
					level: 60,
					fileUrl: 'https://cdn.example.test/1004/maniac.dtx',
					fileSizeBytes: 700,
					fileEncoding: 'SHIFT_JIS'
				}
			]);
		});
	});

	it.each([
		['UTF-16LE', encodeUtf16LeNoBom],
		['UTF-16BE', encodeUtf16BeNoBom]
	])(
		'claims a BOM-less %s chart by filename stem when no set.def exists',
		async (_encodingName, encode) => {
			// The desktop decoder tries UTF-16 without a byte-order mark, so
			// such a chart is cataloged with a real rating. The header probe
			// must decode it the same way — reading it as UTF-8 mistakes the
			// NUL-interleaved bytes for a missing #DLEVEL and reserves the
			// object as "proven unrated", leaving the row unbound.
			const chartBody = encode('#TITLE: Song\n#DLEVEL: 60\n');
			const bucket = {
				...makeBucket([[{ key: '42/basic.dtx', size: 300, uploaded: new Date() }]]),
				get: vi.fn(async () => ({ arrayBuffer: async () => chartBody }))
			} as unknown as R2Bucket;

			const discovery = await discoverCatalogFiles(
				bucket,
				{
					simfileId: 42,
					dtxFiles: [{ label: 'Basic', level: 60 }],
					publicBaseUrl: 'https://cdn.example.test'
				},
				silentLogger
			);

			expect(discovery.charts).toEqual([
				{
					label: 'Basic',
					level: 60,
					fileUrl: 'https://cdn.example.test/42/basic.dtx',
					fileSizeBytes: 300,
					fileEncoding: 'SHIFT_JIS'
				}
			]);
		}
	);

	it('pairs fallback rows by probed level when filename and rating orders disagree', async () => {
		// Numbered exports carry no difficulty signal in their names:
		// 01.dtx rates 6.00 (EXPERT) and 02.dtx rates 4.50 (NOVICE), so
		// filename order disagrees with normalized-rating order. Pairing
		// sorted rows with sorted keys would hand each difficulty the
		// other's chart — probe the headers and match on level instead.
		const chartBodies: Record<string, string> = {
			'42/01.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/02.dtx': '#TITLE: Song\n#DLEVEL: 450\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// Reversed from 01.dtx/02.dtx ratings so positional pairing
				// would assign the opposite file to each row.
				dtxFiles: [
					{ label: 'Novice', level: 450 },
					{ label: 'Expert', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Novice',
				level: 450,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('reserves a proven-unrated chart instead of binding it positionally', async () => {
		// 01.dtx is the EXPERT row's chart via set.def. 02.dtx is a complete
		// read with no #DLEVEL — provably unrated, so it can never be a
		// row's source and must be reserved: if it leaked into the
		// positional pairing it would bind the NOVICE row ahead of the
		// unprobed 03.dtx.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXPERT\n#L1FILE 01.dtx\n',
			'42/01.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/02.dtx': '#TITLE: Song\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() },
					{ key: '42/03.dtx', size: 400, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => {
				if (key === '42/03.dtx') throw new Error('transient R2 error');
				return { arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '') };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// A second row no set.def slot names: it reaches the
				// fallback and pairs with 03.dtx, the only unprobed key.
				dtxFiles: [
					{ label: 'Expert', level: 60 },
					{ label: 'Novice', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Expert',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Novice',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/03.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('binds a level-zero row to a chart that probes as zero or unrated', async () => {
		for (const body of ['#TITLE: Song\n#DLEVEL: 0\n', '#TITLE: Song\n']) {
			const bucket = {
				...makeBucket([[{ key: '42/basic.dtx', size: 300, uploaded: new Date() }]]),
				get: vi.fn(async () => ({ arrayBuffer: async () => encodeToBuffer(body) }))
			} as unknown as R2Bucket;

			const discovery = await discoverCatalogFiles(
				bucket,
				{
					simfileId: 42,
					dtxFiles: [{ label: 'basic', level: 0 }],
					publicBaseUrl: 'https://cdn.example.test'
				},
				silentLogger
			);

			expect(discovery.charts[0]).toEqual({
				label: 'basic',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			});
		}
	});

	it('reuses definitive chart level probes across requests for the same object identity', async () => {
		const object = {
			key: '99/basic.dtx',
			size: 300,
			uploaded: new Date('2026-01-01T00:00:00Z'),
			etag: 'etag-before'
		};
		const bucket = {
			...makeBucket([[object]]),
			get: vi.fn(async () => ({
				arrayBuffer: async () => encodeToBuffer('#TITLE: Song\n#DLEVEL: 60\n'),
				body: new ReadableStream(),
				etag: 'etag-before'
			}))
		} as unknown as R2Bucket;
		const options = {
			simfileId: 99,
			dtxFiles: [{ label: 'basic', level: 60 }],
			publicBaseUrl: 'https://cdn.example.test'
		};

		await discoverCatalogFiles(bucket, options, silentLogger);
		await discoverCatalogFiles(bucket, options, silentLogger);

		expect(bucket.get).toHaveBeenCalledTimes(1);
	});

	it('pairs remaining rows positionally in the uploader’s case-sensitive filename order', async () => {
		// Catalog rows arrive in files.sort() order — Rust's case-sensitive
		// path sort puts 'Expert.dtx' before 'basic.dtx'. Pairing that row
		// order with locale-collated keys ('basic.dtx' first) swaps the
		// previews. SET.def named the rows at catalog time but was not
		// uploaded, and the replacement charts' ratings match no row, so
		// nothing but the uploader's filename order can pair them.
		const chartBodies: Record<string, string> = {
			'42/Expert.dtx': '#TITLE: Song\n#DLEVEL: 85\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 35\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/Expert.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// Row insertion order reproduces the uploader's: Expert.dtx
				// was cataloged first (HARD), basic.dtx second (EASY).
				dtxFiles: [
					{ label: 'HARD', level: 80 },
					{ label: 'EASY', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'HARD',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/Expert.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'EASY',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('claims a re-rated chart by its filename stem when the rating names no row', async () => {
		// Replacement uploads keep filenames while their new #DLEVEL values
		// identify no catalog row — the stem match is still each row's own
		// file. Rejecting it leaves Basic to bind Zeta.dtx positionally:
		// 'Zeta.dtx' sorts between 'Expert.dtx' and 'basic.dtx' under the
		// uploader's case-sensitive order.
		const chartBodies: Record<string, string> = {
			'42/Expert.dtx': '#TITLE: Song\n#DLEVEL: 85\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 35\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/Expert.dtx', size: 300, uploaded: new Date() },
					{ key: '42/Zeta.dtx', size: 200, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => {
				if (key === '42/Zeta.dtx') throw new Error('transient R2 error');
				return { arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '') };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Expert', level: 80 },
					{ label: 'Basic', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/Expert.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('settles raw filename claims before competing aliases take their keys', async () => {
		// Two BASIC rows own a.dtx and b.dtx by the uploader's raw-filename
		// label lookup. OTHER only aliases a.dtx through SET.def while its real
		// chart is the unlisted other.dtx; the alias must not win merely because
		// it is the more constrained exact candidate.
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL BASIC\n#L2FILE b.dtx\n#L3LABEL OTHER\n#L3FILE ./a.dtx\n',
			'42/a.dtx': '#TITLE: A\n#DLEVEL: 60\n',
			'42/b.dtx': '#TITLE: B\n#DLEVEL: 60\n',
			'42/other.dtx': '#TITLE: Other\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 120, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b.dtx', size: 400, uploaded: new Date() },
					{ key: '42/other.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 60 },
					{ label: 'BASIC', level: 60 },
					{ label: 'OTHER', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		const urls = discovery.charts.map((chart) => chart.fileUrl);
		expect(urls.slice(0, 2).sort()).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/b.dtx'
		]);
		expect(urls[2]).toBe('https://cdn.example.test/42/other.dtx');
	});

	it('lets a row use an aliased chart after the other label exact-claims a different file', async () => {
		// SET.def names BASIC a.dtx, EXPERT b.dtx, then a second EXPERT
		// alias ./a.dtx. Re-uploading a.dtx at EXPERT's rating makes
		// BASIC's reference look like another label's chart, but EXPERT
		// exact-claims b.dtx — the unused alias must not reserve a.dtx
		// away from BASIC, which would leave BASIC without a preview.
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL EXPERT\n#L2FILE b.dtx\n#L3LABEL EXPERT\n#L3FILE ./a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
			'42/b.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 120, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'EXPERT', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'EXPERT',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/b.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('shares one header read between labels that alias the same chart', async () => {
		// BASIC a.dtx and EXPERT ./a.dtx resolve to one R2 object. Both
		// labels are ambiguous, but the header proves the same rating for
		// both refs — the second label must not spend another R2 GET.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL EXPERT\n#L2FILE ./a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 30\n'
		};
		const get = vi.fn(async (key: string) => ({
			arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
		}));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get
		} as unknown as R2Bucket;

		await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'EXPERT', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(get.mock.calls.filter(([key]) => key === '42/a.dtx')).toHaveLength(1);
	});

	it('reads chart header probes conditionally on the listed object etag', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE basic.dtx\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 30\n',
			'42/other.dtx': '#TITLE: Other\n#DLEVEL: 30\n'
		};
		const get = vi.fn(async (key: string) => ({
			arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? ''),
			body: new ReadableStream(),
			etag: 'listed-etag',
			size: 32
		}));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 60, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 300, uploaded: new Date(), etag: 'listed-etag' },
					{ key: '42/other.dtx', size: 300, uploaded: new Date(), etag: 'other-etag' }
				]
			]),
			get
		} as unknown as R2Bucket;

		await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 30 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(get).toHaveBeenCalledWith(
			'42/basic.dtx',
			expect.objectContaining({
				onlyIf: { etagMatches: 'listed-etag' },
				range: expect.objectContaining({ offset: 0 })
			})
		);
	});

	it('re-probes after a failed R2 precondition instead of caching the unprobed result', async () => {
		// A failed onlyIf returns object metadata without a body. That read
		// proves nothing about the chart, so it must stay out of the shared
		// probe cache and the next discovery must ask R2 again. The row label
		// does not match the filename stem, so only the pairing probe runs.
		const object = {
			key: '42/chart1.dtx',
			size: 300,
			uploaded: new Date('2026-01-01T00:00:00Z'),
			etag: 'listed-etag'
		};
		const get = vi.fn(async () => ({ etag: 'listed-etag', size: object.size }));
		const bucket = {
			// Both discoveries must see the same listing so the second one
			// reaches the probe cache.
			list: vi.fn(async () => ({ objects: [object], truncated: false, cursor: undefined })),
			get
		} as unknown as R2Bucket;
		const options = {
			simfileId: 42,
			dtxFiles: [{ label: 'BASIC', level: 30 }],
			publicBaseUrl: 'https://cdn.example.test'
		};

		await discoverCatalogFiles(bucket, options, silentLogger);
		await discoverCatalogFiles(bucket, options, silentLogger);

		expect(get).toHaveBeenCalledTimes(2);
	});

	it('keeps filename order among probed and unprobed keys for equal-rated rows', async () => {
		// Both rows rate 6.00. 01.dtx's #DLEVEL sits beyond the 16 KiB
		// probe window so it stays unprobed; 02.dtx probes 60. The first
		// row consuming the probed key leaves 01.dtx to bind the second
		// row positionally — a swap. Equal-rated rows are
		// indistinguishable by rating, so each takes the earliest
		// still-plausible key in uploader filename order instead.
		const chartBodies: Record<string, string> = {
			'42/01.dtx': `${'#TITLE: ' + 'x'.repeat(16390)}\n#DLEVEL: 60\n`,
			'42/02.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 16420, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return { arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer) };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// Uploader order: 01.dtx cataloged first as Basic, 02.dtx
				// second as Expert — both rated 6.00 (raw 60).
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Expert', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 16420,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('pairs positional fallback charts in code-point order for supplementary filenames', async () => {
		// Rust's path sort orders 'Ａ.dtx' (U+FF21) before '𠀀.dtx'
		// (U+20000) by code point. JavaScript's code-unit comparison
		// inverts them — the supplementary character's leading surrogate
		// (0xD840) sorts below any BMP unit above it — so equal-rated or
		// positional pairing on code-unit order swaps the charts.
		const chartBodies: Record<string, string> = {
			'42/Ａ.dtx': '#TITLE: Song\n#DLEVEL: 85\n',
			'42/𠀀.dtx': '#TITLE: Song\n#DLEVEL: 35\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/Ａ.dtx', size: 300, uploaded: new Date() },
					{ key: '42/𠀀.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// Uploader order: Ａ.dtx cataloged first (HARD), then
				// 𠀀.dtx (EASY). The re-rated probes name no row and no
				// SET.def exists, so only filename order can pair them.
				dtxFiles: [
					{ label: 'HARD', level: 80 },
					{ label: 'EASY', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'HARD',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/%EF%BC%A1.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'EASY',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/%F0%A0%80%80.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not let a re-rated stem claim displace an exact-rating match', async () => {
		// The local SET.def cataloged 01.dtx as Basic (30) and Basic.dtx as
		// Expert (80) — a row's label is not always its chart's filename
		// stem. R2 holds both charts but no SET.def, and Basic.dtx was
		// re-rated to 85: its probed rating names no row, so the stem
		// claim would bind it to the Basic row before 01.dtx's exact 30
		// rating can claim it — leaving Expert to take 01.dtx positionally.
		// Mismatched-rating stem claims must defer to exact-rating claims.
		const chartBodies: Record<string, string> = {
			'42/01.dtx': '#TITLE: Song\n#DLEVEL: 30\n',
			'42/Basic.dtx': '#TITLE: Song\n#DLEVEL: 85\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/Basic.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				// Uploader order: 01.dtx cataloged first as Basic, then
				// Basic.dtx as Expert.
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/Basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('reserves probed exact matches before giving unprobed keys to an equal-rated group', async () => {
		// Rows in uploader order: 01.dtx -> Expert (80), 02.dtx -> Basic
		// (60), 03.dtx -> Advanced (60). 01.dtx's #DLEVEL sits beyond the
		// probe window (unprobed); the two level-60 charts probe exactly.
		// The equal-rated group has enough exact matches, so the earlier
		// unprobed key is Expert's positional candidate — consuming it
		// for Basic leaves only displaced charts for the other rows.
		const chartBodies: Record<string, string> = {
			'42/01.dtx': `${'#TITLE: ' + 'x'.repeat(16390)}\n#DLEVEL: 80\n`,
			'42/02.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/03.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 16420, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() },
					{ key: '42/03.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return { arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer) };
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Expert', level: 80 },
					{ label: 'Basic', level: 60 },
					{ label: 'Advanced', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 16420,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/03.dtx',
				fileSizeBytes: 700,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('scopes rating-based fallback claims to catalog-eligible chart keys', async () => {
		// One BASIC row at 85. Its own top-level chart was re-rated to
		// 60 — the name survives while the stored level stays stale — and
		// a nested backup still carries 85. parse_dtx_folder catalogs
		// only top-level files, so a nested chart can never be a row's
		// chart: the rating claim must not let it displace the stem
		// match that the re-rated pass restores.
		const chartBodies: Record<string, string> = {
			'42/Basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/extras/backup.dtx': '#TITLE: Song\n#DLEVEL: 85\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/Basic.dtx', size: 500, uploaded: new Date() },
					{ key: '42/extras/backup.dtx', size: 700, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'basic', level: 85 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'basic',
				level: 85,
				fileUrl: 'https://cdn.example.test/42/Basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('keeps deeper-nested keys out of the positional fallback', async () => {
		// The EXPERT row's own chart was re-rated to 60 — the new rating
		// names no row, so the file stays a positional candidate. A nested
		// backup still carries 85 but is catalog-ineligible: the rating and
		// stem passes already refuse it, and the positional pairing must
		// too — '42/extras/' sorts before '42/z.dtx', so without the scope
		// the row binds the backup instead of its own re-rated file.
		const chartBodies: Record<string, string> = {
			'42/extras/backup.dtx': '#TITLE: Song\n#DLEVEL: 85\n',
			'42/z.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/backup.dtx', size: 200, uploaded: new Date() },
					{ key: '42/z.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'EXPERT', level: 85 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'EXPERT',
				level: 85,
				fileUrl: 'https://cdn.example.test/42/z.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('pairs a leftover row with its only nested chart', async () => {
		// Legacy nested layout: the song's only chart sits in a subfolder
		// and no set.def exists, so no object is catalog-eligible. With
		// the leftover objects matching the remaining rows one-to-one
		// there is no eligible chart to displace — the nested file is
		// the row's only possible source and must still serve the
		// preview.
		const get = vi.fn();
		const bucket = {
			...makeBucket([[{ key: '42/charts/basic.dtx', size: 500, uploaded: new Date() }]]),
			get
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 30 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/charts/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
		// A catalog-ineligible chart never claims a row by rating, so its
		// header is not worth a probe read.
		expect(get).not.toHaveBeenCalled();
	});

	it('skips header probes for catalog-ineligible charts', async () => {
		// The rating pass probes leftover objects for #DLEVEL, but a
		// deeper-nested key can never claim a row — reading its header
		// wastes an R2 GET. The eligible candidate is still probed.
		const get = vi.fn(async (key: string) => ({
			arrayBuffer: async () =>
				encodeToBuffer(
					key === '42/song.dtx'
						? '#TITLE: Song\n#DLEVEL: 30\n'
						: '#TITLE: B\n#DLEVEL: 85\n'
				)
		}));
		const bucket = {
			...makeBucket([
				[
					{ key: '42/extras/backup.dtx', size: 200, uploaded: new Date() },
					{ key: '42/song.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get
		} as unknown as R2Bucket;

		await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 30 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(get).toHaveBeenCalledWith('42/song.dtx', expect.anything());
		expect(get.mock.calls.some(([calledKey]) => calledKey === '42/extras/backup.dtx')).toBe(
			false
		);
	});

	it('keeps a 16385-byte chart ending in #DLEVEL 0 without trailing newline as unrated (EOF)', async () => {
		const prefix = '#TITLE: ' + 'x'.repeat(16367) + '\n#DLEVEL 0'; // exact 16385 bytes, no trailing newline
		expect(prefix.length).toBe(16385);
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 80, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 16385, uploaded: new Date() },
					{ key: '42/real.dtx', size: 200, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => {
				const text =
					key === '42/set.def'
						? '#L1LABEL BASIC\n#L1FILE placeholder.dtx\n'
						: key === '42/placeholder.dtx'
							? prefix
							: '#TITLE: Real\n#DLEVEL: 45\n';
				const buf = encodeToBuffer(text);
				return {
					size: buf.byteLength,
					arrayBuffer: async () => buf
				};
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 45 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts[0]?.fileUrl).toBe('https://cdn.example.test/42/real.dtx');
	});

	it('prevents two SET.def rows from claiming the same resolved R2 chart', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL EXPERT\n#L2FILE ./a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 30\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 80, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'EXPERT', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'BASIC',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'EXPERT',
				level: 80,
				fileUrl: null,
				fileSizeBytes: null,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('probes leftover SET.def references so an unrated leftover cannot claim a row by stem', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXTRA\n#L1FILE solo.dtx\n',
			'42/solo.dtx': '#TITLE: Unrated Solo\n',
			'42/a.dtx': '#TITLE: Real Solo\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 80, uploaded: new Date() },
					{ key: '42/a.dtx', size: 400, uploaded: new Date() },
					{ key: '42/solo.dtx', size: 200, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'SOLO',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not fill an equal-rated shortage with an unprobed key belonging to another row position', async () => {
		// Uploader order: 01.dtx -> Expert (80), 02.dtx -> Basic (60), 03.dtx -> Advanced (60).
		// Both 01.dtx and 03.dtx are truncated before #DLEVEL (unprobed); 02.dtx probes 60.
		// The level-60 group has a one-exact shortage, so it must fill with 03.dtx (pos 2)
		// rather than stealing 01.dtx (pos 0, Expert's file).
		const chartBodies: Record<string, string> = {
			'42/01.dtx': `${'#TITLE: ' + 'x'.repeat(16390)}\n#DLEVEL: 80\n`,
			'42/02.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
			'42/03.dtx': `${'#TITLE: ' + 'x'.repeat(16390)}\n#DLEVEL: 60\n`
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 16420, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() },
					{ key: '42/03.dtx', size: 16420, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return {
					size: buffer.byteLength,
					arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer)
				};
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Expert', level: 80 },
					{ label: 'Basic', level: 60 },
					{ label: 'Advanced', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 16420,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/03.dtx',
				fileSizeBytes: 16420,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not let a lower-rated row steal a shared alias from the exact-rated row', async () => {
		// Reproduced from PR #365 review: SET.def names the same chart
		// twice through different spellings — `./a.dtx` for BASIC and
		// `a.dtx` for EXPERT — which resolve to one R2 object. The
		// uploader's literal lookup gives a.dtx to EXPERT and catalogs
		// the unlisted basic.dtx under its stem. Processing lower-rated
		// rows first lets BASIC's non-exact claim take the shared key
		// before EXPERT's exact claim runs, then positional pairing
		// hands EXPERT the wrong chart.
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE ./a.dtx\n#L2LABEL EXPERT\n#L2FILE a.dtx\n',
			'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 30\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return {
					size: buffer.byteLength,
					arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer)
				};
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 30,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('probes a sole reference when another SET.def label with no DB rows can own the row', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL BASIC\n#L1FILE placeholder.dtx\n#L2LABEL EXTRA\n#L2FILE ./basic.dtx\n',
			'42/placeholder.dtx': '#TITLE: Empty\n#DLEVEL: 0\n',
			'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 50\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 500, uploaded: new Date() },
					{ key: '42/placeholder.dtx', size: 100, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 50 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 50,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('breaks equal-rating exact SET.def ties in uploader filename order', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL BASIC\n#L1FILE z.dtx\n#L2LABEL BASIC\n#L2FILE a.dtx\n',
			'42/a.dtx': '#TITLE: Song A\n#DLEVEL: 60\n',
			'42/z.dtx': '#TITLE: Song Z\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/z.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Basic', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/z.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('coordinates exact claims so shared references preserve distinct matches', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def':
				'#L1LABEL A\n#L1FILE 01.dtx\n#L2LABEL A\n#L2FILE 02.dtx\n#L3LABEL B\n#L3FILE ./01.dtx\n',
			'42/01.dtx': '#TITLE: Chart 1\n#DLEVEL: 60\n',
			'42/02.dtx': '#TITLE: Chart 2\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 90, uploaded: new Date() },
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/02.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 60 },
					{ label: 'B', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'A',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'B',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('preserves raw-filename ownership when distinct equal-rated labels share cross-label aliases', async () => {
		// Desktop uploader matches raw filenames: A -> a.dtx, B -> b.dtx, C -> c.dtx.
		// Ranking by contender count alone lets A take ./b.dtx (1 contender) over
		// a.dtx (2 contenders), swapping A and B.
		const chartBodies: Record<string, string> = {
			'42/set.def': [
				'#L1LABEL A',
				'#L1FILE a.dtx',
				'#L2LABEL A',
				'#L2FILE ./b.dtx',
				'#L3LABEL B',
				'#L3FILE b.dtx',
				'#L4LABEL B',
				'#L4FILE ./a.dtx',
				'#L5LABEL C',
				'#L5FILE c.dtx',
				'#L6LABEL C',
				'#L6FILE ./a.dtx'
			].join('\n'),
			'42/a.dtx': '#TITLE: Chart A\n#DLEVEL: 60\n',
			'42/b.dtx': '#TITLE: Chart B\n#DLEVEL: 60\n',
			'42/c.dtx': '#TITLE: Chart C\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 160, uploaded: new Date() },
					{ key: '42/a.dtx', size: 300, uploaded: new Date() },
					{ key: '42/b.dtx', size: 400, uploaded: new Date() },
					{ key: '42/c.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 60 },
					{ label: 'B', level: 60 },
					{ label: 'C', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'A',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/a.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'B',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/b.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'C',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/c.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('preserves row positions when a deferred equal-rated fallback group remains short', async () => {
		const oversizedHeader = `#TITLE: Big\n#COMMENT: ${'x'.repeat(20000)}\n#DLEVEL: 80\n`;
		const chartBodies: Record<string, string> = {
			'42/01.dtx': '#TITLE: Basic Re-rated\n#DLEVEL: 70\n',
			'42/02.dtx': oversizedHeader,
			'42/03.dtx': '#TITLE: Advanced\n#DLEVEL: 60\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/01.dtx', size: 300, uploaded: new Date() },
					{ key: '42/02.dtx', size: oversizedHeader.length, uploaded: new Date() },
					{ key: '42/03.dtx', size: 500, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string, options?: { range?: { length?: number } }) => {
				const buffer = encodeToBuffer(chartBodies[key] ?? '');
				const length = options?.range?.length;
				return {
					size: buffer.byteLength,
					arrayBuffer: async () => (length ? buffer.slice(0, length) : buffer)
				};
			})
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Expert', level: 80 },
					{ label: 'Advanced', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Expert',
				level: 80,
				fileUrl: 'https://cdn.example.test/42/02.dtx',
				fileSizeBytes: oversizedHeader.length,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Advanced',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/03.dtx',
				fileSizeBytes: 500,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('does not let an unrated SET.def leftover claim a rated row when a level-zero row exists', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXTRA\n#L1FILE basic.dtx\n',
			'42/01.dtx': '#TITLE: Basic\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Unrated Extra\n',
			'42/practice.dtx': '#TITLE: Practice\n#DLEVEL: 0\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 80, uploaded: new Date() },
					{ key: '42/01.dtx', size: 400, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 200, uploaded: new Date() },
					{ key: '42/practice.dtx', size: 300, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Practice', level: 0 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Practice',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/practice.dtx',
				fileSizeBytes: 300,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});

	it('preserves an unrated SET.def leftover for an unclaimed level-zero row when its stem does not match', async () => {
		const chartBodies: Record<string, string> = {
			'42/set.def': '#L1LABEL EXTRA\n#L1FILE basic.dtx\n',
			'42/01.dtx': '#TITLE: Basic\n#DLEVEL: 60\n',
			'42/basic.dtx': '#TITLE: Unrated Practice\n#DLEVEL: 0\n'
		};
		const bucket = {
			...makeBucket([
				[
					{ key: '42/set.def', size: 80, uploaded: new Date() },
					{ key: '42/01.dtx', size: 400, uploaded: new Date() },
					{ key: '42/basic.dtx', size: 200, uploaded: new Date() }
				]
			]),
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => encodeToBuffer(chartBodies[key] ?? '')
			}))
		} as unknown as R2Bucket;

		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 60 },
					{ label: 'Practice', level: 0 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts).toEqual([
			{
				label: 'Basic',
				level: 60,
				fileUrl: 'https://cdn.example.test/42/01.dtx',
				fileSizeBytes: 400,
				fileEncoding: 'SHIFT_JIS'
			},
			{
				label: 'Practice',
				level: 0,
				fileUrl: 'https://cdn.example.test/42/basic.dtx',
				fileSizeBytes: 200,
				fileEncoding: 'SHIFT_JIS'
			}
		]);
	});
});

describe('PR365 review assignment regressions', () => {
	const makeChartBucket = (
		chartBodies: Record<string, string>,
		sizes: Record<string, number> = {}
	): R2Bucket => {
		const objects = Object.keys(chartBodies).map((key) => ({
			key,
			size: sizes[key] ?? chartBodies[key].length,
			uploaded: new Date()
		}));
		return {
			...makeBucket([objects]),
			get: vi.fn(
				async (
					key: string,
					options?: { range?: { offset?: number; length?: number; suffix?: number } }
				) => {
					const bytes = new TextEncoder().encode(chartBodies[key] ?? '');
					let start = 0;
					let end = bytes.byteLength;
					const range = options?.range;
					if (range?.suffix !== undefined) {
						start = Math.max(0, end - range.suffix);
					} else if (range) {
						start = range.offset ?? 0;
						if (range.length !== undefined) end = Math.min(end, start + range.length);
					}
					const bodyBytes = bytes.slice(start, end);
					return {
						size: bytes.byteLength,
						arrayBuffer: async () => bodyBytes.buffer
					};
				}
			)
		} as unknown as R2Bucket;
	};

	it('does not resolve a SET.def reference to a non-chart audio object', async () => {
		const bucket = makeChartBucket({
			'42/set.def': '#L1LABEL BASIC\n#L1FILE 42/sample.wav\n',
			'42/42/sample.wav': 'not a chart'
		});
		const discovery = await discoverCatalogFiles(
			bucket,
			{
				simfileId: 42,
				dtxFiles: [{ label: 'Basic', level: 30 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts[0].fileUrl).toBeNull();
	});

	it('uses augmenting exact-alias assignments so no row is stranded', async () => {
		const refs = [
			['A', 'a.dtx'],
			['A', 'b.dtx'],
			['B', 'a.dtx'],
			['B', 'c.dtx'],
			['C', 'a.dtx'],
			['C', 'c.dtx'],
			['D', 'b.dtx'],
			['D', 'd.dtx'],
			['D', 'e.dtx'],
			['E', 'b.dtx'],
			['E', 'd.dtx'],
			['E', 'e.dtx']
		];
		const setDef = refs
			.map(([label, file], i) => `#L${i + 1}LABEL ${label}\n#L${i + 1}FILE ${file}\n`)
			.join('');
		const bodies: Record<string, string> = { '42/set.def': setDef };
		for (const stem of ['a', 'b', 'c', 'd', 'e']) {
			bodies[`42/${stem}.dtx`] = '#TITLE: Song\n#DLEVEL: 30\n';
		}
		const discovery = await discoverCatalogFiles(
			makeChartBucket(bodies),
			{
				simfileId: 42,
				dtxFiles: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, level: 30 })),
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.every((chart) => chart.fileUrl !== null)).toBe(true);
		expect(new Set(discovery.charts.map((chart) => chart.fileUrl)).size).toBe(5);
	});

	it('defers a re-rated leftover stem until exact-rated charts claim their rows', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL EXTRA\n#L1FILE ./basic.dtx\n',
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 85\n',
				'42/01.dtx': '#TITLE: Song\n#DLEVEL: 30\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/01.dtx',
			'https://cdn.example.test/42/basic.dtx'
		]);
	});
	it('keeps later SET.def sections visible so equal-rated rows pair in uploader order', async () => {
		// The desktop uploader folds every #TITLE section into one slot map, so
		// it catalogs BASIC rows for both a.dtx and z.dtx (filename order).
		// Reading only the first section would hand the first row z.dtx.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#TITLE One',
					'#L1LABEL BASIC',
					'#L1FILE z.dtx',
					'#TITLE Two',
					'#L2LABEL BASIC',
					'#L2FILE a.dtx'
				].join('\n'),
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/z.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 60 },
					{ label: 'BASIC', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/z.dtx'
		]);
	});

	it('defers an alias whose rating names a row without a set.def reference', async () => {
		// BASIC aliases expert.dtx, but the uploader cataloged basic.dtx and
		// expert.dtx by filename stem. The alias must not take EXPERT's exact-rated
		// chart before the stem/exact fallback can assign both rows.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL BASIC\n#L1FILE ./expert.dtx\n',
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 30\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx',
			'https://cdn.example.test/42/expert.dtx'
		]);
	});

	it('preserves raw-filename ownership when a re-rated chart is not an exact match', async () => {
		// A owns a.dtx by raw filename and B only aliases it. After a.dtx is
		// re-rated away from both rows, lower-rated B must not claim it before
		// A's non-exact raw-filename claim runs.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL A\n#L1FILE a.dtx\n#L2LABEL B\n#L2FILE ./a.dtx\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/b.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 80 },
					{ label: 'B', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/b.dtx'
		]);
	});

	it('checks raw-filename ownership before accepting an unprobed alias', async () => {
		// The first 16 KiB probe of a.dtx ends before its #DLEVEL, so B's
		// lower-rated alias is unprobed when non-exact SET.def claims run.
		// That missing probe must not let B take A's raw-filename chart.
		const lateRatedChart = `${'#COMMENT padding\n'.repeat(1100)}#DLEVEL: 70\n`;
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL A\n#L1FILE a.dtx\n#L2LABEL B\n#L2FILE ./a.dtx\n',
				'42/a.dtx': lateRatedChart,
				'42/b.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 80 },
					{ label: 'B', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/b.dtx'
		]);
	});

	it('never lets an alias displace a raw-filename claim during reassignment', async () => {
		// A owns a.dtx by raw filename; B only aliases it as ./a.dtx and has
		// ./sub/c.dtx available. B must take c, not move A onto ./b.dtx.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL A',
					'#L1FILE a.dtx',
					'#L2LABEL A',
					'#L2FILE ./b.dtx',
					'#L3LABEL B',
					'#L3FILE ./a.dtx',
					'#L4LABEL B',
					'#L4FILE ./sub/c.dtx'
				].join('\n'),
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/b.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/sub/c.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 60 },
					{ label: 'B', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/sub/c.dtx'
		]);
	});

	it('keeps raw-filename claims when identical candidate sets are reordered', async () => {
		// A owns a.dtx by raw filename while B reaches the same resolved keys
		// only through aliases. Even when the nested key sorts first, the
		// identical-candidate reordering must not take a.dtx away from A.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL A',
					'#L1FILE a.dtx',
					'#L2LABEL A',
					'#L2FILE ./0/c.dtx',
					'#L3LABEL B',
					'#L3FILE ./a.dtx',
					'#L4LABEL B',
					'#L4FILE ./0/c.dtx'
				].join('\n'),
				'42/0/c.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 60 },
					{ label: 'B', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/0/c.dtx'
		]);
	});

	it('drops a set.def slot when a later section clears its label', async () => {
		// The desktop uploader folds sections and discards incomplete slots.
		// BASIC is therefore the root basic.dtx by filename stem, not the
		// replacement file named beside the cleared label.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#TITLE One',
					'#L1LABEL BASIC',
					'#L1FILE basic.dtx',
					'#TITLE Two',
					'#L1LABEL:',
					'#L1FILE extras/alternate.dtx'
				].join('\n'),
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/extras/alternate.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx'
		]);
	});

	it('prefers the root chart over a nested same-stem copy when both rate off the row', async () => {
		// solo.dtx was re-rated to 80 after upload; extras/set.def names its
		// sibling extras/solo.dtx (70). Neither matches the row's 60, and the
		// nested copy sorts first — the uploader's catalogued root file wins.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [{ label: 'SOLO', level: 60 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx'
		]);
	});

	it('reserves a nested same-stem copy after the root chart claims the stem row', async () => {
		// Once SOLO claims the catalogued root solo.dtx, the nested copy is a
		// duplicate, not a positional chart for another row. ZEN must pair with
		// the remaining top-level chart even though the nested key sorts first.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/zztop.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'ZEN', level: 50 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/zztop.dtx'
		]);
	});

	it('lets an unreferenced nested same-stem copy fill another row’s exact rating match', async () => {
		// The sibling copy is not named by SET.def, so nothing puts it in
		// keysLeftForExactMatch. It is still the only chart whose rating matches HARD.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE other.dtx\n',
				'42/extras/other.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/extras/solo.dtx'
		]);
	});

	it('lets a nested same-stem copy fill another row’s exact rating match', async () => {
		// SOLO takes the root solo.dtx by stem and rating. The nested copy rates
		// 70 and is HARD's only exact rating match, so reserving it as a duplicate
		// would drop HARD from the preview.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/extras/solo.dtx'
		]);
	});

	it('prefers an ordinary exact-rated chart over a retained nested same-stem copy', async () => {
		// SOLO claims root solo.dtx (60). extras/solo.dtx rates 70 and is
		// retained for HARD, but zztop.dtx also rates 70 and is the
		// catalogued uploader file — the nested copy must not win on key order.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/zztop.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/zztop.dtx'
		]);
	});

	it('pairs ordinary and retained-copy exact matches in equal-rated row order', async () => {
		// HARD and EXTREME both rate 70. zztop.dtx is the ordinary uploader
		// chart and extras/solo.dtx is the retained duplicate; both are needed,
		// so the ordinary chart belongs on the earlier equal-rated row.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/zztop.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 },
					{ label: 'EXTREME', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/zztop.dtx',
			'https://cdn.example.test/42/extras/solo.dtx'
		]);
	});

	it('keeps retained nested copies out of equal-rated shortage positions', async () => {
		// SOLO and HARD take their root charts. extras/solo.dtx (70) stays
		// retained, but it is not an uploader file: z02.dtx is BASIC's
		// positional match and must not shift to ADVANCED.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 50\n',
				'42/hard.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/z01.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/z02.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/z03.dtx': '#TITLE: Song\n#DLEVEL: 90\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 50 },
					{ label: 'HARD', level: 70 },
					{ label: 'EXPERT', level: 40 },
					{ label: 'BASIC', level: 60 },
					{ label: 'ADVANCED', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/hard.dtx',
			'https://cdn.example.test/42/z01.dtx',
			'https://cdn.example.test/42/z02.dtx',
			'https://cdn.example.test/42/z03.dtx'
		]);
	});

	it('keeps same-label rows in uploader order when another label shares their candidates', async () => {
		// B owns a.dtx, and both A rows reach all three keys. Direct claims pin
		// B to a.dtx, but the two A rows must still pair with b.dtx and c.dtx in
		// uploader order rather than each other's files.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL B',
					'#L1FILE a.dtx',
					'#L2LABEL B',
					'#L2FILE ./b.dtx',
					'#L3LABEL B',
					'#L3FILE ./c.dtx',
					'#L4LABEL A',
					'#L4FILE ./a.dtx',
					'#L5LABEL A',
					'#L5FILE b.dtx',
					'#L6LABEL A',
					'#L6FILE c.dtx'
				].join('\n'),
				'42/a.dtx': '#TITLE: A\n#DLEVEL: 60\n',
				'42/b.dtx': '#TITLE: B\n#DLEVEL: 60\n',
				'42/c.dtx': '#TITLE: C\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'B', level: 60 },
					{ label: 'A', level: 60 },
					{ label: 'A', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/b.dtx',
			'https://cdn.example.test/42/c.dtx'
		]);
	});

	it('retries a blocked alias after its raw owner settles on another file', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': [
					'#L1LABEL A',
					'#L1FILE ./a.dtx',
					'#L2LABEL A',
					'#L2FILE ./bonus/alt.dtx',
					'#L3LABEL C',
					'#L3FILE c.dtx',
					'#L4LABEL C',
					'#L4FILE a.dtx'
				].join('\n'),
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/c.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/extras/bonus/alt.dtx': '#TITLE: Song\n#DLEVEL: 50\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'A', level: 30 },
					{ label: 'C', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/c.dtx'
		]);
	});

	it('retries a rating-deferred alias after the matching row claims its own stem chart', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./basic.dtx',
					'#L2LABEL BASIC',
					'#L2FILE ./bonus/alt.dtx'
				].join('\n'),
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/bonus/alt.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx',
			'https://cdn.example.test/42/expert.dtx'
		]);
	});

	it('retries a rating-deferred alias after exact-rating assignment settles the other row', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./shared.dtx',
					'#L2LABEL BASIC',
					'#L2FILE ./bonus/alt.dtx'
				].join('\n'),
				'42/abexpert.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/aapositional.dtx': '#TITLE: Song\n#DLEVEL: 50\n',
				'42/shared.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/bonus/alt.dtx': '#TITLE: Song\n#DLEVEL: 90\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'Basic', level: 30 },
					{ label: 'Expert', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/shared.dtx',
			'https://cdn.example.test/42/abexpert.dtx'
		]);
	});

	it('keeps a deferred row’s later reference available when another row takes the blocked alias', async () => {
		// BASIC first aliases SHARED's exact-rated shared.dtx, so it defers.
		// Its later z-alt.dtx reference is BASIC's own re-rated chart: reserving
		// that reference as an unrelated leftover must not make the retry skip it.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./shared.dtx',
					'#L2LABEL BASIC',
					'#L2FILE z-alt.dtx'
				].join('\n'),
				'42/shared.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/z-alt.dtx': '#TITLE: Song\n#DLEVEL: 90\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'SHARED', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/z-alt.dtx',
			'https://cdn.example.test/42/shared.dtx'
		]);
	});

	it('evaluates a same-row bare reference instead of deferring behind its alias', async () => {
		// Both SET.def slots name the same chart for the same BASIC row. The
		// explicit ./ alias comes first, but the later bare spelling is the
		// uploader's raw-filename ownership evidence; a late #DLEVEL makes the
		// short probe inconclusive rather than proving the row has no chart.
		const lateRatedChart = `${'#COMMENT padding\n'.repeat(1100)}#DLEVEL: 30\n`;
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./song.dtx',
					'#L2LABEL BASIC',
					'#L2FILE song.dtx'
				].join('\n'),
				'42/song.dtx': lateRatedChart
			}),
			{
				simfileId: 42,
				dtxFiles: [{ label: 'BASIC', level: 30 }],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/song.dtx'
		]);
	});

	it('consumes a reserved deferred reference only once across duplicate labels', async () => {
		// Both BASIC rows defer behind SHARED's shared.dtx. z-alt.dtx is one
		// reserved SET.def candidate, not a key both rows may claim; the second
		// row still needs its own unlisted chart.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./shared.dtx',
					'#L2LABEL BASIC',
					'#L2FILE z-alt.dtx',
					'#L3LABEL BASIC',
					'#L3FILE z-alt.dtx'
				].join('\n'),
				'42/other.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
				'42/shared.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/z-alt.dtx': '#TITLE: Song\n#DLEVEL: 90\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'BASIC', level: 40 },
					{ label: 'SHARED', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/z-alt.dtx',
			'https://cdn.example.test/42/other.dtx',
			'https://cdn.example.test/42/shared.dtx'
		]);
	});

	it('rejects a deferred SET.def candidate proven unrated by the deep stem probe', async () => {
		// BASIC defers behind SHARED's exact-rated shared.dtx. While that
		// deferral is pending, the deep stem probe proves solo.dtx is now
		// unrated even though its short SET.def probe was inconclusive. The
		// retry must not bind that placeholder before BASIC's own re-rated
		// stem chart can claim the row.
		const lateUnratedChart = `${'#COMMENT padding\n'.repeat(1100)}#DLEVEL: 0\n`;
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./shared.dtx',
					'#L2LABEL BASIC',
					'#L2FILE ./solo.dtx'
				].join('\n'),
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/shared.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/solo.dtx': lateUnratedChart
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'SHARED', level: 80 },
					{ label: 'SOLO', level: 50 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx',
			'https://cdn.example.test/42/shared.dtx',
			null
		]);
	});

	it('rejects a deferred SET.def candidate proven rating-less by the deep stem probe', async () => {
		// A large chart with no #DLEVEL at all is only unprobed in the short
		// SET.def window. Once the deep stem probe reads the whole object, the
		// complete-read miss is as definitive as an explicit zero rating.
		const lateUnratedChart = '#COMMENT padding\n'.repeat(1100);
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': [
					'#L1LABEL BASIC',
					'#L1FILE ./shared.dtx',
					'#L2LABEL BASIC',
					'#L2FILE ./solo.dtx'
				].join('\n'),
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/shared.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/solo.dtx': lateUnratedChart
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'SHARED', level: 80 },
					{ label: 'SOLO', level: 50 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx',
			'https://cdn.example.test/42/shared.dtx',
			null
		]);
	});

	it('prefers a re-rated root stem chart over a nested same-stem exact copy', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE other.dtx\n',
				'42/extras/other.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 70\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/hard.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/hard.dtx'
		]);
	});

	it('does not let a same-stem copy suppress the legacy deep-chart fallback', async () => {
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE other.dtx\n',
				'42/extras/other.dtx': '#TITLE: Song\n#DLEVEL: 90\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 75\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/old/archive/hard.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);
		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/old/archive/hard.dtx'
		]);
	});
	it('checks only unclaimed same-label rows when rejecting a mismatched rating', async () => {
		// z.dtx was re-rated in place after upload, so both probes name the
		// already-satisfied BASIC/80 row. That claimed row must not make the
		// remaining BASIC/30 row reject z.dtx and lose its own file.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL BASIC\n#L1FILE ./a.dtx\n#L2LABEL BASIC\n#L2FILE ./z.dtx\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/z.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 80 },
					{ label: 'BASIC', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/z.dtx'
		]);
	});

	it('keeps a nested alias behind an available re-rated root reference', async () => {
		// z.dtx exact-claims BASIC/80. BASIC/30 was re-rated in a.dtx to 40,
		// so neither root reference exact-matches it; the nested 80-rated alias
		// must not consume the row before that available root reference.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def':
					'#L1LABEL BASIC\n#L1FILE extras/c.dtx\n#L2LABEL BASIC\n#L2FILE a.dtx\n#L3LABEL BASIC\n#L3FILE z.dtx\n',
				'42/extras/c.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
				'42/z.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'BASIC', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/z.dtx'
		]);
	});

	it('keeps a re-rated stem-owned root chart behind a ./ alias', async () => {
		// BASIC's ./expert.dtx alias misses the uploader's SET.def label lookup,
		// so EXPERT owns expert.dtx by filename stem even after the chart is
		// re-rated away from the stored row level.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def':
					'#L1LABEL BASIC\n#L1FILE extras/c.dtx\n#L2LABEL BASIC\n#L2FILE ./expert.dtx\n#L3LABEL BASIC\n#L3FILE a.dtx\n',
				'42/extras/c.dtx': '#TITLE: Song\n#DLEVEL: 45\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 75\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 40\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'EXPERT', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/expert.dtx'
		]);
	});

	it('looks past a missing reference after saving a nested fallback', async () => {
		// z.dtx exact-claims BASIC/80. Once extras/c.dtx is only a fallback,
		// the missing gone.dtx reference must not end BASIC/30's search before
		// the available re-rated root a.dtx.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def':
					'#L1LABEL BASIC\n#L1FILE extras/c.dtx\n#L2LABEL BASIC\n#L2FILE gone.dtx\n#L3LABEL BASIC\n#L3FILE a.dtx\n#L4LABEL BASIC\n#L4FILE z.dtx\n',
				'42/extras/c.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 40\n',
				'42/z.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 30 },
					{ label: 'BASIC', level: 80 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/z.dtx'
		]);
	});

	it('defers an exact-rated alias owned by another row’s unique filename stem', async () => {
		// BASIC aliases expert.dtx, while both rows and both charts rate 60.
		// Rating alone cannot distinguish the rows, so EXPERT's unique stem
		// ownership must keep expert.dtx from the alias; basic.dtx is BASIC's
		// own stem chart.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL BASIC\n#L1FILE ./expert.dtx\n',
				'42/basic.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 60 },
					{ label: 'EXPERT', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/basic.dtx',
			'https://cdn.example.test/42/expert.dtx'
		]);
	});

	it('keeps a root-displaced same-stem sibling available for an exact match', async () => {
		// The leftover SET.def reference makes extras/solo.dtx the stem-row
		// candidate, but the catalogued root solo.dtx wins SOLO. The displaced
		// sibling still rates 60 and is HARD's only remaining exact chart.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'HARD', level: 60 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			'https://cdn.example.test/42/extras/solo.dtx'
		]);
	});

	it('does not count a claimed row as a stem-ownership rating conflict', async () => {
		// other.dtx exact-claims OTHER/75 first. Although expert.dtx duplicates
		// that 75 rating, the satisfied OTHER row no longer needs expert.dtx, so
		// the EXPERT stem owner must still win it over BASIC's alias.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def':
					'#L1LABEL BASIC\n#L1FILE ./expert.dtx\n#L2LABEL OTHER\n#L2FILE other.dtx\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 75\n',
				'42/other.dtx': '#TITLE: Song\n#DLEVEL: 75\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'EXPERT', level: 70 },
					{ label: 'BASIC', level: 30 },
					{ label: 'OTHER', level: 75 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/expert.dtx',
			null,
			'https://cdn.example.test/42/other.dtx'
		]);
	});

	it('retries a stem-owned alias after the stem owner claims another chart', async () => {
		// BASIC's only SET.def file is expert.dtx, whose filename stem belongs to
		// the EXPERT row. That row's exact-rated chart is hard.dtx instead, so
		// the blocked BASIC claim must retry after EXPERT settles.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL BASIC\n#L1FILE ./expert.dtx\n',
				'42/expert.dtx': '#TITLE: Song\n#DLEVEL: 75\n',
				'42/hard.dtx': '#TITLE: Song\n#DLEVEL: 70\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'FREE', level: 10 },
					{ label: 'BASIC', level: 30 },
					{ label: 'EXPERT', level: 70 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			null,
			'https://cdn.example.test/42/expert.dtx',
			'https://cdn.example.test/42/hard.dtx'
		]);
	});

	it('defers a duplicate-rated SET.def claim behind an exact-rated fallback chart', async () => {
		// z.dtx duplicates the already-satisfied BASIC/80 rating. BASIC/30 may
		// still use it when nothing better exists, but b.dtx probes exactly 30
		// and must win before that non-exact SET.def claim settles.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/set.def': '#L1LABEL BASIC\n#L1FILE a.dtx\n#L2LABEL BASIC\n#L2FILE z.dtx\n',
				'42/a.dtx': '#TITLE: Song\n#DLEVEL: 80\n',
				'42/b.dtx': '#TITLE: Song\n#DLEVEL: 30\n',
				'42/z.dtx': '#TITLE: Song\n#DLEVEL: 80\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'BASIC', level: 80 },
					{ label: 'BASIC', level: 30 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/a.dtx',
			'https://cdn.example.test/42/b.dtx'
		]);
	});

	it('keeps a root-displaced same-stem sibling out of positional fallback', async () => {
		// The displaced sibling is only a duplicate of SOLO's chart. When no row
		// carries its exact 60 rating, EXTREME must stay missing rather than
		// previewing another row's chart.
		const discovery = await discoverCatalogFiles(
			makeChartBucket({
				'42/extras/set.def': '#L1LABEL OTHER\n#L1FILE solo.dtx\n',
				'42/extras/solo.dtx': '#TITLE: Copy\n#DLEVEL: 60\n',
				'42/solo.dtx': '#TITLE: Song\n#DLEVEL: 60\n'
			}),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'SOLO', level: 60 },
					{ label: 'EXTREME', level: 90 }
				],
				publicBaseUrl: 'https://cdn.example.test'
			},
			silentLogger
		);

		expect(discovery.charts.map((chart) => chart.fileUrl)).toEqual([
			'https://cdn.example.test/42/solo.dtx',
			null
		]);
	});
});
