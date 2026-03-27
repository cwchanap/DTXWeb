import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron BrowserWindow for protocol handling
vi.mock('electron', () => {
	const send = vi.fn();
	return {
		BrowserWindow: {
			getAllWindows: vi.fn(() => [{ webContents: { send } }])
		}
	};
});

// Mock Supabase client factory
const mockAuth = {
	verifyOtp: vi.fn(),
	setSession: vi.fn(),
	getSession: vi.fn(),
	signOut: vi.fn()
};

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: mockAuth }))
}));

// Use stubEnv to provide Vite-style env vars

describe('auth module', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await vi.resetModules();
		vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
		vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', 'anon');
	});

	it('initializes Supabase when env vars present', async () => {
		const auth = await import('./auth');
		const client = auth.initializeSupabase();
		expect(client).toBeTruthy();
	});

	it('verifyMagicLink stores session and returns success', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } },
			error: null
		});

		const url = 'https://example.com/callback?token_hash=hash123';
		const res = await auth.verifyMagicLink(url);
		expect(res.success).toBe(true);
		expect(res.session).toBeTruthy();
		expect(auth.getCurrentSession()).toEqual({ access_token: 'a', refresh_token: 'r' });
	});

	it('ensureSupabaseAuth returns true only when session exists', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		// No session yet
		expect(await auth.ensureSupabaseAuth()).toBe(false);

		// After magic link verification
		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } },
			error: null
		});
		await auth.verifyMagicLink('https://example.com/cb?token_hash=1');
		expect(await auth.ensureSupabaseAuth()).toBe(true);
	});

	it('validateSession sets and confirms session validity', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.setSession.mockResolvedValue({ error: null });
		mockAuth.getSession.mockResolvedValue({
			data: { session: { user: { id: 'u1' } } },
			error: null
		});

		const ok = await auth.validateSession({ accessToken: 'a', refreshToken: 'r' });
		expect(ok).toBe(true);
		expect(auth.getCurrentSession()).toBeTruthy();
	});

	it('logoutSession signs out when session exists', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		// Seed a session
		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } },
			error: null
		});
		await auth.verifyMagicLink('https://example.com/cb?token_hash=1');

		const res = await auth.logoutSession();
		expect(res).toBe(true);
		expect(mockAuth.signOut).toHaveBeenCalled();
	});

	it('logoutSession clears session and returns false when signOut throws', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } },
			error: null
		});
		await auth.verifyMagicLink('https://example.com/cb?token_hash=1');
		mockAuth.signOut.mockRejectedValue(new Error('signOut failed'));

		const res = await auth.logoutSession();
		expect(res).toBe(false);
		expect(auth.getCurrentSession()).toBeNull();
	});

	it('verifyMagicLink returns failure when no token found in URL', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		const res = await auth.verifyMagicLink('https://example.com/callback');
		expect(res.success).toBe(false);
		expect((res as any).error).toMatch(/token/i);
	});

	it('verifyMagicLink returns failure when verifyOtp returns error', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: null, user: null },
			error: new Error('otp failed')
		});

		const res = await auth.verifyMagicLink('https://example.com/cb?token_hash=bad');
		expect(res.success).toBe(false);
	});

	it('verifyMagicLink returns failure when no session is created', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.verifyOtp.mockResolvedValue({
			data: { session: null, user: null },
			error: null
		});

		const res = await auth.verifyMagicLink('https://example.com/cb?token_hash=x');
		expect(res.success).toBe(false);
		expect((res as any).error).toMatch(/session/i);
	});

	it('validateSession returns false when setSession fails', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.setSession.mockResolvedValue({ error: new Error('set failed') });

		const ok = await auth.validateSession({ accessToken: 'a', refreshToken: 'r' });
		expect(ok).toBe(false);
	});

	it('validateSession returns false when getSession returns no session', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.setSession.mockResolvedValue({ error: null });
		mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });

		const ok = await auth.validateSession({ accessToken: 'a', refreshToken: 'r' });
		expect(ok).toBe(false);
	});

	it('validateSession returns false when supabaseClient is null and initializeSupabase returns null', async () => {
		vi.stubEnv('PUBLIC_SUPABASE_URL', '');
		vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', '');
		const auth = await import('./auth');
		// supabaseClient starts as null; initializeSupabase() will return null due to missing env vars
		const ok = await auth.validateSession({ accessToken: 'a', refreshToken: 'r' });
		expect(ok).toBe(false);
	});

	it('validateSession returns false when setSession throws', async () => {
		const auth = await import('./auth');
		auth.initializeSupabase();

		mockAuth.setSession.mockRejectedValue(new Error('unexpected throw'));

		const ok = await auth.validateSession({ accessToken: 'a', refreshToken: 'r' });
		expect(ok).toBe(false);
	});

	it('getSupabaseClient returns the initialized client', async () => {
		const auth = await import('./auth');
		const client = auth.initializeSupabase();
		expect(auth.getSupabaseClient()).toBe(client);
	});

	describe('handleProtocolUrl', () => {
		it('handles magic link auth-callback URL and sends result to renderer', async () => {
			const auth = await import('./auth');
			const electron = await import('electron');
			auth.initializeSupabase();

			mockAuth.verifyOtp.mockResolvedValue({
				data: {
					session: { access_token: 'a', refresh_token: 'r' },
					user: { id: 'u1' }
				},
				error: null
			});

			const encoded = encodeURIComponent('https://example.com/cb?token_hash=abc123');
			await auth.handleProtocolUrl(`dtxweb://auth-callback?magic_link=${encoded}`);

			const send = electron.BrowserWindow.getAllWindows()[0].webContents.send;
			expect(send).toHaveBeenCalledWith(
				'magic-link-result',
				expect.objectContaining({ success: true })
			);
		});

		it('handles legacy access_token/refresh_token auth-callback', async () => {
			const auth = await import('./auth');
			const electron = await import('electron');

			await auth.handleProtocolUrl(
				'dtxweb://auth-callback?access_token=tok&refresh_token=ref'
			);

			const send = electron.BrowserWindow.getAllWindows()[0].webContents.send;
			expect(send).toHaveBeenCalledWith('auth-callback', {
				accessToken: 'tok',
				refreshToken: 'ref'
			});
		});

		it('skips sending when no windows open for legacy callback', async () => {
			const auth = await import('./auth');
			const electron = await import('electron');
			vi.mocked(electron.BrowserWindow.getAllWindows).mockReturnValueOnce([]);

			await auth.handleProtocolUrl(
				'dtxweb://auth-callback?access_token=tok&refresh_token=ref'
			);

			// Should not throw - and no windows means send is never called
		});

		it('handles non-auth-callback protocol URL without calling send', async () => {
			const auth = await import('./auth');
			const electron = await import('electron');

			await auth.handleProtocolUrl('dtxweb://other-action?param=value');

			const send = electron.BrowserWindow.getAllWindows()[0].webContents.send;
			expect(send).not.toHaveBeenCalled();
		});

		it('handles invalid URL gracefully without throwing', async () => {
			const auth = await import('./auth');

			// Should not throw
			await expect(auth.handleProtocolUrl('not-a-valid-url')).resolves.toBeUndefined();
		});
	});
});
