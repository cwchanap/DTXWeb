import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { getDb, getSimfileOwner } from '$lib/server/db';
import { buildZipStream, createZipSources, validateZipSources } from '$lib/server/zipBuilder';
import { getClientIp, tryConsumeRateLimit, listAllR2Objects, logger } from '@dtx/common/server';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
		tryConsumeRateLimit: vi.fn(),
		listAllR2Objects: vi.fn()
	};
});
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(), getSimfileOwner: vi.fn() }));
vi.mock('$lib/server/zipBuilder', () => ({
	buildZipStream: vi.fn(),
	createZipSources: vi.fn(),
	validateZipSources: vi.fn()
}));

const createMockRequest = (headers?: Record<string, string>): Request => {
	const h = new Headers(headers);
	return { headers: h } as unknown as Request;
};

const createMockPlatform = (withKv = true) => ({
	env: {
		DTXFILE_BUCKET: {} as unknown,
		DB: {},
		...(withKv ? { RATE_LIMIT: {}, RATE_LIMIT_ENV: 'test' } : {})
	}
});

const mockUser = {
	id: 'user-123',
	email: 'test@example.com'
} as unknown as import('@supabase/supabase-js').User;

describe('GET /api/simFile/download/[simfileID]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as never);
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'owner-456', is_published: 1 });
		vi.mocked(listAllR2Objects).mockResolvedValue([
			{ key: '42/file.dtx', size: 1024, uploaded: new Date() }
		]);
		vi.mocked(createZipSources).mockReturnValue([
			{ path: 'file.dtx', objectKey: '42/file.dtx', size: 1024 }
		]);
		vi.mocked(buildZipStream).mockReturnValue(new ReadableStream<Uint8Array>());
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({
			allowed: true,
			remainingBytes: 1073741824
		});
		vi.mocked(validateZipSources).mockResolvedValue(undefined);
	});

	it('returns 400 when simfileID is missing', async () => {
		const res = await GET({
			params: { simfileID: '' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'SimFile ID is required' });
	});

	it('returns 400 for non-integer simfileID', async () => {
		const res = await GET({
			params: { simfileID: 'abc' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'Invalid SimFile ID' });
	});

	it('returns 404 when simfile does not exist', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue(null);
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(404);
	});

	it('returns 401 when simfile is unpublished and user is not authenticated', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'owner-456', is_published: 0 });
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(401);
	});

	it('returns 403 when simfile is unpublished and user is not the owner', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'owner-456', is_published: 0 });
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: { id: 'other-user', email: 'x@x.com' } as never },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(403);
	});

	it('returns 500 when bucket is not available', async () => {
		const res = await GET({
			params: { simfileID: '42' },
			platform: { env: { DB: {} } },
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(500);
		expect(logger.error).toHaveBeenCalledWith('DTXFILE_BUCKET binding not available');
	});

	it('returns 429 when rate limit is exceeded', async () => {
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest({ 'cf-connecting-ip': '1.2.3.4' })
		} as never);
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('Rate limit') });
	});

	it('returns 200 ZIP for a published simfile', async () => {
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest({ 'cf-connecting-ip': '1.2.3.4' })
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
		expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="chart-42.zip"');
		expect(getClientIp(createMockRequest({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
		expect(tryConsumeRateLimit).toHaveBeenCalledWith(expect.anything(), 'test:1.2.3.4', 1024);
	});

	it('returns 400 when the client IP header is missing and rate limiting is enabled', async () => {
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: 'Unable to determine client IP for rate limiting.'
		});
		expect(tryConsumeRateLimit).not.toHaveBeenCalled();
	});

	it('skips rate limiting when KV binding is absent (local dev)', async () => {
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(false),
			locals: { user: null },
			request: createMockRequest()
		} as never);
		expect(res.status).toBe(200);
		expect(tryConsumeRateLimit).not.toHaveBeenCalled();
	});

	it('allows owner to download unpublished simfile', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: mockUser.id, is_published: 0 });
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: mockUser },
			request: createMockRequest({ 'cf-connecting-ip': '1.2.3.4' })
		} as never);
		expect(res.status).toBe(200);
	});

	it('returns a generic 500 payload on unexpected errors', async () => {
		vi.mocked(listAllR2Objects).mockRejectedValueOnce(new Error('bucket exploded'));
		const res = await GET({
			params: { simfileID: '42' },
			platform: createMockPlatform(),
			locals: { user: null },
			request: createMockRequest({ 'cf-connecting-ip': '1.2.3.4' })
		} as never);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Internal server error' });
		expect(logger.error).toHaveBeenCalledWith(
			'Download error for simfile 42:',
			expect.any(Error)
		);
	});
});
