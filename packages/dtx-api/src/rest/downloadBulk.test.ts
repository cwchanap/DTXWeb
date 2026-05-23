import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeDownloadBulk } from './downloadBulk';
import type { Env } from '../env';
import type { R2Bucket, KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(),
		listAllR2Objects: vi.fn(async () => [
			{ key: '1/song.dtx', size: 100, uploaded: new Date() }
		]),
		validateZipSources: vi.fn(async () => {}),
		buildZipStream: vi.fn(() => new ReadableStream()),
		createZipSources: vi.fn((objs) =>
			(objs as Array<{ key: string; size: number }>).map((o) => ({
				objectKey: o.key,
				size: o.size,
				path: o.key
			}))
		),
		tryConsumeRateLimit: vi.fn(async () => ({ allowed: true, remainingBytes: 0 })),
		getClientIp: vi.fn(() => '1.2.3.4')
	};
});

vi.mock('../auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

const { getSimfileOwner, tryConsumeRateLimit, listAllR2Objects } =
	await import('@dtx/common/server');
const { verifyToken } = await import('../auth/verifyToken');
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedRate = vi.mocked(tryConsumeRateLimit);
const mockedListAllR2Objects = vi.mocked(listAllR2Objects);
const mockedVerify = vi.mocked(verifyToken);

const { validateZipSources } = await import('@dtx/common/server');
const mockedValidateZipSources = vi.mocked(validateZipSources);

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as R2Bucket,
	RATE_LIMIT_API: {} as KVNamespace,
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const jsonReq = (body: unknown, search = '') =>
	new Request(`http://api/downloads/bulk${search}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

const formReq = (ids: (string | number)[], search = '') => {
	const params = new URLSearchParams();
	for (const id of ids) {
		params.append('ids', String(id));
	}
	return new Request(`http://api/downloads/bulk${search}`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: params.toString()
	});
};

beforeEach(() => {
	mockedGetOwner.mockReset();
	mockedRate.mockReset().mockResolvedValue({ allowed: true, remainingBytes: 0 });
	mockedListAllR2Objects
		.mockReset()
		.mockResolvedValue([{ key: '1/song.dtx', size: 100, uploaded: new Date() }]);
	mockedVerify.mockReset().mockResolvedValue(null);
	mockedValidateZipSources.mockReset();
});

describe('POST /downloads/bulk', () => {
	it('400 on null body', async () => {
		const response = await routeDownloadBulk(jsonReq(null), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on non-object body (string)', async () => {
		const response = await routeDownloadBulk(jsonReq('hello'), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on non-object body (array)', async () => {
		const response = await routeDownloadBulk(jsonReq([1, 2, 3]), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on missing ids field', async () => {
		const response = await routeDownloadBulk(jsonReq({}), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on empty ids', async () => {
		const response = await routeDownloadBulk(jsonReq({ ids: [] }), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on non-positive integer id', async () => {
		const response = await routeDownloadBulk(jsonReq({ ids: [-1] }), makeEnv());
		expect(response.status).toBe(400);
	});

	it('400 on more than 20 ids', async () => {
		const ids = Array.from({ length: 21 }, (_, i) => i + 1);
		const response = await routeDownloadBulk(jsonReq({ ids }), makeEnv());
		expect(response.status).toBe(400);
	});

	it('dedupes ids', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 1, 2] }), makeEnv());
		expect(response.status).toBe(200);
		expect(mockedGetOwner).toHaveBeenCalledTimes(2);
	});

	it('401 for anonymous when any id is unpublished', async () => {
		mockedGetOwner.mockImplementation(async (_db, id) =>
			id === 1 ? { user_id: 'u1', is_published: 1 } : { user_id: 'u1', is_published: 0 }
		);
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 2] }), makeEnv());
		expect(response.status).toBe(401);
	});

	it('returns validate=1 envelope without streaming', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1] }, '?validate=1'), makeEnv());
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; fileCount: number };
		expect(body).toEqual({ ok: true, fileCount: 1 });
		expect(mockedRate).toHaveBeenCalledWith(
			expect.anything(),
			'pre-prod:downloads:1.2.3.4',
			100,
			undefined,
			false
		);
		// HEAD checks should NOT run for validate-only requests
		expect(mockedValidateZipSources).not.toHaveBeenCalled();
	});

	it('429 on validate-only when rate limit exceeded', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedRate.mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1] }, '?validate=1'), makeEnv());
		expect(response.status).toBe(429);
	});

	it('accepts form-urlencoded body', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(formReq([1, 2]), makeEnv());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
	});

	it('accepts form-urlencoded body for validate-only', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(formReq([1], '?validate=1'), makeEnv());
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; fileCount: number };
		expect(body).toEqual({ ok: true, fileCount: 1 });
	});

	it('401 when anonymous and PUBLIC_ENABLE_BLOG_DOWNLOAD is false', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(
			jsonReq({ ids: [1] }),
			makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false' })
		);
		expect(response.status).toBe(401);
	});

	it('200 streams ZIP for accessible ids', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 2] }), makeEnv());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(response.headers.get('content-disposition')).toContain('drumery-charts.zip');
	});

	it('reports accessible charts that have no downloadable files', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedListAllR2Objects.mockImplementation(async (_bucket, prefix) => {
			return prefix === '2/' ? [] : [{ key: '1/song.dtx', size: 100, uploaded: new Date() }];
		});
		const response = await routeDownloadBulk(jsonReq({ ids: [1, 2] }), makeEnv());
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Some selected charts do not have uploaded files available.',
			ids: [2]
		});
		expect(mockedRate).not.toHaveBeenCalled();
		// HEAD checks should NOT run when some charts have no files
		expect(mockedValidateZipSources).not.toHaveBeenCalled();
	});

	it('reports empty accessible charts during validate-only requests', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedListAllR2Objects.mockImplementation(async (_bucket, prefix) => {
			return prefix === '2/' ? [] : [{ key: '1/song.dtx', size: 100, uploaded: new Date() }];
		});
		const response = await routeDownloadBulk(
			jsonReq({ ids: [1, 2] }, '?validate=1'),
			makeEnv()
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'Some selected charts do not have uploaded files available.',
			ids: [2]
		});
	});

	it('429 on rate limit hit', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedRate.mockResolvedValue({ allowed: false, remainingBytes: 0 });
		const response = await routeDownloadBulk(jsonReq({ ids: [1] }), makeEnv());
		expect(response.status).toBe(429);
		// HEAD checks should NOT run when rate limit blocks the download
		expect(mockedValidateZipSources).not.toHaveBeenCalled();
	});

	it('consumes rate limit for non-validate requests', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		await routeDownloadBulk(jsonReq({ ids: [1] }), makeEnv());
		expect(mockedRate).toHaveBeenCalledWith(
			expect.anything(),
			'pre-prod:downloads:1.2.3.4',
			100,
			undefined,
			true
		);
	});
});
