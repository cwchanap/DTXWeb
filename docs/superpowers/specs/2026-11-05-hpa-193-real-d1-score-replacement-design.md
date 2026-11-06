# HPA-193 — Real-D1 Score Replacement Regression Design

**Date:** 2026-11-05  
**Status:** Draft, revised after [GitHub design review](https://github.com/cwchanap/DTXWeb/pull/337#issuecomment-6673745114)  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Delivery:** One PR for design, implementation, tests, and verification; no follow-up PR.

## Goal

Prove on real D1 that **insert → replace → replace** on the same chart/user retains only the final score set, correctly maps every score INSERT binding, sorts best-first then by `display_order`, and preserves one aggregate with no stale/extra score records.

## Existing setup — reuse it

- `packages/dtx-api/src/db/queries.integration.test.ts` already runs Miniflare D1, applies all numbered migrations from `dtx-api/d1-migrations`, resets schema per test, and seeds `user-1` / chart `1`. Add **one `it()`** inside its existing `describe('upsertChartScoreAndReplaceScores (real D1)')`; reuse `db`, `scoreInput` and `defaultChartScoreFields`.
- `packages/dtx-api/src/db/queries.ts` writes a chart aggregate, DELETEs prior scores and INSERTs replacements as one D1 batch. `getUserChartScore` already orders by `is_best DESC, display_order ASC`.
- `queries.integration.test.ts` already covers a single replacement, aggregate upsert, TOCTOU, and negative tests for partial unique indexes `idx_scores_one_best` and `idx_scores_display_order`. `queries.test.ts` covers mock statement shapes. **Do not repeat those tests** or create another harness.
- `0002_scores.sql` and `0007_score_semantics.sql` define the real constraints. Keep best-row rate/rank/cleared/performed-at/display-order **NULL**; chart-level rate/rank live on `chart_scores`.

## Single test fixture

| Write | Data | Purpose |
| --- | --- | --- |
| First insert | `playCount=2`, `clearCount=1`; best score `700000`, recent order 1 | Initial chart-score and two children |
| First replace | `playCount=5`, `clearCount=3`; best `800000`, recents at orders 1 and 2 | Overwrite earlier children |
| Final replace | `playCount=9`, `clearCount=7`, `fullCombo=true`, `maxCombo=913`, `bestAchievementRate=98.5`, `bestRankLabel='SS'`, a fixed `lastPlayedAt`; best `990000` and two recents, **inserted order 2 then order 1** | Verify final bindings, replacement, and read ordering |

Use **pairwise-distinct judgment sentinels within each final score row** to catch swapped bind positions, not elaborate phase-one/two fixtures. For example:
- Best: `score=990000`, `perfect=501`, `great=402`, `good=303`, `poor=204`, `miss=105`; score-level `achievement_rate`, `rank_label`, `cleared`, `performed_at`, `display_order` are NULL.
- Recent **order 2** (inserted first): `achievement_rate=83.25`, `rank_label='A'`, `cleared=false`, `perfect=31`, `great=22`, `good=13`, `poor=4`, `miss=1`, `performed_at='2026-10-02T14:00:00Z'`.
- Recent **order 1** (inserted second): `achievement_rate=94.5`, `rank_label='S'`, `cleared=true`, `perfect=61`, `great=42`, `good=23`, `poor=4`, `miss=2`, `performed_at='2026-10-03T16:00:00Z'`.

Leave recent `score` values NULL and use `scoreInput` defaults where possible. Set `lastPlayedAt` to a distinctive fixed value. The false/true `cleared` pair specifically verifies `false` binds as `0`, not NULL.

## Minimal assertions

1. All three writes return the **same** `chart_scores.id`. Assert the final chart-level fields with `toMatchObject` on the third result (do not compare generated `created_at`/`updated_at` with a full-row `toEqual`). Optionally confirm `third.created_at === first.created_at` to verify the conflict update preserves creation time.
2. Call `getUserChartScore(db, 'user-1', 1)` **once**; project each score row to remove generated `id`, `chart_score_id` and `created_at`, then `toEqual` the exact ordered `[best, recentOrder1, recentOrder2]` values, including nulls, booleans (0/1), rank, rates, judgments, and timestamps. This single assertion proves best uniqueness and distinct display orders; the existing negative index tests enforce the actual constraints.
3. Assert `SELECT COUNT(*) AS cnt FROM scores` **without WHERE** returns `3`, and `SELECT COUNT(*) AS cnt FROM chart_scores` returns `1`. The setup contains no other scores. Together with the three retrieved rows and real-D1 foreign-key constraints, these counts rule out stale rows under any ID or orphaned score records. **Do not add a `LEFT JOIN ... WHERE cs.id IS NULL` assertion:** Miniflare enforces the foreign key, and this case never deletes `chart_scores`; the join would add no useful signal.

## Guardrails and acceptance

- Only the existing API integration test changes in the implementation phase. No production SQL, schema, migrations, new mocks/helpers/frameworks, dependencies, CI jobs, GraphQL, or cross-package refactors.
- Keep existing mock and partial-unique-index tests intact. Do not expand test coverage outside the requested three-write regression.
- The focused integration test, API test suite, and API typecheck should pass. **Put observed commands/results in the PR description**, not duplicated in this design and plan. Keep both docs stable unless design decisions actually change.
