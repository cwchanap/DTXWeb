import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_USE_GRAPHQL_API: 'false', PUBLIC_DTX_API_URL: 'https://api.test' };
	const requestMock = vi.fn();
	return { mockEnv, requestMock };
});

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./token', () => ({
	getAccessTokenOrNull: vi.fn().mockResolvedValue('test-token'),
	getAccessToken: vi.fn().mockResolvedValue('test-token')
}));

vi.mock('./transport', () => ({
	makeBrowserClient: () => ({ request: requestMock, url: 'x', requestConfig: { headers: {} } }),
	makeServiceBindingClient: () => ({ request: requestMock })
}));

import { listSimfiles, getSimfile, updateSimfile, deleteSimfile } from './chart';

const restFetch = vi.fn();
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});

describe('listSimfiles (REST path)', () => {
	it('hits /api/chart with query params and returns { data, count }', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: 1, title: 't' }], count: 1 }))
		);
		const result = await listSimfiles({ scope: 'mine', search: 'foo', page: 2, pageSize: 10 });
		expect(restFetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/chart?'),
			expect.any(Object)
		);
		const url = restFetch.mock.calls[0][0] as string;
		expect(url).toContain('scope=mine');
		expect(url).toContain('search=foo');
		expect(url).toContain('page=2');
		expect(url).toContain('pageSize=10');
		expect(url).toContain('check_uploaded=true');
		expect(result).toEqual({ data: [{ id: 1, title: 't' }], count: 1 });
	});
});

describe('listSimfiles (GraphQL path)', () => {
	beforeEach(() => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
	});

	it('calls ListSimfiles and adapts to { data, count }', async () => {
		requestMock.mockResolvedValue({
			simfiles: {
				count: 2,
				data: [
					{
						id: '1',
						title: 't1',
						artist: 'a',
						bpm: 120,
						isPublished: true,
						hasUploadedFiles: true
					},
					{
						id: '2',
						title: 't2',
						artist: 'b',
						bpm: 130,
						isPublished: false,
						hasUploadedFiles: false
					}
				]
			}
		});
		const result = await listSimfiles({ scope: 'mine' });
		expect(requestMock).toHaveBeenCalledOnce();
		expect(result.count).toBe(2);
		expect(result.data).toHaveLength(2);
		expect(result.data[0].has_uploaded_files).toBe(true);
	});

	it('maps scope string mine → MINE enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'mine' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('MINE');
	});

	it('maps scope string published → PUBLISHED enum', async () => {
		requestMock.mockResolvedValue({ simfiles: { count: 0, data: [] } });
		await listSimfiles({ scope: 'published' });
		const vars = requestMock.mock.calls[0][1] as { scope: string };
		expect(vars.scope).toBe('PUBLISHED');
	});
});

describe('getSimfile', () => {
	it('REST: GET /api/chart/${id}', async () => {
		restFetch.mockResolvedValue(new Response(JSON.stringify({ id: 7, title: 't' })));
		const result = await getSimfile('7');
		expect(restFetch).toHaveBeenCalledWith('/api/chart/7', expect.any(Object));
		expect(result.id).toBe(7);
	});

	it('GraphQL: calls GetSimfile and unwraps', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({
			simfile: { id: '7', title: 't', files: [], hasUploadedFiles: false }
		});
		const result = await getSimfile('7');
		expect(result.id).toBe(7);
	});
});

describe('updateSimfile', () => {
	it('REST: PATCH /api/chart/${id} with body', async () => {
		restFetch.mockResolvedValue(new Response(JSON.stringify({ id: 9, title: 'new' })));
		const result = await updateSimfile('9', { title: 'new' });
		expect(restFetch).toHaveBeenCalledWith(
			'/api/chart/9',
			expect.objectContaining({ method: 'PATCH' })
		);
		expect(result.title).toBe('new');
	});

	it('GraphQL: calls UpdateSimfile mutation', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ updateSimfile: { id: '9', title: 'new' } });
		const result = await updateSimfile('9', { title: 'new' });
		expect(result.title).toBe('new');
	});
});

describe('deleteSimfile', () => {
	it('REST: DELETE /api/simFile/delete/${id}', async () => {
		restFetch.mockResolvedValue(new Response(null, { status: 204 }));
		const result = await deleteSimfile('3');
		expect(restFetch).toHaveBeenCalledWith(
			'/api/simFile/delete/3',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(result.deleted).toBe(true);
	});

	it('GraphQL: calls DeleteSimfile', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ deleteSimfile: { id: '3', deleted: true } });
		const result = await deleteSimfile('3');
		expect(result.deleted).toBe(true);
	});
});
