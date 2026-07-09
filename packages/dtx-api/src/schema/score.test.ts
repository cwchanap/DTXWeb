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
