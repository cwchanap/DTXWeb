import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { getDb, getSimfileOwner } from '$lib/server/db';
import {
	getClientIp,
	tryConsumeRateLimit,
	listAllR2Objects,
	logger,
	buildZipStream,
	createZipSources,
	validateZipSources
} from '@dtx/common/server';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
		tryConsumeRateLimit: vi.fn(),
		listAllR2Objects: vi.fn(),
		buildZipStream: vi.fn(),
		createZipSources: vi.fn(),
		validateZipSources: vi.fn()
	};
});
vi.mock('$lib/server/db', () => ({ getDb: vi.fn(), getSimfileOwner: vi.fn() }));

const createRequest = (body: unknown, headers?: Record<string, string>): Request =>
	({
		url: 'http://localhost/api/simFile/download/bulk',
		headers: new Headers({ 'cf-connecting-ip': '1.2.3.4', ...headers }),
		json: async () => body
	}) as unknown as Request;

const createMockPlatform = (withKv = true) => ({
	env: {
		DTXFILE_BUCKET: {},
		DB: {},
		...(withKv ? { RATE_LIMIT: {}, RATE_LIMIT_ENV: 'test' } : {})
	}
});

describe('POST /api/simFile/download/bulk', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as never);
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'owner', is_published: 1 });
		vi.mocked(listAllR2Objects).mockImplementation(async (_bucket, prefix) => [
			{ key: `${prefix}file.dtx`, size: 512, uploaded: new Date() }
		]);
		vi.mocked(createZipSources).mockReturnValue([
			{ path: 'chart-1/file.dtx', objectKey: '1/file.dtx', size: 512 }
		]);
		vi.mocked(buildZipStream).mockReturnValue(new ReadableStream<Uint8Array>());
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({
			allowed: true,
			remainingBytes: 1073741824
		});
		vi.mocked(validateZipSources).mockResolvedValue(undefined);
	});

	it('returns 400 for invalid JSON', async () => {
		const req = {
			url: 'http://localhost/api/simFile/download/bulk',
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
		expect(await res.json()).toMatchObject({ error: 'Invalid request body' });
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

	it('accepts form submissions for bulk downloads', async () => {
		const request = new Request('http://localhost/api/simFile/download/bulk', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'cf-connecting-ip': '1.2.3.4'
			},
			body: 'ids=1&ids=2'
		});

		const res = await POST({
			request,
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
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
		expect(await res.json()).toMatchObject({ error: 'Simfile not found', ids: [99] });
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

	it('returns JSON success for validation-only requests after a non-consuming rate limit check', async () => {
		const platform = createMockPlatform();
		const request = new Request('http://localhost/api/simFile/download/bulk?validate=1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'cf-connecting-ip': '1.2.3.4'
			},
			body: JSON.stringify({ ids: [1, 2] })
		});

		const res = await POST({
			request,
			platform,
			locals: { user: null }
		} as never);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, fileCount: 2 });
		expect(getClientIp(request)).toBe('1.2.3.4');
		expect(tryConsumeRateLimit).toHaveBeenCalledWith(
			platform.env.RATE_LIMIT,
			'test:1.2.3.4',
			1024,
			undefined,
			false
		);
	});

	it('returns 429 for validation-only requests when rate limit is exceeded', async () => {
		vi.mocked(tryConsumeRateLimit).mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const request = new Request('http://localhost/api/simFile/download/bulk?validate=1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'cf-connecting-ip': '1.2.3.4'
			},
			body: JSON.stringify({ ids: [1, 2] })
		});

		const res = await POST({
			request,
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);

		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({
			error: 'Rate limit exceeded. Please try again later.'
		});
	});

	it('returns 400 for validation-only requests when client IP cannot be determined', async () => {
		const request = new Request('http://localhost/api/simFile/download/bulk?validate=1', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ ids: [1] })
		});

		const res = await POST({
			request,
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);

		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({
			error: 'Unable to determine client IP for rate limiting.'
		});
		expect(tryConsumeRateLimit).not.toHaveBeenCalled();
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
		expect(await res.json()).toMatchObject({ error: 'Unauthorized', ids: [2] });
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
		expect(await res.json()).toMatchObject({ error: 'Forbidden', ids: [2] });
		expect(listAllR2Objects).not.toHaveBeenCalled();
	});

	it('returns 400 when the client IP header is missing', async () => {
		const req = {
			url: 'http://localhost/api/simFile/download/bulk',
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

	it('returns 400 when any requested chart has no uploaded files', async () => {
		vi.mocked(listAllR2Objects)
			.mockResolvedValueOnce([{ key: '1/file.dtx', size: 512, uploaded: new Date() }])
			.mockResolvedValueOnce([]);
		vi.mocked(createZipSources)
			.mockReturnValueOnce([{ path: 'chart-1/file.dtx', objectKey: '1/file.dtx', size: 512 }])
			.mockReturnValueOnce([]);

		const res = await POST({
			request: createRequest({ ids: [1, 2] }),
			platform: createMockPlatform(),
			locals: { user: null }
		} as never);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'Some selected charts do not have uploaded files available.',
			ids: [2]
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
		expect(logger.error).toHaveBeenCalledWith(
			'Bulk download error for ids [1]:',
			expect.any(Error)
		);
	});

	it('skips rate limiting when KV binding is absent (local dev)', async () => {
		const res = await POST({
			request: {
				url: 'http://localhost/api/simFile/download/bulk',
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
