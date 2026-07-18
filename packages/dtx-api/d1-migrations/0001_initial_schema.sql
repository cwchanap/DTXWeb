-- 0001_initial_schema.sql
-- Migrate Supabase PostgreSQL tables to Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS simfiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    bpm REAL NOT NULL,
    user_id TEXT NOT NULL,
    is_published INTEGER NOT NULL DEFAULT 0,
    display_id INTEGER,
    download_url TEXT,
    preview_url TEXT,
    video_preview_url TEXT,
    publish_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- IF NOT EXISTS on every index so the migration is reapply-safe: a D1
-- initialized before this migration system existed (old deploy path only
-- ran `wrangler deploy`, leaving no migration-history row for 0001) would
-- otherwise fail with "index ... already exists" when `migrations apply`
-- replays 0001, blocking 0002 and the worker deploy. Matches the idempotent
-- pattern already used in 0002_scores.sql.
CREATE INDEX IF NOT EXISTS idx_simfiles_user_id ON simfiles(user_id);
CREATE INDEX IF NOT EXISTS idx_simfiles_is_published ON simfiles(is_published);
CREATE INDEX IF NOT EXISTS idx_simfiles_publish_date ON simfiles(publish_date);

CREATE TABLE IF NOT EXISTS dtx_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 0,
    simfile_id INTEGER NOT NULL,
    FOREIGN KEY (simfile_id) REFERENCES simfiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dtx_files_simfile_id ON dtx_files(simfile_id);

CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL
);
