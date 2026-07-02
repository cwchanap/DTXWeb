import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedirect = vi.hoisted(() =>
	vi.fn((status: number, location: string) => {
		const err = new Error(`Redirect to ${location}`) as any;
		err.status = status;
		err.location = location;
		throw err;
	})
);

vi.mock('@sveltejs/kit', () => ({
	redirect: mockRedirect
}));

import { GOOGLE_AUTH_GENERIC_MESSAGE, GOOGLE_AUTH_UNAVAILABLE_MESSAGE } from '$lib/auth/google';
import { GET } from './+server';

const makeEvent = (
	rawUrl: string,
	exchangeError: Error | null = null,
	identities = [{ provider: 'email' }, { provider: 'google' }]
) => ({
	url: new URL(rawUrl),
	locals: {
		supabase: {
			auth: {
				exchangeCodeForSession: vi.fn().mockResolvedValue({ error: exchangeError }),
				getUserIdentities: vi.fn().mockResolvedValue({
					data: { identities },
					error: null
				}),
				signOut: vi.fn().mockResolvedValue({ error: null })
			}
		}
	}
});

describe('/auth/callback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects missing-code login callbacks to login with sanitized error', async () => {
		const event = makeEvent('http://localhost/auth/callback');

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
	});

	it('redirects provider errors to login with sanitized no-signup message', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?error=access_denied&error_description=Signups+not+allowed'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('preserves desktop intent when redirecting login errors', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?redirect=desktop&error=access_denied'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?redirect=desktop&error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('exchanges code and redirects standard login to /app', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc');

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app'
		});
		expect(event.locals.supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
	});

	it('exchanges code and redirects desktop login to /app?redirect=desktop', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc&redirect=desktop');

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app?redirect=desktop'
		});
	});

	it('redirects exchange errors to login', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc',
			new Error('Signups not allowed')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('rejects Google-only login sessions created outside the linking flow', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc', null, [
			{ provider: 'google' }
		]);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('rejects forged linking callbacks that produce a Google-only session', async () => {
		// An unauthenticated user can craft `link=google` in the callback URL and
		// initiate a Google OAuth flow with that redirect. If Google signups are
		// enabled, exchangeCodeForSession leaves them with a Google-only session.
		// The post-exchange identity check must reject this regardless of `link`.
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			null,
			[{ provider: 'google' }]
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('redirects successful account linking back to account page', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app/account?linked=google'
		});
	});

	it('redirects account-linking errors back to a safe account page', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?link=google&next=https://evil.example&error=denied'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});
});
