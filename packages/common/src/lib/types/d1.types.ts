// D1 database row types — replaces Supabase Database type for D1/SQLite schema.
// These types mirror the D1 schema in d1-migrations/0001_initial_schema.sql.
// SQLite booleans are stored as INTEGER (0/1), timestamps as TEXT (ISO 8601).

export interface SimfileRow {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	user_id: string;
	is_published: 0 | 1; // SQLite boolean
	display_id: number | null;
	download_url: string | null;
	google_drive_file_id: string | null;
	preview_url: string | null;
	video_preview_url: string | null;
	publish_date: string;
	created_at: string;
	updated_at: string;
}

export interface SimfileInsert {
	title?: string;
	artist?: string;
	bpm: number;
	user_id: string;
	is_published?: 0 | 1;
	display_id?: number | null;
	download_url?: string | null;
	preview_url?: string | null;
	video_preview_url?: string | null;
	publish_date?: string;
}

export interface SimfileUpdate {
	title?: string;
	artist?: string;
	bpm?: number;
	is_published?: 0 | 1;
	display_id?: number | null;
	download_url?: string | null;
	preview_url?: string | null;
	video_preview_url?: string | null;
	publish_date?: string;
}

export interface DtxFileRow {
	id: number;
	label: string;
	level: number;
	simfile_id: number;
}

export interface DtxFileInsert {
	label?: string;
	level?: number;
	simfile_id: number;
}

export interface ChartScoreRow {
	id: number;
	chart_id: number;
	user_id: string;
	play_count: number;
	clear_count: number;
	full_combo: 0 | 1;
	max_combo: number;
	best_achievement_rate: number | null;
	best_rank_label: string | null;
	last_played_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface ScoreRow {
	id: number;
	chart_score_id: number;
	is_best: 0 | 1;
	score: number | null;
	achievement_rate: number | null;
	rank_label: string | null;
	cleared: 0 | 1 | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performed_at: string | null;
	display_order: number | null;
	created_at: string;
}

export interface ScoreInsert {
	is_best?: boolean;
	score?: number | null;
	achievement_rate?: number | null;
	rank_label?: string | null;
	cleared?: boolean | null | undefined;
	perfect?: number | null;
	great?: number | null;
	good?: number | null;
	poor?: number | null;
	miss?: number | null;
	performed_at?: string | null;
	display_order?: number | null;
}

export interface UserProfileRow {
	id: number;
	user_id: string;
	username: string;
}

export interface UserProfileInsert {
	user_id: string;
	username: string;
}

export interface UserProfileUpdate {
	username?: string;
}

/** Simfile with joined dtx_files — the API-facing shape with boolean is_published.
 * Owner-only fields are optional because publishedOnly queries intentionally omit them. */
export interface SimfileWithDtxFiles extends Omit<
	SimfileRow,
	'is_published' | 'user_id' | 'google_drive_file_id'
> {
	is_published: boolean;
	user_id?: string;
	google_drive_file_id?: string | null;
	dtx_files: { id?: number; level: number; label: string }[];
}

/** Convert a raw D1 simfile row (integer booleans) to the API-facing shape */
export const toSimfileWithDtx = (
	row: Omit<SimfileRow, 'user_id' | 'google_drive_file_id'> & {
		user_id?: string;
		google_drive_file_id?: string | null;
	},
	dtxFiles: { id?: number; level: number; label: string }[]
): SimfileWithDtxFiles => ({
	...row,
	is_published: row.is_published === 1,
	dtx_files: dtxFiles
});
