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

import { actions } from './+page.server';

const makeEvent = (fields: Record<string, string>, signInError: Error | null = null) => ({
	request: {
		formData: vi.fn().mockResolvedValue({
			get: (key: string) => fields[key] ?? null
		})
	},
	locals: {
		supabase: {
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({ error: signInError })
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
});
