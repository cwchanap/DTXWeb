import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authGuard } from './hooks.server';

type RequestEvent = Parameters<typeof authGuard>[0]['event'];

const makeEvent = (overrides: Partial<RequestEvent> = {}): RequestEvent => {
	const url = new URL(overrides?.url ?? 'https://example.com/');
	const safeGetSession =
		overrides?.locals?.safeGetSession ??
		vi.fn().mockResolvedValue({ session: null, user: null });

	return {
		locals: {
			safeGetSession,
			session: null,
			user: null,
			...((overrides?.locals as unknown as Record<string, unknown>) ?? {})
		},
		url,
		request: new Request(url.toString()),
		...(overrides as Partial<RequestEvent>)
	} as unknown as RequestEvent;
};

const resolve = vi.fn().mockResolvedValue(new Response('ok'));

describe('authGuard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('redirects unauthenticated user from /app to /login', async () => {
		const event = makeEvent({ url: new URL('https://example.com/app') });
		event.locals.safeGetSession = vi.fn().mockResolvedValue({ session: null, user: null });

		await expect(authGuard({ event, resolve })).rejects.toThrow();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('redirects unauthenticated user from /app to /login with redirect param', async () => {
		const event = makeEvent({ url: new URL('https://example.com/app?redirect=desktop') });
		event.locals.safeGetSession = vi.fn().mockResolvedValue({ session: null, user: null });

		try {
			await authGuard({ event, resolve });
		} catch (err: unknown) {
			// SvelteKit redirect throws a Redirect object
			expect(err).toBeDefined();
			expect((err as { status?: number }).status).toBe(303);
			expect((err as { location?: string }).location).toBe('/login?redirect=desktop');
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it('redirects authenticated user from /login to /app', async () => {
		const mockSession = { access_token: 'tok' } as unknown as App.Locals['session'];
		const mockUser = { id: 'u1' } as unknown as App.Locals['user'];
		const event = makeEvent({ url: new URL('https://example.com/login') });
		event.locals.safeGetSession = vi
			.fn()
			.mockResolvedValue({ session: mockSession, user: mockUser });

		try {
			await authGuard({ event, resolve });
		} catch (err: unknown) {
			expect(err).toBeDefined();
			expect((err as { status?: number }).status).toBe(303);
			expect((err as { location?: string }).location).toBe('/app');
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it('redirects authenticated user from /login?redirect=desktop to /app?redirect=desktop', async () => {
		const mockSession = { access_token: 'tok' } as unknown as App.Locals['session'];
		const mockUser = { id: 'u1' } as unknown as App.Locals['user'];
		const event = makeEvent({ url: new URL('https://example.com/login?redirect=desktop') });
		event.locals.safeGetSession = vi
			.fn()
			.mockResolvedValue({ session: mockSession, user: mockUser });

		try {
			await authGuard({ event, resolve });
		} catch (err: unknown) {
			expect(err).toBeDefined();
			expect((err as { status?: number }).status).toBe(303);
			expect((err as { location?: string }).location).toBe('/app?redirect=desktop');
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it('resolves normally for unauthenticated user on public route', async () => {
		const event = makeEvent({ url: new URL('https://example.com/') });
		event.locals.safeGetSession = vi.fn().mockResolvedValue({ session: null, user: null });

		await authGuard({ event, resolve });
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('sets session and user on locals when authenticated', async () => {
		const mockSession = { access_token: 'tok' } as unknown as App.Locals['session'];
		const mockUser = { id: 'u1' } as unknown as App.Locals['user'];
		const event = makeEvent({ url: new URL('https://example.com/app') });
		event.locals.safeGetSession = vi
			.fn()
			.mockResolvedValue({ session: mockSession, user: mockUser });

		await authGuard({ event, resolve });
		expect(event.locals.session).toBe(mockSession);
		expect(event.locals.user).toBe(mockUser);
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('sets null session and user on locals when unauthenticated', async () => {
		const event = makeEvent({ url: new URL('https://example.com/') });
		event.locals.safeGetSession = vi.fn().mockResolvedValue({ session: null, user: null });

		await authGuard({ event, resolve });
		expect(event.locals.session).toBeNull();
		expect(event.locals.user).toBeNull();
		expect(resolve).toHaveBeenCalledWith(event);
	});
});
