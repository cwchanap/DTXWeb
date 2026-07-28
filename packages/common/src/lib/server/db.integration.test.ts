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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	upsertChartScoreAndReplaceScores,
	getUserChartScore,
	listUserScoredSimfiles,
	listUserChartScores,
	getChartVisibilityBatch,
	updateSimfileDriveFile
} from './db';
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

// Read the migration files once. They create the full schema including
// CHECK constraints and partial unique indexes that Drizzle's schema.ts cannot
// express (idx_scores_one_best, idx_scores_display_order), plus the
// (user_id, updated_at) recency-sort index from 0003.
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

const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
	.filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
	.sort()
	.map((fileName) => ({
		fileName,
		statements: splitStatements(
			stripComments(readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8'))
		)
	}));

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

const runMigrations = async () => {
	for (const migration of MIGRATIONS) {
		await runMigration(migration.statements);
	}
};

beforeEach(async () => {
	// Drop tables so each test starts clean.
	await db.prepare('DROP TABLE IF EXISTS scores').run();
	await db.prepare('DROP TABLE IF EXISTS chart_scores').run();
	await db.prepare('DROP TABLE IF EXISTS dtx_files').run();
	await db.prepare('DROP TABLE IF EXISTS user_profiles').run();
	await db.prepare('DROP TABLE IF EXISTS simfiles').run();

	await runMigrations();

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

describe('Google Drive file migration and owner-constrained update (real D1)', () => {
	it('applies every numbered migration through 0006 once and starts the Drive ID as NULL', async () => {
		expect(MIGRATIONS.map((migration) => migration.fileName)).toEqual([
			'0001_initial_schema.sql',
			'0002_scores.sql',
			'0003_chart_scores_user_updated_index.sql',
			'0004_normalize_legacy_dtx_file_levels.sql',
			'0005_fix_level_decoding_formula.sql',
			'0006_google_drive_file_id.sql'
		]);

		const row = await db
			.prepare('SELECT google_drive_file_id FROM simfiles WHERE id = ?')
			.bind(1)
			.first<{ google_drive_file_id: string | null }>();
		expect(row?.google_drive_file_id).toBeNull();
	});

	it('persists the Drive ID and download URL for the owner', async () => {
		const updated = await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'drive-file-123',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-123'
		});
		expect(updated.google_drive_file_id).toBe('drive-file-123');
		expect(updated.download_url).toBe('https://drive.google.com/uc?id=drive-file-123');

		const persisted = await db
			.prepare('SELECT google_drive_file_id, download_url FROM simfiles WHERE id = ?')
			.bind(1)
			.first<{ google_drive_file_id: string | null; download_url: string | null }>();
		expect(persisted).toEqual({
			google_drive_file_id: 'drive-file-123',
			download_url: 'https://drive.google.com/uc?id=drive-file-123'
		});
	});

	it('rejects a wrong owner and missing row without changing the original metadata', async () => {
		await expect(
			updateSimfileDriveFile(db, 1, 'user-2', {
				googleDriveFileId: 'other-users-file',
				downloadUrl: 'https://drive.google.com/uc?id=other-users-file'
			})
		).rejects.toThrow('Simfile not found');
		await expect(
			updateSimfileDriveFile(db, 99, 'user-1', {
				googleDriveFileId: 'missing-file',
				downloadUrl: 'https://drive.google.com/uc?id=missing-file'
			})
		).rejects.toThrow('Simfile not found');

		const row = await db
			.prepare('SELECT google_drive_file_id, download_url FROM simfiles WHERE id = ?')
			.bind(1)
			.first<{ google_drive_file_id: string | null; download_url: string | null }>();
		expect(row).toEqual({ google_drive_file_id: null, download_url: null });
	});

	it('applies the patch when expectNoExistingDriveFile matches a NULL binding', async () => {
		const updated = await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'first-upload-file',
			downloadUrl: 'https://drive.google.com/uc?id=first-upload-file',
			expectNoExistingDriveFile: true
		});
		expect(updated.google_drive_file_id).toBe('first-upload-file');
	});

	it('rejects a FirstUpload guard when the row already has a Drive binding', async () => {
		// Simulate another device having already established a binding.
		await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'device-b-file-y',
			downloadUrl: 'https://drive.google.com/uc?id=device-b-file-y'
		});
		// A FirstUpload guard (expectNoExistingDriveFile) must fail because the
		// binding is no longer NULL.
		await expect(
			updateSimfileDriveFile(db, 1, 'user-1', {
				googleDriveFileId: 'stale-device-a-file',
				downloadUrl: 'https://drive.google.com/uc?id=stale-device-a-file',
				expectNoExistingDriveFile: true
			})
		).rejects.toThrow('Simfile not found');

		// The newer binding is preserved.
		const row = await db
			.prepare('SELECT google_drive_file_id FROM simfiles WHERE id = ?')
			.bind(1)
			.first<{ google_drive_file_id: string | null }>();
		expect(row?.google_drive_file_id).toBe('device-b-file-y');
	});

	it('applies the patch when expectedPreviousDriveFileId matches the current binding', async () => {
		// Establish an initial binding.
		await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'initial-file',
			downloadUrl: 'https://drive.google.com/uc?id=initial-file'
		});
		// An ExplicitReplacement guard expecting that exact ID must succeed.
		const updated = await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'replacement-file',
			downloadUrl: 'https://drive.google.com/uc?id=replacement-file',
			expectedPreviousDriveFileId: 'initial-file'
		});
		expect(updated.google_drive_file_id).toBe('replacement-file');
	});

	it('rejects an ExplicitReplacement guard when the binding changed to a different file', async () => {
		// Establish an initial binding.
		await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'initial-file',
			downloadUrl: 'https://drive.google.com/uc?id=initial-file'
		});
		// Another device replaces the file.
		await updateSimfileDriveFile(db, 1, 'user-1', {
			googleDriveFileId: 'device-b-file-y',
			downloadUrl: 'https://drive.google.com/uc?id=device-b-file-y'
		});
		// A guard expecting the stale 'initial-file' must fail.
		await expect(
			updateSimfileDriveFile(db, 1, 'user-1', {
				googleDriveFileId: 'stale-device-a-file',
				downloadUrl: 'https://drive.google.com/uc?id=stale-device-a-file',
				expectedPreviousDriveFileId: 'initial-file'
			})
		).rejects.toThrow('Simfile not found');

		const row = await db
			.prepare('SELECT google_drive_file_id FROM simfiles WHERE id = ?')
			.bind(1)
			.first<{ google_drive_file_id: string | null }>();
		expect(row?.google_drive_file_id).toBe('device-b-file-y');
	});

	it('rejects a second direct application of 0006 because Wrangler records applied migrations', async () => {
		const migration = MIGRATIONS.find(
			(candidate) => candidate.fileName === '0006_google_drive_file_id.sql'
		);
		expect(migration).toBeDefined();
		await expect(runMigration(migration!.statements)).rejects.toThrow(/duplicate column name/);
	});
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

	it('TOCTOU: chart deleted after seeding chart_scores is a true no-op (no partial write)', async () => {
		// Simulate the production TOCTOU orphan: chart_scores exists for a
		// chart that was deleted from dtx_files, and D1's FK cascade didn't
		// fire (the documented production behavior — see 0002_scores.sql).
		// Miniflare's D1 enforces FKs and doesn't support PRAGMA foreign_keys,
		// so recreate chart_scores without the FK constraint to match the
		// production orphan state.
		await db.exec('DROP TABLE scores');
		await db.exec('DROP TABLE chart_scores');
		await db.exec(
			'CREATE TABLE chart_scores (' +
				'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
				'chart_id INTEGER NOT NULL, user_id TEXT NOT NULL, ' +
				'play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0), ' +
				'clear_count INTEGER NOT NULL DEFAULT 0 CHECK (clear_count >= 0 AND clear_count <= play_count), ' +
				"created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), " +
				"updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"
		);
		await db.exec(
			'CREATE UNIQUE INDEX idx_chart_scores_user_chart ON chart_scores(user_id, chart_id)'
		);
		await db.exec('CREATE INDEX idx_chart_scores_chart ON chart_scores(chart_id)');
		await db.exec(
			'CREATE TABLE scores (' +
				'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
				'chart_score_id INTEGER NOT NULL, ' +
				'is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)), ' +
				'score INTEGER CHECK (score IS NULL OR score >= 0), ' +
				'achievement_rate REAL CHECK (achievement_rate IS NULL OR (achievement_rate >= 0 AND achievement_rate <= 100)), ' +
				"rank_label TEXT CHECK (rank_label IS NULL OR rank_label IN ('SS','S','A','B','C','D','E','F')), " +
				'full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1)), ' +
				'cleared INTEGER NOT NULL DEFAULT 0 CHECK (cleared IN (0, 1)), ' +
				'max_combo INTEGER CHECK (max_combo IS NULL OR max_combo >= 0), ' +
				'perfect INTEGER CHECK (perfect IS NULL OR perfect >= 0), ' +
				'great INTEGER CHECK (great IS NULL OR great >= 0), ' +
				'good INTEGER CHECK (good IS NULL OR good >= 0), ' +
				'poor INTEGER CHECK (poor IS NULL OR poor >= 0), ' +
				'miss INTEGER CHECK (miss IS NULL OR miss >= 0), ' +
				'performed_at TEXT, ' +
				'display_order INTEGER CHECK (display_order IS NULL OR (display_order >= 1 AND display_order <= 5)), ' +
				"created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"
		);
		await db.exec('CREATE INDEX idx_scores_chart_score ON scores(chart_score_id)');
		await db.exec(
			'CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1'
		);
		await db.exec(
			'CREATE UNIQUE INDEX idx_scores_display_order ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL'
		);

		// Seed the orphan: chart_scores + scores for chart 1, then delete
		// dtx_files (no cascade since chart_scores has no FK).
		await db
			.prepare(
				'INSERT INTO chart_scores (chart_id, user_id, play_count, clear_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.bind(1, 'user-1', 5, 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
			.run();
		const chartScoreRow = await db
			.prepare('SELECT id FROM chart_scores WHERE user_id = ? AND chart_id = ?')
			.bind('user-1', 1)
			.first<{ id: number }>();
		const csId = chartScoreRow!.id;
		await db
			.prepare(
				'INSERT INTO scores (chart_score_id, is_best, score, achievement_rate, display_order) VALUES (?, 1, ?, ?, NULL)'
			)
			.bind(csId, 900000, 90.0)
			.run();
		await db
			.prepare(
				'INSERT INTO scores (chart_score_id, is_best, score, achievement_rate, display_order) VALUES (?, 0, NULL, ?, 1)'
			)
			.bind(csId, 80.0)
			.run();
		await db.prepare('DELETE FROM dtx_files WHERE id = 1').run();

		// The upsert must throw (so the caller reports "write failed") AND the
		// batch must roll back — the orphaned chart_scores row must retain its
		// original scores, not have them replaced. The EXISTS-gated subquery
		// yields NULL for chart_score_id (dtx_files row is gone), and D1's NOT
		// NULL constraint rejects the INSERT, rolling back the entire batch.
		// (With an empty scores array, the batch commits zero changes and the
		// JS code throws "Failed to upsert chart_score" instead. Both paths
		// produce no partial write — the caller's allSettled reports "write
		// failed" either way.)
		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 1,
				userId: 'user-1',
				playCount: 99,
				clearCount: 99,
				scores: [scoreInput({ is_best: true, score: 999999, achievement_rate: 99.9 })]
			})
		).rejects.toThrow();

		// The orphaned chart_scores aggregate must be unchanged (play_count
		// still 5, not 99 — the upsert was a no-op).
		const after = await db
			.prepare('SELECT * FROM chart_scores WHERE user_id = ? AND chart_id = ?')
			.bind('user-1', 1)
			.first<{ play_count: number; clear_count: number }>();
		expect(after).not.toBeNull();
		expect(after!.play_count).toBe(5);
		expect(after!.clear_count).toBe(2);

		// The original 2 scores must still be there (DELETE was a no-op).
		const fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched).not.toBeNull();
		expect(fetched!.scores).toHaveLength(2);
		expect(fetched!.scores[0].score).toBe(900000);
	});

	it('TOCTOU: unpublished chart owned by another user rejects the write (visibility gate)', async () => {
		// Seed a second chart owned by user-2, unpublished. The caller
		// (user-1) is neither the owner nor is the chart published, so the
		// visibility predicate threaded into the write transaction must reject
		// it — mirroring the pre-write visibility check in score.ts so a chart
		// unpublished between that check and this batch cannot be scored by a
		// non-owner.
		await db
			.prepare(
				'INSERT INTO simfiles (title, artist, bpm, user_id, is_published) VALUES (?, ?, ?, ?, ?)'
			)
			.bind('Other User Song', 'Artist', 120, 'user-2', 0)
			.run();
		await db
			.prepare('INSERT INTO dtx_files (label, level, simfile_id) VALUES (?, ?, ?)')
			.bind('BASIC', 5, 2)
			.run();

		await expect(
			upsertChartScoreAndReplaceScores(db, {
				chartId: 2,
				userId: 'user-1',
				playCount: 1,
				clearCount: 1,
				scores: [scoreInput({ is_best: true, score: 900000, achievement_rate: 90.0 })]
			})
		).rejects.toThrow();

		// No chart_scores row was created for the non-owner caller.
		const row = await db
			.prepare('SELECT * FROM chart_scores WHERE user_id = ? AND chart_id = ?')
			.bind('user-1', 2)
			.first();
		expect(row).toBeNull();
	});

	it('still writes for the OWNER of an unpublished chart (ownership satisfies visibility)', async () => {
		// The seeded simfile is owned by user-1 and defaults to unpublished.
		// The owner must still be able to score their own unpublished chart.
		const result = await upsertChartScoreAndReplaceScores(db, {
			chartId: 1,
			userId: 'user-1',
			playCount: 3,
			clearCount: 1,
			scores: [scoreInput({ is_best: true, score: 700000, achievement_rate: 70.0 })]
		});
		expect(result.user_id).toBe('user-1');
		const fetched = await getUserChartScore(db, 'user-1', 1);
		expect(fetched!.scores).toHaveLength(1);
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

// Read-path integration tests for the three SQL functions that the score page
// relies on. These are only mock-tested in score.test.ts; a wrong join/column
// or a broken visibility filter / recency ORDER BY would pass the mocks but
// fail in prod. This block seeds two users against real D1 and verifies
// pagination, the visibility filter (published OR owned), the
// ORDER BY MAX(cs.updated_at) recency ordering, the batched chart-score fetch,
// and the visibility-batch map shape.
//
// Fixture (all ids are explicit so assertions can reference them):
//   simfiles: 1 (user-2, published), 2 (user-1, unpublished), 3 (user-2,
//             unpublished — NOT visible to user-1), 4 (user-2, published)
//   dtx_files (charts): 10→sim1, 11→sim2, 12→sim3, 13→sim4
//   chart_scores (user-1 has a row on every chart, including the invisible
//             sim3, so the visibility filter is actually exercised):
//     chart 10 (sim1): updated_at 2026-07-10  <- most recent VISIBLE
//     chart 11 (sim2): updated_at 2026-07-09
//     chart 12 (sim3): updated_at 2026-07-11  <- most recent overall, but
//                                                excluded by visibility
//     chart 13 (sim4): updated_at 2026-07-08
//   scores: best + 1 recent on chart_score 100 (chart 10); best only on 101.
const seedReadPathFixture = async (db: D1Database) => {
	// Clear the simfile/dtx_files/chart_scores/scores seeded by the outer
	// beforeEach so the explicit fixture below is the only data present.
	await db.prepare('DELETE FROM scores').run();
	await db.prepare('DELETE FROM chart_scores').run();
	await db.prepare('DELETE FROM dtx_files').run();
	await db.prepare('DELETE FROM simfiles').run();

	await db
		.prepare(
			`INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, publish_date, created_at, updated_at)
			 VALUES
			   (1, 'Pub Other',    'A', 120, 'user-2', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
			   (2, 'Mine Unpub',   'B', 130, 'user-1', 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
			   (3, 'Other Unpub',  'C', 140, 'user-2', 0, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'),
			   (4, 'Pub Other 2',  'D', 150, 'user-2', 1, '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z')`
		)
		.run();

	await db
		.prepare(
			`INSERT INTO dtx_files (id, label, level, simfile_id) VALUES
			   (10, 'BASIC', 5, 1),
			   (11, 'ADV',   8, 2),
			   (12, 'EXT',  10, 3),
			   (13, 'BASIC', 3, 4)`
		)
		.run();

	await db
		.prepare(
			`INSERT INTO chart_scores (id, chart_id, user_id, play_count, clear_count, created_at, updated_at)
			 VALUES
			   (100, 10, 'user-1', 7, 5, '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z'),
			   (101, 11, 'user-1', 3, 2, '2026-07-01T00:00:00Z', '2026-07-09T00:00:00Z'),
			   (102, 12, 'user-1', 9, 6, '2026-07-01T00:00:00Z', '2026-07-11T00:00:00Z'),
			   (103, 13, 'user-1', 2, 1, '2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z')`
		)
		.run();

	await db
		.prepare(
			`INSERT INTO scores (id, chart_score_id, is_best, score, achievement_rate, rank_label, full_combo, cleared, max_combo, perfect, great, good, poor, miss, performed_at, display_order)
			 VALUES
			   (200, 100, 1, 950000, 91.3, 'S', 1, 1, 800, 500, 30, 10, 5, 2, '2026-06-02T00:00:00Z', NULL),
			   (201, 100, 0, NULL,   82.4, 'A', 0, 1, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-01T00:00:00Z', 1),
			   (202, 101, 1, 880000, 88.0, 'S', 0, 1, 700, 400, 50, 20, 10, 5, '2026-06-01T00:00:00Z', NULL)`
		)
		.run();
};

describe('read-path SQL (real D1)', () => {
	beforeEach(async () => {
		await seedReadPathFixture(db);
	});

	describe('listUserScoredSimfiles', () => {
		it('returns only visible simfiles (published OR owned), ordered by recency', async () => {
			const { data, count } = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 1,
				pageSize: 20
			});

			// sim3 is owned by user-2 and unpublished -> excluded by the
			// visibility filter even though user-1 has a (most-recent)
			// chart_score on it. A broken filter would leak it.
			expect(count).toBe(3);
			expect(data.map((s) => s.id)).toEqual([1, 2, 4]);
			// Recency: MAX(cs.updated_at) DESC -> sim1 (07-10), sim2 (07-09), sim4 (07-08).
			expect(data.map((s) => s.title)).toEqual(['Pub Other', 'Mine Unpub', 'Pub Other 2']);
		});

		it('paginates at the SQL level (page 1 and page 2)', async () => {
			const page1 = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 1,
				pageSize: 2
			});
			expect(page1.count).toBe(3);
			expect(page1.data.map((s) => s.id)).toEqual([1, 2]);

			const page2 = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 2,
				pageSize: 2
			});
			expect(page2.count).toBe(3);
			expect(page2.data.map((s) => s.id)).toEqual([4]);
		});

		it('uses simfile_id as a stable tie-breaker when updated_at ties', async () => {
			// Add sim5 (published, user-2) with a chart_score whose updated_at
			// TIES sim1's (2026-07-10). Without a secondary sort key, SQLite
			// could return sim1 and sim5 in either order — and swap them
			// between page requests, causing duplicates/omissions. The
			// d.simfile_id DESC tie-breaker makes the order deterministic.
			await db
				.prepare(
					`INSERT INTO simfiles (id, title, artist, bpm, user_id, is_published, publish_date, created_at, updated_at)
					 VALUES (5, 'Tied Pub', 'E', 160, 'user-2', 1, '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z')`
				)
				.run();
			await db
				.prepare(
					"INSERT INTO dtx_files (id, label, level, simfile_id) VALUES (14, 'ADV', 7, 5)"
				)
				.run();
			await db
				.prepare(
					`INSERT INTO chart_scores (id, chart_id, user_id, play_count, clear_count, created_at, updated_at)
					 VALUES (104, 14, 'user-1', 1, 1, '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z')`
				)
				.run();

			// Tied updated_at (07-10) -> sim5 (id 5) before sim1 (id 1) under
			// d.simfile_id DESC. Full visible order: 5, 1, 2, 4.
			const { data } = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 1,
				pageSize: 20
			});
			expect(data.map((s) => s.id)).toEqual([5, 1, 2, 4]);

			// Page boundary right at the tie: page 1 size 1 -> [5], page 2 -> [1].
			// A non-deterministic tie would risk returning [1] then [1] (dup) or
			// skipping sim5. The tie-breaker keeps both pages stable.
			const p1 = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 1,
				pageSize: 1
			});
			const p2 = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 2,
				pageSize: 1
			});
			expect(p1.data.map((s) => s.id)).toEqual([5]);
			expect(p2.data.map((s) => s.id)).toEqual([1]);
		});

		it('joins dtx_files for each returned simfile', async () => {
			const { data } = await listUserScoredSimfiles(db, {
				userId: 'user-1',
				page: 1,
				pageSize: 20
			});
			const sim1 = data.find((s) => s.id === 1);
			expect(sim1?.dtx_files).toEqual([{ id: 10, level: 5, label: 'BASIC' }]);
		});

		it('returns empty data with count 0 for a user with no scores', async () => {
			const { data, count } = await listUserScoredSimfiles(db, {
				userId: 'nobody',
				page: 1,
				pageSize: 20
			});
			expect(count).toBe(0);
			expect(data).toEqual([]);
		});
	});

	describe('listUserChartScores', () => {
		it('batch-fetches chart_scores + scores keyed by chart_id, best-first', async () => {
			const map = await listUserChartScores(db, 'user-1', [10, 11]);

			expect(map.size).toBe(2);
			const chart10 = map.get(10)!;
			expect(chart10.chartScore.id).toBe(100);
			expect(chart10.chartScore.play_count).toBe(7);
			// best-first (is_best DESC), then display_order ASC.
			expect(chart10.scores).toHaveLength(2);
			expect(chart10.scores[0].is_best).toBe(1);
			expect(chart10.scores[0].score).toBe(950000);
			expect(chart10.scores[1].is_best).toBe(0);
			expect(chart10.scores[1].display_order).toBe(1);

			const chart11 = map.get(11)!;
			expect(chart11.chartScore.id).toBe(101);
			expect(chart11.scores).toHaveLength(1);
			expect(chart11.scores[0].is_best).toBe(1);
		});

		it('returns an empty map for an empty chart-id list', async () => {
			const map = await listUserChartScores(db, 'user-1', []);
			expect(map.size).toBe(0);
		});

		it('omits charts the user has no chart_score for', async () => {
			// Chart 13 exists (sim4) but user-1's score on it (chart_score 103)
			// has no scores rows — the chart_score itself is still returned.
			// Chart 999 has no chart_score at all -> absent from the map.
			const map = await listUserChartScores(db, 'user-1', [13, 999]);
			expect(map.size).toBe(1);
			expect(map.has(13)).toBe(true);
			expect(map.get(13)!.scores).toEqual([]);
			expect(map.has(999)).toBe(false);
		});
	});

	describe('getChartVisibilityBatch', () => {
		it('resolves owner + published flag for each chart id', async () => {
			const map = await getChartVisibilityBatch(db, [10, 11, 12, 13]);
			expect(map.size).toBe(4);
			expect(map.get(10)).toEqual({ user_id: 'user-2', is_published: 1 });
			expect(map.get(11)).toEqual({ user_id: 'user-1', is_published: 0 });
			expect(map.get(12)).toEqual({ user_id: 'user-2', is_published: 0 });
			expect(map.get(13)).toEqual({ user_id: 'user-2', is_published: 1 });
		});

		it('omits unknown chart ids from the map', async () => {
			const map = await getChartVisibilityBatch(db, [10, 999]);
			expect(map.size).toBe(1);
			expect(map.has(10)).toBe(true);
			expect(map.has(999)).toBe(false);
		});

		it('returns an empty map for an empty id list', async () => {
			const map = await getChartVisibilityBatch(db, []);
			expect(map.size).toBe(0);
		});
	});
});
