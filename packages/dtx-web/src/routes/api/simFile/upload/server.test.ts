import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Session } from '@supabase/supabase-js';
import { getDb } from '$lib/server/db';
import { getSimfileOwner } from '@dtx/common/server';

// Mock logger
vi.mock('@dtx/common/server', () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn()
	},
	getSimfileOwner: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn()
}));

// Mock R2 Bucket
const createMockBucket = (): R2Bucket =>
	({
		put: vi.fn().mockResolvedValue({ success: true })
	}) as unknown as R2Bucket;

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
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'test-user-id', is_published: 0 });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 400 when file exceeds 50MB size limit', async () => {
		const oversizedFile = new File(['x'], 'test.dtx', { type: 'application/octet-stream' });
		Object.defineProperty(oversizedFile, 'size', { value: 51 * 1024 * 1024 });

		const formData = new FormData();
		formData.append('file', oversizedFile);
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
			platform: { env: { DTXFILE_BUCKET: createMockBucket(), DB: {} } },
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
		expect(data.error).toBe('Invalid input data');
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

	it('returns 404 when simfile does not exist', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue(null);
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

	it('returns 500 when simfile lookup fails', async () => {
		vi.mocked(getSimfileOwner).mockRejectedValue(new Error('db error'));
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
		expect(data.error).toBe('Internal server error');
	});

	it('returns 403 when user does not own simfile', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({
			user_id: 'different-user-id',
			is_published: 0
		});
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
		expect(data.error).toBe('Invalid input data');
	});

	it('returns 400 when simFileId is not a valid integer', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123abc');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 400 when simFileId is hexadecimal', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '0x10');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 400 when simFileId is negative', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '-123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 400 when simFileId uses scientific notation', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '1e2');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 400 when simFileId is whitespace-padded', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', ' 123 ');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

		const response = await POST({
			request,
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
		// Note: The endpoint checks `if (!result)` which is a specific check
		// If upload fails for other reasons, it returns generic error
		expect(data.error).toBeTruthy();
	});

	it('accepts bearer token authentication from desktop app', async () => {
		// Add arrayBuffer method to File prototype for jsdom environment
		const originalArrayBuffer = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = async function () {
			return new ArrayBuffer(8);
		};

		try {
			const mockBucket = createMockBucket();
			const formData = new FormData();
			formData.append('file', new File(['content'], 'test.wav'));
			formData.append('simFileId', '123');

			const request = createMockRequest(
				'POST',
				'http://localhost:5173/api/simFile/upload',
				formData
			);
			// Add Authorization header for bearer token
			request.headers.set('Authorization', 'Bearer test-bearer-token');

			// Simulate what the hooks would do after validating the bearer token
			const mockUser = createMockSession().user;

			const response = await POST({
				request,
				platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
				locals: {
					safeGetSession: async () => ({ session: null, user: null }),
					session: null,
					user: mockUser // Simulate hooks setting this after validation
				}
			} as any);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.message).toBe('File uploaded successfully');
		} finally {
			// Restore original method
			if (originalArrayBuffer) {
				File.prototype.arrayBuffer = originalArrayBuffer;
			} else {
				// @ts-expect-error - Removing non-existent property from prototype
				delete File.prototype.arrayBuffer;
			}
		}
	});

	it('returns 401 when bearer token is invalid', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);
		// Add invalid Authorization header
		request.headers.set('Authorization', 'Bearer invalid-token');

		const response = await POST({
			request,
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

	it('returns 401 when no cookie session and no bearer token', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);
		// No Authorization header and no cookie session

		const response = await POST({
			request,
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

	it('returns 403 when bearer token user does not own simfile', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({
			user_id: 'different-user-id',
			is_published: 0
		});
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);
		request.headers.set('Authorization', 'Bearer test-bearer-token');

		// Simulate what the hooks would do after validating the bearer token
		const mockUser = createMockSession('test-user-id').user;

		const response = await POST({
			request,
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } },
			locals: {
				safeGetSession: async () => ({ session: null, user: null }),
				session: null,
				user: mockUser // Simulate hooks setting this after validation
			}
		} as any);

		expect(response.status).toBe(403);
		const data = await response.json();
		expect(data.error).toBe('Forbidden');
	});

	it('returns 500 when R2 bucket.put throws an exception', async () => {
		const throwingBucket = {
			put: vi.fn().mockRejectedValue(new Error('R2 connection error'))
		} as unknown as R2Bucket;

		const file = new File(['content'], 'test.dtx', { type: 'application/octet-stream' });
		const formData = new FormData();
		formData.append('file', file);
		formData.append('simFileId', '123');

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
			platform: { env: { DTXFILE_BUCKET: throwingBucket, DB: {} } },
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
		expect(data.error).toBe('Internal server error');
	});

	it('returns 400 when simFileId passes digit check but exceeds safe integer range', async () => {
		const mockBucket = createMockBucket();
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.wav'));
		formData.append('simFileId', '99999999999999999999'); // too large, not a safe integer

		const request = createMockRequest(
			'POST',
			'http://localhost:5173/api/simFile/upload',
			formData
		);

		const response = await POST({
			request,
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

	it('returns 500 when bucket.put returns null (R2 upload failure)', async () => {
		const originalArrayBuffer = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = async function () {
			return new ArrayBuffer(8);
		};

		try {
			const nullResultBucket = {
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

			const response = await POST({
				request,
				platform: { env: { DTXFILE_BUCKET: nullResultBucket, DB: {} } },
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
			expect(data.error).toBe('Failed to upload file');
		} finally {
			if (originalArrayBuffer) {
				File.prototype.arrayBuffer = originalArrayBuffer;
			} else {
				// @ts-expect-error - Removing non-existent property from prototype
				delete File.prototype.arrayBuffer;
			}
		}
	});
});
