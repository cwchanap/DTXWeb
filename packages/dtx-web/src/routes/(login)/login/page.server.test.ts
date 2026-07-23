import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFail = vi.hoisted(() => vi.fn((status: number, data: object) => ({ status, data })));
const mockRedirect = vi.hoisted(() =>
	vi.fn((status: number, location: string) => {
		const err = new Error(`Redirect to ${location}`) as any;
		err.status = status;
		err.location = location;
		throw err;
	})
);

vi.mock('@sveltejs/kit', () => ({
	fail: mockFail,
	redirect: mockRedirect
}));

import { GOOGLE_AUTH_UNAVAILABLE_MESSAGE } from '$lib/auth/google';
import { actions } from './+page.server';

const makeEvent = (fields: Record<string, string>, signInError: Error | null = null) => ({
	request: {
		formData: vi.fn().mockResolvedValue({
			get: (key: string) => fields[key] ?? null
		})
	},
	url: new URL('http://localhost/login'),
	locals: {
		supabase: {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({ error: signInError }),
				signInWithOAuth: vi.fn().mockResolvedValue({
					data: { url: 'https://supabase.example/auth/google' },
					error: null
				})
			}
		}
	}
});

describe('login/+page.server actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('login action', () => {
		it('returns fail(400) when signInWithPassword errors', async () => {
			const authError = new Error('Invalid credentials');
			const event = makeEvent({ email: 'a@b.com', password: 'wrong' }, authError);

			const result = await actions.login(event as any);

			expect(mockFail).toHaveBeenCalledWith(400, {
				success: false,
				error: 'Invalid credentials'
			});
			expect(result).toEqual({
				status: 400,
				data: { success: false, error: 'Invalid credentials' }
			});
		});

		it('redirects to /app when login succeeds without desktop redirect', async () => {
			const event = makeEvent({ email: 'a@b.com', password: 'correct', redirect: '' });

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app'
			});
		});

		it('redirects to /app?redirect=desktop when redirect=desktop is set', async () => {
			const event = makeEvent({
				email: 'a@b.com',
				password: 'correct',
				redirect: 'desktop'
			});

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app?redirect=desktop'
			});
		});

		// `next` preserves the post-login return path (e.g. /app/score) so
		// re-authentication after a session expiry returns the user to the
		// page they were on, not the default /app.
		it('redirects to the next path when next is an /app route', async () => {
			const event = makeEvent({
				email: 'a@b.com',
				password: 'correct',
				next: '/app/score'
			});

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app/score'
			});
		});

		it('falls back to /app when next is absent', async () => {
			const event = makeEvent({ email: 'a@b.com', password: 'correct' });

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app'
			});
		});

		// safeAppRedirectPath rejects anything outside /app* — a crafted
		// `next` can't pivot the post-login destination to an external URL.
		it('rejects a non-/app next path and falls back to /app/account', async () => {
			const event = makeEvent({
				email: 'a@b.com',
				password: 'correct',
				next: 'https://evil.example/path'
			});

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app/account'
			});
		});

		it('ignores next when redirect=desktop is set', async () => {
			const event = makeEvent({
				email: 'a@b.com',
				password: 'correct',
				redirect: 'desktop',
				next: '/app/score'
			});

			await expect(actions.login(event as any)).rejects.toMatchObject({
				location: '/app?redirect=desktop'
			});
		});
	});

	describe('google action', () => {
		it('starts Google OAuth with a web callback', async () => {
			const event = makeEvent({ redirect: '' });

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		it('starts Google OAuth with a desktop callback when redirect=desktop is set', async () => {
			const event = makeEvent({ redirect: 'desktop' });

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback?redirect=desktop',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		// `next` is threaded into the OAuth callback URL so the callback can
		// honor it after the Google round-trip. Validated via
		// safeAppRedirectPath before being attached.
		it('threads next into the web callback URL when next is an /app route', async () => {
			const event = makeEvent({ next: '/app/score' });

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback?next=%2Fapp%2Fscore',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		it('omits next from the callback URL when next is absent', async () => {
			const event = makeEvent({});

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		it('rejects a non-/app next and falls back to /app/account in the callback URL', async () => {
			const event = makeEvent({ next: 'https://evil.example/path' });

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback?next=%2Fapp%2Faccount',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		it('does not thread next into the callback URL when redirect=desktop is set', async () => {
			const event = makeEvent({ redirect: 'desktop', next: '/app/score' });

			await expect(actions.google(event as any)).rejects.toMatchObject({
				location: 'https://supabase.example/auth/google'
			});

			expect(event.locals.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback?redirect=desktop',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
		});

		it('returns a sanitized failure when Supabase rejects Google OAuth', async () => {
			const event = makeEvent({ redirect: '' });
			event.locals.supabase.auth.signInWithOAuth.mockResolvedValueOnce({
				data: { url: null },
				error: new Error('Signups not allowed for this instance')
			});

			const result = await actions.google(event as any);

			expect(mockFail).toHaveBeenCalledWith(400, {
				success: false,
				error: GOOGLE_AUTH_UNAVAILABLE_MESSAGE
			});
			expect(result).toEqual({
				status: 400,
				data: { success: false, error: GOOGLE_AUTH_UNAVAILABLE_MESSAGE }
			});
		});
	});
});
