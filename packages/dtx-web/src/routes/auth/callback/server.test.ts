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

import {
	GOOGLE_AUTH_GENERIC_MESSAGE,
	GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE,
	GOOGLE_AUTH_UNAVAILABLE_MESSAGE
} from '$lib/auth/google';
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

const makeEventWithIdentitiesError = (
	rawUrl: string,
	identitiesError: Error,
	identities = [{ provider: 'email' }, { provider: 'google' }]
) => ({
	url: new URL(rawUrl),
	locals: {
		supabase: {
			auth: {
				exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
				getUserIdentities: vi.fn().mockResolvedValue({
					data: { identities },
					error: identitiesError
				}),
				signOut: vi.fn().mockResolvedValue({ error: null })
			}
		}
	}
});

const makeEventWithThrowingExchange = (rawUrl: string) => ({
	url: new URL(rawUrl),
	locals: {
		supabase: {
			auth: {
				exchangeCodeForSession: vi.fn().mockRejectedValue(new Error('network failure')),
				getUserIdentities: vi.fn().mockResolvedValue({
					data: { identities: [{ provider: 'email' }, { provider: 'google' }] },
					error: null
				}),
				signOut: vi.fn().mockResolvedValue({ error: null })
			}
		}
	}
});

const makeEventWithThrowingIdentities = (rawUrl: string) => ({
	url: new URL(rawUrl),
	locals: {
		supabase: {
			auth: {
				exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
				getUserIdentities: vi.fn().mockRejectedValue(new Error('network failure')),
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

	it('prefers error_description over error when sanitizing provider errors', async () => {
		// `error=access_denied` alone would sanitize to the generic message, but
		// `error_description=identity already linked` must win and produce the
		// provider-conflict message. This locks in the ?? precedence in +server.ts.
		const event = makeEvent(
			'http://localhost/auth/callback?error=access_denied&error_description=identity+already+linked'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE.replaceAll(' ', '+')}`
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

	it('signs out and redirects to login when getUserIdentities returns an error', async () => {
		const event = makeEventWithIdentitiesError(
			'http://localhost/auth/callback?code=abc',
			new Error('identity lookup failed')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('redirects to login with generic error when exchangeCodeForSession throws', async () => {
		const event = makeEventWithThrowingExchange('http://localhost/auth/callback?code=abc');

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('redirects account-linking to account page when exchangeCodeForSession throws', async () => {
		const event = makeEventWithThrowingExchange(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('signs out and redirects to login when getUserIdentities throws', async () => {
		const event = makeEventWithThrowingIdentities('http://localhost/auth/callback?code=abc');

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('preserves session and redirects to account page when getUserIdentities throws during linking', async () => {
		const event = makeEventWithThrowingIdentities(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account'
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});

	it('preserves session when getUserIdentities returns an error during linking', async () => {
		// A signed-in user whose Google link callback hits an identities-lookup
		// error (return, not throw) must keep their password session and be sent
		// back to the account page with an error — not signed out and sent to
		// /login like a Google-only login session.
		const event = makeEventWithIdentitiesError(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			new Error('identity lookup failed')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});

	it('preserves session when a link callback lacks the Google identity', async () => {
		// The Google link did not actually attach the Google identity (e.g. the
		// provider returned success but the identity is temporarily absent), yet
		// the user still has their password identity. Preserve the session and
		// report the error on the account page.
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			null,
			[{ provider: 'email' }]
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});

	it('redirects account-linking to account page when exchangeCodeForSession returns an error', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			new Error('identity already linked to another user')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});
});
