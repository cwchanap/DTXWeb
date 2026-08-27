import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadSimfileFile, purgeCacheForFile } from './uploads';
import { workerLogger } from '@dtx/common/server';
import type { Env } from '../env';
import type { R2Bucket } from '@cloudflare/workers-types';

vi.mock('@dtx/common/server', () => ({
	getSimfileOwner: vi.fn(),
	workerLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	}
}));

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = getSimfileOwner as ReturnType<typeof vi.fn>;

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
	PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example/',
	...overrides
});

const uploadedAt = new Date('2026-08-27T05:00:00.123Z');
const successfulR2Object = {
	key: '42/song.dtx',
	etag: 'etag-1',
	version: 'version-1',
	uploaded: uploadedAt,
	size: 2048
};
const makeBucket = (putResult: Record<string, unknown> | null = successfulR2Object): R2Bucket =>
	({ put: vi.fn(async () => putResult) }) as unknown as R2Bucket;

const makeFile = (size = 1024, name = 'song.dtx'): File =>
	new File([new Uint8Array(size)], name, { type: 'application/octet-stream' });

beforeEach(() => mockedGetOwner.mockReset());

describe('uploadSimfileFile', () => {
	it('returns 401 when no user', async () => {
		const result = await uploadSimfileFile(makeEnv(), null, '42', makeFile(), makeBucket());
		expect(result.response.status).toBe(401);
	});

	it('returns 400 for invalid simfileId', async () => {
		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'abc',
			makeFile(),
			makeBucket()
		);
		expect(result.response.status).toBe(400);
	});

	it('returns 400 for oversize file (>50MB)', async () => {
		const big = makeFile(51 * 1024 * 1024);
		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			big,
			makeBucket()
		);
		expect(result.response.status).toBe(400);
	});

	it('returns 404 when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			makeFile(),
			makeBucket()
		);
		expect(result.response.status).toBe(404);
	});

	it('returns 403 when caller is not the owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			makeFile(),
			makeBucket()
		);
		expect(result.response.status).toBe(403);
	});

	it('puts the file with sanitized key and returns upload identity separately', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const bucket = makeBucket({ ...successfulR2Object, key: '42/escape/song.dtx' });
		const file = makeFile(2048, '../escape/song.dtx');
		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' } as { id: string },
			'42',
			file,
			bucket
		);
		expect(result.response.status).toBe(200);
		expect(bucket.put).toHaveBeenCalledWith(
			'42/escape/song.dtx',
			expect.any(ReadableStream),
			expect.objectContaining({
				httpMetadata: expect.objectContaining({
					contentType: 'application/octet-stream',
					cacheControl: 'public, max-age=31536000'
				})
			})
		);
		expect(result.uploadedObject).toEqual({
			simfileId: 42,
			key: '42/escape/song.dtx',
			etag: 'etag-1',
			version: 'version-1',
			uploaded: '2026-08-27T05:00:00.123Z',
			size: 2048
		});
		expect(await result.response.json()).toEqual({
			message: 'File uploaded successfully',
			file: {
				fileName: '../escape/song.dtx',
				key: '42/escape/song.dtx',
				size: 2048,
				contentType: 'application/octet-stream',
				status: 'Uploaded'
			}
		});
	});

	it.each(['bgm.m4a', 'BGM.M4A', './bgm.m4a'])(
		'returns 409 for reserved canonical derivative upload %s',
		async (fileName) => {
			mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
			const bucket = makeBucket();

			const result = await uploadSimfileFile(
				makeEnv(),
				{ id: 'u1' },
				'42',
				makeFile(1024, fileName),
				bucket
			);

			expect(result.response.status).toBe(409);
			expect(bucket.put).not.toHaveBeenCalled();
		}
	);

	it.each(['assets/bgm.ogg', 'assets/bgm.m4a', 'music.ogg', 'song.flac'])(
		'allows non-canonical authored upload %s when generation is off',
		async (fileName) => {
			mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
			const bucket = makeBucket({
				...successfulR2Object,
				key: `42/${fileName}`,
				size: 1024
			});

			const result = await uploadSimfileFile(
				makeEnv(),
				{ id: 'u1' },
				'42',
				makeFile(1024, fileName),
				bucket
			);

			expect(result.response.status).toBe(200);
			expect(result.uploadedObject?.key).toBe(`42/${fileName}`);
		}
	);

	it.each(['etag', 'version', 'uploaded', 'size'])(
		'returns 500 when successful R2 PUT omits identity field %s',
		async (field) => {
			mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
			const incomplete = { ...successfulR2Object };
			delete incomplete[field as keyof typeof incomplete];

			const result = await uploadSimfileFile(
				makeEnv(),
				{ id: 'u1' },
				'42',
				makeFile(2048),
				makeBucket(incomplete)
			);

			expect(result.response.status).toBe(500);
			expect(result.uploadedObject).toBeUndefined();
		}
	);

	it('returns 500 when R2 PUT returns null', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });

		const result = await uploadSimfileFile(
			makeEnv(),
			{ id: 'u1' },
			'42',
			makeFile(),
			makeBucket(null)
		);

		expect(result.response.status).toBe(500);
		expect(result.uploadedObject).toBeUndefined();
	});
});

describe('purgeCacheForFile', () => {
	it('returns false (and logs warn) when secrets are missing', async () => {
		const env = makeEnv({ CLOUDFLARE_ZONE_ID: undefined, CLOUDFLARE_API_TOKEN: undefined });
		const spy = vi.spyOn(workerLogger, 'warn').mockImplementation(() => {});
		const result = await purgeCacheForFile(env, 'https://x', workerLogger);
		expect(result).toBe(false);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining('Cloudflare cache purge skipped'));
		spy.mockRestore();
	});

	it('calls the Cloudflare API when both secrets are set', async () => {
		const env = makeEnv({ CLOUDFLARE_ZONE_ID: 'z1', CLOUDFLARE_API_TOKEN: 'tok' });
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
		const result = await purgeCacheForFile(
			env,
			'https://files.example/42/song.dtx',
			workerLogger
		);
		expect(result).toBe(true);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/z1/purge_cache',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ Authorization: 'Bearer tok' })
			})
		);
		fetchSpy.mockRestore();
	});
});
