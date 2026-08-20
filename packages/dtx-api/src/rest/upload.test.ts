import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeUpload } from './upload';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('../auth/session', () => ({ resolveAuthSession: vi.fn(async () => null) }));

vi.mock('../services/uploads', () => ({
	uploadSimfileFile: vi.fn(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	),
	purgeCacheForFile: vi.fn(async () => true)
}));

const { resolveAuthSession } = await import('../auth/session');
const { uploadSimfileFile, purgeCacheForFile } = await import('../services/uploads');
const mockedResolveAuthSession = vi.mocked(resolveAuthSession);
const mockedUpload = vi.mocked(uploadSimfileFile);
const mockedPurge = vi.mocked(purgeCacheForFile);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
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
	PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (): ExecutionContext =>
	({
		waitUntil: vi.fn((p) => p),
		passThroughOnException: vi.fn()
	}) as unknown as ExecutionContext;

const multipartReq = (headers: Record<string, string> = {}) => {
	const form = new FormData();
	form.set('file', new File([new Uint8Array(10)], 'a.dtx', { type: 'application/octet-stream' }));
	form.set('simFileId', '42');
	return new Request('http://api/upload', { method: 'POST', headers, body: form });
};

const validAuthSession = (): NonNullable<Awaited<ReturnType<typeof resolveAuthSession>>> => ({
	user: { id: 'u1' },
	session: {
		id: 'session-1',
		userId: 'u1',
		expiresAt: new Date('2030-01-01T00:00:00.000Z')
	}
});

beforeEach(() => {
	mockedResolveAuthSession.mockReset().mockResolvedValue(null);
	mockedUpload.mockClear();
	mockedPurge.mockClear();
});

describe('POST /upload', () => {
	it('401 when anonymous or the session is invalid', async () => {
		const response = await routeUpload(multipartReq(), makeEnv(), makeCtx());
		expect(response.status).toBe(401);
	});

	it('accepts a valid Better Auth cookie session', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const request = multipartReq({
			Cookie: 'dtx-local-session=session',
			Origin: 'http://localhost:5173'
		});
		const response = await routeUpload(request, makeEnv(), makeCtx());
		expect(response.status).toBe(200);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
		expect(mockedUpload).toHaveBeenCalledWith(
			expect.anything(),
			{ id: 'u1' },
			'42',
			expect.any(File),
			expect.anything()
		);
	});

	it('accepts a valid desktop Bearer session without Origin', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const request = multipartReq({ Authorization: 'Bearer opaque-session-token' });
		const response = await routeUpload(request, makeEnv(), makeCtx());

		expect(response.status).toBe(200);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('rejects a cookie session when unsafe Origin is missing', async () => {
		const request = multipartReq({ Cookie: 'dtx-local-session=session' });
		const response = await routeUpload(request, makeEnv(), makeCtx());

		expect(response.status).toBe(401);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('rejects a cookie session from the wrong Origin', async () => {
		const request = multipartReq({
			Cookie: 'dtx-local-session=session',
			Origin: 'https://evil.example.com'
		});
		const response = await routeUpload(request, makeEnv(), makeCtx());

		expect(response.status).toBe(401);
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, expect.anything());
	});

	it('schedules cache purge via ctx.waitUntil', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		mockedUpload.mockResolvedValue(
			new Response(JSON.stringify({ file: { key: '42/a.dtx' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const ctx = makeCtx();
		await routeUpload(multipartReq(), makeEnv(), ctx);
		expect(ctx.waitUntil).toHaveBeenCalled();
	});

	it('URL-encodes R2 key segments for cache purge', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		mockedUpload.mockResolvedValue(
			new Response(JSON.stringify({ file: { key: '42/my song file.dtx' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const ctx = makeCtx();
		await routeUpload(multipartReq(), makeEnv(), ctx);
		expect(ctx.waitUntil).toHaveBeenCalled();
		// purgeCacheForFile should be called with URL-encoded path
		expect(mockedPurge).toHaveBeenCalledWith(
			expect.anything(),
			'https://files.example/42/my%20song%20file.dtx',
			expect.anything()
		);
	});

	it('400 when form is missing required parts', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const emptyReq = new Request('http://api/upload', {
			method: 'POST',
			body: new FormData()
		});
		const response = await routeUpload(emptyReq, makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});
});
