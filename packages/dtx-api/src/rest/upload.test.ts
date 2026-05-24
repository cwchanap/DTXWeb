import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeUpload } from './upload';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('../auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

vi.mock('../services/uploads', () => ({
	uploadSimfileFile: vi.fn(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	),
	purgeCacheForFile: vi.fn(async () => true)
}));

const { verifyToken } = await import('../auth/verifyToken');
const { uploadSimfileFile, purgeCacheForFile } = await import('../services/uploads');
const mockedVerify = vi.mocked(verifyToken);
const mockedUpload = vi.mocked(uploadSimfileFile);
const mockedPurge = vi.mocked(purgeCacheForFile);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
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

const multipartReq = () => {
	const form = new FormData();
	form.set('file', new File([new Uint8Array(10)], 'a.dtx', { type: 'application/octet-stream' }));
	form.set('simFileId', '42');
	return new Request('http://api/upload', { method: 'POST', body: form });
};

beforeEach(() => {
	mockedVerify.mockReset().mockResolvedValue(null);
	mockedUpload.mockClear();
	mockedPurge.mockClear();
});

describe('POST /upload', () => {
	it('401 when no bearer', async () => {
		const response = await routeUpload(multipartReq(), makeEnv(), makeCtx());
		expect(response.status).toBe(401);
	});

	it('delegates to uploadSimfileFile when authed', async () => {
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		const response = await routeUpload(multipartReq(), makeEnv(), makeCtx());
		expect(response.status).toBe(200);
		expect(mockedUpload).toHaveBeenCalled();
	});

	it('schedules cache purge via ctx.waitUntil', async () => {
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
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
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
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
		mockedVerify.mockResolvedValue({
			user: { id: 'u1' },
			session: {}
		} as Awaited<ReturnType<typeof verifyToken>>);
		const emptyReq = new Request('http://api/upload', {
			method: 'POST',
			body: new FormData()
		});
		const response = await routeUpload(emptyReq, makeEnv(), makeCtx());
		expect(response.status).toBe(400);
	});
});
