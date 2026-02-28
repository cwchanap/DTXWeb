import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Session } from '@supabase/supabase-js';
import { getDb, getSimfileOwner } from '$lib/server/db';

// Mock logger
vi.mock('$lib/server/logger', () => ({
	default: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn()
	}
}));

vi.mock('$lib/server/db');

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
	objects: Array<{ key: string; size?: number; uploaded?: Date }> = [],
	secondPageObjects?: Array<{ key: string; size?: number; uploaded?: Date }>
): R2Bucket => {
	let callCount = 0;
	return {
		list: vi.fn().mockImplementation(() => {
			callCount++;
			if (secondPageObjects && callCount === 1) {
				return Promise.resolve({
					objects: objects.map((obj) => ({
						key: obj.key,
						size: obj.size ?? 1024,
						uploaded: obj.uploaded || new Date()
					})),
					truncated: true,
					cursor: 'page2-cursor'
				});
			}
			const page = secondPageObjects && callCount === 2 ? secondPageObjects : objects;
			return Promise.resolve({
				objects: page.map((obj) => ({
					key: obj.key,
					size: obj.size ?? 1024,
					uploaded: obj.uploaded || new Date()
				})),
				truncated: false
			});
		})
	} as unknown as R2Bucket;
};

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
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'test-user-id', is_published: 0 });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when user is not authenticated', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
				safeGetSession: async () => ({ session: null, user: null }),
				session: null,
				user: null
			}
		} as any);

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 400 when simfileID is not a valid integer', async () => {
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123abc' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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

	it('returns 401 when bearer token is invalid', async () => {
		const mockBucket = createMockBucket();
		const headers = new Headers({ Authorization: 'Bearer invalid-token' });

		const response = await GET({
			request: createMockRequest(headers),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		vi.mocked(getSimfileOwner).mockRejectedValue(new Error('db error'));
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		expect(data.error).toBe('Failed to list files');
	});

	it('returns 404 when simfile does not exist', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue(null);
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		vi.mocked(getSimfileOwner).mockResolvedValue({
			user_id: 'different-user-id',
			is_published: 0
		});
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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

		expect(mockBucket.list).toHaveBeenCalledWith({
			prefix: '123/',
			limit: 1000,
			cursor: undefined
		});
	});

	it('returns empty array when no files exist', async () => {
		const mockBucket = createMockBucket([]);

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DB: {} } },
			locals: {
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

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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

	it('returns all files across paginated R2 responses', async () => {
		const page1Objects = [{ key: '123/file1.dtx', size: 1024 }];
		const page2Objects = [{ key: '123/file2.wav', size: 2048 }];
		const mockBucket = createMockBucket(page1Objects, page2Objects);

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		expect(mockBucket.list).toHaveBeenCalledTimes(2);
	});

	it('returns 200 when simfile is published and requesting user is not the owner', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({
			user_id: 'different-owner-id',
			is_published: 1
		});
		const mockObjects = [
			{ key: '123/file1.dtx', size: 1024, uploaded: new Date('2024-01-01') }
		];
		const mockBucket = createMockBucket(mockObjects);

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		expect(data.files).toHaveLength(1);
		expect(data.files[0].fileName).toBe('file1.dtx');
	});

	it('returns 403 when simfile is unpublished and requesting user is not the owner', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({
			user_id: 'different-owner-id',
			is_published: 0
		});
		const mockBucket = createMockBucket();

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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

	it('returns 500 when R2 list is truncated but no cursor is provided', async () => {
		// Mock bucket that returns truncated without a cursor
		const mockBucket = {
			list: vi.fn().mockResolvedValue({
				objects: [{ key: '123/file1.dtx', size: 1024, uploaded: new Date() }],
				truncated: true
				// No cursor provided
			})
		} as unknown as R2Bucket;

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		expect(data.error).toBe('Failed to list all files: pagination cursor unavailable');
	});

	it('returns 500 when R2 list cursor is the same as previous cursor (infinite loop)', async () => {
		let callCount = 0;
		// Mock bucket that returns same cursor repeatedly
		const mockBucket = {
			list: vi.fn().mockImplementation(() => {
				callCount++;
				return Promise.resolve({
					objects: [{ key: '123/file1.dtx', size: 1024, uploaded: new Date() }],
					truncated: true,
					cursor: 'same-cursor' // Same cursor every time
				});
			})
		} as unknown as R2Bucket;

		const response = await GET({
			request: createMockRequest(),
			params: { simfileID: '123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
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
		expect(data.error).toBe('Failed to list all files: pagination cursor unavailable');
	});
});
