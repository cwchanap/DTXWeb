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
