-- 0002_scores.sql
-- Per-user score import from DTXManiaCX.
-- dtx_files stays a global chart definition; chart_scores is the per-user
-- intermediate holding aggregates; scores holds individual plays.

CREATE TABLE IF NOT EXISTS chart_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    clear_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_id) REFERENCES dtx_files(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chart_scores_user_chart ON chart_scores(user_id, chart_id);
CREATE INDEX idx_chart_scores_chart ON chart_scores(chart_id);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    achievement_rate REAL,
    rank_label TEXT,
    full_combo INTEGER NOT NULL DEFAULT 0,
    cleared INTEGER NOT NULL DEFAULT 0,
    max_combo INTEGER,
    perfect INTEGER, great INTEGER, good INTEGER, poor INTEGER, miss INTEGER,
    performed_at TEXT,
    display_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE
);
CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
