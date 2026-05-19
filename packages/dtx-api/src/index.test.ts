import { describe, it, expect } from 'vitest';
import worker from './index';
import type { Env } from './env';

const makeEnv = (graphiql: 'true' | 'false' = 'true'): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon-key',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: graphiql,
	CORS_ALLOWED_ORIGINS: 'https://pre-prod.dtx.hapadona.com,http://localhost:5173',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
});

const ctx = {} as ExecutionContext;

describe('worker fetch router', () => {
	it('returns a CORS preflight response for allow-listed origins', async () => {
		const response = await worker.fetch(
			new Request('https://api.test/graphql', {
				method: 'OPTIONS',
				headers: { Origin: 'http://localhost:5173' }
			}),
			makeEnv(),
			ctx
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
			ctx
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
			ctx
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
			makeEnv('true'),
			ctx
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
			ctx
		);

		expect(response.status).toBe(404);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(await response.text()).toBe('Not Found');
	});
});
