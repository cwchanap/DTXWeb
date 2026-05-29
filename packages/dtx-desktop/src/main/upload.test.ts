import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./graphql/client', () => ({
	getApiBaseUrl: () => 'https://api.test',
	getAccessToken: vi.fn().mockResolvedValue('tok')
}));

import { uploadFile } from './upload';

const fetchSpy = vi.fn();
beforeEach(() => {
	fetchSpy.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

describe('uploadFile', () => {
	it('POSTs multipart to /upload with bearer + DTXDesktopApp header', async () => {
		fetchSpy.mockResolvedValue(
			new Response(
				JSON.stringify({
					message: 'ok',
					file: {
						fileName: 'a.dtx',
						key: '1/a.dtx',
						size: 100,
						contentType: 'application/octet-stream',
						status: 'Uploaded'
					}
				})
			)
		);
		const fd = new FormData();
		fd.append('simFileId', '1');
		const r = await uploadFile(fd);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.test/upload',
			expect.objectContaining({ method: 'POST', body: fd })
		);
		const init = fetchSpy.mock.calls[0][1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer tok');
		expect(headers['User-Agent']).toBe('DTXDesktopApp');
		expect(r.success).toBe(true);
	});

	it('returns shaped error on non-2xx', async () => {
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify({ error: 'boom' }), { status: 400 })
		);
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('boom');
	});

	it('returns timeout error on AbortError', async () => {
		const abortErr = new DOMException('The operation was aborted.', 'AbortError');
		fetchSpy.mockRejectedValue(abortErr);
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('Request timed out after 30000ms');
	});

	it('falls back to statusText when non-ok response body is not JSON', async () => {
		fetchSpy.mockResolvedValue(
			new Response('not json', { status: 502, statusText: 'Bad Gateway' })
		);
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('Bad Gateway');
	});

	it('returns error message from a generic Error', async () => {
		fetchSpy.mockRejectedValue(new Error('network down'));
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('network down');
	});

	it('returns Unknown error when a non-Error is thrown', async () => {
		fetchSpy.mockRejectedValue('something broke');
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('Unknown error');
	});

	it('falls back to HTTP status when JSON body has no error field', async () => {
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 })
		);
		const r = await uploadFile(new FormData());
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error).toBe('HTTP 403');
	});
});
