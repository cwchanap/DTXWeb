import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { getMe, upsertUserProfile } from './user';

const restFetch = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
	mockEnv.PUBLIC_USE_GRAPHQL_API = 'false';
	requestMock.mockReset();
	restFetch.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = restFetch as unknown as typeof fetch;
});
afterEach(() => {
	(globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
});

describe('getMe', () => {
	it('REST: GET /api/user/profile', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { user_id: 'u1', username: 'alice' } }))
		);
		const r = await getMe();
		expect(restFetch).toHaveBeenCalledWith('/api/user/profile', expect.any(Object));
		expect(r).toEqual({ user_id: 'u1', username: 'alice' });
	});

	it('REST: includes response body in error when not OK', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ message: 'token expired' }), { status: 401 })
		);
		await expect(getMe()).rejects.toThrow('me failed: 401 – token expired');
	});

	it('GraphQL: calls Me', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ me: { userId: 'u1', username: 'alice' } });
		const r = await getMe();
		expect(r).toEqual({ user_id: 'u1', username: 'alice' });
	});
});

describe('upsertUserProfile', () => {
	it('REST: PUT /api/user/profile', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { user_id: 'u1', username: 'bob' } }))
		);
		const r = await upsertUserProfile({ username: 'bob' });
		expect(restFetch).toHaveBeenCalledWith(
			'/api/user/profile',
			expect.objectContaining({ method: 'PUT' })
		);
		expect(r.username).toBe('bob');
	});

	it('GraphQL: calls UpsertUserProfile', async () => {
		mockEnv.PUBLIC_USE_GRAPHQL_API = 'true';
		requestMock.mockResolvedValue({ upsertUserProfile: { userId: 'u1', username: 'bob' } });
		const r = await upsertUserProfile({ username: 'bob' });
		expect(r.username).toBe('bob');
	});

	it('REST: includes response body in error when not OK', async () => {
		restFetch.mockResolvedValue(
			new Response(JSON.stringify({ error: 'username taken' }), { status: 409 })
		);
		await expect(upsertUserProfile({ username: 'bob' })).rejects.toThrow(
			'upsert failed: 409 – username taken'
		);
	});
});
