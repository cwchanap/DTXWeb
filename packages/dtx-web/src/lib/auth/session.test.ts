import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ PUBLIC_DTX_API_URL: 'https://api.test' }));

vi.mock('$env/static/public', () => mockEnv);

import { fetchAuthSession } from './session';

type SessionEvent = Parameters<typeof fetchAuthSession>[0];

const makeEvent = (
	options: {
		cookie?: string;
		api?: { fetch: typeof fetch };
		fetch?: typeof fetch;
	} = {}
) => {
	const url = new URL('https://web.test/app');
	return {
		url,
		request: new Request(url, {
			headers: options.cookie ? { cookie: options.cookie } : undefined
		}),
		platform: options.api ? { env: { API: options.api } } : undefined,
		fetch: options.fetch
	} as unknown as SessionEvent;
};

const responseWithSession = (session: unknown, user: unknown, cookies: string[] = []) => {
	const headers = new Headers({ 'content-type': 'application/json' });
	for (const cookie of cookies) headers.append('set-cookie', cookie);
	return new Response(JSON.stringify(session === null ? null : { session, user }), { headers });
};

describe('fetchAuthSession', () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock);
		mockEnv.PUBLIC_DTX_API_URL = 'https://api.test';
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('looks up an authenticated session through the public API and forwards request cookies', async () => {
		const session = { id: 'session-1', userId: 'user-1' };
		const user = { id: 'user-1', email: 'user@example.com' };
		fetchMock.mockResolvedValue(
			responseWithSession(session, user, ['first=one; Path=/', 'second=two; Path=/'])
		);

		const result = await fetchAuthSession(makeEvent({ cookie: 'session=opaque-token' }));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/auth/get-session');
		const [, requestInit] = fetchMock.mock.calls[0];
		expect(requestInit?.method).toBe('GET');
		expect((requestInit?.headers as Headers).get('cookie')).toBe('session=opaque-token');
		expect(result).toEqual({
			session,
			user,
			setCookies: ['first=one; Path=/', 'second=two; Path=/']
		});
	});

	it('uses SvelteKit event.fetch for the public fallback when available', async () => {
		const eventFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(responseWithSession({ id: 'session-1' }, { id: 'user-1' }));

		await fetchAuthSession(makeEvent({ fetch: eventFetch, cookie: 'session=opaque-token' }));

		expect(eventFetch).toHaveBeenCalledWith(
			'https://api.test/api/auth/get-session',
			expect.objectContaining({ method: 'GET' })
		);
		expect((eventFetch.mock.calls[0][1]?.headers as Headers).get('cookie')).toBe(
			'session=opaque-token'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('prefers the API service binding over the public API URL', async () => {
		const bindingFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(responseWithSession({ id: 'session-1' }, { id: 'user-1' }));
		fetchMock.mockRejectedValue(new Error('public fallback should not be used'));

		const result = await fetchAuthSession(
			makeEvent({ cookie: 'session=opaque-token', api: { fetch: bindingFetch } })
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(bindingFetch).toHaveBeenCalledTimes(1);
		const [request] = bindingFetch.mock.calls[0];
		expect(new URL(request instanceof Request ? request.url : String(request)).pathname).toBe(
			'/api/auth/get-session'
		);
		expect(result.session).toEqual({ id: 'session-1' });
	});

	it('returns an anonymous result when the API has no session', async () => {
		fetchMock.mockResolvedValue(responseWithSession(null, null));

		await expect(fetchAuthSession(makeEvent())).resolves.toEqual({
			session: null,
			user: null,
			setCookies: []
		});
	});

	it('returns an anonymous result when the API request fails', async () => {
		fetchMock.mockRejectedValue(new Error('API unavailable'));

		await expect(
			fetchAuthSession(makeEvent({ cookie: 'session=opaque-token' }))
		).resolves.toEqual({
			session: null,
			user: null,
			setCookies: []
		});
	});

	it('returns an anonymous result for a failed API response', async () => {
		fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));

		await expect(fetchAuthSession(makeEvent())).resolves.toEqual({
			session: null,
			user: null,
			setCookies: []
		});
	});
});
