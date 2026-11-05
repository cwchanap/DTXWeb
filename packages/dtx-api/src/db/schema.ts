import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const simfiles = sqliteTable(
	'simfiles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		title: text('title').notNull().default(''),
		artist: text('artist').notNull().default(''),
		bpm: real('bpm').notNull(),
		userId: text('user_id').notNull(),
		isPublished: integer('is_published').$type<0 | 1>().notNull().default(0),
		displayId: integer('display_id'),
		downloadUrl: text('download_url'),
		googleDriveFileId: text('google_drive_file_id'),
		previewUrl: text('preview_url'),
		videoPreviewUrl: text('video_preview_url'),
		publishDate: text('publish_date')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	},
	(table) => ({
		userIdIdx: index('idx_simfiles_user_id').on(table.userId),
		isPublishedIdx: index('idx_simfiles_is_published').on(table.isPublished),
		publishDateIdx: index('idx_simfiles_publish_date').on(table.publishDate)
	})
);

export const dtxFiles = sqliteTable(
	'dtx_files',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		label: text('label').notNull().default(''),
		level: integer('level').notNull().default(0),
		simfileId: integer('simfile_id')
			.notNull()
			.references(() => simfiles.id, { onDelete: 'cascade' })
	},
	(table) => ({
		simfileIdIdx: index('idx_dtx_files_simfile_id').on(table.simfileId)
	})
);

export const userProfiles = sqliteTable(
	'user_profiles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id').notNull(),
		username: text('username').notNull()
	},
	(table) => ({
		userIdUniqueIdx: uniqueIndex('user_profiles_user_id_unique').on(table.userId)
	})
);

// NOTE: `chartScores` and `scores` below are Drizzle table definitions used
// for type inference and test setup (db.test.ts, score.test.ts). Production
// queries in db.ts use raw SQL strings against the `chart_scores` / `scores`
// tables rather than these Drizzle builders, so these exports are not imported
// by the service layer — only by tests. They are kept here so the schema
// definition lives in one place and test fixtures can use the typed builders.
// CHECK constraints and partial unique indexes mirror the raw SQL migrations
// (0002_scores.sql + 0007_score_semantics.sql) so tests inserting via Drizzle
// builders are subject to the same integrity rules as production raw-SQL writes.
export const chartScores = sqliteTable(
	'chart_scores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chartId: integer('chart_id')
			.notNull()
			.references(() => dtxFiles.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		playCount: integer('play_count').notNull().default(0),
		clearCount: integer('clear_count').notNull().default(0),
		fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
		maxCombo: integer('max_combo').notNull().default(0),
		bestAchievementRate: real('best_achievement_rate'),
		bestRankLabel: text('best_rank_label'),
		lastPlayedAt: text('last_played_at'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
		updatedAt: text('updated_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	},
	(table) => ({
		userChartUniqueIdx: uniqueIndex('idx_chart_scores_user_chart').on(
			table.userId,
			table.chartId
		),
		chartIdx: index('idx_chart_scores_chart').on(table.chartId),
		playCountCheck: check('chart_scores_play_count_check', sql`${table.playCount} >= 0`),
		clearCountCheck: check(
			'chart_scores_clear_count_check',
			sql`${table.clearCount} >= 0 AND ${table.clearCount} <= ${table.playCount}`
		),
		fullComboCheck: check('chart_scores_full_combo_check', sql`${table.fullCombo} IN (0, 1)`),
		maxComboCheck: check('chart_scores_max_combo_check', sql`${table.maxCombo} >= 0`),
		bestAchievementRateCheck: check(
			'chart_scores_best_achievement_rate_check',
			sql`${table.bestAchievementRate} IS NULL OR (${table.bestAchievementRate} >= 0 AND ${table.bestAchievementRate} <= 100)`
		),
		bestRankLabelCheck: check(
			'chart_scores_best_rank_label_check',
			sql`${table.bestRankLabel} IS NULL OR ${table.bestRankLabel} IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')`
		)
	})
);

export const scores = sqliteTable(
	'scores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		chartScoreId: integer('chart_score_id')
			.notNull()
			.references(() => chartScores.id, { onDelete: 'cascade' }),
		isBest: integer('is_best').$type<0 | 1>().notNull().default(0),
		score: integer('score'),
		achievementRate: real('achievement_rate'),
		rankLabel: text('rank_label'),
		cleared: integer('cleared').$type<0 | 1>(),
		perfect: integer('perfect'),
		great: integer('great'),
		good: integer('good'),
		poor: integer('poor'),
		miss: integer('miss'),
		performedAt: text('performed_at'),
		displayOrder: integer('display_order'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	},
	(table) => ({
		chartScoreIdx: index('idx_scores_chart_score').on(table.chartScoreId),
		oneBestIdx: uniqueIndex('idx_scores_one_best')
			.on(table.chartScoreId)
			.where(sql`${table.isBest} = 1`),
		displayOrderIdx: uniqueIndex('idx_scores_display_order')
			.on(table.chartScoreId, table.displayOrder)
			.where(sql`${table.displayOrder} IS NOT NULL`),
		isBestCheck: check('scores_is_best_check', sql`${table.isBest} IN (0, 1)`),
		scoreCheck: check('scores_score_check', sql`${table.score} IS NULL OR ${table.score} >= 0`),
		achievementRateCheck: check(
			'scores_achievement_rate_check',
			sql`${table.achievementRate} IS NULL OR (${table.achievementRate} >= 0 AND ${table.achievementRate} <= 100)`
		),
		rankLabelCheck: check(
			'scores_rank_label_check',
			sql`${table.rankLabel} IS NULL OR ${table.rankLabel} IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')`
		),
		clearedCheck: check(
			'scores_cleared_check',
			sql`${table.cleared} IS NULL OR ${table.cleared} IN (0, 1)`
		),
		perfectCheck: check(
			'scores_perfect_check',
			sql`${table.perfect} IS NULL OR ${table.perfect} >= 0`
		),
		greatCheck: check('scores_great_check', sql`${table.great} IS NULL OR ${table.great} >= 0`),
		goodCheck: check('scores_good_check', sql`${table.good} IS NULL OR ${table.good} >= 0`),
		poorCheck: check('scores_poor_check', sql`${table.poor} IS NULL OR ${table.poor} >= 0`),
		missCheck: check('scores_miss_check', sql`${table.miss} IS NULL OR ${table.miss} >= 0`),
		displayOrderCheck: check(
			'scores_display_order_check',
			sql`${table.displayOrder} IS NULL OR (${table.displayOrder} >= 1 AND ${table.displayOrder} <= 5)`
		),
		bestMetadataCheck: check(
			'scores_best_metadata_check',
			sql`${table.isBest} = 0 OR (${table.achievementRate} IS NULL AND ${table.rankLabel} IS NULL AND ${table.cleared} IS NULL AND ${table.performedAt} IS NULL AND ${table.displayOrder} IS NULL)`
		)
	})
);
