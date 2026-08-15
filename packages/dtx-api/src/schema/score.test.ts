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
		getChartVisibilityBatch: vi.fn(),
		getUserChartScore: vi.fn(),
		upsertChartScoreAndReplaceScores: vi.fn(),
		listUserScoredSimfiles: vi.fn(),
		listUserChartScores: vi.fn()
	};
});

const { schema } = await import('./index');
const { getSimfile, getSimfileOwner, getUserChartScore } = await import('@dtx/common/server');
const mockedGetSimfile = vi.mocked(getSimfile);
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedGetUserChartScore = vi.mocked(getUserChartScore);

const { listUserChartScores } = await import('@dtx/common/server');
const mockedListChartScores = vi.mocked(listUserChartScores);

const { getChartVisibilityBatch, upsertChartScoreAndReplaceScores } =
	await import('@dtx/common/server');
const mockedVisibility = vi.mocked(getChartVisibilityBatch);
const mockedUpsertReplace = vi.mocked(upsertChartScoreAndReplaceScores);

/** Helper: build a visibility Map that marks all given chart IDs as published. */
const visibleMap = (ids: number[]): Map<number, { user_id: string; is_published: 0 | 1 }> =>
	new Map(ids.map((id) => [id, { user_id: 'owner-1', is_published: 1 as 0 | 1 }]));

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
	kv: {
		get: vi.fn().mockResolvedValue(null),
		put: vi.fn().mockResolvedValue(undefined)
	} as unknown as Ctx['kv'],
	request: new Request('http://test'),
	logger: workerLogger,
	ownerByIdCache: new Map(),
	hasUploadedFilesCache: new Map(),
	filesCache: new Map(),
	catalogFilesCache: new Map(),
	chartScoresCache: new Map(),
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
				full_combo: 1,
				max_combo: 812,
				best_achievement_rate: 96.25,
				best_rank_label: 'SS',
				last_played_at: '2026-08-14T13:00:00Z',
				created_at: 't',
				updated_at: 't'
			},
			scores: [
				{
					id: 1,
					chart_score_id: 3,
					is_best: 1,
					score: 912380,
					achievement_rate: null,
					rank_label: null,
					cleared: null,
					perfect: 1300,
					great: 120,
					good: 20,
					poor: 5,
					miss: 5,
					performed_at: null,
					display_order: null,
					created_at: 't'
				}
			]
		});

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query {
				simfile(id: "42") {
				dtxFiles { id myChartScore { playCount clearCount fullCombo maxCombo bestAchievementRate bestRankLabel lastPlayedAt scores { isBest score achievementRate rankLabel cleared } } }
				}
			}`
		});

		const dtx = (result.data?.simfile as { dtxFiles: unknown[] }).dtxFiles[0] as {
			id: string;
			myChartScore: {
				playCount: number;
				clearCount: number;
				fullCombo: boolean;
				maxCombo: number;
				bestAchievementRate: number | null;
				bestRankLabel: string | null;
				lastPlayedAt: string | null;
				scores: unknown[];
			};
		};
		expect(dtx.id).toBe('10');
		expect(dtx.myChartScore.playCount).toBe(10);
		expect(dtx.myChartScore.fullCombo).toBe(true);
		expect(dtx.myChartScore.maxCombo).toBe(812);
		expect(dtx.myChartScore.bestAchievementRate).toBe(96.25);
		expect(dtx.myChartScore.bestRankLabel).toBe('SS');
		expect(dtx.myChartScore.lastPlayedAt).toBe('2026-08-14T13:00:00Z');
		expect(dtx.myChartScore.scores[0]).toMatchObject({
			isBest: true,
			score: 912380,
			achievementRate: null,
			rankLabel: null,
			cleared: null
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
	full_combo: 1 as const,
	max_combo: 812,
	best_achievement_rate: 96.25,
	best_rank_label: 'SS',
	last_played_at: '2026-08-14T13:00:00Z',
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

	it('rejects with RATE_LIMITED when the per-user hourly cap is exceeded on a writable upload', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		// Override the kv mock to simulate the user already hitting the cap.
		(ctx.kv as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce(
			String(10)
		);
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		expect(result.errors?.[0].extensions?.code).toBe('RATE_LIMITED');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('does not consume a rate-limit token when every chart is skipped', async () => {
		mockedVisibility.mockResolvedValue(new Map());
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const kvPut = ctx.kv.put as unknown as ReturnType<typeof vi.fn>;
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
			updatedCharts: number;
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].reason).toBe('chart not found');
		expect(kvPut).not.toHaveBeenCalled();
	});

	it('upserts a visible chart and replaces its scores atomically', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);

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
							fullCombo: false,
							maxCombo: 903,
							scores: [
								{
									isBest: true,
									score: 912380,
									achievementRate: 91.3,
									rankLabel: 'S',
									cleared: true,
									perfect: 1300,
									great: 120,
									good: 20,
									poor: 5,
									miss: 5,
									performedAt: '2026-06-02T00:00:00'
								},
								{
									isBest: false,
									achievementRate: 82.4,
									rankLabel: 'A',
									cleared: true,
									displayOrder: 1,
									performedAt: '2026-06-02T00:00:00'
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
		// Single atomic call with all chart-owned params (guards against swapped playCount/clearCount).
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(1);
		expect(mockedUpsertReplace).toHaveBeenCalledWith(
			{}, // db is {} in ctx
			expect.objectContaining({
				chartId: 10,
				userId: 'user-1',
				playCount: 10,
				clearCount: 4,
				fullCombo: false,
				maxCombo: 903,
				bestAchievementRate: null,
				bestRankLabel: null,
				lastPlayedAt: null,
				scores: expect.arrayContaining([
					expect.objectContaining({
						is_best: true,
						score: 912380,
						achievement_rate: null,
						rank_label: null,
						cleared: null,
						performed_at: null,
						display_order: null
					}),
					expect.objectContaining({ is_best: false, display_order: 1 })
				])
			})
		);
	});

	it('canonicalizes best-row metadata and passes chart score records to D1', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 7,
							clearCount: 4,
							fullCombo: true,
							maxCombo: 812,
							bestAchievementRate: 96.25,
							bestRankLabel: 'SS',
							lastPlayedAt: '2026-08-14T13:00:00Z',
							scores: [
								{
									isBest: true,
									score: 987654,
									achievementRate: 72,
									rankLabel: 'B',
									cleared: true,
									performedAt: '2026-08-14T12:00:00Z',
									displayOrder: 5,
									perfect: 700,
									great: 80,
									good: 20,
									poor: 8,
									miss: 4
								},
								{
									isBest: false,
									achievementRate: 81.5,
									rankLabel: 'S',
									cleared: null,
									performedAt: '2026-08-14T13:00:00Z',
									displayOrder: 1
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
		expect(mockedUpsertReplace).toHaveBeenCalledWith(ctx.db, {
			chartId: 10,
			userId: 'user-1',
			playCount: 7,
			clearCount: 4,
			fullCombo: true,
			maxCombo: 812,
			bestAchievementRate: 96.25,
			bestRankLabel: 'SS',
			lastPlayedAt: '2026-08-14T13:00:00Z',
			scores: [
				{
					is_best: true,
					score: 987654,
					achievement_rate: null,
					rank_label: null,
					cleared: null,
					perfect: 700,
					great: 80,
					good: 20,
					poor: 8,
					miss: 4,
					performed_at: null,
					display_order: null
				},
				{
					is_best: false,
					score: null,
					achievement_rate: 81.5,
					rank_label: 'S',
					cleared: null,
					perfect: null,
					great: null,
					good: null,
					poor: null,
					miss: null,
					performed_at: '2026-08-14T13:00:00Z',
					display_order: 1
				}
			]
		});
	});

	it('skips a chart that is not visible to the caller', async () => {
		mockedVisibility.mockResolvedValue(new Map());
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '999',
							playCount: 0,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: []
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].chartId).toBe('999');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with more than 5 recent scores', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const best = { isBest: true, score: 900, cleared: true };
		const recent = Array.from({ length: 6 }, (_v, i) => ({
			isBest: false,
			achievementRate: 50,
			rankLabel: 'E',
			cleared: false,
			displayOrder: i + 1
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 7,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: [best, ...recent]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].chartId).toBe('10');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with more than one best score', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 2,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{ isBest: true, score: 900, cleared: true },
								{ isBest: true, score: 950, cleared: true }
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('more than one best score');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with no best score (would erase the stored best via replace)', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: false,
									achievementRate: 80,
									cleared: true,
									displayOrder: 1
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('no best score');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('strips displayOrder from a best score instead of dropping the chart', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true,
									displayOrder: 1
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
		// The best row is kept (not dropped); its displayOrder is stripped to null.
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(1);
		expect(payload.skipped).toEqual([]);
		expect(mockedUpsertReplace).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				scores: expect.arrayContaining([
					expect.objectContaining({ is_best: true, display_order: null })
				])
			})
		);
	});

	it('drops a displayOrder-out-of-range recent row but keeps the best', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 2,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{ isBest: true, score: 900, cleared: true },
								{ isBest: false, cleared: false, displayOrder: 6 }
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
		// The out-of-range recent row is dropped; the best is kept.
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(1);
		expect(payload.skipped).toEqual([]);
	});

	it('drops a duplicate displayOrder row but keeps the first occurrence', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 3,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{ isBest: true, score: 900, cleared: true },
								{
									isBest: false,
									cleared: false,
									displayOrder: 1
								},
								{ isBest: false, cleared: false, displayOrder: 1 }
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
		// The first occurrence is kept; the duplicate is dropped. The chart is
		// not skipped — only the bad row is.
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(2);
		expect(payload.skipped).toEqual([]);
	});

	it('skips a chart with an achievementRate outside 0..100', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							bestAchievementRate: 150,
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('bestAchievementRate out of range');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('strips an unknown rankLabel and still accepts the chart', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: 900,
									rankLabel: 'X',
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(1);
		expect(payload.skipped).toEqual([]);
		expect(mockedUpsertReplace).toHaveBeenCalledWith(
			ctx.db,
			expect.objectContaining({
				scores: [expect.objectContaining({ rank_label: null, score: 900 })]
			})
		);
	});

	it('accepts a chart with a valid rankLabel', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: 900,
									rankLabel: 'SS',
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: unknown[];
		};
		expect(payload.updatedCharts).toBe(1);
		expect(payload.skipped).toEqual([]);
	});

	it('skips a chart with an invalid chart id', async () => {
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: 'not-a-number',
							playCount: 0,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: []
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].chartId).toBe('not-a-number');
		expect(payload.skipped[0].reason).toBe('invalid chart id');
		// Visibility batch is called with an empty array (no valid IDs), which
		// returns an empty map — no chart is looked up.
		expect(mockedVisibility).toHaveBeenCalledWith(ctx.db, []);
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('rejects a payload exceeding the chart cap without writing anything', async () => {
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const charts = Array.from({ length: 101 }, (_v, i) => ({
			chartId: String(i + 1),
			playCount: 1,
			clearCount: 1,
			fullCombo: false,
			maxCombo: 0,
			scores: [{ isBest: true, score: 900, cleared: true }]
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: { input: { charts } }
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].chartId).toBe('*');
		expect(payload.skipped[0].reason).toContain('too many charts');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with too many score rows', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const scores = Array.from({ length: 11 }, () => ({
			isBest: false,
			cleared: false,
			displayOrder: 1
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 11,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toContain('too many scores');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('isolates per-chart write failures: a failed chart is skipped, prior commits survive', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace
			.mockResolvedValueOnce(chartScoreRow)
			.mockRejectedValueOnce(new Error('D1 batch failed'));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						},
						{
							chartId: '11',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 950, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			insertedScores: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(1);
		expect(payload.skipped).toEqual([{ chartId: '11', reason: 'write failed' }]);
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(2);
	});

	it('refunds the hourly token when every write fails (D1 outage)', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		mockedUpsertReplace.mockRejectedValue(new Error('D1 batch failed'));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const kvGet = ctx.kv.get as unknown as ReturnType<typeof vi.fn>;
		const kvPut = ctx.kv.put as unknown as ReturnType<typeof vi.fn>;
		// First get: rate-limit check (counter at 0 → allowed, increments to 1).
		// Second get: refund check (counter at 1 → decrements back to 0).
		kvGet.mockResolvedValueOnce(null).mockResolvedValueOnce('1');
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped).toEqual([{ chartId: '10', reason: 'write failed' }]);
		// Two puts: first increments (rate-limit), second decrements (refund).
		expect(kvPut).toHaveBeenCalledTimes(2);
		// The refund put writes the decremented value (0).
		expect(kvPut).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('uploadscores:user-1:'),
			'0',
			{ expirationTtl: 3600 }
		);
	});

	// If the refund KV put itself rejects (KV outage on top of D1 outage), the
	// mutation must NOT throw — that would surface as a GraphQL error after all
	// the write work already completed, leaving the caller with neither scores
	// nor a result payload. The refund is best-effort: log a warning and return
	// the normal result so the client sees skipped charts + updatedCharts=0.
	it('does not throw when the refund KV put rejects (best-effort refund)', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		mockedUpsertReplace.mockRejectedValue(new Error('D1 batch failed'));
		const warn = vi.fn();
		const ctx = makeCtx({
			user: { id: 'user-1' } as never,
			logger: {
				info: vi.fn(),
				warn,
				error: vi.fn(),
				debug: vi.fn()
			} as unknown as Ctx['logger']
		});
		const kvGet = ctx.kv.get as unknown as ReturnType<typeof vi.fn>;
		const kvPut = ctx.kv.put as unknown as ReturnType<typeof vi.fn>;
		// First get: rate-limit check (counter at 0 → allowed, increments to 1).
		// Second get: refund check (counter at 1 → attempts decrement).
		kvGet.mockResolvedValueOnce(null).mockResolvedValueOnce('1');
		// The refund put rejects — the safety net itself is broken.
		kvPut.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('KV put failed'));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		// Mutation resolves normally — no GraphQL error surfaced.
		expect(result.errors).toBeUndefined();
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped).toEqual([{ chartId: '10', reason: 'write failed' }]);
		// The refund failure is logged as a warning, not swallowed silently.
		expect(warn).toHaveBeenCalledWith(
			'Failed to refund upload token after total write failure',
			expect.objectContaining({ userId: 'user-1', error: 'KV put failed' })
		);
	});

	// Exercises the WRITE_CONCURRENCY=8 chunk boundary: 9 writable charts span
	// two chunks (8 + 1). Every chart must be written — the second chunk must
	// not be dropped by an off-by-one in the slice/loop. Also pins that the
	// chart cap is checked before the rate-limit token (a 9-chart payload is
	// under the cap, so the token IS consumed here).
	it('writes all charts across the WRITE_CONCURRENCY chunk boundary (9 charts, 2 chunks)', async () => {
		const ids = Array.from({ length: 9 }, (_, i) => i + 1);
		mockedVisibility.mockResolvedValue(visibleMap(ids));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: ids.map((id) => ({
						chartId: String(id),
						playCount: 1,
						clearCount: 1,
						fullCombo: false,
						maxCombo: 0,
						scores: [{ isBest: true, score: 900, cleared: true }]
					}))
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			insertedScores: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(9);
		expect(payload.insertedScores).toBe(9);
		expect(payload.skipped).toEqual([]);
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(9);
	});

	it('does not consume a rate-limit token for an oversized payload (cap checked first)', async () => {
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const kvPut = ctx.kv.put as unknown as ReturnType<typeof vi.fn>;
		const charts = Array.from({ length: 101 }, (_v, i) => ({
			chartId: String(i + 1),
			playCount: 1,
			clearCount: 1,
			fullCombo: false,
			maxCombo: 0,
			scores: [{ isBest: true, score: 900, cleared: true }]
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: { input: { charts } }
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].chartId).toBe('*');
		// The rate-limit KV put (token increment) must NOT have been called —
		// the chart cap short-circuits before checkUploadRateLimit.
		expect(kvPut).not.toHaveBeenCalled();
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('honors the MAX_UPLOADS_PER_HOUR env override on a writable upload', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		const ctx = makeCtx({
			user: { id: 'user-1' } as never,
			env: { ...makeEnv(), MAX_UPLOADS_PER_HOUR: '2' }
		});
		// Simulate the user already at the env-configured cap of 2.
		(ctx.kv as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce('2');
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		expect(result.errors?.[0].extensions?.code).toBe('RATE_LIMITED');
	});

	it('falls back to the default when MAX_UPLOADS_PER_HOUR is non-numeric', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({
			user: { id: 'user-1' } as never,
			env: { ...makeEnv(), MAX_UPLOADS_PER_HOUR: 'not-a-number' }
		});
		// Default cap is 10; a counter of 9 must still be allowed through.
		(ctx.kv as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce('9');
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		// No RATE_LIMITED error — default cap of 10 allows a counter of 9.
		expect(result.errors).toBeUndefined();
		expect(mockedUpsertReplace).toHaveBeenCalledOnce();
	});

	it('does not rate-limit an empty charts payload', async () => {
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const kvPut = ctx.kv.put as unknown as ReturnType<typeof vi.fn>;
		// Cap already exhausted — empty still succeeds without consuming.
		(ctx.kv as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce(
			String(10)
		);
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: { input: { charts: [] } }
		});
		expect(result.errors).toBeUndefined();
		expect(kvPut).not.toHaveBeenCalled();
	});

	it('skips a chart with a negative playCount', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: -1,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('playCount must be a non-negative integer');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a negative clearCount', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 5,
							clearCount: -1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('clearCount must be a non-negative integer');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart where clearCount exceeds playCount', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 3,
							clearCount: 5,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('clearCount cannot exceed playCount');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a negative judgment count', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true,
									perfect: -5
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('judgment counts must be non-negative integers');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a negative score', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: -100,
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('score must be a non-negative integer');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a negative maxCombo', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: -1,
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('maxCombo must be a non-negative integer');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with an unparseable lastPlayedAt', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							lastPlayedAt: 'not-a-date',
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true
								}
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('invalid lastPlayedAt');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('clamps a future recent performedAt to now instead of dropping the row', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		// A desktop clock 1 hour ahead of the Worker must not drop the recent row.
		const future = new Date(Date.now() + 3_600_000).toISOString();
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: 900,
									cleared: true
								},
								{
									isBest: false,
									cleared: true,
									performedAt: future,
									displayOrder: 1
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
		expect(payload.skipped).toEqual([]);
		expect(payload.updatedCharts).toBe(1);
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(1);
		// The clamped performedAt should be <= now (within test slack).
		const call = mockedUpsertReplace.mock.calls[0][1] as {
			scores: { is_best: boolean; performed_at: string | null }[];
		};
		const recent = call.scores.find((score) => !score.is_best)!;
		expect(recent.performed_at).not.toBe(future);
		expect(Date.parse(recent.performed_at!)).toBeLessThanOrEqual(Date.now());
	});

	it('skips a duplicate chartId within one payload (defense-in-depth)', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 1,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 900, cleared: true }]
						},
						{
							chartId: '10',
							playCount: 2,
							clearCount: 1,
							fullCombo: false,
							maxCombo: 0,
							scores: [{ isBest: true, score: 950, cleared: true }]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		// Only the first occurrence is upserted; the second is skipped.
		expect(payload.updatedCharts).toBe(1);
		expect(payload.skipped).toEqual([{ chartId: '10', reason: 'duplicate chart id' }]);
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(1);
	});

	// Key new behavior: one bad recent row drops only that row, not the best
	// or the whole chart. Previously a single invalid field in any score row
	// caused the entire chart (best + all recent) to be skipped.
	it('drops an invalid recent row but keeps the valid best row', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 3,
							clearCount: 2,
							fullCombo: false,
							maxCombo: 432,
							scores: [
								{
									isBest: true,
									score: 983400,
									achievementRate: 98.34,
									rankLabel: 'SS',
									cleared: true
								},
								{
									isBest: false,
									achievementRate: 92.1,
									rankLabel: 'S',
									cleared: true,
									displayOrder: 1
								},
								{
									isBest: false,
									achievementRate: 150, // invalid: > 100
									rankLabel: 'S',
									cleared: false,
									displayOrder: 2
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
		// The chart is accepted; the bad recent row (achievementRate 150) is
		// dropped, but the best row and the valid recent row are kept.
		expect(payload.updatedCharts).toBe(1);
		expect(payload.insertedScores).toBe(2);
		expect(payload.skipped).toEqual([]);
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(1);
		expect(mockedUpsertReplace).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				scores: expect.arrayContaining([
					expect.objectContaining({ is_best: true, score: 983400 }),
					expect.objectContaining({ is_best: false, display_order: 1 })
				])
			})
		);
	});

	// Regression: an invalid best row must reject the whole chart, not
	// silently drop the best and accept only the recent rows. The replace-all
	// batch (DELETE + INSERT) would otherwise erase the stored best score.
	it('rejects a chart when the best row is invalid, preserving stored scores', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		mockedUpsertReplace.mockResolvedValue(chartScoreRow);
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 3,
							clearCount: 2,
							fullCombo: false,
							maxCombo: 0,
							scores: [
								{
									isBest: true,
									score: -1, // invalid: negative
									cleared: true
								},
								{
									isBest: false,
									achievementRate: 92.1,
									rankLabel: 'S',
									cleared: true,
									displayOrder: 1
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
			skipped: { chartId: string; reason: string }[];
		};
		// The chart is skipped (not accepted) so the destructive replace-all
		// never runs — the stored best score is preserved.
		expect(payload.updatedCharts).toBe(0);
		expect(payload.insertedScores).toBe(0);
		expect(payload.skipped).toEqual([{ chartId: '10', reason: 'best score row invalid' }]);
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('rejects an empty scores[] payload that would wipe prior scores', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: {
					charts: [
						{
							chartId: '10',
							playCount: 0,
							clearCount: 0,
							fullCombo: false,
							maxCombo: 0,
							scores: []
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			updatedCharts: number;
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.updatedCharts).toBe(0);
		expect(payload.skipped[0].chartId).toBe('10');
		expect(payload.skipped[0].reason).toBe('no scores provided');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
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

	it('isolates scored simfiles between users', async () => {
		// user-1 has scored simfiles; user-2 has none
		mockedListScored.mockImplementation(async (_db, opts) => {
			if (opts.userId === 'user-1') {
				return {
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
				} as never;
			}
			return { count: 0, data: [] } as never;
		});

		// User 1 sees their scored simfile
		const ctx1 = makeCtx({ user: { id: 'user-1' } as never });
		const result1 = await runQuery(ctx1, {
			query: `query { myScoredSimfiles { count data { id } } }`
		});
		const conn1 = result1.data?.myScoredSimfiles as { count: number; data: { id: string }[] };
		expect(conn1.count).toBe(1);
		expect(conn1.data).toHaveLength(1);
		expect(mockedListScored).toHaveBeenCalledWith(
			ctx1.db,
			expect.objectContaining({ userId: 'user-1' })
		);

		// User 2 sees nothing
		const ctx2 = makeCtx({ user: { id: 'user-2' } as never });
		const result2 = await runQuery(ctx2, {
			query: `query { myScoredSimfiles { count data { id } } }`
		});
		const conn2 = result2.data?.myScoredSimfiles as { count: number; data: unknown[] };
		expect(conn2.count).toBe(0);
		expect(conn2.data).toHaveLength(0);
		expect(mockedListScored).toHaveBeenCalledWith(
			ctx2.db,
			expect.objectContaining({ userId: 'user-2' })
		);
	});
});

describe('DtxFile.myChartScore batching (N+1)', () => {
	it('batches every chart on the page into ONE listUserChartScores call', async () => {
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
					dtx_files: [
						{ id: 10, level: 5, label: 'BASIC' },
						{ id: 11, level: 8, label: 'EXTREME' }
					]
				}
			]
		} as never);

		mockedListChartScores.mockResolvedValue(
			new Map([
				[
					10,
					{
						chartScore: {
							id: 3,
							chart_id: 10,
							user_id: 'user-1',
							play_count: 10,
							clear_count: 4,
							full_combo: 1,
							max_combo: 812,
							best_achievement_rate: 96.25,
							best_rank_label: 'SS',
							last_played_at: '2026-08-14T13:00:00Z',
							created_at: 't',
							updated_at: 't'
						},
						scores: [
							{
								id: 1,
								chart_score_id: 3,
								is_best: 1,
								score: 900000,
								achievement_rate: null,
								rank_label: null,
								cleared: null,
								perfect: 1,
								great: 1,
								good: 1,
								poor: 1,
								miss: 1,
								performed_at: null,
								display_order: null,
								created_at: 't'
							}
						]
					}
				]
			]) as never
		);

		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		const result = await runQuery(ctx, {
			query: `query {
				myScoredSimfiles {
					data {
						dtxFiles { id myChartScore { playCount scores { isBest score } } }
					}
				}
			}`
		});

		const charts = (
			result.data?.myScoredSimfiles as {
				data: { dtxFiles: { id: string; myChartScore: { playCount: number } | null }[] }[];
			}
		).data[0].dtxFiles;

		// One batched call for both charts, with both chart ids — not one per chart.
		expect(mockedListChartScores).toHaveBeenCalledTimes(1);
		expect(mockedListChartScores).toHaveBeenCalledWith(ctx.db, 'user-1', [10, 11]);
		// The per-chart getUserChartScore path must NOT run when batched.
		expect(mockedGetUserChartScore).not.toHaveBeenCalled();
		// Chart 10 resolves from the batch map; chart 11 (absent from map) is null.
		expect(charts[0].myChartScore?.playCount).toBe(10);
		expect(charts[1].myChartScore).toBeNull();
	});
});
