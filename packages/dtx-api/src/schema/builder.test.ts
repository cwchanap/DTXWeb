import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import { workerLogger } from '@dtx/common/server';
import type { Ctx, OwnerCacheEntry } from '../context';
import type { Env } from '../env';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return { ...actual, getSimfileOwner: vi.fn() };
});

const { getSimfileOwner } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: 'http://test',
	SUPABASE_SERVICE_ROLE_KEY: 'srk'
});

const baseCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map<string, OwnerCacheEntry | null>(),
	...overrides
});

// Probe field: throws GraphQLError if the named scope fails.
builder.queryField('probeOwner', (t) =>
	t.string({
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_, args) => ({ owner: { simfileId: String(args.id) } }),
		resolve: () => 'ok'
	})
);
builder.queryField('probePublicOrOwner', (t) =>
	t.string({
		args: { id: t.arg.id({ required: true }) },
		authScopes: (_, args) => ({ publicOrOwner: { simfileId: String(args.id) } }),
		resolve: () => 'ok'
	})
);
builder.queryField('probeUser', (t) =>
	t.string({ authScopes: { user: true }, resolve: () => 'ok' })
);

const schema = builder.toSchema();

const runQuery = async (ctx: Ctx, query: string) => {
	const yoga = createYoga<{ ctx: Ctx }>({
		schema,
		context: (req) => req.ctx,
		maskedErrors: false,
		cors: false,
		landingPage: false
	});
	const response = await yoga.fetch(
		'http://test/graphql',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ query })
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

describe('auth scopes', () => {
	beforeEach(() => mockedGetOwner.mockReset());

	it('user scope: passes when ctx.user is set', async () => {
		const result = await runQuery(
			baseCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }),
			'{ probeUser }'
		);
		expect(result.data?.probeUser).toBe('ok');
	});

	it('user scope: rejects when ctx.user is null', async () => {
		const result = await runQuery(baseCtx(), '{ probeUser }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: passes when caller is the owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "42") }'
		);
		expect(result.data?.probeOwner).toBe('ok');
	});

	it('owner scope: rejects when caller is not owner', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'other', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "42") }'
		);
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: rejects anonymous', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(baseCtx(), '{ probeOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: caches lookup per request', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const ctx = baseCtx({ user: { id: 'u1' } as Ctx['user'] });
		await runQuery(ctx, '{ a: probeOwner(id: "42")  b: probeOwner(id: "42") }');
		expect(mockedGetOwner).toHaveBeenCalledTimes(1);
	});

	it('publicOrOwner: anonymous passes when simfile is published', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 1 });
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.data?.probePublicOrOwner).toBe('ok');
	});

	it('publicOrOwner: owner passes for unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probePublicOrOwner(id: "42") }'
		);
		expect(result.data?.probePublicOrOwner).toBe('ok');
	});

	it('publicOrOwner: rejects non-owner anon when unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('publicOrOwner: rejects when simfile missing', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});
});
