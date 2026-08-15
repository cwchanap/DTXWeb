-- 0007_score_semantics.sql
-- Move chart-level score records out of scores so recent plays can retain
-- their own achievement/rank/clear metadata while the best row is canonical.
-- CHECK parity spans 0002_scores.sql + 0007_score_semantics.sql; keep both
-- migration files and packages/common/src/lib/server/db/schema.ts aligned.

ALTER TABLE chart_scores ADD COLUMN full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1));
ALTER TABLE chart_scores ADD COLUMN max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= 0);
ALTER TABLE chart_scores ADD COLUMN best_achievement_rate REAL CHECK (best_achievement_rate IS NULL OR (best_achievement_rate >= 0 AND best_achievement_rate <= 100));
ALTER TABLE chart_scores ADD COLUMN best_rank_label TEXT CHECK (best_rank_label IS NULL OR best_rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'));
ALTER TABLE chart_scores ADD COLUMN last_played_at TEXT;

UPDATE chart_scores
SET full_combo = COALESCE((
        SELECT s.full_combo FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ), 0),
    max_combo = COALESCE((
        SELECT s.max_combo FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ), 0),
    best_achievement_rate = (
        SELECT s.achievement_rate FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ),
    best_rank_label = (
        SELECT s.rank_label FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    ),
    last_played_at = (
        SELECT s.performed_at FROM scores s
        WHERE s.chart_score_id = chart_scores.id AND s.is_best = 1 LIMIT 1
    );

CREATE TABLE scores_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,
    is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
    score INTEGER CHECK (score IS NULL OR score >= 0),
    achievement_rate REAL CHECK (achievement_rate IS NULL OR (achievement_rate >= 0 AND achievement_rate <= 100)),
    rank_label TEXT CHECK (rank_label IS NULL OR rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F')),
    cleared INTEGER CHECK (cleared IS NULL OR cleared IN (0, 1)),
    perfect INTEGER CHECK (perfect IS NULL OR perfect >= 0),
    great INTEGER CHECK (great IS NULL OR great >= 0),
    good INTEGER CHECK (good IS NULL OR good >= 0),
    poor INTEGER CHECK (poor IS NULL OR poor >= 0),
    miss INTEGER CHECK (miss IS NULL OR miss >= 0),
    performed_at TEXT,
    display_order INTEGER CHECK (display_order IS NULL OR (display_order >= 1 AND display_order <= 5)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE,
    CHECK (is_best = 0 OR (achievement_rate IS NULL AND rank_label IS NULL AND cleared IS NULL AND performed_at IS NULL AND display_order IS NULL))
);

INSERT INTO scores_v2 (
    id, chart_score_id, is_best, score, achievement_rate, rank_label,
    cleared, perfect, great, good, poor, miss, performed_at,
    display_order, created_at
)
SELECT
    id,
    chart_score_id,
    is_best,
    score,
    CASE WHEN is_best = 1 THEN NULL ELSE achievement_rate END,
    CASE WHEN is_best = 1 THEN NULL ELSE rank_label END,
    CASE WHEN is_best = 1 THEN NULL ELSE cleared END,
    perfect, great, good, poor, miss,
    CASE WHEN is_best = 1 THEN NULL ELSE performed_at END,
    CASE WHEN is_best = 1 THEN NULL ELSE display_order END,
    created_at
FROM scores;

DROP TABLE scores;
ALTER TABLE scores_v2 RENAME TO scores;

CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
CREATE UNIQUE INDEX idx_scores_display_order
    ON scores(chart_score_id, display_order) WHERE display_order IS NOT NULL;
