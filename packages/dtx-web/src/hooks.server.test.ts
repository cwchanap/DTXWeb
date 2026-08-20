import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchAuthSession = vi.hoisted(() => vi.fn());

vi.mock('$lib/auth/session', () => ({ fetchAuthSession: mockFetchAuthSession }));

import { authGuard, authSession, csrf } from './hooks.server';

type RequestEvent = Parameters<typeof authGuard>[0]['event'];

const makeEvent = (overrides: Partial<RequestEvent> = {}): RequestEvent => {
	const url = new URL(overrides?.url ?? 'https://example.com/');

	return {
		locals: {
			session: null,
			user: null,
			...((overrides?.locals as unknown as Record<string, unknown>) ?? {})
		},
		url,
		request: new Request(url.toString()),
		platform: undefined,
		...(overrides as Partial<RequestEvent>)
	} as unknown as RequestEvent;
};

const resolve = vi.fn().mockResolvedValue(new Response('ok'));

describe('auth hooks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchAuthSession.mockResolvedValue({ session: null, user: null, setCookies: [] });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const expectRedirect = async (
		response: Response | Promise<Response>,
		location: string,
		status = 303
	) => {
		const result = await response;
		expect(result.status).toBe(status);
		expect(result.headers.get('location')).toBe(location);
	};

	it('loads neutral session data into locals and preserves every Set-Cookie value', async () => {
		const session = { id: 'session-1' };
		const user = { id: 'user-1' };
		mockFetchAuthSession.mockResolvedValue({
			session,
			user,
			setCookies: ['first=one; Path=/', 'second=two; Path=/']
		});
		const event = makeEvent({
			request: new Request('https://example.com/', { headers: { cookie: 'session=token' } })
		});
		const response = new Response('ok');

		const result = await authSession({ event, resolve: vi.fn().mockResolvedValue(response) });

		expect(event.locals.session).toBe(session);
		expect(event.locals.user).toBe(user);
		expect(result.headers.getSetCookie()).toEqual(['first=one; Path=/', 'second=two; Path=/']);
	});

	it('redirects unauthenticated users from /app with a safe next path', async () => {
		const event = makeEvent({ url: new URL('https://example.com/app/score?page=3') });

		await expectRedirect(
			authGuard({ event, resolve }),
			'/login?next=' + encodeURIComponent('/app/score?page=3')
		);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('preserves every session cookie through a protected redirect', async () => {
		mockFetchAuthSession.mockResolvedValue({
			session: null,
			user: null,
			setCookies: ['first=one; Path=/', 'second=two; Path=/']
		});
		const event = makeEvent({ url: new URL('https://example.com/app/score?page=3') });

		const response = await authSession({
			event,
			resolve: (nestedEvent) => authGuard({ event: nestedEvent, resolve })
		});

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'/login?next=' + encodeURIComponent('/app/score?page=3')
		);
		expect(response.headers.getSetCookie()).toEqual([
			'first=one; Path=/',
			'second=two; Path=/'
		]);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('treats query parameters as an ordinary safe web next path', async () => {
		const event = makeEvent({
			url: new URL('https://example.com/app?tab=overview')
		});

		await expectRedirect(
			authGuard({ event, resolve }),
			'/login?next=' + encodeURIComponent('/app?tab=overview')
		);
	});

	it('redirects authenticated users from /login to /app', async () => {
		const event = makeEvent({
			url: new URL('https://example.com/login?next=%2Fapp%2Fscore'),
			locals: {
				session: {
					id: 'session-1',
					userId: 'user-1',
					expiresAt: '2099-01-01T00:00:00.000Z'
				},
				user: { id: 'user-1' }
			}
		});

		await expectRedirect(authGuard({ event, resolve }), '/app');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('keeps normal form CSRF protection for the former desktop headers', async () => {
		const event = makeEvent({
			request: new Request('https://example.com/form', {
				method: 'POST',
				headers: {
					accept: 'application/json',
					'content-type': 'application/x-www-form-urlencoded',
					origin: 'https://evil.example',
					'user-agent': 'DTXDesktopApp',
					'x-requested-with': 'DTXDesktopApp'
				}
			})
		});

		const result = await csrf({ event, resolve });

		expect(result.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});
