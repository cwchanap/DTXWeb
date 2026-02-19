import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DELETE } from './+server';
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
const createMockRequest = (method: string, url: string, headers?: Headers): Request => {
	return {
		method,
		url,
		headers: headers ?? new Headers(),
		json: async () => ({}),
		text: async () => '',
		blob: async () => new Blob(),
		arrayBuffer: async () => new ArrayBuffer(0),
		formData: async () => new FormData(),
		clone: function () {
			return createMockRequest(method, url, headers);
		},
		body: null,
		bodyUsed: false
	} as Request;
};

// Mock R2 Bucket
const createMockBucket = (
	objects: Array<{ key: string }> = [],
	truncated: boolean = false
): R2Bucket =>
	({
		list: vi.fn().mockResolvedValue({
			objects: objects.map((obj) => ({
				key: obj.key,
				size: 1024,
				uploaded: new Date()
			})),
			truncated
		}),
		delete: vi.fn().mockResolvedValue(undefined)
	}) as unknown as R2Bucket;

// Mock Supabase client
const createMockSupabaseClient = (
	simfileData: any | null = null,
	error: any = null,
	userData: any | null = null,
	userError: any = null,
	deleteError: any = null
) =>
	({
		from: vi.fn(() => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn().mockResolvedValue({ data: simfileData, error })
				}))
			})),
			delete: vi.fn(() => ({
				eq: vi.fn().mockResolvedValue({ error: deleteError })
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

describe('/api/simFile/delete/[simfileID]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const response = await DELETE({
			request,
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
		const request = createMockRequest(
			'DELETE',
			'http://localhost:5173/api/simFile/delete/123',
			headers
		);

		const response = await DELETE({
			request,
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
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const response = await DELETE({
			request,
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

	it('returns 401 when session exists but user is null', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const mockSession: Session = createMockSession();
		mockSession.user = null as any;

		const response = await DELETE({
			request,
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(),
				safeGetSession: async () => ({ session: mockSession, user: null }),
				session: mockSession,
				user: null
			}
		} as any);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 404 when simfile does not exist', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const response = await DELETE({
			request,
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

	it('returns 403 when user does not own the simfile', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'different-user-id'
		};

		const response = await DELETE({
			request,
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

	it('successfully deletes files when user owns the simfile', async () => {
		const mockObjects = [
			{ key: '123/file1.dtx' },
			{ key: '123/file2.wav' },
			{ key: '123/file3.mp3' }
		];
		const mockBucket = createMockBucket(mockObjects);
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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
		expect(data.message).toBe('Files deleted successfully');
		expect(data.deleted).toBe(3);
		expect(data.failed).toBe(0);
		expect(data.total).toBe(3);

		expect(mockBucket.list).toHaveBeenCalledWith({ prefix: '123/', limit: 10000 });
		expect(mockBucket.delete).toHaveBeenCalledTimes(3);
		for (const obj of mockObjects) {
			expect(mockBucket.delete).toHaveBeenCalledWith(obj.key);
		}
	});

	it('successfully deletes files with bearer token', async () => {
		const mockObjects = [{ key: '123/file1.dtx' }];
		const mockBucket = createMockBucket(mockObjects);
		const headers = new Headers({ Authorization: 'Bearer valid-token' });
		const request = createMockRequest(
			'DELETE',
			'http://localhost:5173/api/simFile/delete/123',
			headers
		);

		const simfileData = {
			id: 123,
			user_id: 'token-user-id'
		};

		// Simulate what the hooks would do after validating the bearer token
		const mockUser = createMockSession('token-user-id').user;

		const response = await DELETE({
			request,
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(simfileData, null, null, null),
				safeGetSession: async () => ({ session: null, user: null }),
				session: null,
				user: mockUser // Simulate hooks setting this after validation
			}
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.deleted).toBe(1);
		expect(data.failed).toBe(0);
	});

	it('returns success when no files exist to delete', async () => {
		const mockBucket = createMockBucket([]);
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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
		expect(data.message).toBe('No files to delete');
		expect(data.deleted).toBe(0);
	});

	it('returns 500 when simfile record delete fails', async () => {
		const mockObjects = [{ key: '123/file1.dtx' }];
		const mockBucket = createMockBucket(mockObjects);
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket } },
			locals: {
				supabase: createMockSupabaseClient(
					simfileData,
					null,
					null,
					null,
					new Error('Delete failed')
				),
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
		expect(data.error).toBe('Failed to delete simfile record after deleting R2 files');
	});

	it('returns 400 when simfileID is missing', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/');

		const response = await DELETE({
			request,
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
		expect(data.error).toBe('SimFile ID is required');
	});

	it('returns 400 when simfileID is invalid', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/abc');

		const response = await DELETE({
			request,
			params: { simfileID: 'abc' },
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
		expect(data.error).toBe('Invalid SimFile ID');
	});

	it('returns 400 when simfileID is not a whole number', async () => {
		const mockBucket = createMockBucket();
		const request = createMockRequest(
			'DELETE',
			'http://localhost:5173/api/simFile/delete/123.45'
		);

		const response = await DELETE({
			request,
			params: { simfileID: '123.45' },
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
		expect(data.error).toBe('Invalid SimFile ID');
	});

	it('returns 500 when bucket is not available', async () => {
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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

	it('handles partial failures gracefully', async () => {
		const mockObjects = [{ key: '123/file1.dtx' }, { key: '123/file2.wav' }];

		const mockBucket = {
			list: vi.fn().mockResolvedValue({
				objects: mockObjects.map((obj) => ({
					key: obj.key,
					size: 1024,
					uploaded: new Date()
				}))
			}),
			delete: vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error('Delete failed'))
		} as unknown as R2Bucket;

		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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

		// Now returns 200 even with partial failures since DB record is deleted
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.deleted).toBe(1);
		expect(data.failed).toBe(1);
		expect(data.total).toBe(2);
		expect(data.partialDeletion).toBe(true);
	});

	it('returns 200 with partialDeletion when all deletions fail but DB record is deleted', async () => {
		const mockObjects = [{ key: '123/file1.dtx' }];
		const mockBucket = {
			list: vi.fn().mockResolvedValue({
				objects: mockObjects.map((obj) => ({
					key: obj.key,
					size: 1024,
					uploaded: new Date()
				}))
			}),
			delete: vi.fn().mockRejectedValue(new Error('Delete failed'))
		} as unknown as R2Bucket;

		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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

		// Now returns 200 even with all file deletions failing since DB record is deleted
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.deleted).toBe(0);
		expect(data.failed).toBe(1);
		expect(data.total).toBe(1);
		expect(data.partialDeletion).toBe(true);
	});

	it('successfully deletes files across multiple paginated R2 responses', async () => {
		let listCallCount = 0;
		const mockBucket = {
			list: vi.fn().mockImplementation(() => {
				listCallCount++;
				if (listCallCount === 1) {
					return Promise.resolve({
						objects: [{ key: '123/file1.dtx' }],
						truncated: true,
						cursor: 'page2-cursor'
					});
				}
				return Promise.resolve({
					objects: [{ key: '123/file2.wav' }],
					truncated: false
				});
			}),
			delete: vi.fn().mockResolvedValue(undefined)
		} as unknown as R2Bucket;

		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');
		const simfileData = { id: 123, user_id: 'test-user-id' };

		const response = await DELETE({
			request,
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
		expect(data.total).toBe(2);
		expect(data.deleted).toBe(2);
		expect(data.failed).toBe(0);
		expect(data.partialDeletion).toBe(false);
		expect(mockBucket.list).toHaveBeenCalledTimes(2);
		expect(mockBucket.list).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cursor: 'page2-cursor' })
		);
	});

	it('returns 500 when list is truncated', async () => {
		const mockObjects = [{ key: '123/file1.dtx' }];
		const mockBucket = createMockBucket(mockObjects, true);
		const request = createMockRequest('DELETE', 'http://localhost:5173/api/simFile/delete/123');

		const simfileData = {
			id: 123,
			user_id: 'test-user-id'
		};

		const response = await DELETE({
			request,
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

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Failed to list all files for deletion');
		expect(data.message).toBe(
			'File listing was truncated but pagination cursor was invalid; some files may not have been deleted'
		);
	});
});
