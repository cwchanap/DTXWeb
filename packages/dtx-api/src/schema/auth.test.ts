import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => {
	const generateLink = vi.fn();
	return {
		createClient: vi.fn(() => ({
			auth: { getUser: vi.fn(), admin: { generateLink } }
		})),
		__generateLink: generateLink
	};
});

let actualGenerateMagicLink: typeof import('../services/magicLink').generateMagicLink;
vi.mock('../services/magicLink', async () => {
	const actual =
		await vi.importActual<typeof import('../services/magicLink')>('../services/magicLink');
	actualGenerateMagicLink = actual.generateMagicLink;
	return { ...actual, generateMagicLink: vi.fn() };
});

const { schema } = await import('./index');
const { generateMagicLink } = await import('../services/magicLink');
const mocked = vi.mocked(generateMagicLink);

const makeKv = (initial: Record<string, string> = {}): KVNamespace => {
	const store = new Map(Object.entries(initial));
	return {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(),
		list: vi.fn(),
		getWithMetadata: vi.fn()
	} as unknown as KVNamespace;
};

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
});

const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
	user: null,
	session: null,
	env: makeEnv(),
	db: {} as Ctx['db'],
	r2: {} as Ctx['r2'],
	kv: {} as Ctx['kv'],
	request: new Request('http://test', { headers: { 'cf-connecting-ip': '5.6.7.8' } }),
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

beforeEach(() => mocked.mockReset());

describe('Mutation.generateMagicLink', () => {
	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { generateMagicLink { magicLinkUrl success } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mocked).not.toHaveBeenCalled();
	});

	it('returns magicLinkUrl on success', async () => {
		mocked.mockResolvedValue({ magicLinkUrl: 'https://example.com/magic' });
		const result = await runQuery(
			makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }),
			{ query: 'mutation { generateMagicLink { magicLinkUrl success } }' }
		);
		expect(result.data?.generateMagicLink).toEqual({
			magicLinkUrl: 'https://example.com/magic',
			success: true
		});
	});

	it('passes the IP from cf-connecting-ip to the service', async () => {
		mocked.mockResolvedValue({ magicLinkUrl: 'https://example.com/magic' });
		await runQuery(makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'] }), {
			query: 'mutation { generateMagicLink { magicLinkUrl } }'
		});
		expect(mocked).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			{ id: 'u1', email: 'a@b.com' },
			'5.6.7.8'
		);
	});

	it('propagates RATE_LIMITED from the service', async () => {
		// Delegate to the real service so the rejection originates in source code
		// (not the test file) — sidesteps Vitest's unhandled-rejection tracker
		// reporting test-constructed errors as test failures.
		mocked.mockImplementationOnce(actualGenerateMagicLink);
		const hour = Math.floor(Date.now() / 3_600_000);
		const kv = makeKv({ [`magiclink:u1:${hour}`]: '5' });
		const result = await runQuery(
			makeCtx({ user: { id: 'u1', email: 'a@b.com' } as Ctx['user'], kv }),
			{ query: 'mutation { generateMagicLink { magicLinkUrl } }' }
		);
		expect(result.errors?.[0]?.extensions?.code).toBe('RATE_LIMITED');
	});

	it('rejects when authed user has no email (BAD_USER_INPUT)', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { generateMagicLink { magicLinkUrl } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});
