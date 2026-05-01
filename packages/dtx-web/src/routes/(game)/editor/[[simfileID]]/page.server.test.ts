import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, message: string) => {
		const err = new Error(message) as any;
		err.status = status;
		err.body = { message };
		throw err;
	})
}));

import { load } from './+page.server';

type EditorPageLoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

const requirePageLoadResult = (result: Awaited<ReturnType<typeof load>>): EditorPageLoadResult => {
	if (result === undefined) {
		throw new Error('Expected load() to return editor page data');
	}
	return result;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('editor/[[simfileID]]/+page.server load', () => {
	it('returns null metadata when no simfileID is provided', async () => {
		const result = requirePageLoadResult(
			await load({
				params: { simfileID: '' },
				platform: undefined
			} as any)
		);

		expect(result.simfileID).toBeNull();
		expect(result.metadata).toBeNull();
	});

	it('returns null metadata when bucket is not available', async () => {
		const result = requirePageLoadResult(
			await load({
				params: { simfileID: 'sim-123' },
				platform: { env: {} }
			} as any)
		);

		expect(result.simfileID).toBe('sim-123');
		expect(result.metadata).toBeNull();
	});

	it('throws 404 when bucket returns null for set.def', async () => {
		const bucketReturningNull = {
			get: vi.fn().mockResolvedValue(null)
		};

		await expect(
			load({
				params: { simfileID: 'sim-123' },
				platform: { env: { DTXFILE_BUCKET: bucketReturningNull } }
			} as any)
		).rejects.toMatchObject({ status: 404 });
	});

	it('throws 404 when def file not found in R2', async () => {
		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockResolvedValue(null)
		};

		await expect(
			load({
				params: { simfileID: 'missing-sim' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		).rejects.toMatchObject({ status: 404 });
	});

	it('parses def file content and returns metadata', async () => {
		const defContent = '#TITLE Test Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const encoder = new TextEncoder();
		const buffer = encoder.encode(defContent).buffer;

		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockResolvedValue({
				arrayBuffer: vi.fn().mockResolvedValue(buffer)
			})
		};

		const result = requirePageLoadResult(
			await load({
				params: { simfileID: 'sim-123' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		);

		expect(result.simfileID).toBe('sim-123');
		expect(result.metadata?.title).toBe('Test Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-16LE BOM encoded def file', async () => {
		const defText = '#TITLE BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		// Build a proper UTF-16LE buffer: each code unit → 2 little-endian bytes
		const utf16Bytes = new Uint8Array(defText.length * 2);
		for (let i = 0; i < defText.length; i++) {
			const codePoint = defText.charCodeAt(i);
			utf16Bytes[i * 2] = codePoint & 0xff;
			utf16Bytes[i * 2 + 1] = (codePoint >> 8) & 0xff;
		}
		// Prepend UTF-16LE BOM: 0xFF 0xFE
		const bomBuffer = new Uint8Array([0xff, 0xfe, ...utf16Bytes]).buffer;

		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockResolvedValue({
				arrayBuffer: vi.fn().mockResolvedValue(bomBuffer)
			})
		};

		const result = requirePageLoadResult(
			await load({
				params: { simfileID: 'sim-bom' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		);

		expect(result.simfileID).toBe('sim-bom');
		expect(result.metadata?.title).toBe('BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-8 BOM encoded def file', async () => {
		const defText = '#TITLE UTF8 BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const encoder = new TextEncoder();
		const textBytes = encoder.encode(defText);
		// Add UTF-8 BOM: 0xEF 0xBB 0xBF
		const bomBuffer = new Uint8Array([0xef, 0xbb, 0xbf, ...textBytes]).buffer;

		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockResolvedValue({
				arrayBuffer: vi.fn().mockResolvedValue(bomBuffer)
			})
		};

		const result = requirePageLoadResult(
			await load({
				params: { simfileID: 'sim-utf8bom' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		);

		expect(result.simfileID).toBe('sim-utf8bom');
		expect(result.metadata?.title).toBe('UTF8 BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('throws 500 when R2 get throws an unexpected error', async () => {
		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockRejectedValue(new Error('R2 connection failed'))
		};

		await expect(
			load({
				params: { simfileID: 'sim-error' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		).rejects.toMatchObject({ status: 500 });
	});

	it('parses title with colon separator', async () => {
		const defContent = '#TITLE:Colon Title\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const encoder = new TextEncoder();
		const buffer = encoder.encode(defContent).buffer;

		const realBucket = {
			toString: () => 'R2Bucket',
			get: vi.fn().mockResolvedValue({
				arrayBuffer: vi.fn().mockResolvedValue(buffer)
			})
		};

		const result = requirePageLoadResult(
			await load({
				params: { simfileID: 'sim-colon' },
				platform: { env: { DTXFILE_BUCKET: realBucket } }
			} as any)
		);

		expect(result.metadata?.title).toBe('Colon Title');
	});
});
