-- 0002_scores.sql
-- Per-user score import from DTXManiaCX.
-- dtx_files stays a global chart definition; chart_scores is the per-user
-- intermediate holding aggregates; scores holds individual plays.
--
-- CHECK constraints mirror validateChartScores (score.ts) as a DB-level
-- backstop so a race or bypassed validator cannot corrupt the data:
--   chart_scores: play_count >= 0, clear_count >= 0, clear_count <= play_count
--   scores: non-negative judgment counts, score >= 0, achievement_rate 0..100,
--           display_order NULL or 1..5, boolean columns IN (0, 1),
--           rank_label NULL or IN (SS, S, A, B, C, D, E, F)
--
-- ON DELETE CASCADE foreign keys are declared as a backstop only. D1 (SQLite)
-- does not reliably enforce FK cascade PRAGMAs across connections, so
-- deleteSimfile (db.ts) explicitly deletes children in the correct order
-- (scores -> chart_scores -> dtx_files -> simfiles) in a single D1 batch.
-- Do NOT add a code path that deletes dtx_files directly without first
-- deleting its chart_scores/scores children, or rows will be orphaned.

CREATE TABLE IF NOT EXISTS chart_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    clear_count INTEGER NOT NULL DEFAULT 0 CHECK (clear_count >= 0 AND clear_count <= play_count),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_id) REFERENCES dtx_files(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_scores_user_chart ON chart_scores(user_id, chart_id);
CREATE INDEX IF NOT EXISTS idx_chart_scores_chart ON chart_scores(chart_id);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
    score INTEGER CHECK (score IS NULL OR score >= 0),
    achievement_rate REAL CHECK (achievement_rate IS NULL OR (achievement_rate >= 0 AND achievement_rate <= 100)),
    rank_label TEXT CHECK (rank_label IS NULL OR rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')),
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
CREATE INDEX IF NOT EXISTS idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
-- Enforce display_order uniqueness at the DB level: each chart_score may have
-- at most one score per display_order value. Only non-null display_order rows
-- are constrained (best scores carry NULL and are excluded). Mirrors the app-
-- layer validation in validateChartScores so a race or bypassed validator can-
-- not corrupt the recent-scores ordering.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_display_order
    ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL;
