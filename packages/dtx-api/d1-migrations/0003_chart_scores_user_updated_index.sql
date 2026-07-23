-- 0003_chart_scores_user_updated_index.sql
-- Used by listUserScoredSimfiles (db.ts), which filters chart_scores by
--   WHERE cs.user_id = ?
-- and then groups by d.simfile_id and orders by MAX(cs.updated_at) DESC.
-- The existing idx_chart_scores_user_chart(user_id, chart_id) covers the
-- user_id filter but does not carry updated_at, so evaluating the recency
-- ordering previously required reading the user's chart_scores rows to
-- access updated_at. This composite index keeps updated_at alongside
-- user_id so the filter and the recency column can be served from the
-- index. It does not by itself satisfy the GROUP BY + MAX(cs.updated_at)
-- sort, which still requires aggregation across the joined/grouped rows.
--
-- Drizzle parity: there is no Drizzle definition for this index because
-- chart_scores/scores Drizzle builders in db/schema.ts are test-only (see
-- the NOTE in that file). Production queries use raw SQL against the tables.
-- If a Drizzle definition is later added, mirror the name + columns here.
CREATE INDEX IF NOT EXISTS idx_chart_scores_user_updated
    ON chart_scores(user_id, updated_at);

-- Rollback (manual, if needed): D1 migrations are forward-only.
--   DROP INDEX IF EXISTS idx_chart_scores_user_updated;
