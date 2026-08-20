import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$lib/i18n', () => ({}));
vi.mock('$lib/auth/session', () => ({ fetchAuthSession: vi.fn() }));

const mockBrowserEnv = vi.hoisted(() => ({ browser: false }));
const mockLocaleSet = vi.hoisted(() => vi.fn());
const mockWaitLocale = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('$app/environment', () => ({
	get browser() {
		return mockBrowserEnv.browser;
	}
}));

vi.mock('svelte-i18n', () => ({
	locale: { set: mockLocaleSet },
	waitLocale: mockWaitLocale
}));

import { load } from './+layout';
import { authGuard } from '../hooks.server';

describe('+layout load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockBrowserEnv.browser = false;
		mockWaitLocale.mockResolvedValue(undefined);
	});

	it('returns the neutral server layout data without creating a Supabase client', async () => {
		const data = { session: { id: 'session-1' }, user: { id: 'user-1' } };

		await expect(load({ data } as never)).resolves.toEqual(data);
		expect(mockWaitLocale).toHaveBeenCalledOnce();
	});

	it('sets the browser locale before returning layout data', async () => {
		mockBrowserEnv.browser = true;
		const data = { session: null, user: null };

		await load({ data } as never);

		expect(mockLocaleSet).toHaveBeenCalledWith(expect.any(String));
	});

	it('returns an unauthenticated desktop authorization request through login', async () => {
		const url = new URL('https://web.test/app/desktop-auth?user_code=ab-cd');
		const event = {
			locals: { session: null, user: null },
			url,
			request: new Request(url)
		};
		const resolve = vi.fn();

		const response = await authGuard({ event, resolve } as never);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(
			'/login?next=' + encodeURIComponent('/app/desktop-auth?user_code=ab-cd')
		);
		expect(resolve).not.toHaveBeenCalled();
	});
});
