import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
	mockGetSession: vi.fn()
}));

let browserValue = true;

vi.mock('$app/environment', () => ({
	get browser() {
		return browserValue;
	}
}));
vi.mock('@supabase/ssr', () => ({
	createBrowserClient: () => ({
		auth: { getSession: mockGetSession }
	})
}));
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'test-key'
}));

import { getAccessTokenOrNull, getAccessToken, tokenFromSession } from './token';

beforeEach(() => {
	browserValue = true;
	mockGetSession.mockReset();
});

describe('getAccessTokenOrNull', () => {
	it('returns null when not in browser', async () => {
		browserValue = false;
		const result = await getAccessTokenOrNull();
		expect(result).toBeNull();
	});

	it('returns token when session exists', async () => {
		mockGetSession.mockResolvedValue({
			data: { session: { access_token: 'abc123' } }
		});
		const result = await getAccessTokenOrNull();
		expect(result).toBe('abc123');
	});

	it('returns null when no session', async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });
		const result = await getAccessTokenOrNull();
		expect(result).toBeNull();
	});
});

describe('getAccessToken', () => {
	it('returns token when available', async () => {
		mockGetSession.mockResolvedValue({
			data: { session: { access_token: 'abc123' } }
		});
		const result = await getAccessToken();
		expect(result).toBe('abc123');
	});

	it('throws "User not authenticated" when not available', async () => {
		mockGetSession.mockResolvedValue({ data: { session: null } });
		await expect(getAccessToken()).rejects.toThrow('User not authenticated');
	});
});

describe('tokenFromSession', () => {
	it('returns token from session', () => {
		const session = { access_token: 'tok' } as any;
		expect(tokenFromSession(session)).toBe('tok');
	});

	it('returns null for null session', () => {
		expect(tokenFromSession(null)).toBeNull();
	});

	it('returns null for undefined session', () => {
		expect(tokenFromSession(undefined)).toBeNull();
	});
});
