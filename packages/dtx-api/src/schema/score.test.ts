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

	it('rejects with RATE_LIMITED when the per-user hourly cap is exceeded', async () => {
		const ctx = makeCtx({ user: { id: 'user-1' } as never });
		// Override the kv mock to simulate the user already hitting the cap.
		(ctx.kv as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValueOnce(
			String(10)
		);
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: { input: { charts: [] } }
		});
		expect(result.errors?.[0].extensions?.code).toBe('RATE_LIMITED');
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
									performedAt: '2026-06-02T00:00:00'
								},
								{
									isBest: false,
									achievementRate: 82.4,
									rankLabel: 'A',
									fullCombo: false,
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
		// Single atomic call with all params (guards against swapped playCount/clearCount).
		expect(mockedUpsertReplace).toHaveBeenCalledTimes(1);
		expect(mockedUpsertReplace).toHaveBeenCalledWith(
			{}, // db is {} in ctx
			{
				chartId: 10,
				userId: 'user-1',
				playCount: 10,
				clearCount: 4,
				scores: expect.arrayContaining([
					expect.objectContaining({ is_best: true, score: 912380 }),
					expect.objectContaining({ is_best: false, display_order: 1 })
				])
			}
		);
	});

	it('skips a chart that is not visible to the caller', async () => {
		mockedVisibility.mockResolvedValue(new Map());
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
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with more than 5 recent scores', async () => {
		mockedVisibility.mockResolvedValue(visibleMap([10, 11]));
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
							scores: [
								{ isBest: true, score: 900, fullCombo: false, cleared: true },
								{ isBest: true, score: 950, fullCombo: false, cleared: true }
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

	it('skips a chart whose best score carries a displayOrder', async () => {
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
							scores: [
								{
									isBest: true,
									score: 900,
									fullCombo: false,
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
		expect(payload.skipped[0].reason).toBe('best score with displayOrder');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a displayOrder outside the 1..5 range', async () => {
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
							scores: [
								{ isBest: false, fullCombo: false, cleared: false, displayOrder: 6 }
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('displayOrder out of range (expected 1..5)');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a duplicate displayOrder', async () => {
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
							clearCount: 0,
							scores: [
								{
									isBest: false,
									fullCombo: false,
									cleared: false,
									displayOrder: 1
								},
								{ isBest: false, fullCombo: false, cleared: false, displayOrder: 1 }
							]
						}
					]
				}
			}
		});
		const payload = result.data?.uploadScores as {
			skipped: { chartId: string; reason: string }[];
		};
		expect(payload.skipped[0].reason).toBe('duplicate displayOrder');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
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
							scores: [
								{
									isBest: true,
									score: 900,
									achievementRate: 150,
									fullCombo: false,
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
		expect(payload.skipped[0].reason).toBe('achievementRate out of range');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
	});

	it('skips a chart with a rankLabel outside the known set', async () => {
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
							scores: [
								{
									isBest: true,
									score: 900,
									rankLabel: 'X',
									fullCombo: false,
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
		expect(payload.skipped[0].reason).toBe('rankLabel must be one of SS/S/A/B/C/D/E/F');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
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
							scores: [
								{
									isBest: true,
									score: 900,
									rankLabel: 'SS',
									fullCombo: false,
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
					charts: [{ chartId: 'not-a-number', playCount: 0, clearCount: 0, scores: [] }]
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
			scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
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
			fullCombo: false,
			cleared: false,
			displayOrder: 1
		}));
		const result = await runQuery(ctx, {
			query: uploadMutation,
			variables: {
				input: { charts: [{ chartId: '10', playCount: 11, clearCount: 0, scores }] }
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
							scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
						},
						{
							chartId: '11',
							playCount: 1,
							clearCount: 1,
							scores: [{ isBest: true, score: 950, fullCombo: false, cleared: true }]
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
							scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
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
							scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
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
							scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
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
							scores: [
								{
									isBest: true,
									score: 900,
									fullCombo: false,
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
							scores: [
								{
									isBest: true,
									score: -100,
									fullCombo: false,
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
							scores: [
								{
									isBest: true,
									score: 900,
									fullCombo: false,
									cleared: true,
									maxCombo: -1
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

	it('skips a chart with an unparseable performedAt', async () => {
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
							scores: [
								{
									isBest: true,
									score: 900,
									fullCombo: false,
									cleared: true,
									performedAt: 'not-a-date'
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
		expect(payload.skipped[0].reason).toBe('invalid performedAt');
		expect(mockedUpsertReplace).not.toHaveBeenCalled();
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
							scores: [{ isBest: true, score: 900, fullCombo: false, cleared: true }]
						},
						{
							chartId: '10',
							playCount: 2,
							clearCount: 1,
							scores: [{ isBest: true, score: 950, fullCombo: false, cleared: true }]
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
							created_at: 't',
							updated_at: 't'
						},
						scores: [
							{
								id: 1,
								chart_score_id: 3,
								is_best: 1,
								score: 900000,
								achievement_rate: 90,
								rank_label: 'A',
								full_combo: 0,
								cleared: 1,
								max_combo: 800,
								perfect: 1,
								great: 1,
								good: 1,
								poor: 1,
								miss: 1,
								performed_at: 't',
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
