# HPA-193 — Real-D1 Score Replacement Implementation Plan

**Date:** 2026-11-05  
**Status:** Draft, revised after [design review Revision 2](https://github.com/cwchanap/DTXWeb/pull/337#pullrequestreview-5795402409); implementation pending  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Design (authoritative fixture/assertions):** [Real-D1 regression design](../specs/2026-11-05-hpa-193-real-d1-score-replacement-design.md)

> **Single-PR delivery:** Add the test and its verification to **this PR #337**, not another PR. The design owns the fixture and assertions; don't maintain a second copy here.

## Work — one test only

**Modify:** `packages/dtx-api/src/db/queries.integration.test.ts`

1. **Add one `it()`:** Under the existing real-D1 `upsertChartScoreAndReplaceScores` describe, reuse its Miniflare/migration fixture and helpers. Perform the three writes from the design. Keep early writes small; make final score-row judgment sentinels distinct and set **`display_order: 2` before `display_order: 1`** explicitly in the recent-score inputs, with `cleared=false` / `true`. Respect the canonical best-row null fields.
2. **Verify the aggregate:** Assert all three writes preserve the same ID, **require `expect(third.created_at).toBe(first.created_at)`**, and use `toMatchObject` for final chart-level values rather than matching dynamic timestamps.
3. **Verify the child rows without redundant SQL:** Call `getUserChartScore` once, omit only generated row fields (`id`, `chart_score_id`, `created_at`), and `toEqual` the three exact **SQLite-typed expected objects** in the design in **best → recent 1 → recent 2** order. Finish with unfiltered `COUNT(*)` queries on `scores` (3) and `chart_scores` (1). No duplicate direct score query, per-index counts, or orphan `LEFT JOIN`.
4. **Leave existing coverage intact:** The real-D1 negative partial-index tests and mock statement-shape tests already exist; do not duplicate or move them. No production query change, migration, CI job, fixture factory, dependency, or testing harness is planned.

## Verification

Run from the repo root **after** committing the test:

```bash
bun run --filter=dtx-api test -- src/db/queries.integration.test.ts
bun run --filter=dtx-api test
bun run --filter=dtx-api check
```

Check formatting/lint feedback for the changed file. Confirm the implementation diff adds just the one test. Record actual test totals, failures, and any blockers **in PR #337's description**; update these planning docs only if the design itself changes. Keep this PR draft until the test is reviewed. No Cloudflare migration/deployment or web/desktop E2E is required.

## Stop conditions

- If this needs a new shared testing harness, **stop and document the blocker** per HPA-193 rather than adding infrastructure.
- If the test reproduces a production bug, report the evidence before changing `queries.ts`. A small necessary fix may remain on this **same PR** after revising the design.
- Do not mark the Linear ticket complete until implementation is merged.
