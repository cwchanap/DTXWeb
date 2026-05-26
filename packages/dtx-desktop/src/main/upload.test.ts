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
});
