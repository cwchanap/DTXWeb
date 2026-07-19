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
	{
		exchangeError,
		exchangeThrow,
		identitiesError,
		identitiesThrow,
		identities = [{ provider: 'email' }, { provider: 'google' }]
	}: {
		exchangeError?: Error | null;
		exchangeThrow?: Error;
		identitiesError?: Error;
		identitiesThrow?: Error;
		identities?: Array<{ provider: string }>;
	} = {}
) => ({
	url: new URL(rawUrl),
	locals: {
		supabase: {
			auth: {
				exchangeCodeForSession: exchangeThrow
					? vi.fn().mockRejectedValue(exchangeThrow)
					: vi.fn().mockResolvedValue({ error: exchangeError ?? null }),
				getUserIdentities: identitiesThrow
					? vi.fn().mockRejectedValue(identitiesThrow)
					: vi.fn().mockResolvedValue({
							data: { identities },
							error: identitiesError ?? null
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

	// `next` preserves the post-login return path (e.g. /app/score) through
	// the Google OAuth round-trip. The callback honors it on success so a
	// user whose session expired on /app/score returns there, not /app.
	it('redirects to the next path on successful login when next is an /app route', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&next=' + encodeURIComponent('/app/score')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app/score'
		});
	});

	// safeAppRedirectPath rejects anything outside /app* — a crafted `next`
	// can't pivot the post-login destination to an external URL.
	it('rejects a non-/app next and falls back to /app/account on success', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&next=' +
				encodeURIComponent('https://evil.example')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app/account'
		});
	});

	// Desktop intent keeps its own /app?redirect=desktop target; `next` is a
	// web-route concept and is never set for desktop (buildAuthCallbackUrl
	// guards this), but defend-in-depth: even if present, desktop wins.
	it('ignores next when redirect=desktop is set', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&redirect=desktop&next=' +
				encodeURIComponent('/app/score')
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: '/app?redirect=desktop'
		});
	});

	it('redirects exchange errors to login', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc', {
			exchangeError: new Error('Signups not allowed')
		});

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('rejects Google-only login sessions created outside the linking flow', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc', {
			identities: [{ provider: 'google' }]
		});

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
			{ identities: [{ provider: 'google' }] }
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
		const event = makeEvent('http://localhost/auth/callback?code=abc', {
			identitiesError: new Error('identity lookup failed')
		});

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('redirects to login with generic error when exchangeCodeForSession throws', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc', {
			exchangeThrow: new Error('network failure')
		});

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('redirects account-linking to account page when exchangeCodeForSession throws', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			{ exchangeThrow: new Error('network failure') }
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
	});

	it('signs out and redirects to login when getUserIdentities throws', async () => {
		const event = makeEvent('http://localhost/auth/callback?code=abc', {
			identitiesThrow: new Error('network failure')
		});

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('signs out and redirects to login when getUserIdentities throws during linking', async () => {
		// A forged `link=google` callback can produce a Google-only session,
		// and the /app guard doesn't re-check identities on subsequent requests.
		// When identities lookup throws, we can't verify a non-Google identity,
		// so the session must be cleared even for account-link callbacks.
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			{ identitiesThrow: new Error('network failure') }
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('signs out and redirects to login when getUserIdentities returns an error during linking', async () => {
		// Same rationale as the throw case: an identities-lookup error means
		// we cannot confirm a non-Google identity, so a forged `link=google`
		// Google-only session must not be retained.
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			{ identitiesError: new Error('identity lookup failed') }
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/login?error=${GOOGLE_AUTH_UNAVAILABLE_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).toHaveBeenCalled();
	});

	it('preserves session when a link callback lacks the Google identity', async () => {
		// The Google link did not actually attach the Google identity (e.g. the
		// provider returned success but the identity is temporarily absent), yet
		// the user still has their password identity. Preserve the session and
		// report the error on the account page.
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			{ identities: [{ provider: 'email' }] }
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_GENERIC_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});

	it('redirects account-linking to account page when exchangeCodeForSession returns an error', async () => {
		const event = makeEvent(
			'http://localhost/auth/callback?code=abc&link=google&next=/app/account',
			{ exchangeError: new Error('identity already linked to another user') }
		);

		await expect(GET(event as any)).rejects.toMatchObject({
			location: `/app/account?auth_error=${GOOGLE_AUTH_PROVIDER_CONFLICT_MESSAGE.replaceAll(' ', '+')}`
		});
		expect(event.locals.supabase.auth.signOut).not.toHaveBeenCalled();
	});
});
