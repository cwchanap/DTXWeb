import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from './+server';
import { getDb } from '$lib/server/db';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserProfile, upsertUserProfile } from '@dtx/common/server';

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn()
}));
vi.mock('@dtx/common/server', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
	getUserProfile: vi.fn(),
	upsertUserProfile: vi.fn()
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {} } };
const mockProfile = { id: 1, user_id: 'user-1', username: 'testuser' };

const createMockRequest = (body: unknown = {}): Request =>
	({ json: async () => body }) as unknown as Request;

describe('GET /api/user/profile', () => {
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

	it('returns 404 when profile not found', async () => {
		vi.mocked(getUserProfile).mockResolvedValue(null);
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(404);
	});

	it('returns 200 with profile data', async () => {
		vi.mocked(getUserProfile).mockResolvedValue(mockProfile);
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual(mockProfile);
	});

	it('returns 500 on unexpected error', async () => {
		vi.mocked(getUserProfile).mockRejectedValue(new Error('DB error'));
		const response = await GET({
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(500);
	});
});

describe('PUT /api/user/profile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as D1Database);
	});

	it('returns 401 when unauthenticated', async () => {
		const response = await PUT({
			request: createMockRequest({ username: 'testuser' }),
			platform: mockPlatform as App.Platform,
			locals: { user: null } as App.Locals
		});
		expect(response.status).toBe(401);
	});

	it('returns 400 when username is missing', async () => {
		const response = await PUT({
			request: createMockRequest({}),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for malformed JSON', async () => {
		const request = {
			json: async () => {
				throw new SyntaxError('Unexpected token');
			}
		} as unknown as Request;

		const response = await PUT({
			request,
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid JSON');
	});

	it('trims username before upsert', async () => {
		vi.mocked(upsertUserProfile).mockResolvedValue(mockProfile);
		await PUT({
			request: createMockRequest({ username: '  testuser  ' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(upsertUserProfile).toHaveBeenCalledWith(expect.anything(), {
			user_id: 'user-1',
			username: 'testuser'
		});
	});

	it('returns 400 when username exceeds 30 characters', async () => {
		const response = await PUT({
			request: createMockRequest({ username: 'a'.repeat(31) }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Username must be 1-30 characters');
	});

	it('returns 400 when username is not a string', async () => {
		const response = await PUT({
			request: createMockRequest({ username: 123 }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(400);
	});

	it('returns 200 with upserted profile', async () => {
		vi.mocked(upsertUserProfile).mockResolvedValue(mockProfile);
		const response = await PUT({
			request: createMockRequest({ username: 'testuser' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual(mockProfile);
		expect(upsertUserProfile).toHaveBeenCalledWith(expect.anything(), {
			user_id: 'user-1',
			username: 'testuser'
		});
	});

	it('returns 500 on unexpected error', async () => {
		vi.mocked(upsertUserProfile).mockRejectedValue(new Error('DB error'));
		const response = await PUT({
			request: createMockRequest({ username: 'testuser' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(500);
	});
});
