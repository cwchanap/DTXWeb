import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { getDb, getSimfileOwner } from '$lib/server/db';
import { listAllR2Objects } from '$lib/server/r2';
import { fetchR2Entries, buildZip } from '$lib/server/zipBuilder';
import { tryConsumeRateLimit } from '$lib/server/rateLimiter';
import logger from '$lib/server/logger';

vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(), getSimfileOwner: vi.fn() }));
vi.mock('$lib/server/r2', () => ({ listAllR2Objects: vi.fn() }));
vi.mock('$lib/server/zipBuilder', () => ({ fetchR2Entries: vi.fn(), buildZip: vi.fn() }));
vi.mock('$lib/server/rateLimiter', () => ({
	getClientIp: vi.fn((request: Request) => {
		const forwardedIp =
			request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
		const ip = forwardedIp?.split(',')[0]?.trim();
		return !ip || ip.toLowerCase() === 'unknown' ? null : ip;
	}),
	tryConsumeRateLimit: vi.fn()
}));

const createRequest = (body: unknown, headers?: Record<string, string>): Request =>
	({
		headers: new Headers({ 'cf-connecting-ip': '1.2.3.4', ...headers }),
		json: async () => body
	}) as unknown as Request;

const createMockPlatform = (withKv = true) => ({
	env: {
		DTXFILE_BUCKET: {},
		DB: {},
		...(withKv ? { RATE_LIMIT: {} } : {})
	}
});

describe('POST /api/simFile/download/bulk', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as never);
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'owner', is_published: 1 });
		vi.mocked(listAllR2Objects).mockResolvedValue([
			{ key: '1/file.dtx', size: 512, uploaded: new Date() }
		]);
		vi.mocked(fetchR2Entries).mockResolvedValue([
			{ path: 'chart-1/file.dtx', data: new ArrayBuffer(512) }
		]);
		vi.mocked(buildZip).mockResolvedValue(new Uint8Array([0x50, 0x4b]));
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({
			allowed: true,
			remainingBytes: 1073741824
		});
	});

	it('returns 400 for invalid JSON', async () => {
		const req = {
			headers: new Headers(),
			json: async () => {
				throw new Error('bad json');
			}
		} as unknown as Request;
		const res = await POST({
			request: req,
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid JSON' });
	});

	it('returns 400 when ids is missing', async () => {
		const res = await POST({
			request: createRequest({}),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
	});

	it('returns 400 when ids is empty', async () => {
		const res = await POST({
			request: createRequest({ ids: [] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
	});

	it('returns 400 when ids exceed max limit', async () => {
		const ids = Array.from({ length: 21 }, (_, i) => i + 1);
		const res = await POST({
			request: createRequest({ ids }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('20') });
	});

	it('returns 400 for non-integer ids', async () => {
		const res = await POST({
			request: createRequest({ ids: [1, 'abc', 3] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'All ids must be positive integers' });
	});

	it('returns 500 when bucket is not available', async () => {
		const res = await POST({
			request: createRequest({ ids: [1] }),
			platform: { env: { DB: {} } },
			locals: { user: null }
		} as never);
		expect(res.status).toBe(500);
		expect(logger.error).toHaveBeenCalledWith('DTXFILE_BUCKET binding not available');
	});

	it('returns 404 when any requested chart is missing', async () => {
		vi.mocked(getSimfileOwner)
			.mockResolvedValueOnce({ user_id: 'owner', is_published: 1 })
			.mockResolvedValueOnce(null);
		const res = await POST({
			request: createRequest({ ids: [1, 99] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: 'Simfile not found', missingIds: [99] });
	});

	it('returns 429 when rate limit is exceeded', async () => {
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const res = await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(429);
	});

	it('returns 200 ZIP for valid published ids', async () => {
		const res = await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
		expect(res.headers.get('Content-Disposition')).toBe(
			'attachment; filename="drumery-charts.zip"'
		);
	});

	it('returns 401 when any requested chart is unpublished for an unauthenticated user', async () => {
		vi.mocked(getSimfileOwner)
			.mockResolvedValueOnce({ user_id: 'owner', is_published: 1 })
			.mockResolvedValueOnce({ user_id: 'owner', is_published: 0 });
		const res = await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: 'Unauthorized', inaccessibleIds: [2] });
		expect(listAllR2Objects).not.toHaveBeenCalled();
	});

	it('returns 403 when any requested chart is inaccessible to a different authenticated user', async () => {
		vi.mocked(getSimfileOwner)
			.mockResolvedValueOnce({ user_id: 'owner', is_published: 1 })
			.mockResolvedValueOnce({ user_id: 'owner', is_published: 0 });
		const res = await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: { id: 'other-user', email: 'x@x.com' } as never }
		} as never);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ error: 'Forbidden', inaccessibleIds: [2] });
		expect(listAllR2Objects).not.toHaveBeenCalled();
	});

	it('returns 400 when the client IP header is missing', async () => {
		const req = {
			headers: new Headers(),
			json: async () => ({ ids: [1] })
		} as unknown as Request;
		const res = await POST({
			request: req,
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: 'Unable to determine client IP for rate limiting.'
		});
		expect(tryConsumeRateLimit).not.toHaveBeenCalled();
	});

	it('logs an anonymized client identifier for successful bulk downloads', async () => {
		await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(logger.info).toHaveBeenCalledWith(
			'Bulk downloading 2 simfiles',
			expect.objectContaining({ anonymizedIp: '1.2.3.x' })
		);
	});

	it('returns a generic 500 payload on unexpected errors', async () => {
		vi.mocked(listAllR2Objects).mockRejectedValueOnce(new Error('bucket exploded'));
		const res = await POST({
			request: createRequest({ ids: [1] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Internal server error' });
		expect(logger.error).toHaveBeenCalledWith('Bulk download error:', expect.any(Error));
	});

	it('skips rate limiting when KV binding is absent (local dev)', async () => {
		const res = await POST({
			request: {
				headers: new Headers(),
				json: async () => ({ ids: [1] })
			} as unknown as Request,
			platform: createMockPlatform(false),
			locals: { user: null }
		} as never);
		expect(res.status).toBe(200);
		expect(tryConsumeRateLimit).not.toHaveBeenCalled();
	});
});
