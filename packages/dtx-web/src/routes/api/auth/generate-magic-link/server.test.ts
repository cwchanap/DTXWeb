import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateLink = vi.hoisted(() => vi.fn());
const mockCreateClient = vi.hoisted(() =>
	vi.fn().mockReturnValue({
		auth: {
			admin: {
				generateLink: mockGenerateLink
			}
		}
	})
);

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
	}
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: mockCreateClient
}));

import { POST } from './+server';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/auth/generate-magic-link', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({ session: null, user: null })
			}
		} as any);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 400 when user has no email', async () => {
		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: null } }
				})
			}
		} as any);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('User email not found');
	});

	it('returns 500 when generateLink returns an error', async () => {
		mockGenerateLink.mockResolvedValue({
			data: null,
			error: { message: 'Failed to generate' }
		});

		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: 'user@example.com' } }
				})
			}
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Failed to generate magic link');
	});

	it('returns 500 when action_link is missing from response', async () => {
		mockGenerateLink.mockResolvedValue({
			data: { properties: {} },
			error: null
		});

		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: 'user@example.com' } }
				})
			}
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Invalid magic link generated');
	});

	it('returns magic link URL on success', async () => {
		const magicLinkUrl = 'https://example.supabase.co/auth/v1/verify?token=abc123';
		mockGenerateLink.mockResolvedValue({
			data: { properties: { action_link: magicLinkUrl } },
			error: null
		});

		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: 'user@example.com' } }
				})
			}
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.magicLinkUrl).toBe(magicLinkUrl);
		expect(data.success).toBe(true);
	});

	it('calls generateLink with correct email and redirect', async () => {
		const magicLinkUrl = 'https://example.supabase.co/auth/v1/verify?token=xyz';
		mockGenerateLink.mockResolvedValue({
			data: { properties: { action_link: magicLinkUrl } },
			error: null
		});

		await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: 'test@example.com' } }
				})
			}
		} as any);

		expect(mockGenerateLink).toHaveBeenCalledWith({
			type: 'magiclink',
			email: 'test@example.com',
			options: { redirectTo: 'dtx://auth-callback' }
		});
	});

	it('returns 500 when an unexpected error is thrown', async () => {
		mockGenerateLink.mockRejectedValue(new Error('Unexpected failure'));

		const response = await POST({
			locals: {
				safeGetSession: vi.fn().mockResolvedValue({
					session: { user: { id: 'user-1', email: 'user@example.com' } }
				})
			}
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Internal server error');
	});
});
