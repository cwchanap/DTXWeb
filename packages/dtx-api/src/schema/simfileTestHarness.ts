import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

// Imported lazily so vi.mock registrations in consuming test files are
// honoured before the schema (which imports the mocked modules) loads.
const { schema } = await import('./index');

export const makeEnv = (): Env => ({
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

export const makeCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
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
	catalogFilesCache: new Map(),
	...overrides
});

export const runQuery = async (ctx: Ctx, body: Record<string, unknown>) => {
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
		data?: Record<string, unknown> | null;
		errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
	}>;
};
