# HPA-308 Score Import Semantics — Design

**Date:** 2026-08-14
**Status:** Proposed for implementation
**Linear:** HPA-308

## 1. Problem

The desktop score importer currently constructs one `is_best = true` `Score` row from fields in DTXManiaCX `SongScores` that do not all describe the same play.

`packages/dtx-desktop/src-tauri/src/scores.rs::build_best` currently combines:

- `BestScore`, `BestAchievementRate`, and `BestPerfect/BestGreat/BestGood/BestPoor/BestMiss`, which are updated together for the highest-scoring play;
- `FullCombo`, which is cumulative and stays true after any full-combo play;
- `MaxCombo`, which is an independent all-time maximum;
- `ClearCount > 0`, which means the chart has ever been cleared;
- `LastPlayedAt`, which is the most recent play timestamp.

The resulting row is persisted and rendered as if it were one historical performance even though that performance may never have existed.

The original score-page design already has the correct high-level seam: `chart_scores` owns per-user chart aggregates while `scores` owns individual score/history rows. HPA-308 should correct the data semantics at that seam rather than introduce another score model.

## 2. Source-data constraints

The current DTXManiaCX data model determines what can be represented truthfully.

### `SongScores`

DTXManiaCX writes the following together when `BestScore` improves:

- `BestScore`
- `BestAchievementRate`
- `BestPerfect`
- `BestGreat`
- `BestGood`
- `BestPoor`
- `BestMiss`

These fields may therefore remain on DTXWeb's best `Score` row.

The following are independent chart-wide facts and must not remain on that row:

- `FullCombo`: whether any play has full-comboed the chart;
- `MaxCombo`: maximum combo across all plays;
- `PlayCount`: total plays;
- `ClearCount`: total clears;
- `LastPlayedAt`: timestamp of the latest play, not the best-scoring play.

### `PerformanceHistory`

Current DTXManiaCX `PerformanceHistory` stores only:

- `PerformedAt`
- `HistoryLine`
- `DisplayOrder`
- song / score identity and pitch metadata

`HistoryLine` can provide result (`Cleared` / `Failed`), rank, and achievement rate. It does **not** preserve the numeric score or judgment breakdown for that play.

Therefore HPA-308 cannot recover a complete historical play that produced `BestScore`. Attempting to match the best score to `PerformanceHistory` would invent information that is not stored.

## 3. Goals

- Never present chart-wide or latest-play facts as properties of the best-scoring play.
- Preserve all trustworthy information already available from DTXManiaCX.
- Keep the existing `ChartScore` + `Score` architecture and replace semantics in place.
- Represent an unknown per-play result as unknown, not as `Failed`.
- Keep the implementation small enough to land as one focused score-contract change.

## 4. Non-goals

- Store a full unbounded play history.
- Change DTXManiaCX to record richer history.
- Add leaderboards or public score data.
- Redesign score matching, upload batching, or the score-page layout.
- Add a compatibility layer for old GraphQL clients or old local payload shapes.

## 5. Chosen model

### 5.1 `ChartScore` owns chart-wide aggregates

Extend `chart_scores` with:

```text
playCount   = SongScores.PlayCount
clearCount  = SongScores.ClearCount
fullCombo   = SongScores.FullCombo        // ever full-comboed
maxCombo    = SongScores.MaxCombo         // all-time maximum
```

`fullCombo` and `maxCombo` move here because their source values are chart-wide aggregates, just like the existing play and clear counts.

`maxCombo` is a non-negative integer with default `0`; there is no useful semantic distinction between `NULL` and zero in the source database.

### 5.2 Best `Score` contains only one coherent best-score stat block

The best row remains because the existing API, persistence ordering, and web presentation already model a distinguished best score cleanly.

It contains:

```text
isBest           = true
score            = SongScores.BestScore
achievementRate  = SongScores.BestAchievementRate
rankLabel        = derived from BestAchievementRate
perfect/great/good/poor/miss = SongScores.Best* stat block
cleared          = null
performedAt      = null
displayOrder     = null
```

`cleared` is unknown because `ClearCount > 0` says only that *some* play cleared the chart. `performedAt` is unknown because `LastPlayedAt` is the latest play, not the time the best score was achieved.

`fullCombo` and `maxCombo` are removed from `Score` entirely.

### 5.3 Recent `Score` rows remain history-derived

Recent rows continue to contain only data available from `PerformanceHistory`:

```text
isBest           = false
score            = null
achievementRate  = parsed from HistoryLine when available
rankLabel        = parsed from HistoryLine when available
cleared          = true | false | null
perfect/great/good/poor/miss = null
performedAt      = PerformanceHistory.PerformedAt
displayOrder     = normalized 1..5
```

A malformed or unfamiliar `HistoryLine` produces `cleared = null`. It must no longer fall back to `false`, because “could not parse result” is not equivalent to “failed”.

## 6. Persistence change

Add `packages/dtx-api/d1-migrations/0007_score_semantics.sql`.

The migration should:

1. Add `full_combo INTEGER NOT NULL DEFAULT 0 CHECK (full_combo IN (0, 1))` to `chart_scores`.
2. Add `max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= 0)` to `chart_scores`.
3. Backfill both fields from the existing best score row. Although those values are incorrectly *located* today, the values themselves already come from DTXManiaCX's chart-wide `FullCombo` and `MaxCombo` fields and are valid aggregate data.
4. Rebuild `scores` without the `full_combo` and `max_combo` columns.
5. Make `scores.cleared` nullable with `CHECK (cleared IS NULL OR cleared IN (0, 1))`.
6. While copying existing rows, set `cleared = NULL` and `performed_at = NULL` for `is_best = 1`; preserve recent-row values and the trustworthy best-score stat block.
7. Recreate the existing score indexes and constraints.

This is intentionally a breaking schema cleanup. There is no compatibility table, duplicate write path, or transitional field alias.

## 7. Common DB contract

Update the shared D1 types and query layer to match the new ownership:

```ts
interface ChartScoreRow {
  // existing fields
  play_count: number;
  clear_count: number;
  full_combo: 0 | 1;
  max_combo: number;
}

interface ScoreRow {
  // existing per-play fields
  cleared: 0 | 1 | null;
  // no full_combo
  // no max_combo
}

interface ScoreInsert {
  cleared?: boolean | null;
  // no full_combo
  // no max_combo
}
```

`upsertChartScoreAndReplaceScores` gains `fullCombo` and `maxCombo` parameters, persists them in the existing atomic chart-score upsert, and removes those values from score inserts.

## 8. GraphQL contract

### `ChartScore`

Add:

```graphql
fullCombo: Boolean!
maxCombo: Int!
```

### `Score`

Change:

```graphql
cleared: Boolean
```

Remove:

```graphql
fullCombo
maxCombo
```

### Upload input

`ChartScoresInput` gains required `fullCombo` and `maxCombo` fields. `ScoreInput.cleared` becomes nullable, and `ScoreInput` no longer accepts `fullCombo` or `maxCombo`.

The API keeps requiring exactly one best row for a non-empty chart upload. Before persistence it canonicalizes the best row so `cleared`, `performedAt`, and `displayOrder` are `null`. This makes the server contract enforce the semantic rule even if a future desktop client accidentally sends stale per-play values.

No versioned GraphQL input is introduced.

## 9. Desktop importer and uploader

### Rust parser

Change the parsed shape to:

```rust
pub struct ScorePayload {
    pub is_best: bool,
    pub score: Option<i64>,
    pub achievement_rate: Option<f64>,
    pub rank_label: Option<String>,
    pub cleared: Option<bool>,
    pub perfect: Option<i64>,
    pub great: Option<i64>,
    pub good: Option<i64>,
    pub poor: Option<i64>,
    pub miss: Option<i64>,
    pub performed_at: Option<String>,
    pub display_order: Option<i64>,
}

pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
    pub full_combo: bool,
    pub max_combo: i64,
}
```

`build_best` uses only the coherent best-score fields and sets `cleared` / `performed_at` to `None`.

`group_joined_rows` maps `SongScores.FullCombo` and `SongScores.MaxCombo` into `ChartAggregate`, and recent rows forward `parse_history_line(...).cleared` directly instead of `unwrap_or(false)`.

### Renderer

Update the renderer types to the same shape. `buildUpload` sends `fullCombo` and `maxCombo` beside `playCount` and `clearCount` at chart level.

The desktop score preview shows chart-wide full-combo/max-combo next to the existing play/clear aggregate summary. The best line shows only score/rank/achievement. Recent plays render:

- green `Cleared` for `true`;
- red `Failed` for `false`;
- a neutral dash for `null`.

No new interaction or navigation is added.

## 10. Web presentation

The scored-simfiles query requests `fullCombo` and `maxCombo` from `myChartScore` rather than each `Score`.

The web adapter mirrors the GraphQL ownership:

- `ChartScoreView` gains `fullCombo` and `maxCombo`;
- `ScoreView.cleared` becomes `boolean | null`;
- `ScoreView` drops `fullCombo` / `maxCombo`.

`ScoreCard` renders the full-combo badge and max-combo value at chart-summary level. The best block remains score/rank/achievement/judgments. Recent result text uses the same true / false / unknown tri-state as desktop.

## 11. Invariants

After HPA-308:

1. A field on an individual `Score` row must be attributable to that represented play/stat block.
2. Chart-wide cumulative values live only on `ChartScore`.
3. The best row never claims a clear result or performed timestamp that DTXManiaCX cannot source.
4. An unparseable recent outcome remains unknown instead of becoming a failure.
5. Upload remains replace-all and atomic per `(user, chart)` exactly as today.
6. Best + recent ordering and the five-recent-row cap do not change.

## 12. Alternatives considered

### Move all best data onto `ChartScore`

This is semantically clean but causes unnecessary churn: `is_best`, best-first ordering, score rendering, and existing API helpers would all need restructuring even though the score/stat block is internally coherent. It solves more than HPA-308 requires.

### Keep the current schema and only hide misleading fields in the UI

This is the smallest visual diff but leaves the persisted/API model lying about ownership. Other consumers could still interpret the synthetic row as a real play, so it does not fix the bug at its source.

### Recover the exact best play from `PerformanceHistory`

Not possible with the current DTXManiaCX schema. History does not store the numeric score or judgment block needed to identify/reconstruct the best-scoring play.

## 13. Verification strategy

The implementation should pin the semantics at each boundary:

- migration/schema parity and D1 replacement tests;
- GraphQL validation/query tests for chart aggregates and nullable result;
- Rust parser tests proving best fields are not mixed and malformed history yields unknown;
- desktop renderer tests for chart-level aggregate display and tri-state history result;
- web adapter/component tests for the same contract;
- existing score upload, score-page, and D1 integration suites remain green.

No new E2E scenario is required unless an existing score E2E fixture fails to express the new contract; the behavior is fully covered by the existing score flow plus focused boundary tests.