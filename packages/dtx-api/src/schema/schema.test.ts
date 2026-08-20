import { describe, it, expect, vi } from 'vitest';
import { yoga } from './index';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

const makeEnv = (graphiql: 'true' | 'false'): Env => ({
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
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: graphiql,
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const ctx = {} as ExecutionContext;

describe('GraphQL schema', () => {
	it('Query.healthz resolves to "ok"', async () => {
		const env = makeEnv('false');
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: '{ healthz }' })
			},
			{ env, ctx }
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { healthz: string } };
		expect(body.data.healthz).toBe('ok');
	});

	it('introspection lists Query.healthz as a field', async () => {
		const env = makeEnv('false');
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: '{ __schema { queryType { fields { name } } } }'
				})
			},
			{ env, ctx }
		);
		const body = (await response.json()) as {
			data: { __schema: { queryType: { fields: Array<{ name: string }> } } };
		};
		expect(body.data.__schema.queryType.fields.map((f) => f.name)).toContain('healthz');
	});

	it('GET /graphql returns GraphiQL HTML when GRAPHIQL=true', async () => {
		const env = makeEnv('true');
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env, ctx }
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
	});

	it('GET /graphql does not return GraphiQL when GRAPHIQL=false', async () => {
		const env = makeEnv('false');
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env, ctx }
		);
		expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
	});
});
