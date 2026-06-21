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
	catalogFilesCache: new Map(),
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

	it('exposes compatibility metadata defaults on a published simfile', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { id genre tags durationSeconds } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			id: '42',
			genre: null,
			tags: [],
			durationSeconds: null
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

	it('exposes compatibility metadata defaults in published list results', async () => {
		mockedList.mockResolvedValue({ data: [publishedSimfile], count: 1 });

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED) { count data { id genre tags durationSeconds } } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			count: 1,
			data: [
				{
					id: '42',
					genre: null,
					tags: [],
					durationSeconds: null
				}
			]
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
	discoverCatalogFiles: vi.fn(),
	enrichFiles: vi.fn(),
	enrichHasUploadedFiles: vi.fn(),
	batchEnrichHasUploadedFiles: vi.fn(async () => new Map()),
	batchEnrichFiles: vi.fn(async () => new Map()),
	batchDiscoverCatalogFiles: vi.fn(async () => new Map())
}));

const {
	discoverCatalogFiles,
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles,
	batchDiscoverCatalogFiles
} = await import('../services/r2Enrichment');
const mockedDiscoverCatalogFiles = vi.mocked(discoverCatalogFiles);
const mockedFiles = vi.mocked(enrichFiles);
const mockedHasUploaded = vi.mocked(enrichHasUploadedFiles);
const mockedBatchHasUploaded = vi.mocked(batchEnrichHasUploadedFiles);
const mockedBatchFiles = vi.mocked(batchEnrichFiles);
const mockedBatchCatalog = vi.mocked(batchDiscoverCatalogFiles);

beforeEach(() => {
	mockedDiscoverCatalogFiles.mockReset().mockResolvedValue({
		previewUrl: null,
		downloadUrl: null,
		charts: [],
		chartsPopulated: true
	});
	mockedBatchCatalog.mockReset().mockResolvedValue(new Map());
});

describe('Simfile.files / Simfile.hasUploadedFiles (lazy)', () => {
	beforeEach(() => {
		mockedFiles.mockReset();
		mockedHasUploaded.mockReset();
		mockedBatchHasUploaded.mockReset().mockResolvedValue(new Map());
		mockedBatchFiles.mockReset().mockResolvedValue(new Map());
		mockedBatchCatalog.mockReset().mockResolvedValue(new Map());
	});

	it('resolves catalog DTX file metadata from discovered R2 files', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			dtx_files: [
				{ label: 'ADV', level: 5.25 },
				{ label: 'EXT', level: 8.75 }
			]
		});
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			// charts are positional: charts[index] corresponds to
			// dtx_files[index]. Order must match the dtx_files array.
			charts: [
				{
					label: 'ADV',
					level: 5.25,
					fileUrl: 'https://cdn.example/42/adv.dtx',
					fileSizeBytes: 1234,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'EXT',
					level: 8.75,
					fileUrl: 'https://cdn.example/42/ext.dtx',
					fileSizeBytes: 2345,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const result = await runQuery(
			makeCtx({ env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://cdn.example' } }),
			{
				query: '{ simfile(id: "42") { dtxFiles { label level fileUrl fileSizeBytes fileEncoding } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			dtxFiles: [
				{
					label: 'ADV',
					level: 5.25,
					fileUrl: 'https://cdn.example/42/adv.dtx',
					fileSizeBytes: 1234,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'EXT',
					level: 8.75,
					fileUrl: 'https://cdn.example/42/ext.dtx',
					fileSizeBytes: 2345,
					fileEncoding: 'SHIFT_JIS'
				}
			]
		});
		expect(mockedDiscoverCatalogFiles).toHaveBeenCalledWith(
			expect.anything(),
			{
				simfileId: 42,
				dtxFiles: [
					{ label: 'ADV', level: 5.25 },
					{ label: 'EXT', level: 8.75 }
				],
				publicBaseUrl: 'https://cdn.example'
			},
			expect.anything()
		);
		expect(mockedDiscoverCatalogFiles).toHaveBeenCalledTimes(1);
	});

	it('resolves duplicate label+level rows by row index, not by label search', async () => {
		// The DB schema has no UNIQUE constraint on (simfile_id, label, level),
		// so two dtx_files rows can share the same label+level. The resolver
		// must resolve each row positionally (charts[index]) rather than
		// searching by label+level, which would return the first chart for
		// both rows and expose the wrong R2 object for the second.
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			dtx_files: [
				{ label: 'BSC', level: 3 },
				{ label: 'BSC', level: 3 }
			]
		});
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			charts: [
				{
					label: 'BSC',
					level: 3,
					fileUrl: 'https://cdn.example/42/chart-a.dtx',
					fileSizeBytes: 100,
					fileEncoding: 'SHIFT_JIS'
				},
				{
					label: 'BSC',
					level: 3,
					fileUrl: 'https://cdn.example/42/chart-b.dtx',
					fileSizeBytes: 200,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const result = await runQuery(
			makeCtx({ env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://cdn.example' } }),
			{
				query: '{ simfile(id: "42") { dtxFiles { label level fileUrl fileSizeBytes } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			dtxFiles: [
				{
					label: 'BSC',
					level: 3,
					fileUrl: 'https://cdn.example/42/chart-a.dtx',
					fileSizeBytes: 100
				},
				{
					label: 'BSC',
					level: 3,
					fileUrl: 'https://cdn.example/42/chart-b.dtx',
					fileSizeBytes: 200
				}
			]
		});
	});

	it('falls back to discovered previewUrl when database preview_url is null', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, preview_url: null });
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: 'https://cdn.example/42/preview.mp3',
			downloadUrl: null,
			charts: [],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { previewUrl } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			previewUrl: 'https://cdn.example/42/preview.mp3'
		});
	});

	it('returns null downloadUrl when database download_url is null (no R2 discovery fallback)', async () => {
		// downloadUrl is DB-only: discovered R2 audio objects (drum sample
		// chips like bass.ogg) must NOT be returned as the external download
		// link. The R2 download path is handled separately via
		// hasUploadedFiles + downloadSimfile(), gated by the blog download
		// feature flag.
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, download_url: null });
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: 'https://cdn.example/42/music.ogg',
			charts: [],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { downloadUrl } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			downloadUrl: null
		});
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('returns null downloadUrl when database download_url is whitespace-only (no R2 discovery fallback)', async () => {
		// Mirrors the previewUrl coercion: empty / whitespace DB strings must
		// be coerced to null so the GraphQL field renders as null rather than
		// the raw '' to clients. But unlike previewUrl, downloadUrl does NOT
		// fall back to catalog discovery — it stays null.
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, download_url: '   ' });
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: 'https://cdn.example/42/music.ogg',
			charts: [],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { downloadUrl } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			downloadUrl: null
		});
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('falls back to discovered previewUrl when database preview_url is an empty string', async () => {
		// ChartDetail form submits empty inputs as '' which the update resolver
		// stores verbatim. Blank strings must be treated like NULL so the
		// catalog fallback runs instead of returning '' to clients.
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({ ...publishedSimfile, preview_url: '' });
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: 'https://cdn.example/42/preview.mp3',
			downloadUrl: null,
			charts: [],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { previewUrl } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			previewUrl: 'https://cdn.example/42/preview.mp3'
		});
		expect(mockedDiscoverCatalogFiles).toHaveBeenCalledTimes(1);
	});

	it('prefers database previewUrl and downloadUrl over discovered values', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			...publishedSimfile,
			preview_url: 'https://db.example/preview.mp3',
			download_url: 'https://db.example/download.zip'
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { previewUrl downloadUrl } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfile).toEqual({
			previewUrl: 'https://db.example/preview.mp3',
			downloadUrl: 'https://db.example/download.zip'
		});
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('returns an INTERNAL field error when a selected DTX chart fileUrl is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			charts: [
				{
					label: 'BSC',
					level: 7.5,
					fileUrl: null,
					fileSizeBytes: null,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { dtxFiles { label fileUrl } } }'
		});

		expect(result.errors?.[0]?.message).toBe('DTX chart file not found in R2');
		expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL');
	});

	it('returns INTERNAL for fileSizeBytes when the DTX chart file is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			charts: [
				{
					label: 'BSC',
					level: 7.5,
					fileUrl: null,
					fileSizeBytes: null,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { dtxFiles { label fileSizeBytes } } }'
		});

		expect(result.errors?.[0]?.message).toBe('DTX chart file not found in R2');
		expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL');
	});

	it('returns INTERNAL for fileEncoding when the DTX chart file is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			charts: [
				{
					label: 'BSC',
					level: 7.5,
					fileUrl: null,
					fileSizeBytes: null,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const result = await runQuery(makeCtx(), {
			query: '{ simfile(id: "42") { dtxFiles { label fileEncoding } } }'
		});

		expect(result.errors?.[0]?.message).toBe('DTX chart file not found in R2');
		expect(result.errors?.[0]?.extensions?.code).toBe('INTERNAL');
	});

	it('logs to ctx.logger.error before throwing when a DTX chart file is missing', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(publishedSimfile);
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: null,
			downloadUrl: null,
			charts: [
				{
					label: 'BSC',
					level: 7.5,
					fileUrl: null,
					fileSizeBytes: null,
					fileEncoding: 'SHIFT_JIS'
				}
			],
			chartsPopulated: true
		});

		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		};
		await runQuery(makeCtx({ logger }), {
			query: '{ simfile(id: "42") { dtxFiles { label fileUrl } } }'
		});

		expect(logger.error).toHaveBeenCalledWith('DTX chart file missing in R2', {
			simfileId: 42,
			label: 'BSC',
			level: 7.5
		});
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

	it('uses batch catalog discovery for DTX file URLs in list queries', async () => {
		const sim1 = {
			...publishedSimfile,
			id: 1,
			dtx_files: [{ label: 'BSC', level: 3 }]
		};
		const sim2 = {
			...publishedSimfile,
			id: 2,
			dtx_files: [{ label: 'EXT', level: 8 }]
		};
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		mockedBatchCatalog.mockResolvedValue(
			new Map([
				[
					1,
					{
						previewUrl: null,
						downloadUrl: null,
						charts: [
							{
								label: 'BSC',
								level: 3,
								fileUrl: 'https://bucket.example/1/basic.dtx',
								fileSizeBytes: 100,
								fileEncoding: 'SHIFT_JIS'
							}
						],
						chartsPopulated: true
					}
				],
				[
					2,
					{
						previewUrl: null,
						downloadUrl: null,
						charts: [
							{
								label: 'EXT',
								level: 8,
								fileUrl: 'https://bucket.example/2/extreme.dtx',
								fileSizeBytes: 200,
								fileEncoding: 'SHIFT_JIS'
							}
						],
						chartsPopulated: true
					}
				]
			])
		);

		const result = await runQuery(
			makeCtx({
				env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' }
			}),
			{
				query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id dtxFiles { label fileUrl } } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{
					id: '1',
					dtxFiles: [{ label: 'BSC', fileUrl: 'https://bucket.example/1/basic.dtx' }]
				},
				{
					id: '2',
					dtxFiles: [{ label: 'EXT', fileUrl: 'https://bucket.example/2/extreme.dtx' }]
				}
			]
		});
		expect(mockedBatchCatalog).toHaveBeenCalledTimes(1);
		expect(mockedBatchCatalog).toHaveBeenCalledWith(
			expect.anything(),
			[
				{
					simfileId: 1,
					dtxFiles: [{ label: 'BSC', level: 3 }],
					publicBaseUrl: 'https://bucket.example'
				},
				{
					simfileId: 2,
					dtxFiles: [{ label: 'EXT', level: 8 }],
					publicBaseUrl: 'https://bucket.example'
				}
			],
			expect.anything()
		);
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('does not call catalog discovery for simple list metadata selections', async () => {
		const sim1 = { ...publishedSimfile, id: 1 };
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });

		await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 1) { data { id title } } }'
		});

		expect(mockedBatchCatalog).not.toHaveBeenCalled();
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('uses batch catalog discovery for list previewUrl selections and returns DB downloadUrl', async () => {
		const sim1 = {
			...publishedSimfile,
			id: 1,
			preview_url: 'https://db.example/preview.mp3'
		};
		const sim2 = {
			...publishedSimfile,
			id: 2,
			download_url: 'https://db.example/download.zip'
		};
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		// sim1 has both DB URLs set (preview_url from override, download_url from
		// publishedSimfile default), so it is filtered out. Only sim2 needs
		// discovery because its preview_url is null (publishedSimfile default).
		// sim2's download_url is also set, so downloadUrl does not drive discovery.
		mockedBatchCatalog.mockResolvedValue(
			new Map([
				[
					2,
					{
						previewUrl: null,
						downloadUrl: null,
						charts: [],
						chartsPopulated: false
					}
				]
			])
		);

		const result = await runQuery(
			makeCtx({
				env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' }
			}),
			{
				query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id previewUrl downloadUrl } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{
					id: '1',
					previewUrl: 'https://db.example/preview.mp3',
					downloadUrl: 'https://ext.example/a'
				},
				{
					id: '2',
					previewUrl: null,
					downloadUrl: 'https://db.example/download.zip'
				}
			]
		});
		expect(mockedBatchCatalog).toHaveBeenCalledTimes(1);
		expect(mockedBatchCatalog).toHaveBeenCalledWith(
			expect.anything(),
			[
				{
					simfileId: 2,
					// dtxFiles is [] because the query didn't select any dtxFiles
					// fields — avoids an unnecessary SET.DEF fetch per simfile.
					dtxFiles: [],
					publicBaseUrl: 'https://bucket.example'
				}
			],
			expect.anything()
		);
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('does not trigger catalog discovery when only downloadUrl is selected and DB has values', async () => {
		// downloadUrl is DB-only. Selecting it in a list query must not
		// pull simfiles into the discovery batch — the resolver just
		// returns each row's DB value.
		const sim1 = {
			...publishedSimfile,
			id: 1,
			download_url: 'https://db.example/1-download.zip'
		};
		const sim2 = {
			...publishedSimfile,
			id: 2,
			download_url: 'https://db.example/2-download.zip'
		};
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id downloadUrl } } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{ id: '1', downloadUrl: 'https://db.example/1-download.zip' },
				{ id: '2', downloadUrl: 'https://db.example/2-download.zip' }
			]
		});
		expect(mockedBatchCatalog).not.toHaveBeenCalled();
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('does not batch catalog discovery for list URL selections when database URLs exist', async () => {
		const sim1 = {
			...publishedSimfile,
			id: 1,
			preview_url: 'https://db.example/1-preview.mp3',
			download_url: 'https://db.example/1-download.zip'
		};
		const sim2 = {
			...publishedSimfile,
			id: 2,
			preview_url: 'https://db.example/2-preview.mp3',
			download_url: 'https://db.example/2-download.zip'
		};
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id previewUrl downloadUrl } } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{
					id: '1',
					previewUrl: 'https://db.example/1-preview.mp3',
					downloadUrl: 'https://db.example/1-download.zip'
				},
				{
					id: '2',
					previewUrl: 'https://db.example/2-preview.mp3',
					downloadUrl: 'https://db.example/2-download.zip'
				}
			]
		});
		expect(mockedBatchCatalog).not.toHaveBeenCalled();
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('uses batch catalog discovery for list previewUrl selections when any database value is missing', async () => {
		const sim1 = {
			...publishedSimfile,
			id: 1,
			preview_url: 'https://db.example/1-preview.mp3'
		};
		const sim2 = { ...publishedSimfile, id: 2, preview_url: null };
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		// Only sim2 needs discovery — sim1 has a DB preview_url so it is filtered out.
		mockedBatchCatalog.mockResolvedValue(
			new Map([
				[
					2,
					{
						previewUrl: 'https://bucket.example/2/preview.mp3',
						downloadUrl: null,
						charts: [],
						chartsPopulated: false
					}
				]
			])
		);

		const result = await runQuery(
			makeCtx({
				env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' }
			}),
			{
				query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id previewUrl } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{ id: '1', previewUrl: 'https://db.example/1-preview.mp3' },
				{ id: '2', previewUrl: 'https://bucket.example/2/preview.mp3' }
			]
		});
		expect(mockedBatchCatalog).toHaveBeenCalledTimes(1);
		expect(mockedBatchCatalog).toHaveBeenCalledWith(
			expect.anything(),
			[
				{
					simfileId: 2,
					dtxFiles: [],
					publicBaseUrl: 'https://bucket.example'
				}
			],
			expect.anything()
		);
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('does not trigger batch catalog discovery when only downloadUrl is selected and DB values are null/blank', async () => {
		// downloadUrl is DB-only: null/blank DB values stay null and do NOT
		// trigger R2 discovery. This prevents drum sample chips (e.g.
		// bass.ogg) from being returned as the external download link.
		const sim1 = { ...publishedSimfile, id: 1, download_url: '   ' };
		const sim2 = { ...publishedSimfile, id: 2, download_url: null };
		const sim3 = { ...publishedSimfile, id: 3, download_url: 'https://db.example/3.zip' };
		mockedList.mockResolvedValue({ data: [sim1, sim2, sim3], count: 3 });
		mockedBatchCatalog.mockResolvedValue(new Map());

		const result = await runQuery(makeCtx(), {
			query: '{ simfiles(scope: PUBLISHED, pageSize: 3) { data { id downloadUrl } } }'
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{ id: '1', downloadUrl: null },
				{ id: '2', downloadUrl: null },
				{ id: '3', downloadUrl: 'https://db.example/3.zip' }
			]
		});
		expect(mockedBatchCatalog).not.toHaveBeenCalled();
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('routes sims with blank DB preview_url through batch catalog discovery in list queries', async () => {
		// Empty / whitespace-only DB preview_url must be treated like NULL in
		// the prefetch filter so the sims are included in the discovery batch
		// and the resolver falls back to the discovered value.
		const sim1 = { ...publishedSimfile, id: 1, preview_url: '' };
		const sim2 = {
			...publishedSimfile,
			id: 2,
			preview_url: 'https://db.example/2-preview.mp3',
			download_url: 'https://db.example/2-download.zip'
		};
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		mockedBatchCatalog.mockResolvedValue(
			new Map([
				[
					1,
					{
						previewUrl: 'https://bucket.example/1/preview.mp3',
						downloadUrl: null,
						charts: [],
						chartsPopulated: false
					}
				]
			])
		);

		const result = await runQuery(
			makeCtx({
				env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' }
			}),
			{
				query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id previewUrl downloadUrl } } }'
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{
					id: '1',
					previewUrl: 'https://bucket.example/1/preview.mp3',
					// publishedSimfile's default download_url
					downloadUrl: 'https://ext.example/a'
				},
				{
					id: '2',
					previewUrl: 'https://db.example/2-preview.mp3',
					downloadUrl: 'https://db.example/2-download.zip'
				}
			]
		});
		// Only sim1 needed discovery (blank preview_url). sim2 has both DB
		// URLs set, so it is skipped.
		expect(mockedBatchCatalog).toHaveBeenCalledTimes(1);
		expect(mockedBatchCatalog).toHaveBeenCalledWith(
			expect.anything(),
			[
				{
					simfileId: 1,
					dtxFiles: [],
					publicBaseUrl: 'https://bucket.example'
				}
			],
			expect.anything()
		);
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
	});

	it('uses batch catalog discovery for nested DTX metadata selected via fragments', async () => {
		const sim1 = {
			...publishedSimfile,
			id: 1,
			dtx_files: [{ label: 'BSC', level: 3 }]
		};
		mockedList.mockResolvedValue({ data: [sim1], count: 1 });
		mockedBatchCatalog.mockResolvedValue(
			new Map([
				[
					1,
					{
						previewUrl: null,
						downloadUrl: null,
						charts: [
							{
								label: 'BSC',
								level: 3,
								fileUrl: 'https://cdn.example/1/bsc.dtx',
								fileSizeBytes: 1234,
								fileEncoding: 'SHIFT_JIS'
							}
						],
						chartsPopulated: true
					}
				]
			])
		);

		const result = await runQuery(makeCtx(), {
			query: `
				fragment DtxMetadata on DtxFile { fileSizeBytes fileEncoding }
				{
					simfiles(scope: PUBLISHED, pageSize: 1) {
						data {
							id
							dtxFiles {
								label
								...DtxMetadata
							}
						}
					}
				}
			`
		});

		expect(result.errors).toBeUndefined();
		expect(result.data?.simfiles).toEqual({
			data: [
				{
					id: '1',
					dtxFiles: [
						{
							label: 'BSC',
							fileSizeBytes: 1234,
							fileEncoding: 'SHIFT_JIS'
						}
					]
				}
			]
		});
		expect(mockedBatchCatalog).toHaveBeenCalledTimes(1);
		expect(mockedDiscoverCatalogFiles).not.toHaveBeenCalled();
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

	it('does not poison catalog cache for sims skipped by list when same simfile is queried via another path', async () => {
		// Regression: previously the list resolver wrote a partial cache entry
		// (DB URLs only, charts: []) for every sim that did not need discovery.
		// If the same simfile was also resolved via `simfile(id)` in the same
		// GraphQL document with a different field selection, its preview/download
		// resolvers would hit the partial entry and return stale null/empty
		// values instead of triggering R2 discovery.
		//
		// Setup (downloadUrl is now DB-only and never triggers discovery):
		// - List selects downloadUrl. No batch discovery runs at all. sim1
		//   has a DB download_url; sim2 has null (stays null, no fallback).
		//   No cache entries are written for either sim.
		// - Detail selects previewUrl for sim1. sim1's preview_url is null on
		//   the DB row, so the resolver must trigger single-sim discovery and
		//   return the R2 URL — not a stale partial cache entry.
		const sim1 = {
			...publishedSimfile,
			id: 1,
			download_url: 'https://db.example/1-download.zip',
			preview_url: null
		};
		const sim2 = { ...publishedSimfile, id: 2, download_url: null };
		mockedList.mockResolvedValue({ data: [sim1, sim2], count: 2 });
		mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue(sim1);
		mockedBatchCatalog.mockResolvedValue(new Map());
		// This discovery result is what the detail path's single-sim call
		// should produce for sim1. If a poisoned partial cache entry from
		// the list path leaks, the detail path skips discovery and returns
		// the stale DB value instead of this R2 URL.
		mockedDiscoverCatalogFiles.mockResolvedValue({
			previewUrl: 'https://bucket.example/1/preview.mp3',
			downloadUrl: null,
			charts: [],
			chartsPopulated: true
		});

		const result = await runQuery(
			makeCtx({
				env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' }
			}),
			{
				query: `{
					list: simfiles(scope: PUBLISHED, pageSize: 2) { data { id downloadUrl } }
					detail: simfile(id: "1") { id previewUrl }
				}`
			}
		);

		expect(result.errors).toBeUndefined();
		expect(result.data?.list).toEqual({
			data: [
				{ id: '1', downloadUrl: 'https://db.example/1-download.zip' },
				{ id: '2', downloadUrl: null }
			]
		});
		expect(result.data?.detail).toEqual({
			id: '1',
			previewUrl: 'https://bucket.example/1/preview.mp3'
		});
		// downloadUrl is DB-only, so the list path does not trigger batch
		// discovery at all.
		expect(mockedBatchCatalog).not.toHaveBeenCalled();
		// Single-sim discovery must fire for sim1 from the detail path — it must
		// NOT have been served by a stale partial cache entry from the list path.
		expect(mockedDiscoverCatalogFiles).toHaveBeenCalledTimes(1);
		expect(mockedDiscoverCatalogFiles).toHaveBeenCalledWith(
			expect.anything(),
			{
				simfileId: 1,
				dtxFiles: sim1.dtx_files,
				publicBaseUrl: 'https://bucket.example'
			},
			expect.anything()
		);
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
			query: 'mutation { deleteSimfile(id: "42") { id deleted partialDeletion message } }'
		});

		expect(result.data?.deleteSimfile).toEqual({
			id: '42',
			deleted: true,
			partialDeletion: null,
			message: null
		});
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
			query: 'mutation { deleteSimfile(id: "42") { id deleted partialDeletion message } }'
		});

		expect(result.data?.deleteSimfile).toEqual({
			id: '42',
			deleted: true,
			partialDeletion: null,
			message: null
		});
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
			query: 'mutation { deleteSimfile(id: "42") { id deleted partialDeletion message } }'
		});
		expect(result.data?.deleteSimfile).toEqual({
			id: '42',
			deleted: true,
			partialDeletion: true,
			message: '1 file(s) could not be deleted from storage'
		});
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
