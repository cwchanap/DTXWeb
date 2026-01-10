import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';
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

// Mock R2 Bucket
const createMockBucket = (): R2Bucket =>
	({
		put: vi.fn().mockResolvedValue({ success: true })
	}) as unknown as R2Bucket;

// Mock Supabase client
const createMockSupabaseClient = (simfileData: any | null = null, error: any = null) =>
	({
		from: vi.fn(() => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn().mockResolvedValue({ data: simfileData, error })
				}))
			}))
		}))
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

// Create mock request with FormData
const createMockRequest = (method: string, url: string, formData: FormData): Request => {
	return {
		method,
		url,
		headers: new Headers(),
		json: async () => ({}),
		text: async () => '',
		blob: async () => new Blob(),
		arrayBuffer: async () => new ArrayBuffer(0),
		formData: async () => formData,
		clone: function () {
			return createMockRequest(method, url, formData);
		},
		body: null,
		bodyUsed: false
	} as Request;
};

describe('/api/simFile/upload', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 404 when simfile does not exist', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const simfileData = {
			id: 123,
			user_id: 'different-user-id'
		};

		const response = await POST({
			request,
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

	it('returns 400 when file is missing', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient({ id: 123, user_id: 'test-user-id' }, null),
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
		expect(data.error).toBe('Invalid input data');
	});

	it('returns 400 when simFileId is missing', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient({ id: 123, user_id: 'test-user-id' }, null),
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
		expect(data.error).toBe('Invalid input data');
	});

	it('returns 500 when bucket is not available', async () => {
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await POST({
			request,
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

	it('returns 500 when upload to R2 fails', async () => {
		const mockBucket = {
			put: vi.fn().mockResolvedValue(null)
		} as unknown as R2Bucket;

		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await POST({
			request,
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

		expect(response.status).toBe(500);
		const data = await response.json();
		// Note: The endpoint checks `if (!result)` which is a specific check
		// If upload fails for other reasons, it returns generic error
		expect(data.error).toBeTruthy();
	});
});
