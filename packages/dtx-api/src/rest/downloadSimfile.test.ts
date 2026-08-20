import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeDownloadSimfile } from './downloadSimfile';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(),
		listAllR2Objects: vi.fn(),
		validateZipSources: vi.fn(async () => {}),
		buildZipStream: vi.fn(() => new ReadableStream()),
		createZipSources: vi.fn(() => [{ objectKey: '42/a.dtx', size: 100, path: 'a.dtx' }]),
		tryConsumeRateLimit: vi.fn(async () => ({ allowed: true })),
		getClientIp: vi.fn(() => '1.2.3.4')
	};
});

vi.mock('../auth/session', () => ({ resolveAuthSession: vi.fn(async () => null) }));

const { getSimfileOwner, tryConsumeRateLimit, createZipSources } =
	await import('@dtx/common/server');
const { resolveAuthSession } = await import('../auth/session');
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedRate = vi.mocked(tryConsumeRateLimit);
const mockedCreateZipSources = vi.mocked(createZipSources);
const mockedResolveAuthSession = vi.mocked(resolveAuthSession);

const { validateZipSources } = await import('@dtx/common/server');
const mockedValidateZipSources = vi.mocked(validateZipSources);

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {
		list: vi.fn(async () => ({ objects: [], truncated: false })),
		delete: vi.fn()
	} as unknown as R2Bucket,
	RATE_LIMIT_API: {} as KVNamespace,
	BETTER_AUTH_URL: 'https://api.test',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'http://localhost:5173',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const makeCtx = (): ExecutionContext =>
	({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as unknown as ExecutionContext;

const validAuthSession = (): NonNullable<Awaited<ReturnType<typeof resolveAuthSession>>> => ({
	user: { id: 'u1' },
	session: {
		id: 'session-1',
		userId: 'u1',
		expiresAt: new Date('2030-01-01T00:00:00.000Z')
	}
});

beforeEach(() => {
	mockedGetOwner.mockReset();
	mockedRate.mockReset().mockResolvedValue({ allowed: true, remainingBytes: 0 });
	mockedCreateZipSources
		.mockReset()
		.mockReturnValue([{ objectKey: '42/a.dtx', size: 100, path: 'a.dtx' }]);
	mockedResolveAuthSession.mockReset().mockResolvedValue(null);
	mockedValidateZipSources.mockReset();
});

const req = (headers: Record<string, string> = {}) =>
	new Request('http://api/downloads/42', { method: 'GET', headers });

describe('GET /downloads/:id', () => {
	it('400 on non-numeric id', async () => {
		const response = await routeDownloadSimfile(req(), makeEnv(), makeCtx(), 'abc');
		expect(response.status).toBe(400);
	});

	it('404 when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(404);
	});

	it('401 when anonymous + unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(401);
	});

	it('accepts a valid Better Auth cookie session', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const request = req({ Cookie: 'dtx-local-session=session' });

		const response = await routeDownloadSimfile(request, makeEnv(), makeCtx(), '42');

		expect(response.status).toBe(200);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('accepts a valid desktop Bearer session without Origin', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const request = req({ Authorization: 'Bearer opaque-session-token' });

		const response = await routeDownloadSimfile(request, makeEnv(), makeCtx(), '42');

		expect(response.status).toBe(200);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('403 when authed but non-owner of unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const request = req({ Authorization: 'Bearer opaque-session-token' });
		const response = await routeDownloadSimfile(request, makeEnv(), makeCtx(), '42');
		expect(response.status).toBe(403);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('401 when anonymous and PUBLIC_ENABLE_BLOG_DOWNLOAD is false', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(401);
	});

	it('200 ZIP stream when published, anon, and blog download enabled', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(response.headers.get('content-disposition')).toContain('chart-42.zip');
		expect(mockedRate).toHaveBeenCalledWith(
			expect.anything(),
			'pre-prod:downloads:1.2.3.4',
			100
		);
	});

	it('404 when accessible simfile has no downloadable files', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedCreateZipSources.mockReturnValueOnce([]);
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'No files found for this chart' });
		expect(mockedRate).not.toHaveBeenCalled();
		// HEAD checks should NOT run when no files are found
		expect(mockedValidateZipSources).not.toHaveBeenCalled();
	});

	it('429 on rate limit hit', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedRate.mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(429);
		// HEAD checks should NOT run when rate limit blocks the download
		expect(mockedValidateZipSources).not.toHaveBeenCalled();
	});

	it('400 when client IP is unavailable', async () => {
		const { getClientIp } = await import('@dtx/common/server');
		vi.mocked(getClientIp).mockReturnValueOnce(null);
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadSimfile(
			req(),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' }),
			makeCtx(),
			'42'
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Unable to determine client IP for rate limiting.'
		});
	});
});
