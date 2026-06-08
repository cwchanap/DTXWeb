import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, mockBrowser, mockGetAccessToken } = vi.hoisted(() => ({
	mockEnv: { PUBLIC_USE_GRAPHQL_API: 'true', PUBLIC_DTX_API_URL: 'https://api.test' },
	mockBrowser: true,
	mockGetAccessToken: vi.fn().mockResolvedValue('token-from-supabase')
}));

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: mockBrowser }));
vi.mock('./token', () => ({ getAccessTokenOrNull: mockGetAccessToken }));
vi.mock('./transport', () => ({
	makeBrowserClient: vi.fn((token) => ({ type: 'browser', token })),
	makeServiceBindingClient: vi.fn((binding, token) => ({
		type: 'service-binding',
		binding,
		token
	}))
}));

import { getClient } from './client';
import { makeBrowserClient, makeServiceBindingClient } from './transport';

beforeEach(() => {
	vi.mocked(makeBrowserClient).mockClear();
	vi.mocked(makeServiceBindingClient).mockClear();
	mockGetAccessToken.mockClear();
	mockGetAccessToken.mockResolvedValue('token-from-supabase');
});

describe('getClient', () => {
	it('returns browser client with token from Supabase when no ctx provided', async () => {
		const client = await getClient();
		expect(makeBrowserClient).toHaveBeenCalledWith('token-from-supabase');
		expect(client).toEqual({ type: 'browser', token: 'token-from-supabase' });
	});

	it('returns browser client with pre-supplied accessToken', async () => {
		const client = await getClient({ accessToken: 'pre-supplied-token' });
		expect(makeBrowserClient).toHaveBeenCalledWith('pre-supplied-token');
		expect(mockGetAccessToken).not.toHaveBeenCalled();
	});

	it('prefers ctx.accessToken over Supabase token', async () => {
		const client = await getClient({ accessToken: 'ctx-token' });
		expect(makeBrowserClient).toHaveBeenCalledWith('ctx-token');
	});

	it('passes null token when accessToken is explicitly null', async () => {
		const client = await getClient({ accessToken: null });
		expect(makeBrowserClient).toHaveBeenCalledWith(null);
	});

	it('returns service-binding client when SSR with platform.env.API', async () => {
		// Must reset modules and re-import so getClient sees browser=false
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));
		vi.doMock('$env/dynamic/public', () => ({ env: mockEnv }));
		vi.doMock('./token', () => ({ getAccessTokenOrNull: mockGetAccessToken }));
		vi.doMock('./transport', () => ({
			makeBrowserClient: vi.fn((token) => ({ type: 'browser', token })),
			makeServiceBindingClient: vi.fn((binding, token) => ({
				type: 'service-binding',
				binding,
				token
			}))
		}));

		const { getClient: ssrGetClient } = await import('./client');
		const { makeServiceBindingClient: ssrMakeServiceBinding } = await import('./transport');

		const mockBinding = { fetch: vi.fn() };
		const ctx = {
			platform: {
				env: { API: mockBinding }
			} as unknown as App.Platform,
			accessToken: 'ssr-token'
		};

		const client = await ssrGetClient(ctx);
		expect(ssrMakeServiceBinding).toHaveBeenCalledWith(mockBinding, 'ssr-token');
		expect(client).toEqual({
			type: 'service-binding',
			binding: mockBinding,
			token: 'ssr-token'
		});
	});
});
