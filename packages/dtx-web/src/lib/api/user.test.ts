import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, requestMock } = vi.hoisted(() => {
	const mockEnv = { PUBLIC_DTX_API_URL: 'https://api.test' };
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

beforeEach(() => {
	requestMock.mockReset();
});

describe('getMe', () => {
	it('GraphQL: calls Me', async () => {
		requestMock.mockResolvedValue({ me: { userId: 'u1', username: 'alice' } });
		const r = await getMe();
		expect(r).toEqual({ user_id: 'u1', username: 'alice' });
	});
});

describe('upsertUserProfile', () => {
	it('GraphQL: calls UpsertUserProfile', async () => {
		requestMock.mockResolvedValue({ upsertUserProfile: { userId: 'u1', username: 'bob' } });
		const r = await upsertUserProfile({ username: 'bob' });
		expect(r.username).toBe('bob');
	});
});
