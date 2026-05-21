import { describe, it, expect, vi } from 'vitest';
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

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
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

describe('worker fetch router', () => {
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
		const env = makeEnv();
		const response = await worker.fetch(
			new Request('http://api/downloads/123', { method: 'GET' }),
			env,
			makeExecutionCtx()
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
	});

	it('POST /downloads/bulk dispatches to downloadBulk route', async () => {
		const env = makeEnv();
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
});
