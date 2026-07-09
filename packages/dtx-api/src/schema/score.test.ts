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
		getChartVisibility: vi.fn(),
		getUserChartScore: vi.fn(),
		upsertChartScore: vi.fn(),
		replaceScores: vi.fn(),
		listUserScoredSimfiles: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, getUserChartScore } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedGetUserChartScore = vi.mocked(getUserChartScore);

const { getChartVisibility, upsertChartScore, replaceScores } = await import('@dtx/common/server');
const mockedVisibility = vi.mocked(getChartVisibility);
const mockedUpsert = vi.mocked(upsertChartScore);
const mockedReplace = vi.mocked(replaceScores);

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

beforeEach(() => {
	vi.clearAllMocks();
});

describe('DtxFile.myChartScore', () => {
	it("resolves the signed-in user's chart score for a chart", async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			id: 42,
			title: 'Song',
			artist: 'Artist',
			bpm: 150,
			is_published: true,
			user_id: 'owner-1',
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: 't',
			created_at: 't',
			updated_at: 't',
			dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
		} as never);
		mockedGetUserChartScore.mockResolvedValue({
			chartScore: {
				id: 3,
				chart_id: 10,
				user_id: 'user-1',
				play_count: 10,
				clear_count: 4,
				created_at: 't',
				updated_at: 't'
			},
			scores: [
				{
					id: 1,
					chart_score_id: 3,
					is_best: 1,
					score: 912380,
					achievement_rate: 91.3,
					rank_label: 'S',
					full_combo: 0,
					cleared: 1,
					max_combo: 903,
					perfect: 1300,
					great: 120,
					good: 20,
					poor: 5,
					miss: 5,
					performed_at: 't',
					display_order: null,
					created_at: 't'
				}
			]
		});

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query {
				simfile(id: "42") {
					dtxFiles { id myChartScore { playCount clearCount scores { isBest score achievementRate rankLabel } } }
				}
			}`
		});

		const dtx = (result.data?.simfile as { dtxFiles: unknown[] }).dtxFiles[0] as {
			id: string;
			myChartScore: { playCount: number; clearCount: number; scores: unknown[] };
		};
		expect(dtx.id).toBe('10');
		expect(dtx.myChartScore.playCount).toBe(10);
		expect(dtx.myChartScore.scores[0]).toMatchObject({
			isBest: true,
			score: 912380,
			achievementRate: 91.3,
			rankLabel: 'S'
		});
		// Guards against a file.index-vs-file.id mixup: must resolve using the
		// chart's id (10), not its position in the dtxFiles array.
		expect(mockedGetUserChartScore).toHaveBeenCalledWith(ctx.db, 'user-1', 10);
	});

	it('resolves null when unauthenticated', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedGetSimfile.mockResolvedValue({
			id: 42,
			title: 'Song',
			artist: 'Artist',
			bpm: 150,
			is_published: true,
			user_id: 'owner-1',
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: 't',
			created_at: 't',
			updated_at: 't',
			dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
		} as never);

		const result = await runQuery(makeCtx(), {
			query: `query { simfile(id: "42") { dtxFiles { myChartScore { playCount } } } }`
		});
		const dtx = (result.data?.simfile as { dtxFiles: unknown[] }).dtxFiles[0] as {
			myChartScore: unknown;
		};
		expect(dtx.myChartScore).toBeNull();
		expect(mockedGetUserChartScore).not.toHaveBeenCalled();
	});
});

const uploadMutation = `
	mutation ($input: UploadScoresInput!) {
		uploadScores(input: $input) {
			updatedCharts
			insertedScores
			skipped { chartId reason }
		}
	}`;

const chartScoreRow = {
	id: 3,
	chart_id: 10,
	user_id: 'user-1',
	play_count: 10,
	clear_count: 4,
	created_at: 't',
	updated_at: 't'
};

describe('uploadScores', () => {
	it('rejects unauthenticated callers', async () => {
		const result = await runQuery(makeCtx(), {
			query: uploadMutation,
			variables: { input: { charts: [] } }
		});
		expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
	});

	it('upserts a visible chart and replaces its scores', async () => {
		mockedVisibility.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		mockedUpsert.mockResolvedValue(chartScoreRow);
		mockedReplace.mockResolvedValue(undefined);

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 10,
							clearCount: 4,
							scores: [
								{
									isBest: true,
									score: 912380,
									achievementRate: 91.3,
									rankLabel: 'S',
									fullCombo: false,
									cleared: true,
									maxCombo: 903,
									perfect: 1300,
									great: 120,
									good: 20,
									poor: 5,
									miss: 5,
									performedAt: 't'
								},
								{
									isBest: false,
									achievementRate: 82.4,
									rankLabel: 'A',
									fullCombo: false,
									cleared: true,
									displayOrder: 1,
									performedAt: 't'
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			insertedScores: number;
			skipped: unknown[];
		};
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(2);
		expect(payload.skipped).toEqual([]);
		// Locks down the exact field mapping (guards against swapped playCount/clearCount).
		expect(mockedUpsert).toHaveBeenCalledWith(
			{}, // db is {} in ctx
			{ chartId: 10, userId: 'user-1', playCount: 10, clearCount: 4 }
		);
		expect(mockedReplace).toHaveBeenCalledTimes(1);
	});

	it('skips a chart that is not visible to the caller', async () => {
		mockedVisibility.mockResolvedValue(null);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: { charts: [{ chartId: '999', playCount: 0, clearCount: 0, scores: [] }] }
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].chartId).toBe('999');
		expect(mockedUpsert).not.toHaveBeenCalled();
	});

	it('skips a chart with more than 5 recent scores', async () => {
		mockedVisibility.mockResolvedValue({ user_id: 'owner-1', is_published: 1 });
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const recent = Array.from({ length: 6 }, (_v, i) => ({
			isBest: false,
			achievementRate: 50,
			rankLabel: 'E',
			fullCombo: false,
			cleared: false,
			displayOrder: i + 1
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: { charts: [{ chartId: '10', playCount: 6, clearCount: 0, scores: recent }] }
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].chartId).toBe('10');
		expect(mockedUpsert).not.toHaveBeenCalled();
	});
});

const { listUserScoredSimfiles } = await import('@dtx/common/server');
const mockedListScored = vi.mocked(listUserScoredSimfiles);

describe('myScoredSimfiles', () => {
	it('rejects unauthenticated callers', async () => {
		const result = await runQuery(makeCtx(), {
			query: `query { myScoredSimfiles { count data { id } } }`
		});
		expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
	});

	it("returns the caller's scored simfiles", async () => {
		mockedListScored.mockResolvedValue({
			count: 1,
			data: [
				{
					id: 42,
					title: 'Song',
					artist: 'Artist',
					bpm: 150,
					is_published: true,
					user_id: 'user-1',
					display_id: null,
					download_url: null,
					preview_url: null,
					video_preview_url: null,
					publish_date: 't',
					created_at: 't',
					updated_at: 't',
					dtx_files: [{ id: 10, level: 5, label: 'BASIC' }]
				}
			]
		} as never);

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query { myScoredSimfiles { count data { id title dtxFiles { id level } } } }`
		});
		const conn = result.data?.myScoredSimfiles as {
			count: number;
			data: { id: string; title: string; dtxFiles: { id: string; level: number }[] }[];
		};
		expect(conn.count).toBe(1);
		expect(conn.data[0].id).toBe('42');
		expect(conn.data[0].dtxFiles[0].id).toBe('10');
	});
});
