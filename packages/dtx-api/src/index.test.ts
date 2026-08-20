import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index';
import type { Env } from './env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(async () => ({ user_id: 'u1', is_published: 1 as const })),
		listAllR2Objects: vi.fn(async () => []),
		createZipSources: vi.fn(() => [{ key: '123/a.dtx', size: 1, prefix: '', name: 'a.dtx' }]),
		validateZipSources: vi.fn(async () => {}),
		buildZipStream: vi.fn(() => new ReadableStream()),
		getClientIp: vi.fn(() => null),
		tryConsumeRateLimit: vi.fn(async () => ({ allowed: true, remainingBytes: 0 }))
	};
});

vi.mock('./auth/verifyToken', () => ({ verifyToken: vi.fn(async () => null) }));

const authMocks = vi.hoisted(() => ({
	createAuth: vi.fn(),
	handler: vi.fn()
}));

vi.mock('./auth/auth', () => ({ createAuth: authMocks.createAuth }));

vi.mock('./services/uploads', () => ({
	uploadSimfileFile: vi.fn(
		async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
	),
	purgeCacheForFile: vi.fn(async () => true)
}));

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.test',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'http://localhost:5173',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon-key',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: 'https://pre-prod.dtx.hapadona.com,http://localhost:5173',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const makeExecutionCtx = (): ExecutionContext =>
	({
		waitUntil: vi.fn((p) => p),
		passThroughOnException: vi.fn()
	}) as unknown as ExecutionContext;

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.createAuth.mockReturnValue({ handler: authMocks.handler });
});

describe('worker fetch router', () => {
	it('routes GET /api/auth/* through the request-scoped Better Auth handler', async () => {
		const env = makeEnv();
		authMocks.handler.mockResolvedValue(new Response('better-auth GET'));
		const request = new Request('https://api.test/api/auth/get-session', {
			method: 'GET',
			headers: { Origin: 'http://localhost:5173' }
		});

		const response = await worker.fetch(request, env, makeExecutionCtx());

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('better-auth GET');
		expect(authMocks.createAuth).toHaveBeenCalledWith(env);
		expect(authMocks.handler).toHaveBeenCalledWith(request);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('routes POST /api/auth/* through the request-scoped Better Auth handler', async () => {
		const env = makeEnv();
		authMocks.handler.mockResolvedValue(new Response('better-auth POST', { status: 201 }));
		const request = new Request('https://api.test/api/auth/sign-in/email', {
			method: 'POST',
			headers: {
				Origin: 'http://localhost:5173',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ email: 'user@example.com' })
		});

		const response = await worker.fetch(request, env, makeExecutionCtx());

		expect(response.status).toBe(201);
		expect(await response.text()).toBe('better-auth POST');
		expect(authMocks.createAuth).toHaveBeenCalledWith(env);
		expect(authMocks.handler).toHaveBeenCalledWith(request);
	});

	it('keeps unrelated GraphQL routing outside Better Auth', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/graphql', {
				method: 'GET',
				headers: { accept: 'text/html', Origin: 'http://localhost:5173' }
			}),
			makeEnv({ GRAPHIQL: 'true' }),
			makeExecutionCtx()
		);

		expect(response.status).toBe(200);
		expect(authMocks.createAuth).not.toHaveBeenCalled();
	});

	it('returns a CORS preflight response for allow-listed origins', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/graphql', {
				method: 'OPTIONS',
				headers: { Origin: 'http://localhost:5173' }
			}),
			makeEnv(),
			makeExecutionCtx()
		);

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('returns 200 for GET /healthz and applies CORS headers', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/healthz', {
				headers: { Origin: 'http://localhost:5173' }
			}),
			makeEnv(),
			makeExecutionCtx()
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		const body = (await response.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	it('returns 405 for non-GET /healthz requests', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/healthz', {
				method: 'POST',
				headers: { Origin: 'http://localhost:5173' }
			}),
			makeEnv(),
			makeExecutionCtx()
		);

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('routes GET /graphql through the production Yoga instance', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/graphql', {
				method: 'GET',
				headers: {
					accept: 'text/html',
					Origin: 'http://localhost:5173'
				}
			}),
			makeEnv({ GRAPHIQL: 'true' }),
			makeExecutionCtx()
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type') ?? '').toContain('text/html');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('returns 404 for unknown paths and applies CORS headers', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/missing', {
				headers: { Origin: 'http://localhost:5173' }
			}),
			makeEnv(),
			makeExecutionCtx()
		);

		expect(response.status).toBe(404);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(await response.text()).toBe('Not Found');
	});
});

describe('Phase 2 routes', () => {
	it('GET /downloads/123 dispatches to downloadSimfile route', async () => {
		const { getClientIp } = await import('@dtx/common/server');
		vi.mocked(getClientIp).mockReturnValueOnce('1.2.3.4');
		const env = makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' });
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
	});

	it('GET /downloads/123 returns 400 when client IP is unavailable', async () => {
		// getClientIp is mocked to return null by default
		const env = makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' });
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('Unable to determine client IP for rate limiting.');
	});

	it('POST /downloads/bulk dispatches to downloadBulk route', async () => {
		const env = makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' });
		const response = await worker.fetch(
			new Request('http://api/downloads/bulk', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids: [] })
			}),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(400);
	});

	it('POST /upload dispatches to upload route', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/upload', { method: 'POST', body: new FormData() }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(401);
	});

	it('405 on non-GET /downloads/:id', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'POST' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
	});

	it('400 on malformed /downloads/:id (non-numeric)', async () => {
		const env = makeEnv({ PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true' });
		const response = await worker.fetch(
			new Request('http://api/downloads/abc', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('Invalid SimFile ID');
	});

	it('405 on GET /downloads/bulk', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/bulk', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
	});

	it('CORS-wraps the /upload route response', async () => {
		const env = makeEnv({
			CORS_ALLOWED_ORIGINS: 'https://pre-prod.dtx.hapadona.com'
		});
		const response = await worker.fetch(
			new Request('http://api/upload', {
				method: 'POST',
				headers: { Origin: 'https://pre-prod.dtx.hapadona.com' }
			}),
			env,
			makeExecutionCtx()
		);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
			'https://pre-prod.dtx.hapadona.com'
		);
	});

	it('CORS-wraps 500 when a route handler throws', async () => {
		const { getSimfileOwner } = await import('@dtx/common/server');
		vi.mocked(getSimfileOwner).mockRejectedValueOnce(new Error('R2 listing failed'));

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = makeEnv({
			PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true',
			CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
		});
		const response = await worker.fetch(
			new Request('http://api/downloads/bulk', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					Origin: 'http://localhost:5173'
				},
				body: JSON.stringify({ ids: [1] })
			}),
			env,
			makeExecutionCtx()
		);

		expect(response.status).toBe(500);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('Internal Server Error');
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0][1]).instanceof(Error);
		errorSpy.mockRestore();
	});

	it('GET /simfiles/:id/set.def dispatches to setDef route', async () => {
		const env = makeEnv({
			DTXFILE_BUCKET: {
				get: vi.fn().mockResolvedValue(null)
			} as unknown as Env['DTXFILE_BUCKET']
		});
		const response = await worker.fetch(
			new Request('http://api/simfiles/1002/set.def', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(404);
	});

	it('405 on non-GET /simfiles/:id/set.def', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/simfiles/1002/set.def', { method: 'POST' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET');
	});

	it('400 on non-numeric id for /simfiles/:id/set.def', async () => {
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/simfiles/abc/set.def', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(400);
	});

	it('CORS-wraps 500 when downloadSimfile handler throws', async () => {
		const { getSimfileOwner } = await import('@dtx/common/server');
		vi.mocked(getSimfileOwner).mockRejectedValueOnce(new Error('R2 error'));

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = makeEnv({
			PUBLIC_ENABLE_BLOG_DOWNLOAD: 'true',
			CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
		});
		const { getClientIp } = await import('@dtx/common/server');
		vi.mocked(getClientIp).mockReturnValueOnce('1.2.3.4');
		const response = await worker.fetch(
			new Request('http://api/downloads/123', {
				method: 'GET',
				headers: { Origin: 'http://localhost:5173' }
			}),
			env,
			makeExecutionCtx()
		);

		expect(response.status).toBe(500);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		errorSpy.mockRestore();
	});

	it('CORS-wraps 500 when upload handler throws unexpectedly', async () => {
		const { verifyToken } = await import('./auth/verifyToken');
		vi.mocked(verifyToken).mockResolvedValueOnce({
			user: { id: 'u1', email: 't@t.com' } as never,
			session: {} as never
		});

		const { uploadSimfileFile } = await import('./services/uploads');
		vi.mocked(uploadSimfileFile).mockRejectedValueOnce(new Error('R2 write failed'));

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = makeEnv({
			CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
		});
		const formData = new FormData();
		formData.append('file', new File(['content'], 'test.dtx'));
		formData.append('simFileId', '1');
		const response = await worker.fetch(
			new Request('http://api/upload', {
				method: 'POST',
				headers: { Origin: 'http://localhost:5173' },
				body: formData
			}),
			env,
			makeExecutionCtx()
		);

		expect(response.status).toBe(500);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		errorSpy.mockRestore();
	});

	it('CORS-wraps 500 when setDef handler throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = makeEnv({
			CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
			DTXFILE_BUCKET: {
				get: vi.fn().mockRejectedValueOnce(new Error('R2 read failed'))
			} as unknown as Env['DTXFILE_BUCKET']
		});
		const response = await worker.fetch(
			new Request('http://api/simfiles/1002/set.def', {
				method: 'GET',
				headers: { Origin: 'http://localhost:5173' }
			}),
			env,
			makeExecutionCtx()
		);

		expect(response.status).toBe(500);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		errorSpy.mockRestore();
	});

	it('405 on non-POST /upload', async () => {
		const env = makeEnv({
			CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
		});
		const response = await worker.fetch(
			new Request('http://api/upload', {
				method: 'GET',
				headers: { Origin: 'http://localhost:5173' }
			}),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('POST');
	});
});
