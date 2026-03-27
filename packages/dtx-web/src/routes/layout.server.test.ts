import { describe, it, expect, vi } from 'vitest';

import { load } from './+layout.server';

describe('+layout.server load', () => {
	it('returns session and cookies from safeGetSession', async () => {
		const mockSession = { access_token: 'tok', user: { id: 'u1' } };
		const mockCookies = [{ name: 'sb-token', value: 'abc' }];

		const event = {
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({ session: mockSession })
			},
			cookies: {
				getAll: vi.fn().mockReturnValue(mockCookies)
			}
		};

		const result = await load(event as any);

		expect(result.session).toEqual(mockSession);
		expect(result.cookies).toEqual(mockCookies);
	});

	it('returns null session when not authenticated', async () => {
		const event = {
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({ session: null })
			},
			cookies: {
				getAll: vi.fn().mockReturnValue([])
			}
		};

		const result = await load(event as any);

		expect(result.session).toBeNull();
		expect(result.cookies).toEqual([]);
	});
});
