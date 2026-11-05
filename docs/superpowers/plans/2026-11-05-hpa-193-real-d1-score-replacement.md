# HPA-193 — Real-D1 Score Replacement Implementation Plan

**Date:** 2026-11-05  
**Status:** Draft — implementation not yet started  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Design:** [Real-D1 score replacement design](../specs/2026-11-05-hpa-193-real-d1-score-replacement-design.md)

> **Single-PR delivery:** This PR begins with the design and plan. Add the test and verification results to **this same branch and PR**, not another ticket or PR. Keep it draft until implementation has been reviewed.

## Exact scope

| File | Action |
| --- | --- |
| `packages/dtx-api/src/db/queries.integration.test.ts` | Add **one** three-write real-D1 regression using existing setup and helpers. |
| `docs/superpowers/specs/2026-11-05-hpa-193-real-d1-score-replacement-design.md` | Keep decisions synchronized if implementation discovers a mismatch. |
| This plan | Record verification results and any narrow deviations. |

No changes expected to `queries.ts`, `queries.test.ts`, migrations, schema, Miniflare/Vitest configuration, dependencies, or CI.

## Step 1 — Confirm the test seam

1. Start implementation from the latest main state on this same PR branch. Confirm `queries.integration.test.ts` still owns the Miniflare D1 setup, runs the numbered migrations including `0002_scores.sql` and `0007_score_semantics.sql`, and seeds `user-1` / chart `1` in `beforeEach`.
2. Confirm the current `ScoreInsert` shape and canonical best-row restrictions in `queries.ts` / `0007_score_semantics.sql`. Keep `scoreInput(...)` and `defaultChartScoreFields`; do not create an alternative factory or migrate any test to `@dtx/common`.
3. Check that no equivalent **three-write** regression has landed since the design. If it already fully satisfies HPA-193, point to that evidence rather than adding duplicate test code.

## Step 2 — Add one three-write test

Add `it('keeps only the final scores across insert, replace, replace', async () => { ... })` alongside the existing insertion/replacement tests under `describe('upsertChartScoreAndReplaceScores (real D1)')`.

1. **Insert:** call `upsertChartScoreAndReplaceScores(db, ...)` with chart 1/user-1, `(playCount, clearCount)=(2, 1)`, and two scores: best `700000` plus recent order 1.
2. **Replace:** call again for the same pair with `(5, 3)`, best `800000`, and recents at orders 1 and 2. Use distinct rates/ranks/timestamps so stale data can be detected.
3. **Replace again:** call with `(9, 7)`, `fullCombo=true`, `maxCombo=913`, `bestAchievementRate=98.5`, `bestRankLabel='SS'`, and a distinctive `lastPlayedAt`. Insert best `990000` with distinctive `perfect/great/good/poor/miss`, then **recent order 2 before recent order 1** in the input array. Give both recents different achievement rates, rank labels, cleared states (false/true), timestamps, and judgments.
4. Store the return values (`first`, `second`, `third`); do not depend on arbitrary AUTOINCREMENT score-row IDs. Respect canonical best metadata (best rate/rank belong on `chart_scores`; best row's `achievement_rate`, `rank_label`, `cleared`, `performed_at`, `display_order` stay null).

## Step 3 — Assert persisted results, not just the batch call

1. Assert `first.id === second.id === third.id`. Query `chart_scores` by `(user_id, chart_id)`, assert exactly one row and the final aggregate values.
2. Fetch with `getUserChartScore(db, 'user-1', 1)` and check exact ordered projections: best `990000` first, then recent order 1, then recent order 2, even though they were inserted in reverse order. Assert all distinct final bind sentinels, nullable fields, and numeric stored booleans (`0`/`1`).
3. Read the persisted `scores` directly with a constrained `WHERE chart_score_id = ?`; assert exactly three rows, all referencing `third.id`, and no values unique to either old write. Query the count of `is_best = 1` rows and expect `1`.
4. Run `SELECT COUNT(*) AS cnt FROM scores s LEFT JOIN chart_scores cs ON cs.id = s.chart_score_id WHERE cs.id IS NULL` and expect `0`. This checks that no old replacement left an orphan, without adding FK test machinery.
5. Keep existing separate real-D1 tests that attempt duplicate best and duplicate non-null `display_order`; they provide the explicit negative coverage for `idx_scores_one_best` and `idx_scores_display_order`. Do not repeat those constraint violations in this already-focused scenario.

## Step 4 — Verification and PR completion

Run from repo root after the implementation commit:

```bash
bun run --filter=dtx-api test -- src/db/queries.integration.test.ts
bun run --filter=dtx-api test
bun run --filter=dtx-api check
```

- Record actual test counts, pass/fail and any environmental blockers in this PR. Check formatter/linter feedback for the edited file; run the existing lint command if required by CI.
- Confirm `git diff` contains one added integration test (plus these planning docs); no new harness, package, D1 migration, schema change, or production SQL. The independent mock and unique-index tests must remain present and green.
- Existing PR CI is enough for this test-only change; no Cloudflare deployment, data migration, browser E2E, desktop E2E, or cross-package testing is required.
- Update HPA-193 with this PR link and completion evidence; mark the issue done only once the implementation is merged.

## Stop conditions

- If the current D1 integration suite cannot run without a new framework, **stop and report the concrete blocker** under the Linear ticket's original KISS rule; do not build a generic harness.
- If a tested failure reveals a production defect, record the reproducer and review scope before changing `queries.ts`. A small fix may stay in this single PR with an updated design; do not silently enlarge this test-only plan.
- If a later main-branch commit already supplies the full requested regression, avoid duplicating it.
