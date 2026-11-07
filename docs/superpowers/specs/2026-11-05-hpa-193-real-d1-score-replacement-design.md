# HPA-193 — Real-D1 Score Replacement Regression Design

**Date:** 2026-11-05  
**Status:** Revised after code review  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Delivery:** One PR for design, implementation, tests, and verification; no follow-up PR.

## Goal

Prove on real D1 that **insert → replace → replace** on the same chart/user retains only the final score set, correctly maps every score INSERT binding, clears chart-level fields on update without retaining stale values, verifies `updated_at` moves forward while `created_at` is preserved, sorts recents by `display_order`, and preserves one aggregate with no leftover score records.

## Existing setup — reuse it

- `packages/dtx-api/src/db/queries.integration.test.ts` already runs Miniflare D1, applies all numbered migrations from `dtx-api/d1-migrations`, resets schema per test, and seeds `user-1` / chart `1`. Add **one `it()`** inside its existing `describe('upsertChartScoreAndReplaceScores (real D1)')`; reuse `db`, `scoreInput` and `defaultChartScoreFields`.
- `packages/dtx-api/src/db/queries.ts` writes a chart aggregate, DELETEs prior scores and INSERTs replacements as one D1 batch. `getUserChartScore` orders by `is_best DESC, display_order ASC`.
- `queries.integration.test.ts` already covers a single replacement, aggregate upsert, TOCTOU, and negative tests for partial unique indexes `idx_scores_one_best` and `idx_scores_display_order`. `queries.test.ts` covers mock statement shapes. **Do not repeat those tests** or create another harness.
- `0002_scores.sql` and `0007_score_semantics.sql` define the real constraints. Keep best-row rate/rank/cleared/performed-at/display-order **NULL**; chart-level rate/rank live on `chart_scores`.

## Single test fixture

| Write         | Data                                                                                                                                                                                                    | Purpose                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| First insert  | `playCount=2`, `clearCount=1`; best score `700000`, recent order 1                                                                                                                                      | Initial chart-score and two children                                                                                                   |
| First replace | `playCount=5`, `clearCount=3`, `fullCombo=true`, `maxCombo=950`, `bestRankLabel='A'`; best `800000`, recents at orders 1, 2, and 3                                                                      | Overwrite earlier children and populate slot 3 so the final replace proves un-reused slots do not survive                              |
| Final replace | `playCount=9`, `clearCount=7`, `fullCombo=false`, `maxCombo=913`, `bestAchievementRate=98.5`, `bestRankLabel=null`, a fixed `lastPlayedAt`; two recents then best (**inserted order 2, order 1, best**) | Verify final bindings, clearing values (fullCombo to 0, bestRankLabel to null, lower maxCombo), and read ordering opposing input order |

Use **pairwise-distinct judgment sentinels within each final score row** to catch swapped bind positions, not elaborate phase-one/two fixtures:

- Best: `score=990000`, `perfect=501`, `great=402`, `good=303`, `poor=204`, `miss=105`; score-level `achievement_rate`, `rank_label`, `cleared`, `performed_at`, `display_order` are NULL.
- Recent **order 2** (inserted first): **`display_order=2`**, `achievement_rate=83.25`, `rank_label='A'`, `cleared=false`, `perfect=31`, `great=22`, `good=13`, `poor=4`, `miss=1`, `performed_at='2026-10-02T14:00:00Z'`.
- Recent **order 1** (inserted second): **`display_order=1`**, `achievement_rate=94.5`, `rank_label='S'`, `cleared=true`, `perfect=61`, `great=42`, `good=23`, `poor=4`, `miss=2`, `performed_at='2026-10-03T16:00:00Z'`.

Leave recent `score` values NULL and use `scoreInput` defaults where possible. Set `lastPlayedAt` to a distinctive fixed value. The false/true `cleared` pair specifically verifies `false` binds as `0`, not NULL.

The expected score-row projection in `queries.integration.test.ts` defines exact 12-column objects excluding generated `id`, `chart_score_id`, and `created_at`, compared in read order: best (`display_order: null`), recent 1, then recent 2. D1/SQLite returns `is_best` and `cleared` as integer flags `0 | 1`.

## Minimal assertions

1. All three writes return the **same** `chart_scores.id`. Introduce a small delay before the final write so timestamps land in distinct milliseconds. Assert `expect(third.created_at).toBe(first.created_at)` (proving conflict update preserves creation time without false passes from identical-millisecond runs) and `expect(Date.parse(third.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))` (proving the recency timestamp advances).
2. Assert final chart-level fields with `toMatchObject` on the third result. Setting values in the second write and clearing them in the third (`full_combo: 0`, `best_rank_label: null`, lower `max_combo: 913`) verifies the conflict update overwrites rather than using `COALESCE` or `MAX`.
3. Call `getUserChartScore(db, 'user-1', 1)` **once**; project each score row using rest destructuring `({ id, chart_score_id, created_at, ...rest }) => rest` and `toEqual([finalBest, finalRecent1, finalRecent2])`. Because write 3 inserts `[recent 2, recent 1, best]`, the read order is the reverse of insertion order. Note: the CHECK constraint forces the best row's `display_order` to NULL; in SQLite, `NULL` sorts first under ascending order, so `display_order ASC` and `is_best DESC, display_order ASC` sequence identical rows.
4. Assert `SELECT COUNT(*) AS cnt FROM scores` **without WHERE** returns `3`. Because write 2 wrote orders 1, 2, and 3 while write 3 wrote only orders 1 and 2, this proves un-reused slots from earlier writes were deleted rather than orphaned. Duplicate slots within the same aggregate are already rejected by `idx_scores_display_order` and `idx_scores_one_best`; `third.id === first.id` already proves the single aggregate row.

## Guardrails and acceptance

- Only the existing API integration test changes in the implementation phase. No production SQL, schema, migrations, new mocks/helpers/frameworks, dependencies, CI jobs, GraphQL, or cross-package refactors.
- Keep existing mock and partial-unique-index tests intact. Do not expand test coverage outside the requested three-write regression.
- The focused integration test, API test suite, and API typecheck should pass. **Put observed commands/results in the PR description**, not duplicated in this design and plan. Keep both docs stable unless design decisions actually change.
