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
import { vi } from 'vitest';

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
});
