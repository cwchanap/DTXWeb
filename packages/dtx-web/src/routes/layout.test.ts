import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('$app/environment', () => ({
	browser: false
}));

import { load } from './+layout';
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';

afterEach(() => {
	vi.restoreAllMocks();
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

		const result = await load({
			data: { cookies: [] },
			depends: vi.fn(),
			fetch: vi.fn()
		} as any);

		expect(result.session).toEqual(mockSession);
		expect(result.user).toEqual(mockUser);
	});

	it('creates server client when not in browser', async () => {
		vi.mocked(isBrowser).mockReturnValue(false);

		await load({
			data: { cookies: [{ name: 'test', value: 'cookie' }] },
			depends: vi.fn(),
			fetch: vi.fn()
		} as any);

		expect(createServerClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-anon-key',
			expect.any(Object)
		);
	});

	it('creates browser client when in browser', async () => {
		vi.mocked(isBrowser).mockReturnValue(true);
		vi.mocked(createBrowserClient).mockReturnValue({
			auth: { getSession: mockGetSession, getUser: mockGetUser }
		} as any);

		await load({
			data: { cookies: [] },
			depends: vi.fn(),
			fetch: vi.fn()
		} as any);

		expect(createBrowserClient).toHaveBeenCalledWith(
			'https://test.supabase.co',
			'test-anon-key',
			expect.any(Object)
		);
	});

	it('calls depends with supabase:auth', async () => {
		const mockDepends = vi.fn();

		await load({
			data: { cookies: [] },
			depends: mockDepends,
			fetch: vi.fn()
		} as any);

		expect(mockDepends).toHaveBeenCalledWith('supabase:auth');
	});

	it('returns supabase client in result', async () => {
		const result = await load({
			data: { cookies: [] },
			depends: vi.fn(),
			fetch: vi.fn()
		} as any);

		expect(result.supabase).toBeDefined();
	});

	it('handles null session gracefully', async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });
		mockGetUser.mockResolvedValue({ data: { user: null } });

		const result = await load({
			data: { cookies: [] },
			depends: vi.fn(),
			fetch: vi.fn()
		} as any);

		expect(result.session).toBeNull();
		expect(result.user).toBeNull();
	});
});
