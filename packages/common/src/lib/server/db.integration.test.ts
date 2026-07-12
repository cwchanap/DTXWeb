// @vitest-environment node
//
// Real-DB integration test for the score upsert/replace path. Unlike db.test.ts
// (fully mock-based), this file spins up a Miniflare D1 instance (real SQLite
// under the hood), runs the actual D1 migrations, and exercises
// upsertChartScoreAndReplaceScores end-to-end: the transactional replace, the
// subquery chart_score_id resolution, and the CHECK / partial-unique
// constraints from 0002_scores.sql.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { upsertChartScoreAndReplaceScores, getUserChartScore } from './db';
import type { D1Database } from '@cloudflare/workers-types';

const MIGRATIONS_DIR = join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'..',
	'packages',
	'dtx-api',
	'd1-migrations'
);

// Read the two migration files once. They create the full schema including
// CHECK constraints and partial unique indexes that Drizzle's schema.ts cannot
// express (idx_scores_one_best, idx_scores_display_order).
// Strip `--` comment lines and split on `;` because D1's exec() rejects
// multi-line statements and standalone comment lines.
const stripComments = (sql: string): string =>
	sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n');

const splitStatements = (sql: string): string[] =>
	sql
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

const MIGRATION_0001_STMTS = splitStatements(
	stripComments(readFileSync(join(MIGRATIONS_DIR, '0001_initial_schema.sql'), 'utf8'))
);
const MIGRATION_0002_STMTS = splitStatements(
	stripComments(readFileSync(join(MIGRATIONS_DIR, '0002_scores.sql'), 'utf8'))
);

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
	mf = new Miniflare({
		modules: [
			{
				type: 'ESModule',
				path: 'index.js',
				contents: 'export default { async fetch() { return new Response("ok"); } }'
			}
		],
		d1Databases: ['TEST_DB']
	});
	db = await mf.getD1Database('TEST_DB');
});

afterAll(async () => {
	await mf.dispose();
});

// Reset the schema + seed a simfile and a dtx_files chart before each test so
// tests are isolated. The chart (dtx_files.id = 1) is the target for all
// upsert calls (chartId = 1).
const runMigration = async (statements: string[]) => {
	for (const stmt of statements) {
		await db.prepare(stmt).run();
	}
};

beforeEach(async () => {
	// Drop tables so each test starts clean.
	await db.prepare('DROP TABLE IF EXISTS scores').run();
	await db.prepare('DROP TABLE IF EXISTS chart_scores').run();
	await db.prepare('DROP TABLE IF EXISTS dtx_files').run();
	await db.prepare('DROP TABLE IF EXISTS user_profiles').run();
	await db.prepare('DROP TABLE IF EXISTS simfiles').run();

	await runMigration(MIGRATION_0001_STMTS);
	await runMigration(MIGRATION_0002_STMTS);

	await db
		.prepare('INSERT INTO simfiles (title, artist, bpm, user_id) VALUES (?, ?, ?, ?)')
		.bind('Test Song', 'Test Artist', 120, 'user-1')
		.run();
	await db
		.prepare('INSERT INTO dtx_files (label, level, simfile_id) VALUES (?, ?, ?)')
		.bind('BASIC', 5, 1)
		.run();
});

const scoreInput = (
	overrides: Partial<{
		is_best: boolean;
		score: number | null;
		achievement_rate: number | null;
		rank_label: string | null;
		full_combo: boolean;
		cleared: boolean;
		max_combo: number | null;
		perfect: number | null;
		great: number | null;
		good: number | null;
		poor: number | null;
		miss: number | null;
		performed_at: string | null;
		display_order: number | null;
	}> = {}
) => ({
	is_best: false,
	score: null,
	achievement_rate: null,
	rank_label: null,
	full_combo: false,
	cleared: false,
	max_combo: null,
	perfect: null,
	great: null,
	good: null,
	poor: null,
	miss: null,
	performed_at: null,
	display_order: null,
	...overrides
});

describe('upsertChartScoreAndReplaceScores (real D1)', () => {
	it('inserts a chart_score and its scores in one batch', async () => {
		const result = await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 10,
			clearCount: 4,
			scores: [
				scoreInput({ is_best: true, score: 950000, achievement_rate: 91.3, cleared: true }),
				scoreInput({ is_best: false, achievement_rate: 82.4, display_order: 1 })
			]
		});

		expect(result.chart_id).toBe(1);
		expect(result.user_id).toBe('user-1');
		expect(result.play_count).toBe(10);
		expect(result.clear_count).toBe(4);

		// Verify the scores were inserted via the subquery resolution.
		const fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched).not.toBeNull();
		expect(fetched!.scores).toHaveLength(2);
		// is_best DESC ordering: best row first.
		expect(fetched!.scores[0].is_best).toBe(1);
		expect(fetched!.scores[0].score).toBe(950000);
		expect(fetched!.scores[1].is_best).toBe(0);
		expect(fetched!.scores[1].display_order).toBe(1);
	});

	it('replaces old scores when called again (old scores gone, new present)', async () => {
		// First upsert: 2 scores.
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 10,
			clearCount: 4,
			scores: [
				scoreInput({ is_best: true, score: 950000, achievement_rate: 91.3 }),
				scoreInput({ is_best: false, display_order: 1, achievement_rate: 80.0 }),
				scoreInput({ is_best: false, display_order: 2, achievement_rate: 70.0 })
			]
		});

		let fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched!.scores).toHaveLength(3);

		// Second upsert: 1 score (replace). The 3 old scores must be deleted.
		const result = await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 15,
			clearCount: 8,
			scores: [scoreInput({ is_best: true, score: 990000, achievement_rate: 98.5 })]
		});

		expect(result.play_count).toBe(15);
		expect(result.clear_count).toBe(8);

		fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched!.scores).toHaveLength(1);
		expect(fetched!.scores[0].score).toBe(990000);
		expect(fetched!.scores[0].achievement_rate).toBe(98.5);
	});

	it('upserts the chart_scores aggregate on conflict (same user + chart)', async () => {
		// First insert creates the chart_scores row.
		const first = await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 5,
			clearCount: 2,
			scores: []
		});
		expect(first.play_count).toBe(5);

		// Second call with same (user, chart) hits ON CONFLICT -> UPDATE.
		const second = await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 20,
			clearCount: 10,
			scores: []
		});
		expect(second.id).toBe(first.id); // same row, updated
		expect(second.play_count).toBe(20);
		expect(second.clear_count).toBe(10);

		// Only one chart_scores row exists (unique index enforced).
		const rows = await db
			.prepare('SELECT COUNT(*) AS cnt FROM chart_scores WHERE user_id = ? AND chart_id = ?')
			.bind('user-1', 1)
			.first<{ cnt: number }>();
		expect(rows!.cnt).toBe(1);
	});

	it('handles empty scores array (upsert + delete only, no inserts)', async () => {
		// Seed an initial score.
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 5,
			clearCount: 1,
			scores: [scoreInput({ is_best: true, score: 800000, achievement_rate: 80.0 })]
		});

		// Replace with empty scores: deletes all, inserts none.
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 5,
			clearCount: 1,
			scores: []
		});

		const fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched).not.toBeNull();
		expect(fetched!.scores).toHaveLength(0);
	});
});

describe('D1 CHECK constraints (real D1)', () => {
	it('rejects negative play_count', async () => {
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: -1,
				clearCount: 0,
				scores: []
			})
		).rejects.toThrow();
	});

	it('rejects clear_count > play_count', async () => {
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: 3,
				clearCount: 5,
				scores: []
			})
		).rejects.toThrow();
	});

	it('rejects negative score in a score row', async () => {
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: 1,
				clearCount: 0,
				scores: [scoreInput({ is_best: true, score: -100, achievement_rate: 50.0 })]
			})
		).rejects.toThrow();
	});

	it('rejects achievement_rate > 100', async () => {
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: 1,
				clearCount: 0,
				scores: [scoreInput({ is_best: true, score: 100, achievement_rate: 150.0 })]
			})
		).rejects.toThrow();
	});

	it('rejects display_order > 5', async () => {
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: 1,
				clearCount: 0,
				scores: [scoreInput({ is_best: false, display_order: 6 })]
			})
		).rejects.toThrow();
	});
});

describe('D1 partial unique indexes (real D1)', () => {
	it('rejects a second is_best=1 score for the same chart_score', async () => {
		// The upsert function uses a batch that deletes all old scores first,
		// so it cannot produce two is_best=1 rows. Instead, verify the index
		// directly: insert one best score via the function, then attempt a
		// raw second is_best=1 insert — it must be rejected.
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 1,
			clearCount: 1,
			scores: [scoreInput({ is_best: true, score: 900000, achievement_rate: 90.0 })]
		});

		const chartScore = await getUserChartScore(db, 'user-1', 1);
		const chartScoreId = chartScore!.chartScore.id;

		await expect(
			db
				.prepare('INSERT INTO scores (chart_score_id, is_best) VALUES (?, 1)')
				.bind(chartScoreId)
				.run()
		).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it('rejects duplicate non-null display_order for the same chart_score', async () => {
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 5,
			clearCount: 2,
			scores: [
				scoreInput({ is_best: true, score: 900000, achievement_rate: 90.0 }),
				scoreInput({ is_best: false, display_order: 1, achievement_rate: 80.0 })
			]
		});

		const chartScore = await getUserChartScore(db, 'user-1', 1);
		const chartScoreId = chartScore!.chartScore.id;

		// Attempt to insert a second score with display_order=1 for the same
		// chart_score — the partial unique index idx_scores_display_order must
		// reject it.
		await expect(
			db
				.prepare(
					'INSERT INTO scores (chart_score_id, is_best, display_order) VALUES (?, 0, 1)'
				)
				.bind(chartScoreId)
				.run()
		).rejects.toThrow(/UNIQUE constraint failed/);
	});

	it('allows multiple is_best=0 scores with NULL display_order (not constrained)', async () => {
		// The partial unique index only covers WHERE display_order IS NOT NULL,
		// and idx_scores_one_best only covers WHERE is_best = 1. So multiple
		// is_best=0 rows with NULL display_order are allowed.
		await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 5,
			clearCount: 2,
			scores: [
				scoreInput({ is_best: true, score: 900000, achievement_rate: 90.0 }),
				scoreInput({ is_best: false, display_order: null }),
				scoreInput({ is_best: false, display_order: null })
			]
		});

		const fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched!.scores).toHaveLength(3);
	});
});
