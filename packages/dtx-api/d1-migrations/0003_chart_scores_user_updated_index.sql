-- 0003_chart_scores_user_updated_index.sql
-- Supports the recency sort in listUserScoredSimfiles (db.ts):
--   ORDER BY MAX(cs.updated_at) DESC
--   WHERE cs.user_id = ?
-- The existing idx_chart_scores_user_chart(user_id, chart_id) does not
-- cover updated_at, so the recency sort required a full scan of the user's
-- chart_scores rows. This composite index lets D1 satisfy the filter + sort
-- from the index alone for the common (user_id, updated_at) prefix.
--
-- Drizzle parity: there is no Drizzle definition for this index because
-- chart_scores/scores Drizzle builders in db/schema.ts are test-only (see
-- the NOTE in that file). Production queries use raw SQL against the tables.
-- If a Drizzle definition is later added, mirror the name + columns here.
CREATE INDEX IF NOT EXISTS idx_chart_scores_user_updated
    ON chart_scores(user_id, updated_at);

-- Rollback (manual, if needed): D1 migrations are forward-only.
--   DROP INDEX IF EXISTS idx_chart_scores_user_updated;
