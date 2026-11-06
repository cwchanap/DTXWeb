# HPA-193 — Real-D1 Score Replacement Implementation Plan

**Date:** 2026-11-05  
**Status:** Draft, revised after [GitHub design review](https://github.com/cwchanap/DTXWeb/pull/337#issuecomment-6673745114); implementation pending  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Design (authoritative fixture/assertions):** [Real-D1 regression design](../specs/2026-11-05-hpa-193-real-d1-score-replacement-design.md)

> **Single-PR delivery:** Add the test and its verification to **this PR #337**, not another PR. The design owns the fixture and assertions; don't maintain a second copy here.

## Work — one test only

**Modify:** `packages/dtx-api/src/db/queries.integration.test.ts`

1. **Check for duplication:** Compare latest `main` with the design. If a three-write regression already satisfies HPA-193, report that evidence rather than adding duplicate coverage.
2. **Add one `it()`:** Under the existing real-D1 `upsertChartScoreAndReplaceScores` describe, reuse its Miniflare/migration fixture and helpers. Perform three writes for the same user/chart as defined in the design. Keep early writes small; put distinguishable sentinels in every final score-row binding. Insert recent order 2 before order 1 and use `cleared=false` / `true`. Preserve the canonical best-row null fields.
3. **Verify without redundant SQL:** Assert returned aggregate ID stability and final chart-level fields via `toMatchObject` (ignore dynamic timestamps). Call `getUserChartScore` once, remove generated row fields in the projection, and `toEqual` exact **best → recent 1 → recent 2** contents. Finish with **unfiltered** `COUNT(*)` queries on `scores` (3) and `chart_scores` (1). Do not add a direct per-chart score query, duplicate best/order counts, or a foreign-key orphan `LEFT JOIN`.
4. **Leave existing coverage intact:** The real-D1 negative partial-index tests and mock statement-shape tests already exist; do not duplicate or move them. No production query change, migration, CI job, new fixture factory, dependency, or testing harness is planned.

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
