# HPA-193 — Real-D1 Score Replacement Regression Design

**Date:** 2026-11-05  
**Status:** Draft — design only; implementation to follow on this same PR  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Delivery:** One PR for design, plan, implementation, and verification. Do not open a second PR.

## Goal

Prove that the existing `upsertChartScoreAndReplaceScores` operation retains only the latest score set after **insert → replace → replace** on real D1, with correct column bindings, sort order, one best row, and no orphaned scores.

## Current repository evidence

- The persistence function now lives in `packages/dtx-api/src/db/queries.ts` (moved from `@dtx/common/server` under HPA-617). It executes one `db.batch`: visible-chart-gated `chart_scores` upsert, delete of previous `scores`, and inserts whose `chart_score_id` resolves by `(user_id, chart_id)`.
- `packages/dtx-api/src/db/queries.integration.test.ts` already creates a Miniflare D1 database, applies numbered migrations from `packages/dtx-api/d1-migrations`, resets tables per test, and seeds `user-1` / chart `1`. Reuse its `db`, `scoreInput`, and `defaultChartScoreFields` helpers.
- The existing real-D1 suite verifies initial insertion, a **single** replacement, aggregate upsert, TOCTOU visibility, the `idx_scores_one_best` and `idx_scores_display_order` partial unique indexes, and the score read path. The three-write final-state regression is the missing focused scenario, not a reason to recreate any harness.
- `0002_scores.sql` creates score indexes and checks; `0007_score_semantics.sql` relocates chart-level fields and constrains best-row metadata. Both are already covered by the migration setup. `queries.test.ts` retains fast mock/statement-shape tests.

## One new integration scenario

Add a single `it(...)` case under the existing `describe('upsertChartScoreAndReplaceScores (real D1)')` in `queries.integration.test.ts`.

| Phase | Aggregate and score contents | Intent |
| --- | --- | --- |
| Insert | `playCount=2`, `clearCount=1`; best score `700000`; recent result at `display_order=1` | Establish first chart-score row and first child set. |
| First replace | `playCount=5`, `clearCount=3`; best `800000`; recents at orders `1` and `2` with different rate/rank values | Replace first set, changing row count and metadata. |
| Final replace | `playCount=9`, `clearCount=7`, `fullCombo=true`, `maxCombo=913`, chart best rate `98.5`, chart rank `SS`, a distinct last-played timestamp; best `990000` with distinct judgment counts; **insert recent order `2` before order `1`** with distinct rate, rank, cleared, and played-at values | Show final writes win and read-path ordering is independent of insert order. |

All phase values must satisfy the existing migration constraints. The best row includes numerical score/judgments but **no** achievement, rank, cleared, performed-at, or display-order fields; recent rows use their own nullable metadata. Use visibly different sentinels for `perfect`, `great`, `good`, `poor`, `miss`, `cleared`, `achievement_rate`, `rank_label`, and `performed_at` to expose bind-position mistakes.

## Assertions

1. The same `chart_scores.id` is returned by all three writes and exactly **one** aggregate exists for `(user-1, chart 1)`; its final chart-level values match phase three.
2. A direct `scores` query and/or existing `getUserChartScore` returns **only** the three final rows, in order: one best, then `display_order` 1 and 2. Exact selected fields match phase three (including `NULL`, 0/1 booleans, timestamps, and judgment counts). No phase-one/two sentinel score or recent metadata survives.
3. Count best rows for this chart-score ID and assert exactly one; count `display_order` values and assert they are distinct. The existing real-D1 negative tests already prove both **partial unique indexes reject duplicate inserts**; retain them without duplicating a framework or test matrix.
4. Run a `scores LEFT JOIN chart_scores` orphan query and assert zero rows where `chart_scores.id IS NULL`; all final rows reference the same surviving aggregate ID.

## Guardrails and non-goals

- Touch only the existing API integration test when implementing. Do not change production SQL, migrations, schema, GraphQL, CI configuration, workspace layout, packages, or lockfile.
- No shared Miniflare setup, new test helper abstraction, new package, or separate integration-test runner.
- Keep current mock tests and independent constraint tests. Do not add a second redundant suite just to repeat their coverage.
- Test the current source location in `dtx-api`, not historical `@dtx/common/server` paths.

## Acceptance

- One new real-D1 regression follows all three writes and asserts the complete final state, ordering, uniqueness, bind values, and absence of orphans.
- Existing real-D1 constraint tests continue to pass; no new infrastructure is added.
- Focused integration test, API test suite, and API typecheck pass in the implementation phase. Record actual results in this PR; do not claim tests passed while the PR contains only docs.
