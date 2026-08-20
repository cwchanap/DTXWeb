import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, mockBrowser } = vi.hoisted(() => ({
	mockEnv: { PUBLIC_DTX_API_URL: 'https://api.test' },
	mockBrowser: true
}));

vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({ browser: mockBrowser }));
vi.mock('./transport', () => ({
	makeBrowserClient: vi.fn((fetchFn) => ({ type: 'browser', fetchFn })),
	makeServiceBindingClient: vi.fn((binding, cookieHeader, origin) => ({
		type: 'service-binding',
		binding,
		cookieHeader,
		origin
	}))
}));

import { getClient } from './client';
import { makeBrowserClient, makeServiceBindingClient } from './transport';

beforeEach(() => {
	vi.mocked(makeBrowserClient).mockClear();
	vi.mocked(makeServiceBindingClient).mockClear();
});

describe('getClient', () => {
	it('returns browser client without resolving a bearer token', async () => {
		const client = await getClient();
		expect(makeBrowserClient).toHaveBeenCalledWith(undefined);
		expect(client).toEqual({ type: 'browser', fetchFn: undefined });
	});

	it('passes a request fetch override to the browser client', async () => {
		const fetchFn = vi.fn();
		const client = await getClient({ fetch: fetchFn });
		expect(makeBrowserClient).toHaveBeenCalledWith(fetchFn);
		expect(client).toEqual({ type: 'browser', fetchFn });
	});

	it('returns service-binding client when SSR with platform.env.API', async () => {
		// Must reset modules and re-import so getClient sees browser=false
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));
		vi.doMock('$env/dynamic/public', () => ({ env: mockEnv }));
		vi.doMock('./transport', () => ({
			makeBrowserClient: vi.fn((fetchFn) => ({ type: 'browser', fetchFn })),
			makeServiceBindingClient: vi.fn((binding, cookieHeader, origin) => ({
				type: 'service-binding',
				binding,
				cookieHeader,
				origin
			}))
		}));

		const { getClient: ssrGetClient } = await import('./client');
		const { makeServiceBindingClient: ssrMakeServiceBinding } = await import('./transport');

		const mockBinding = { fetch: vi.fn() };
		const ctx = {
			platform: {
				env: { API: mockBinding }
			} as unknown as App.Platform,
			cookieHeader: 'dtx-session=session-value',
			origin: 'https://web.test'
		};

		const client = await ssrGetClient(ctx);
		expect(ssrMakeServiceBinding).toHaveBeenCalledWith(
			mockBinding,
			'dtx-session=session-value',
			'https://web.test'
		);
		expect(client).toEqual({
			type: 'service-binding',
			binding: mockBinding,
			cookieHeader: 'dtx-session=session-value',
			origin: 'https://web.test'
		});
	});
});
