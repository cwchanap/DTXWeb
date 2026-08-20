import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('$lib/i18n', () => ({}));

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
});
