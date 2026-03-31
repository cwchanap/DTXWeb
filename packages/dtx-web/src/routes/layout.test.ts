import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

vi.mock('$lib/i18n', () => ({}));

vi.mock('svelte-i18n', () => ({
	locale: { set: vi.fn() },
	waitLocale: vi.fn().mockResolvedValue(undefined)
}));

const mockGetSession = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { session: null } }));
const mockGetUser = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { user: null } }));

vi.mock('@supabase/ssr', () => ({
	isBrowser: vi.fn().mockReturnValue(false),
	createBrowserClient: vi.fn().mockReturnValue({
		auth: { getSession: mockGetSession, getUser: mockGetUser }
	}),
	createServerClient: vi.fn().mockReturnValue({
		auth: { getSession: mockGetSession, getUser: mockGetUser }
	})
}));

const mockBrowserEnv = vi.hoisted(() => ({ browser: false }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mockBrowserEnv.browser;
	}
}));

import { load } from './+layout';
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { locale } from 'svelte-i18n';

afterEach(() => {
	vi.restoreAllMocks();
});

const makeLoadArgs = (cookies: Array<{ name: string; value: string }> = []) => ({
	data: { cookies },
	depends: vi.fn(),
	fetch: vi.fn()
});

describe('+layout load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetSession.mockResolvedValue({ data: { session: null } });
		mockGetUser.mockResolvedValue({ data: { user: null } });
		vi.mocked(createServerClient).mockReturnValue({
			auth: { getSession: mockGetSession, getUser: mockGetUser }
		} as any);
		vi.mocked(createBrowserClient).mockReturnValue({
			auth: { getSession: mockGetSession, getUser: mockGetUser }
		} as any);
	});

	it('returns session and user from supabase.auth', async () => {
		const mockSession = { access_token: 'test-token', user: { id: 'user-1' } };
		const mockUser = { id: 'user-1', email: 'test@example.com' };
		mockGetSession.mockResolvedValue({ data: { session: mockSession } });
		mockGetUser.mockResolvedValue({ data: { user: mockUser } });

		const result = await load(makeLoadArgs() as any);

		expect(result.session).toEqual(mockSession);
		expect(result.user).toEqual(mockUser);
	});

	it('creates server client when not in browser', async () => {
		vi.mocked(isBrowser).mockReturnValue(false);
		const mockFetch = vi.fn();
		const cookies = [{ name: 'test', value: 'cookie' }];

		await load({ data: { cookies }, depends: vi.fn(), fetch: mockFetch } as any);

		expect(createServerClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-anon-key',
			expect.objectContaining({
				global: expect.objectContaining({ fetch: mockFetch }),
				cookies: expect.objectContaining({ getAll: expect.any(Function) })
			})
		);
		expect(createBrowserClient).not.toHaveBeenCalled();

		// Verify cookies.getAll returns the passed-in cookies array
		const callOptions = vi.mocked(createServerClient).mock.calls[0][2] as any;
		expect(callOptions.cookies.getAll()).toEqual(cookies);
	});

	it('creates browser client when in browser', async () => {
		vi.mocked(isBrowser).mockReturnValue(true);
		vi.mocked(createBrowserClient).mockReturnValue({
			auth: { getSession: mockGetSession, getUser: mockGetUser }
		} as any);

		await load(makeLoadArgs() as any);

		expect(createBrowserClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-anon-key',
			expect.any(Object)
		);
	});

	it('calls depends with supabase:auth', async () => {
		const mockDepends = vi.fn();

		await load({ ...makeLoadArgs(), depends: mockDepends } as any);

		expect(mockDepends).toHaveBeenCalledWith('supabase:auth');
	});

	it('returns supabase client in result', async () => {
		const result = await load(makeLoadArgs() as any);

		expect(result.supabase).toBeDefined();
	});

	it('handles null session gracefully', async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });
		mockGetUser.mockResolvedValue({ data: { user: null } });

		const result = await load(makeLoadArgs() as any);

		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
	});

	it('sets locale when browser is true', async () => {
		mockBrowserEnv.browser = true;
		try {
			await load(makeLoadArgs() as any);
			expect(vi.mocked(locale.set)).toHaveBeenCalledWith(expect.any(String));
		} finally {
			mockBrowserEnv.browser = false;
		}
	});
});
