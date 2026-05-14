import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { getDb, getNextDisplayId } from '$lib/server/db';
import type { D1Database } from '@cloudflare/workers-types';
import logger from '$lib/server/logger';

vi.mock('$lib/server/db');
vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {} } };

describe('GET /api/chart/next-display-id', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as D1Database);
	});

	it('returns 401 when unauthenticated', async () => {
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: null } as App.Locals
		});
		expect(response.status).toBe(401);
	});

	it('returns the next display_id for the authenticated user', async () => {
		vi.mocked(getNextDisplayId).mockResolvedValue(42);
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({ nextDisplayId: 42 });
		expect(getNextDisplayId).toHaveBeenCalledWith(expect.anything(), 'user-1');
	});

	it('returns 500 on unexpected error', async () => {
		const error = new Error('DB error');
		vi.mocked(getNextDisplayId).mockRejectedValue(error);
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(500);
		expect(logger.error).toHaveBeenCalledWith('Error fetching next display_id:', {
			userId: 'user-1',
			error
		});
	});
});
