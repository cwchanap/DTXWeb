import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeUpload } from './upload';
import type { Env } from '../env';
import type { ExecutionContext, R2Bucket } from '@cloudflare/workers-types';
import { workerLogger } from '@dtx/common/server';

vi.mock('../auth/session', () => ({ resolveAuthSession: vi.fn(async () => null) }));

vi.mock('../services/uploads', () => ({
	uploadSimfileFile: vi.fn(async () => ({
		response: new Response(JSON.stringify({ ok: true }), { status: 200 })
	})),
	purgeCacheForFile: vi.fn(async () => true)
}));

vi.mock('../services/bgmM4aWorkflowTrigger', () => ({
	triggerBgmM4aWorkflow: vi.fn(async () => 'disabled')
}));

const { resolveAuthSession } = await import('../auth/session');
const { uploadSimfileFile, purgeCacheForFile } = await import('../services/uploads');
const { triggerBgmM4aWorkflow } = await import('../services/bgmM4aWorkflowTrigger');
const mockedResolveAuthSession = resolveAuthSession as ReturnType<typeof vi.fn>;
const mockedUpload = uploadSimfileFile as ReturnType<typeof vi.fn>;
const mockedPurge = purgeCacheForFile as ReturnType<typeof vi.fn>;
const mockedTrigger = triggerBgmM4aWorkflow as ReturnType<typeof vi.fn>;

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.test',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'http://localhost:5173',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example',
	...overrides
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
	mockedTrigger.mockReset().mockResolvedValue('disabled');
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
		mockedUpload.mockResolvedValue({
			response: new Response(JSON.stringify({ file: { key: '42/a.dtx' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}),
			uploadedObject: {
				simfileId: 42,
				key: '42/a.dtx',
				etag: 'etag-1',
				version: 'version-1',
				uploaded: '2026-08-27T05:00:00.123Z',
				size: 10
			}
		});
		const ctx = makeCtx();
		await routeUpload(multipartReq(), makeEnv(), ctx);
		expect(ctx.waitUntil).toHaveBeenCalled();
	});

	it('URL-encodes R2 key segments for cache purge', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		mockedUpload.mockResolvedValue({
			response: new Response(JSON.stringify({ file: { key: '42/my song file.dtx' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}),
			uploadedObject: {
				simfileId: 42,
				key: '42/my song file.dtx',
				etag: 'etag-1',
				version: 'version-1',
				uploaded: '2026-08-27T05:00:00.123Z',
				size: 10
			}
		});
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

	it('returns the authored upload response without waiting for the BGM trigger', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		const uploadResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
		mockedUpload.mockResolvedValue({
			response: uploadResponse,
			uploadedObject: {
				simfileId: 42,
				key: '42/music.ogg',
				etag: 'etag-1',
				version: 'version-1',
				uploaded: '2026-08-27T05:00:00.123Z',
				size: 10
			}
		});
		let finishTrigger: (() => void) | undefined;
		mockedTrigger.mockReturnValue(
			new Promise((resolve) => {
				finishTrigger = () => resolve('triggered');
			})
		);
		const ctx = makeCtx();

		const response = await routeUpload(
			multipartReq(),
			makeEnv({ PUBLIC_SIMFILE_BUCKET_URL: '' }),
			ctx
		);

		expect(response).toBe(uploadResponse);
		expect(mockedTrigger).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ key: '42/music.ogg' })
		);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();
		finishTrigger?.();
	});

	it('logs a background BGM trigger failure without rolling back the upload', async () => {
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());
		mockedUpload.mockResolvedValue({
			response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
			uploadedObject: {
				simfileId: 42,
				key: '42/music.ogg',
				etag: 'etag-1',
				version: 'version-1',
				uploaded: '2026-08-27T05:00:00.123Z',
				size: 10
			}
		});
		mockedTrigger.mockRejectedValueOnce(new Error('Workflow unavailable'));
		const errorSpy = vi.spyOn(workerLogger, 'error').mockImplementation(() => {});

		const response = await routeUpload(
			multipartReq(),
			makeEnv({ PUBLIC_SIMFILE_BUCKET_URL: '' }),
			makeCtx()
		);

		expect(response.status).toBe(200);
		expect(errorSpy).toHaveBeenCalledWith('Unexpected error triggering BGM M4A generation', {
			error: 'Error: Workflow unavailable'
		});
		errorSpy.mockRestore();
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
