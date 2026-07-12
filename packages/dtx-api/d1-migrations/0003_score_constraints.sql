-- 0003_score_constraints.sql
-- Add CHECK constraints to chart_scores and scores as DB-level backstop for
-- the app-layer validation in validateChartScores (score.ts). SQLite cannot
-- ALTER TABLE ADD CHECK, so we use the standard table-rebuild pattern:
-- create new table → copy data → drop old → rename → recreate indexes.
--
-- Constraints mirror validateChartScores exactly:
--   chart_scores: play_count >= 0, clear_count >= 0, clear_count <= play_count
--   scores: non-negative judgment counts, score >= 0, achievement_rate 0..100,
--           display_order NULL or 1..5, boolean columns IN (0, 1)

-- Step 1: Rebuild scores first (it holds the FK to chart_scores).
CREATE TABLE scores_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
    score INTEGER CHECK (score IS NULL OR score >= 0),
    achievement_rate REAL CHECK (achievement_rate IS NULL OR (achievement_rate >= 0 AND achievement_rate <= 100)),
    rank_label TEXT,
    full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1)),
    cleared INTEGER NOT NULL DEFAULT 0 CHECK (cleared IN (0, 1)),
    max_combo INTEGER CHECK (max_combo IS NULL OR max_combo >= 0),
    perfect INTEGER CHECK (perfect IS NULL OR perfect >= 0),
    great INTEGER CHECK (great IS NULL OR great >= 0),
    good INTEGER CHECK (good IS NULL OR good >= 0),
    poor INTEGER CHECK (poor IS NULL OR poor >= 0),
    miss INTEGER CHECK (miss IS NULL OR miss >= 0),
    performed_at TEXT,
    display_order INTEGER CHECK (display_order IS NULL OR (display_order >= 1 AND display_order <= 5)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE
);

INSERT INTO scores_new (id, chart_score_id, is_best, score, achievement_rate, rank_label,
    full_combo, cleared, max_combo, perfect, great, good, poor, miss, performed_at,
    display_order, created_at)
SELECT id, chart_score_id, is_best, score, achievement_rate, rank_label,
    full_combo, cleared, max_combo, perfect, great, good, poor, miss, performed_at,
    display_order, created_at
FROM scores;

DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;

-- Step 2: Rebuild chart_scores with CHECK constraints.
CREATE TABLE chart_scores_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    clear_count INTEGER NOT NULL DEFAULT 0 CHECK (clear_count >= 0 AND clear_count <= play_count),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_id) REFERENCES dtx_files(id) ON DELETE CASCADE
);

INSERT INTO chart_scores_new (id, chart_id, user_id, play_count, clear_count, created_at, updated_at)
SELECT id, chart_id, user_id, play_count, clear_count, created_at, updated_at
FROM chart_scores;

DROP TABLE chart_scores;
ALTER TABLE chart_scores_new RENAME TO chart_scores;

-- Step 3: Recreate all indexes (dropped with their parent tables).
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_scores_user_chart ON chart_scores(user_id, chart_id);
CREATE INDEX IF NOT EXISTS idx_chart_scores_chart ON chart_scores(chart_id);

CREATE INDEX IF NOT EXISTS idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_display_order
    ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL;
