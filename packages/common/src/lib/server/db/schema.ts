import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
		chartIdx: index('idx_chart_scores_chart').on(table.chartId)
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
		fullCombo: integer('full_combo').$type<0 | 1>().notNull().default(0),
		cleared: integer('cleared').$type<0 | 1>().notNull().default(0),
		maxCombo: integer('max_combo'),
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
		chartScoreIdx: index('idx_scores_chart_score').on(table.chartScoreId)
	})
);
