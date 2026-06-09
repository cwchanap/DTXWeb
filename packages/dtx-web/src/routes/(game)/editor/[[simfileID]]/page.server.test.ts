import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock factories so the references are valid
const { envMock, publicEnvMock } = vi.hoisted(() => ({
	envMock: { dev: false },
	publicEnvMock: { env: { PUBLIC_DTX_API_URL: 'https://api.test' } }
}));

vi.mock('$app/environment', () => envMock);
vi.mock('$env/dynamic/public', () => publicEnvMock);

vi.mock('@sveltejs/kit', () => ({
	error: vi.fn((status: number, message: string) => {
		const err = new Error(message) as Error & { status: number; body: { message: string } };
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

const callLoad = (simfileID: string, fetchImpl: typeof fetch): ReturnType<typeof load> =>
	load({ params: { simfileID }, fetch: fetchImpl } as unknown as Parameters<typeof load>[0]);

const arrayBufferResponse = (buffer: ArrayBuffer, status = 200) =>
	({
		status,
		ok: status >= 200 && status < 300,
		arrayBuffer: vi.fn().mockResolvedValue(buffer)
	}) as unknown as Response;

beforeEach(() => {
	envMock.dev = false;
	publicEnvMock.env.PUBLIC_DTX_API_URL = 'https://api.test';
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('editor/[[simfileID]]/+page.server load', () => {
	it('returns null metadata when no simfileID is provided', async () => {
		const result = requirePageLoadResult(
			await load({ params: { simfileID: '' } } as unknown as Parameters<typeof load>[0])
		);
		expect(result.simfileID).toBeNull();
		expect(result.metadata).toBeNull();
	});

	it('throws 500 when PUBLIC_DTX_API_URL is not configured in production', async () => {
		publicEnvMock.env.PUBLIC_DTX_API_URL = '';
		const fetchSpy = vi.fn();
		await expect(callLoad('123', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 500
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns null metadata in dev mode without fetching', async () => {
		envMock.dev = true;
		const fetchSpy = vi.fn();
		const result = requirePageLoadResult(
			await callLoad('123', fetchSpy as unknown as typeof fetch)
		);
		expect(result.simfileID).toBe('123');
		expect(result.metadata).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('throws 404 when dtx-api returns 404', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ status: 404, ok: false } as Response);
		await expect(callLoad('123', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 404
		});
		expect(fetchSpy).toHaveBeenCalledWith('https://api.test/simfiles/123/set.def');
	});

	it('parses def file content and returns metadata', async () => {
		const defContent = '#TITLE Test Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const buffer = new TextEncoder().encode(defContent).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(buffer));
		const result = requirePageLoadResult(
			await callLoad('123', fetchSpy as unknown as typeof fetch)
		);
		expect(result.simfileID).toBe('123');
		expect(result.metadata?.title).toBe('Test Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-16LE BOM encoded def file', async () => {
		const defText = '#TITLE BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const utf16Bytes = new Uint8Array(defText.length * 2);
		for (let i = 0; i < defText.length; i++) {
			const codePoint = defText.charCodeAt(i);
			utf16Bytes[i * 2] = codePoint & 0xff;
			utf16Bytes[i * 2 + 1] = (codePoint >> 8) & 0xff;
		}
		const bomBuffer = new Uint8Array([0xff, 0xfe, ...utf16Bytes]).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(bomBuffer));
		const result = requirePageLoadResult(
			await callLoad('bom', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('handles UTF-8 BOM encoded def file', async () => {
		const defText = '#TITLE UTF8 BOM Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const textBytes = new TextEncoder().encode(defText);
		const bomBuffer = new Uint8Array([0xef, 0xbb, 0xbf, ...textBytes]).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(bomBuffer));
		const result = requirePageLoadResult(
			await callLoad('utf8bom', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('UTF8 BOM Song');
		expect(result.metadata?.levels[1]).toEqual({ label: 'BASIC', fileName: 'bas.dtx' });
	});

	it('throws 500 when fetch rejects unexpectedly', async () => {
		const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
		await expect(callLoad('err', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 500
		});
	});

	it('throws error status when dtx-api returns non-404 error', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ status: 503, ok: false } as Response);
		await expect(callLoad('123', fetchSpy as unknown as typeof fetch)).rejects.toMatchObject({
			status: 503
		});
		expect(fetchSpy).toHaveBeenCalledWith('https://api.test/simfiles/123/set.def');
	});

	it('parses title with colon separator', async () => {
		const defContent = '#TITLE:Colon Title\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
		const buffer = new TextEncoder().encode(defContent).buffer;
		const fetchSpy = vi.fn().mockResolvedValue(arrayBufferResponse(buffer));
		const result = requirePageLoadResult(
			await callLoad('colon', fetchSpy as unknown as typeof fetch)
		);
		expect(result.metadata?.title).toBe('Colon Title');
	});
});
