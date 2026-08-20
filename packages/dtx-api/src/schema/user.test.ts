import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { schema } from './index';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getUserProfile: vi.fn(),
		upsertUserProfile: vi.fn(),
		getSimfileOwner: vi.fn()
	};
});

const { getUserProfile, upsertUserProfile } = await import('@dtx/common/server');
const mockedGet = vi.mocked(getUserProfile);
const mockedUpsert = vi.mocked(upsertUserProfile);

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
	PUBLIC_SIMFILE_BUCKET_URL: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	hasUploadedFilesCache: new Map(),
	filesCache: new Map(),
	...overrides
});

const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
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
			body: JSON.stringify(body)
		},
		{ ctx }
	);
	return response.json() as Promise<{
		data?: Record<string, unknown>;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};

beforeEach(() => {
	mockedGet.mockReset();
	mockedUpsert.mockReset();
});

describe('Query.me', () => {
	it('returns null when anonymous (UNAUTHORIZED via scope)', async () => {
		const result = await runQuery(makeCtx(), { query: '{ me { userId username } }' });
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns the profile when authed and profile exists', async () => {
		mockedGet.mockResolvedValue({ id: 1, user_id: 'u1', username: 'alice' });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ me { userId username } }'
		});
		expect(result.data?.me).toEqual({ userId: 'u1', username: 'alice' });
	});

	it('throws NOT_FOUND when authed but profile is missing', async () => {
		mockedGet.mockResolvedValue(null);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ me { userId username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
	});
});

describe('Mutation.upsertUserProfile', () => {
	it('rejects anonymous with FORBIDDEN', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { upsertUserProfile(input: { username: "bob" }) { username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects empty username with BAD_USER_INPUT', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { upsertUserProfile(input: { username: "" }) { username } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('rejects >30 char username with BAD_USER_INPUT', async () => {
		const long = 'x'.repeat(31);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: `mutation { upsertUserProfile(input: { username: "${long}" }) { username } }`
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('trims whitespace and accepts a valid username', async () => {
		mockedUpsert.mockResolvedValue({ id: 1, user_id: 'u1', username: 'alice' });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { upsertUserProfile(input: { username: "  alice  " }) { userId username } }'
		});
		expect(result.data?.upsertUserProfile).toEqual({ userId: 'u1', username: 'alice' });
		expect(mockedUpsert).toHaveBeenCalledWith(expect.anything(), {
			user_id: 'u1',
			username: 'alice'
		});
	});
});
