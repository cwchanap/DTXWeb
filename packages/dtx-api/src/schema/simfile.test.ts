import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { workerLogger } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';
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

vi.mock('../services/createSimfile', () => ({
	createSimfileWithDtx: vi.fn()
}));

const { createSimfileWithDtx } = await import('../services/createSimfile');
const mockedCreateService = vi.mocked(createSimfileWithDtx);

describe('Mutation.createSimfile', () => {
	beforeEach(() => mockedCreateService.mockReset());

	it('rejects anonymous', async () => {
		const result = await runQuery(makeCtx(), {
			query: 'mutation { createSimfile(input: { bpm: 120 }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('accepts bpm: 0 as a valid finite value', async () => {
		mockedCreateService.mockResolvedValue({
			simfile: {
				id: 1,
				title: '',
				artist: '',
				bpm: 0,
				user_id: 'u1',
				is_published: 0 as const,
				display_id: 1,
				download_url: null,
				preview_url: null,
				video_preview_url: null,
				publish_date: '2026-05-19T00:00:00Z',
				created_at: '2026-05-19T00:00:00Z',
				updated_at: '2026-05-19T00:00:00Z'
			},
			dtxFiles: []
		});
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { createSimfile(input: { bpm: 0, title: "" }) { id } }'
		});
		expect(result.errors).toBeUndefined();
	});

	it('passes camelCase input through to the service', async () => {
		mockedCreateService.mockResolvedValue({
			simfile: {
				id: 99,
				title: 'T',
				artist: 'A',
				bpm: 120,
				user_id: 'u1',
				is_published: 1 as const,
				display_id: 7,
				download_url: 'https://ext',
				preview_url: null,
				video_preview_url: 'https://yt',
				publish_date: '2026-05-19T00:00:00Z',
				created_at: '2026-05-19T00:00:00Z',
				updated_at: '2026-05-19T00:00:00Z'
			},
			dtxFiles: [{ label: 'BSC', level: 5.5 }]
		});
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: `mutation {
					createSimfile(input: {
						title: "T", artist: "A", bpm: 120, isPublished: true,
						displayId: 7, downloadUrl: "https://ext", videoPreviewUrl: "https://yt",
						dtxFiles: [{ label: "BSC", level: 5.5 }]
					}) { id title isPublished dtxFiles { label level } }
				}`
		});
		expect(mockedCreateService).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: 'u1',
				title: 'T',
				artist: 'A',
				bpm: 120,
				isPublished: true,
				displayId: 7,
				downloadUrl: 'https://ext',
				videoPreviewUrl: 'https://yt',
				dtxFiles: [{ label: 'BSC', level: 5.5 }]
			})
		);
		expect(result.data?.createSimfile).toEqual({
			id: '99',
			title: 'T',
			isPublished: true,
			dtxFiles: [{ label: 'BSC', level: 5.5 }]
		});
	});

	it('rejects invalid publishDate with BAD_USER_INPUT', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { createSimfile(input: { bpm: 120, publishDate: "not-a-date" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});

vi.mock('../services/r2Enrichment', () => ({
	enrichFiles: vi.fn(),
	enrichHasUploadedFiles: vi.fn(),
	enrichHasUploadedFilesBatch: vi.fn()
}));

const { enrichFiles, enrichHasUploadedFiles } = await import('../services/r2Enrichment');
const mockedFiles = vi.mocked(enrichFiles);
const mockedHasUploaded = vi.mocked(enrichHasUploadedFiles);

describe('Simfile.files / Simfile.hasUploadedFiles (lazy)', () => {
	beforeEach(() => {
		mockedFiles.mockReset();
		mockedHasUploaded.mockReset();
	});

	it('does not call enrichFiles when files is not selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		await runQuery(makeCtx(), { query: '{ simfile(id: "42") { id title } }' });
		expect(mockedFiles).not.toHaveBeenCalled();
	});

	it('calls enrichFiles when files is selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedFiles.mockResolvedValue([
			{ key: '42/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }
		]);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { files { key size uploaded } } }'
		});
		expect(mockedFiles).toHaveBeenCalledWith(expect.anything(), 42);
		expect(result.data?.simfile).toEqual({
			files: [{ key: '42/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }]
		});
	});

	it('calls enrichHasUploadedFiles only when hasUploadedFiles is selected', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedHasUploaded.mockResolvedValue(true);
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { hasUploadedFiles } }'
		});
		expect(mockedHasUploaded).toHaveBeenCalledWith(expect.anything(), 42);
		expect(result.data?.simfile).toEqual({ hasUploadedFiles: true });
	});
});

const { updateSimfile } = await import('@dtx/common/server');
const mockedUpdate = vi.mocked(updateSimfile);

describe('Mutation.updateSimfile', () => {
	beforeEach(() => {
		mockedUpdate.mockReset();
		mockedGetOwner.mockReset();
		mockedGetSimfile.mockReset();
	});

	it('rejects anonymous (FORBIDDEN via owner scope)', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects non-owner with FORBIDDEN', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone-else', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('updates a simfile and returns the full record', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		// Resolver discards updateSimfile's return value, so the shape doesn't matter;
		// getSimfile is what populates the GraphQL response.
		mockedUpdate.mockResolvedValue({} as Awaited<ReturnType<typeof updateSimfile>>);
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, title: 'X', is_published: true });

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X", isPublished: true }) { id title isPublished } }'
		});
		expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 42, {
			title: 'X',
			is_published: 1
		});
		expect(result.data?.updateSimfile).toEqual({
			id: '42',
			title: 'X',
			isPublished: true
		});
	});

	it('rejects invalid publishDate with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { publishDate: "not-a-date" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('rejects empty input with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: {}) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});
});

const makeR2 = (objects: Array<{ key: string }> = []): R2Bucket => {
	const listMock = vi.fn(async () => ({
		objects,
		truncated: false
	}));
	const deleteMock = vi.fn(async () => {});
	return { list: listMock, delete: deleteMock } as unknown as R2Bucket;
};

const { deleteSimfile } = await import('@dtx/common/server');
const mockedDelete = vi.mocked(deleteSimfile);

describe('Mutation.deleteSimfile', () => {
	beforeEach(() => {
		mockedDelete.mockReset();
		mockedGetOwner.mockReset();
	});

	it('rejects anonymous (FORBIDDEN via owner scope)', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const result = await runQuery(makeCtx(), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('rejects non-owner with FORBIDDEN', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone-else', is_published: 0 });
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
	});

	it('lists + deletes R2 objects and the DB row', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const r2 = makeR2([{ key: '42/a.dtx' }, { key: '42/b.dtx' }]);
		mockedDelete.mockResolvedValue(undefined as never);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});

		expect(result.data?.deleteSimfile).toEqual({ id: '42', deleted: true });
		expect(r2.delete).toHaveBeenCalledTimes(2);
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 42);
	});

	it('NOT_FOUND when DB delete fails because simfile is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const r2 = makeR2([]);
		mockedDelete.mockRejectedValue(new Error('Simfile not found'));

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
	});
});
