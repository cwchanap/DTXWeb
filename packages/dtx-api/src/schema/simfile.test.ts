import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { Ctx } from '../context';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } }))
}));

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfile: vi.fn(),
		getSimfileOwner: vi.fn(),
		getNextDisplayId: vi.fn(),
		listSimfiles: vi.fn(),
		searchSimfiles: vi.fn(),
		createSimfile: vi.fn(),
		createDtxFiles: vi.fn(),
		updateSimfile: vi.fn(),
		deleteSimfile: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, getNextDisplayId } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedNextDisplayId = vi.mocked(getNextDisplayId);

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
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
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

const publishedSimfile = {
	id: 42,
	title: 'Song A',
	artist: 'Artist A',
	bpm: 120,
	user_id: 'u1',
	is_published: true as const,
	display_id: 1,
	download_url: 'https://ext.example/a',
	preview_url: null,
	video_preview_url: null,
	publish_date: '2026-05-19T00:00:00Z',
	created_at: '2026-05-19T00:00:00Z',
	updated_at: '2026-05-19T00:00:00Z',
	dtx_files: [{ level: 7.5, label: 'BSC' }]
};

beforeEach(() => {
	mockedGetSimfile.mockReset();
	mockedGetOwner.mockReset();
	mockedNextDisplayId.mockReset();
});

describe('Query.simfile', () => {
	it('returns a published simfile anonymously', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id title artist bpm userId isPublished displayId publishDate dtxFiles { level label } } }'
		});
		expect(result.data?.simfile).toEqual({
			id: '42',
			title: 'Song A',
			artist: 'Artist A',
			bpm: 120,
			userId: 'u1',
			isPublished: true,
			displayId: 1,
			publishDate: '2026-05-19T00:00:00Z',
			dtxFiles: [{ level: 7.5, label: 'BSC' }]
		});
	});

	it('FORBIDDEN for anonymous unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('owner sees own unpublished simfile', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, is_published: false });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfile(id: "42") { id isPublished } }'
		});
		expect(result.data?.simfile).toEqual({ id: '42', isPublished: false });
	});

	it('FORBIDDEN when non-owner authed and unpublished', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'someone-else' } as Ctx['user'] }), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns null when scope passes but row missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(null);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.data?.simfile).toBeNull();
	});

	it('rejects non-integer id with BAD_USER_INPUT (scope rejects → FORBIDDEN)', async () => {
		// loadOwner returns null for unsafe ids; publicOrOwner then denies.
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "abc") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});
});

describe('Query.nextDisplayId', () => {
	it('FORBIDDEN anonymous', async () => {
		const result = await runQuery(makeCtx(), { query: '{ nextDisplayId }' });
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('returns the next id for the authed user', async () => {
		mockedNextDisplayId.mockResolvedValue(42);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ nextDisplayId }'
		});
		expect(result.data?.nextDisplayId).toBe(42);
		expect(mockedNextDisplayId).toHaveBeenCalledWith(expect.anything(), 'u1');
	});
});

const { listSimfiles, searchSimfiles } = await import('@dtx/common/server');
const mockedList = vi.mocked(listSimfiles);
const mockedSearch = vi.mocked(searchSimfiles);

describe('Query.simfiles', () => {
	beforeEach(() => {
		mockedList.mockReset();
	});

	it('rejects MINE scope for anonymous (UNAUTHORIZED)', async () => {
		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: MINE) { count data { id } } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED');
	});

	it('allows PUBLISHED scope anonymously', async () => {
		mockedList.mockResolvedValue({ data: [publishedSimfile], count: 1 });
		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 5) { count data { id title } } }'
		});
		expect(result.data?.simfiles).toEqual({
			count: 1,
			data: [{ id: '42', title: 'Song A' }]
		});
		expect(mockedList).toHaveBeenCalledWith(expect.anything(), {
			userId: undefined,
			publishedOnly: true,
			search: undefined,
			page: 1,
			pageSize: 5
		});
	});

	it('passes user id and search term for MINE scope', async () => {
		mockedList.mockResolvedValue({ data: [], count: 0 });
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfiles(scope: MINE, search: "abc", page: 2, pageSize: 10) { count } }'
		});
		expect(mockedList).toHaveBeenCalledWith(expect.anything(), {
			userId: 'u1',
			publishedOnly: false,
			search: 'abc',
			page: 2,
			pageSize: 10
		});
	});

	it('uses undefined userId when authed user requests PUBLISHED scope', async () => {
		mockedList.mockResolvedValue({ data: [], count: 0 });
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfiles(scope: PUBLISHED) { count } }'
		});
		expect(mockedList).toHaveBeenCalledWith(expect.anything(), {
			userId: undefined,
			publishedOnly: true,
			search: undefined,
			page: 1,
			pageSize: 20
		});
	});
});

describe('Query.simfileSearch', () => {
	beforeEach(() => {
		mockedSearch.mockReset();
	});

	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: '{ simfileSearch(query: "abc") { id title } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('forwards args to the search service', async () => {
		mockedSearch.mockResolvedValue([
			{ id: 7, title: 'X', artist: 'Y', bpm: 100, is_published: 1 }
		]);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "abc", excludeIds: ["3","5"], limit: 4) { id title isPublished } }'
		});
		expect(mockedSearch).toHaveBeenCalledWith(expect.anything(), {
			query: 'abc',
			userId: 'u1',
			excludeIds: [3, 5],
			limit: 4
		});
		expect(result.data?.simfileSearch).toEqual([{ id: '7', title: 'X', isPublished: true }]);
	});

	it('coerces invalid excludeIds entries and skips them', async () => {
		mockedSearch.mockResolvedValue([]);
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "abc", excludeIds: ["3", "not-a-number"]) { id } }'
		});
		expect(mockedSearch).toHaveBeenCalledWith(expect.anything(), {
			query: 'abc',
			userId: 'u1',
			excludeIds: [3],
			limit: 8
		});
	});
});
