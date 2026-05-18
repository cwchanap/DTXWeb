import { describe, it, expect, vi } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { schema } from './index';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

const makeEnv = (graphiql: 'true' | 'false'): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: graphiql,
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false'
});

const makeTestYoga = (env: Env) =>
	createYoga<{ env: Env }>({
		schema,
		context: (): Ctx => ({
			user: null,
			session: null,
			env,
			db: env.DB,
			r2: env.DTXFILE_BUCKET,
			kv: env.RATE_LIMIT_API,
			request: new Request('http://test'),
			logger: workerLogger,
			ownerByIdCache: new Map()
		}),
		graphiql: (_req, ctx) => ctx.env.GRAPHIQL === 'true',
		cors: false,
		landingPage: false,
		maskedErrors: false
	});

describe('GraphQL schema', () => {
	it('Query.healthz resolves to "ok"', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: '{ healthz }' })
			},
			{ env }
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { healthz: string } };
		expect(body.data.healthz).toBe('ok');
	});

	it('introspection lists Query.healthz as a field', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					query: '{ __schema { queryType { fields { name } } } }'
				})
			},
			{ env }
		);
		const body = (await response.json()) as {
			data: { __schema: { queryType: { fields: Array<{ name: string }> } } };
		};
		expect(body.data.__schema.queryType.fields.map((f) => f.name)).toContain('healthz');
	});

	it('GET /graphql returns GraphiQL HTML when GRAPHIQL=true', async () => {
		const env = makeEnv('true');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env }
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
	});

	it('GET /graphql does not return GraphiQL when GRAPHIQL=false', async () => {
		const env = makeEnv('false');
		const yoga = makeTestYoga(env);
		const response = await yoga.fetch(
			'http://test/graphql',
			{ method: 'GET', headers: { accept: 'text/html' } },
			{ env }
		);
		expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
	});
});
