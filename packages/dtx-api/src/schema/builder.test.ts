import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { builder } from './builder';
import { workerLogger } from '@dtx/common/server';
import type { Ctx, OwnerCacheEntry } from '../context';
import type { Env } from '../env';

vi.mock('../auth/session', () => ({ resolveAuthSession: vi.fn() }));

const { resolveAuthSession } = await import('../auth/session');
const { createContext } = await import('../context');
const mockedResolveAuthSession = vi.mocked(resolveAuthSession);

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
	PUBLIC_SIMFILE_BUCKET_URL: 'http://test'
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
	hasUploadedFilesCache: new Map(),
	filesCache: new Map(),
	...overrides
});

const validAuthSession = (): NonNullable<Awaited<ReturnType<typeof resolveAuthSession>>> => ({
	user: { id: 'u1' },
	session: {
		id: 'session-1',
		userId: 'u1',
		expiresAt: new Date('2030-01-01T00:00:00.000Z')
	}
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
	beforeEach(() => {
		mockedGetOwner.mockReset();
		mockedResolveAuthSession.mockReset().mockResolvedValue(null);
	});

	it('GraphQL accepts a valid Better Auth cookie session', async () => {
		const request = new Request('https://api.test/graphql', {
			method: 'POST',
			headers: {
				cookie: 'dtx-local-session=session',
				Origin: 'http://localhost:5173'
			}
		});
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());

		const ctx = await createContext(request, makeEnv());
		const result = await runQuery(ctx, '{ probeUser }');

		expect(result.data?.probeUser).toBe('ok');
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, ctx.env);
	});

	it('GraphQL accepts a valid desktop Bearer session without Origin', async () => {
		const request = new Request('https://api.test/graphql', {
			method: 'POST',
			headers: { Authorization: 'Bearer opaque-session-token' }
		});
		mockedResolveAuthSession.mockResolvedValue(validAuthSession());

		const ctx = await createContext(request, makeEnv());
		const result = await runQuery(ctx, '{ probeUser }');

		expect(result.data?.probeUser).toBe('ok');
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, ctx.env);
	});

	it('GraphQL rejects a cookie session when unsafe Origin is missing', async () => {
		const request = new Request('https://api.test/graphql', {
			method: 'POST',
			headers: { cookie: 'dtx-local-session=session' }
		});

		const ctx = await createContext(request, makeEnv());
		const result = await runQuery(ctx, '{ probeUser }');

		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, ctx.env);
	});

	it('GraphQL rejects a cookie session from the wrong Origin', async () => {
		const request = new Request('https://api.test/graphql', {
			method: 'POST',
			headers: {
				cookie: 'dtx-local-session=session',
				Origin: 'https://evil.example.com'
			}
		});

		const ctx = await createContext(request, makeEnv());
		const result = await runQuery(ctx, '{ probeUser }');

		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, ctx.env);
	});

	it('GraphQL keeps anonymous and invalid sessions unauthorized', async () => {
		const request = new Request('https://api.test/graphql', {
			method: 'POST',
			headers: { Authorization: 'Bearer invalid-session-token' }
		});

		const ctx = await createContext(request, makeEnv());
		const result = await runQuery(ctx, '{ probeUser }');

		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mockedResolveAuthSession).toHaveBeenCalledWith(request, ctx.env);
	});

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

	it('publicOrOwner: passes scope when simfile missing (resolver handles null)', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const result = await runQuery(baseCtx(), '{ probePublicOrOwner(id: "42") }');
		// Scope should pass — the resolver (not auth) determines the response for missing resources.
		expect(result.data?.probePublicOrOwner).toBe('ok');
		expect(result.errors).toBeUndefined();
	});

	it('owner scope: passes scope when simfile missing (resolver handles NOT_FOUND)', async () => {
		mockedGetOwner.mockResolvedValue(null);
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "99") }'
		);
		// Scope should pass — the resolver returns NOT_FOUND for missing resources.
		expect(result.data?.probeOwner).toBe('ok');
		expect(result.errors).toBeUndefined();
	});

	it('owner scope: rejects with FORBIDDEN when DB lookup fails (transient)', async () => {
		mockedGetOwner.mockRejectedValueOnce(new Error('D1 timeout'));
		const result = await runQuery(
			baseCtx({ user: { id: 'u1' } as Ctx['user'] }),
			'{ probeOwner(id: "42") }'
		);
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner scope: retries after a transient DB rejection in the same request', async () => {
		mockedGetOwner
			.mockRejectedValueOnce(new Error('D1 timeout'))
			.mockResolvedValueOnce({ user_id: 'u1', is_published: 0 });
		const ctx = baseCtx({ user: { id: 'u1' } as Ctx['user'] });
		const first = await runQuery(ctx, '{ probeOwner(id: "42") }');
		expect(first.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		const second = await runQuery(ctx, '{ probeOwner(id: "42") }');
		expect(second.data?.probeOwner).toBe('ok');
		expect(mockedGetOwner).toHaveBeenCalledTimes(2);
	});
});
