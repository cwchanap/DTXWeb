import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const simfiles = sqliteTable(
	'simfiles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		title: text('title').notNull().default(''),
		artist: text('artist').notNull().default(''),
		bpm: real('bpm').notNull(),
		userId: text('user_id').notNull(),
		isPublished: integer('is_published').notNull().default(0),
		displayId: integer('display_id'),
		downloadUrl: text('download_url'),
		previewUrl: text('preview_url'),
		videoPreviewUrl: text('video_preview_url'),
		publishDate: text('publish_date').notNull(),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull()
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
