import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

// Mock logger
vi.mock('$lib/server/logger', () => ({
	default: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn()
	}
}));

// Create a mock Request object
const createMockRequest = (headers?: Headers): Request => {
	return {
		headers: headers ?? new Headers(),
		json: async () => ({}),
		text: async () => '',
		blob: async () => new Blob(),
		arrayBuffer: async () => new ArrayBuffer(0),
		formData: async () => new FormData(),
		clone: function () {
			return createMockRequest(headers);
		},
		body: null,
		bodyUsed: false
	} as Request;
};

// Mock R2 Bucket
const createMockBucket = (
	objects: Array<{ key: string; size?: number; uploaded?: Date }> = []
): R2Bucket =>
	({
		list: vi.fn().mockResolvedValue({
			objects: objects.map((obj) => ({
				key: obj.key,
				size: obj.size || 1024,
				uploaded: obj.uploaded || new Date()
			}))
		})
	}) as unknown as R2Bucket;

// Mock Supabase client
const createMockSupabaseClient = (
	simfileData: any | null = null,
	error: any = null,
	userData: any | null = null,
	userError: any = null
) =>
	({
		from: vi.fn(() => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn().mockResolvedValue({ data: simfileData, error })
				}))
			}))
		})),
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: userData, error: userError })
		}
	}) as unknown as SupabaseClient;

// Create mock session
const createMockSession = (userId: string = 'test-user-id'): Session => ({
	access_token: 'test-token',
	refresh_token: 'test-refresh-token',
	expires_in: 3600,
	token_type: 'bearer',
	user: {
		id: userId,
		email: 'test@example.com',
		aud: 'authenticated',
		created_at: new Date().toISOString(),
		app_metadata: {},
		user_metadata: {},
		phone: '',
		phone_confirmed_at: '',
		email_confirmed_at: new Date().toISOString()
	}
});

describe('/api/simFile/listFiles/[simfileID]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(),
				safeGetSession: async () => ({ session: null, user: null }),
				session: null,
				user: null
			}
		} as any);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 401 when bearer token is invalid', async () => {
		const mockBucket = createMockBucket();
		const headers = new Headers({ Authorization: 'Bearer invalid-token' });

		const response = await GET({
			request: createMockRequest(headers),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(
					null,
					null,
					{ user: null },
					new Error('Invalid')
				),
				safeGetSession: async () => ({ session: null, user: null }),
				session: null,
				user: null
			}
		} as any);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 500 when simfile lookup fails', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(null, new Error('db error')),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Failed to verify ownership');
	});

	it('returns 404 when simfile does not exist', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(null, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(404);
		const data = await response.json();
		expect(data.error).toBe('Simfile not found');
	});

	it('returns 403 when user does not own simfile', async () => {
		const mockBucket = createMockBucket();

		const simfileData = {
			id: 123,
			user_id: 'different-user-id'
		};

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(403);
		const data = await response.json();
		expect(data.error).toBe('Forbidden');
	});

	it('successfully lists files when user owns simfile', async () => {
		const mockObjects = [
			{ key: '123/file1.dtx', size: 1024, uploaded: new Date('2024-01-01') },
			{ key: '123/file2.wav', size: 2048, uploaded: new Date('2024-01-02') }
		];
		const mockBucket = createMockBucket(mockObjects);

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.files).toHaveLength(2);
		expect(data.files[0].fileName).toBe('file1.dtx');
		expect(data.files[0].key).toBe('123/file1.dtx');
		expect(data.files[0].size).toBe(1024);
		expect(data.files[1].fileName).toBe('file2.wav');
		expect(data.files[1].key).toBe('123/file2.wav');
		expect(data.files[1].size).toBe(2048);

		expect(mockBucket.list).toHaveBeenCalledWith({ prefix: '123/' });
	});

	it('returns empty array when no files exist', async () => {
		const mockBucket = createMockBucket([]);

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.files).toHaveLength(0);
	});

	it('returns 400 when simfileID is missing', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('SimfileID is required');
	});

	it('returns 500 when bucket is not available', async () => {
		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: {} },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Bucket not available');
	});

	it('filters out empty file names', async () => {
		const mockObjects = [
			{ key: '123/file1.dtx', size: 1024 },
			{ key: '123/', size: 0 }, // This should be filtered out
			{ key: '123/file2.wav', size: 2048 }
		];
		const mockBucket = createMockBucket(mockObjects);

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null),
				safeGetSession: async () => ({
					session: createMockSession(),
					user: createMockSession().user
				}),
				session: createMockSession(),
				user: createMockSession().user
			}
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.files).toHaveLength(2);
		expect(data.files[0].fileName).toBe('file1.dtx');
		expect(data.files[1].fileName).toBe('file2.wav');
	});
});
