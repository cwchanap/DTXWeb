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

	it('rejects non-integer id with BAD_USER_INPUT', async () => {
		// loadOwner returns null for unsafe ids; scope now passes through so
		// the resolver can validate and throw BAD_USER_INPUT.
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "abc") { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('returns null when scope passes but fetched row is private and unowned (TOCTOU)', async () => {
		// Simulate race: publicOrOwner scope saw null (simfile missing → passes),
		// but by the time the resolver reads the full row, a private simfile
		// owned by someone else exists.  The defense-in-depth check must
		// return null instead of leaking the private data.
		mockedGetOwner.mockResolvedValue(null);
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			is_published: false,
			user_id: 'attacker'
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.data?.simfile).toBeNull();
		expect(result.errors).toBeUndefined();
	});

	it('returns null when scope passes (missing) and fetched row is private, even for authed user', async () => {
		// Same TOCTOU scenario but with an authenticated non-owner.
		mockedGetOwner.mockResolvedValue(null);
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			is_published: false,
			user_id: 'attacker'
		});

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfile(id: "42") { id } }'
		});
		expect(result.data?.simfile).toBeNull();
		expect(result.errors).toBeUndefined();
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

	it('trims whitespace from the query before forwarding', async () => {
		mockedSearch.mockResolvedValue([]);
		await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "  test  ") { id } }'
		});
		expect(mockedSearch).toHaveBeenCalledWith(expect.anything(), {
			query: 'test',
			userId: 'u1',
			excludeIds: [],
			limit: 8
		});
	});

	it('returns empty array for whitespace-only query without calling service', async () => {
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: '{ simfileSearch(query: "   ") { id } }'
		});
		expect(result.data?.simfileSearch).toEqual([]);
		expect(mockedSearch).not.toHaveBeenCalled();
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
	batchEnrichHasUploadedFiles: vi.fn(async () => new Map()),
	batchEnrichFiles: vi.fn(async () => new Map())
}));

const { enrichFiles, enrichHasUploadedFiles, batchEnrichHasUploadedFiles, batchEnrichFiles } =
	await import('../services/r2Enrichment');
const mockedFiles = vi.mocked(enrichFiles);
const mockedHasUploaded = vi.mocked(enrichHasUploadedFiles);
const mockedBatchHasUploaded = vi.mocked(batchEnrichHasUploadedFiles);
const mockedBatchFiles = vi.mocked(batchEnrichFiles);

describe('Simfile.files / Simfile.hasUploadedFiles (lazy)', () => {
	beforeEach(() => {
		mockedFiles.mockReset();
		mockedHasUploaded.mockReset();
		mockedBatchHasUploaded.mockReset().mockResolvedValue(new Map());
		mockedBatchFiles.mockReset().mockResolvedValue(new Map());
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

	it('returns false for hasUploadedFiles when R2 enrichment fails', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedHasUploaded.mockRejectedValue(new Error('R2 listing failed'));
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { hasUploadedFiles } }'
		});
		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({ hasUploadedFiles: false });
	});

	it('propagates R2 errors for files instead of returning empty array', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedFiles.mockRejectedValue(new Error('R2 listing failed'));
		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { files { key size uploaded } } }'
		});
		// The files field should error (not silently return []) so the client
		// can distinguish a transient R2 failure from a chart with no files.
		expect(result.errors).toBeDefined();
		expect(result.errors?.[0]?.message).toContain('R2 listing failed');
	});

	it('uses batch enrichment for hasUploadedFiles in list queries', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		const sim2 = { ...publishedSimfile, id: 2 };
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		mockedBatchHasUploaded.mockResolvedValue(
			new Map([
				[1, true],
				[2, false]
			])
		);

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { hasUploadedFiles } } }'
		});

		const simfilesResult = result.data?.simfiles as
			| { data: Array<{ hasUploadedFiles: boolean }> }
			| undefined;
		expect(simfilesResult?.data).toEqual([
			{ hasUploadedFiles: true },
			{ hasUploadedFiles: false }
		]);
		// Batch enrichment should be called once with all simfile IDs
		expect(mockedBatchHasUploaded).toHaveBeenCalledWith(expect.anything(), [1, 2]);
		// Per-row enrichment should NOT be called (batch handled it)
		expect(mockedHasUploaded).not.toHaveBeenCalled();
	});

	it('uses batch enrichment for files in list queries', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		const sim2 = { ...publishedSimfile, id: 2 };
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		mockedBatchFiles.mockResolvedValue(
			new Map<number, Array<{ key: string; size: number; uploaded: string }>>([
				[1, [{ key: '1/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }]],
				[2, []]
			])
		);

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { files { key size uploaded } } } }'
		});

		const simfilesResult = result.data?.simfiles as
			| { data: Array<{ files: Array<{ key: string; size: number; uploaded: string }> }> }
			| undefined;
		expect(simfilesResult?.data).toEqual([
			{ files: [{ key: '1/a.dtx', size: 10, uploaded: '2026-05-19T00:00:00Z' }] },
			{ files: [] }
		]);
		// Batch enrichment should be called once with all simfile IDs
		expect(mockedBatchFiles).toHaveBeenCalledWith(expect.anything(), [1, 2]);
		// Per-row enrichment should NOT be called (batch handled it)
		expect(mockedFiles).not.toHaveBeenCalled();
		// hasUploadedFiles batch should NOT be called (field not selected)
		expect(mockedBatchHasUploaded).not.toHaveBeenCalled();
	});

	it('does not call hasUploadedFiles batch when field is not selected', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });

		await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 1) { data { id title } count } }'
		});

		expect(mockedBatchHasUploaded).not.toHaveBeenCalled();
		expect(mockedBatchFiles).not.toHaveBeenCalled();
	});

	it('does not call files batch when only hasUploadedFiles is selected', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });
		mockedBatchHasUploaded.mockResolvedValue(new Map([[1, true]]));

		await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 1) { data { hasUploadedFiles } count } }'
		});

		expect(mockedBatchHasUploaded).toHaveBeenCalledWith(expect.anything(), [1]);
		expect(mockedBatchFiles).not.toHaveBeenCalled();
	});

	it('does not trigger batch enrichment when __typename is in selection but files/hasUploadedFiles are not', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });

		await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 1) { data { id title __typename } count } }'
		});

		expect(mockedBatchHasUploaded).not.toHaveBeenCalled();
		expect(mockedBatchFiles).not.toHaveBeenCalled();
	});

	it('resolves fields selected via fragment spread for batch enrichment', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });
		mockedBatchHasUploaded.mockResolvedValue(new Map([[1, true]]));

		await runQuery(makeCtx(), {
			query: `
				fragment SimFields on Simfile { id hasUploadedFiles }
				{ simfiles(scope: PUBLISHED, pageSize: 1) { data { ...SimFields } count } }
			`
		});

		expect(mockedBatchHasUploaded).toHaveBeenCalledWith(expect.anything(), [1]);
		expect(mockedBatchFiles).not.toHaveBeenCalled();
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

	it('preserves explicit nulls for nullable fields', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedUpdate.mockResolvedValue({} as Awaited<ReturnType<typeof updateSimfile>>);
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null
		});

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: `mutation {
				updateSimfile(
					id: "42",
					input: {
						displayId: null,
						downloadUrl: null,
						previewUrl: null,
						videoPreviewUrl: null
					}
				) {
					id
					displayId
					downloadUrl
					previewUrl
					videoPreviewUrl
				}
			}`
		});

		expect(result.errors).toBeUndefined();
		expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 42, {
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null
		});
		expect(result.data?.updateSimfile).toEqual({
			id: '42',
			displayId: null,
			downloadUrl: null,
			previewUrl: null,
			videoPreviewUrl: null
		});
	});

	it('rejects invalid publishDate with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { publishDate: "not-a-date" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('rejects empty input with BAD_USER_INPUT', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: {}) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
	});

	it('NOT_FOUND when updateSimfile throws Simfile not found', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedUpdate.mockRejectedValue(new Error('Simfile not found'));

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
	});

	it('falls back to updateSimfile return when getSimfile returns null (concurrent delete)', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		const updatedRow = {
			id: 42,
			title: 'Updated',
			artist: 'Artist',
			bpm: 120,
			is_published: 1,
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: '2026-01-01',
			created_at: '2026-01-01',
			updated_at: '2026-01-01',
			user_id: 'u1'
		};
		mockedUpdate.mockResolvedValue(updatedRow as Awaited<ReturnType<typeof updateSimfile>>);
		// First call: ownership recheck returns the simfile (user_id matches).
		// Second call: re-read returns null (concurrent delete between update and read).
		mockedGetSimfile.mockResolvedValueOnce(publishedSimfile).mockResolvedValueOnce(null);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "Updated" }) { id title } }'
		});
		expect(result.errors).toBeUndefined();
		expect(result.data?.updateSimfile).toEqual({ id: '42', title: 'Updated' });
	});

	it('FORBIDDEN when owner scope passes but simfile belongs to another user (TOCTOU)', async () => {
		// Simulate race: owner scope saw null (simfile didn't exist → scope passes),
		// but by the time the resolver runs, a simfile exists owned by someone else.
		mockedGetOwner.mockResolvedValue(null);
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, user_id: 'attacker' });

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'] }), {
			query: 'mutation { updateSimfile(id: "42", input: { title: "X" }) { id } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(mockedUpdate).not.toHaveBeenCalled();
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

// Pages must be supplied in order; the last page should have truncated: false.
type R2Page = { objects: Array<{ key: string }>; truncated: boolean; cursor?: string };
const makeR2Pages = (pages: R2Page[]): R2Bucket => {
	let i = 0;
	const listMock = vi.fn(async () => pages[i++] ?? { objects: [], truncated: false });
	const deleteMock = vi.fn(async () => {});
	return { list: listMock, delete: deleteMock } as unknown as R2Bucket;
};

const makeR2ListFailure = (): R2Bucket => {
	const listMock = vi.fn(async () => {
		throw new Error('R2 list failure');
	});
	const deleteMock = vi.fn(async () => {});
	return { list: listMock, delete: deleteMock } as unknown as R2Bucket;
};

const { deleteSimfile } = await import('@dtx/common/server');
const mockedDelete = vi.mocked(deleteSimfile);

describe('Mutation.deleteSimfile', () => {
	beforeEach(() => {
		mockedDelete.mockReset();
		mockedGetOwner.mockReset();
		mockedGetSimfile.mockReset();
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
		mockedGetSimfile.mockResolvedValue({ id: 42, user_id: 'u1' } as never);
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
		// Simulate race condition: row existed for scope check, gone by resolver time.
		mockedGetSimfile.mockResolvedValue(null as never);
		const r2 = makeR2([]);
		mockedDelete.mockRejectedValue(new Error('Simfile not found'));

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
		// R2 delete should never be called since the pre-check caught the missing row.
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('does not delete orphaned R2 objects when simfile row is missing', async () => {
		// The owner scope passes for non-existent simfiles (returns true so resolver
		// can return NOT_FOUND). This test verifies that orphaned R2 objects are NOT
		// deleted when the DB row is missing, even if the owner scope let us through.
		mockedGetOwner.mockResolvedValue(null);
		mockedGetSimfile.mockResolvedValue(null as never);
		const r2 = makeR2([{ key: '42/orphaned.dtx' }]);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
		expect(r2.list).not.toHaveBeenCalled();
		expect(r2.delete).not.toHaveBeenCalled();
	});

	it('walks multiple R2 pages via cursor before deleting the DB row', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ id: 42, user_id: 'u1' } as never);
		const r2 = makeR2Pages([
			{ objects: [{ key: '42/a.dtx' }], truncated: true, cursor: 'p2' },
			{ objects: [{ key: '42/b.dtx' }], truncated: false }
		]);
		mockedDelete.mockResolvedValue(undefined as never);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});

		expect(result.data?.deleteSimfile).toEqual({ id: '42', deleted: true });
		expect(r2.list).toHaveBeenCalledTimes(2);
		expect(r2.delete).toHaveBeenCalledTimes(2);
	});

	it('throws INTERNAL when the stalled-cursor guard fires', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ id: 42, user_id: 'u1' } as never);
		const r2 = makeR2Pages([{ objects: [{ key: '42/a.dtx' }], truncated: true }]);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL');
		expect(mockedDelete).not.toHaveBeenCalled();
	});

	it('throws INTERNAL when R2 list() rejects', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ id: 42, user_id: 'u1' } as never);
		const r2 = makeR2ListFailure();

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL');
		expect(mockedDelete).not.toHaveBeenCalled();
	});

	it('continues DB deletion after partial R2 delete failures', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
		mockedGetSimfile.mockResolvedValue({ id: 42, user_id: 'u1' } as never);
		const listMock = vi.fn(async () => ({
			objects: [{ key: '42/a.dtx' }, { key: '42/b.dtx' }],
			truncated: false
		}));
		let deleteCall = 0;
		const deleteMock = vi.fn(async () => {
			deleteCall++;
			if (deleteCall === 2) throw new Error('R2 delete failed');
		});
		const r2 = { list: listMock, delete: deleteMock } as unknown as R2Bucket;
		mockedDelete.mockResolvedValue(undefined as never);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.data?.deleteSimfile).toEqual({ id: '42', deleted: true });
		expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 42);
	});

	it('FORBIDDEN when owner scope passes but simfile belongs to another user (TOCTOU)', async () => {
		// Simulate race: owner scope saw null (simfile didn't exist → scope passes),
		// but by the time the resolver runs, a simfile exists owned by someone else.
		mockedGetOwner.mockResolvedValue(null);
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, user_id: 'attacker' } as never);
		const r2 = makeR2([]);

		const result = await runQuery(makeCtx({ user: { id: 'u1' } as Ctx['user'], r2 }), {
			query: 'mutation { deleteSimfile(id: "42") { id deleted } }'
		});
		expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
		expect(r2.list).not.toHaveBeenCalled();
		expect(mockedDelete).not.toHaveBeenCalled();
	});
});
