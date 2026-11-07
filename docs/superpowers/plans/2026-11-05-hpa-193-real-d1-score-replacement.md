# HPA-193 — Real-D1 Score Replacement Implementation Plan

**Date:** 2026-11-05  
**Status:** Implemented in PR #337; revised after code review  
**Linear:** https://linear.app/cwchanap/issue/HPA-193/dtxwebquality-add-one-real-d1-score-replacement-test  
**Design (authoritative fixture/assertions):** [Real-D1 regression design](../specs/2026-11-05-hpa-193-real-d1-score-replacement-design.md)

> **Single-PR delivery:** Add the test and its verification to **this PR #337**, not another PR. The design owns the fixture and assertions; don't maintain a second copy here.

## Work — one test only

**Modify:** `packages/dtx-api/src/db/queries.integration.test.ts`

1. **Add one `it()`:** Under the existing real-D1 `upsertChartScoreAndReplaceScores` describe, reuse its Miniflare/migration fixture and helpers. Perform the three writes from the design. In write 2, populate slots 1, 2, and 3 along with chart-level values (`fullCombo: true`, `maxCombo: 950`, `bestRankLabel: 'A'`). In write 3, insert **`display_order: 2`, `display_order: 1`, then best**, clearing values (`fullCombo: false`, `bestRankLabel: null`, `maxCombo: 913`) and using distinct judgment sentinels with `cleared=false` / `true`. Respect the canonical best-row null fields.
2. **Verify the aggregate:** Assert all three writes preserve the same ID. Add a small delay before write 3 so millisecond timestamps advance; assert **`expect(third.created_at).toBe(first.created_at)`** and **`expect(Date.parse(third.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))`**. Use `toMatchObject` on the third result to verify cleared chart-level fields (`full_combo: 0`, `best_rank_label: null`, `max_combo: 913`).
3. **Verify the child rows without redundant SQL:** Call `getUserChartScore` once, omit generated row fields with rest destructuring (`{ id, chart_score_id, created_at, ...rest }`), and `toEqual` the three exact **SQLite-typed expected objects** in **best → recent 1 → recent 2** read order. Finish with an unfiltered `COUNT(*)` query on `scores` (3) proving slot 3 was cleared.
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
