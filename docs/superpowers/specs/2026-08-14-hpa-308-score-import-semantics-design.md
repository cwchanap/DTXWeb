# HPA-308 Score Import Semantics — Design

**Date:** 2026-08-14
**Status:** Proposed for implementation
**Linear:** HPA-308

## 1. Problem

The desktop score importer currently constructs one `is_best = true` `Score` row from DTXManiaCX `SongScores` fields that do not all describe the same play.

`packages/dtx-desktop/src-tauri/src/scores.rs::build_best` currently combines:

- `BestScore` and `BestPerfect/BestGreat/BestGood/BestPoor/BestMiss`;
- `BestAchievementRate` and a rank derived from it;
- cumulative `FullCombo`;
- all-time `MaxCombo`;
- `ClearCount > 0`;
- latest-play `LastPlayedAt`.

The modern DTXManiaCX gameplay writer does **not** update all of these under one condition. The resulting DTXWeb row can therefore combine multiple chart records and the latest play while presenting them as one historical performance.

The original score-page design already has the correct high-level seam: `chart_scores` owns per-user chart aggregates while `scores` owns individual best/recent rows. HPA-308 should correct ownership at that seam rather than add another score model.

## 2. Source-data constraints

The current DTXManiaCX writers determine what can be represented truthfully.

### 2.1 Modern gameplay writer

`SongDatabaseService.SaveScoreTransactionAsync` updates these when the numeric score improves:

- `BestScore`
- `BestPerfect`
- `BestGreat`
- `BestGood`
- `BestPoor`
- `BestMiss`
- `TotalNotes`

That is the best-score stat block DTXWeb can keep on the distinguished best `Score` row.

The same writer updates other fields independently:

- `BestRank` is the maximum normalized playing-skill rank.
- `MaxCombo` is `Math.Max(...)` across plays.
- `FullCombo` is cumulative OR across qualifying plays.
- `BestAchievementRate` changes only when `GameSkill` exceeds `HighSkill`; it is the playing-skill/achievement value associated with that best-skill record, not necessarily the `BestScore` play.
- `PlayCount` and `ClearCount` are cumulative counters.
- `LastPlayedAt` is overwritten on every saved play.

Therefore `BestAchievementRate`, its rank label, `FullCombo`, `MaxCombo`, `PlayCount`, `ClearCount`, and `LastPlayedAt` are chart-level facts for DTXWeb's purposes.

The older overload `UpdateScoreAsync(chartId, instrument, newScore, achievementRate, fullCombo)` can update `BestScore` without writing the `BestPerfect...BestMiss` block. HPA-308 does not attempt to reconstruct historical rows written through that legacy path; the supported modern gameplay path and NX import path keep the numeric best score/stat block together.

### 2.2 NX import path

`NxScoreImporter` writes `BestScore`, the `BestPerfect...BestMiss` block, and `BestAchievementRate` together when importing a higher NX best score. That import-specific coupling does not override the semantics of the normal gameplay writer above, so DTXWeb must model the fields according to the broader `SongScores` contract rather than the NX path alone.

### 2.3 `PerformanceHistory`

Current DTXManiaCX `PerformanceHistory` stores only:

- `PerformedAt`
- `HistoryLine`
- `DisplayOrder`
- song / score identity and pitch metadata

`HistoryLine` can provide result (`Cleared` / `Failed`), rank, and achievement rate. It does **not** preserve the numeric score or judgment breakdown for that play.

Therefore HPA-308 cannot recover a complete historical play that produced `BestScore`, and it cannot match `BestAchievementRate` or `LastPlayedAt` back to that play without inventing information.

## 3. Goals

- Never present chart-wide, best-skill, or latest-play facts as properties of the best-scoring play.
- Preserve trustworthy DTXManiaCX data instead of dropping it when ownership changes.
- Keep the existing `ChartScore` + `Score` architecture and atomic replace semantics.
- Represent an unknown per-play result as unknown, not as `Failed`.
- Enforce the best-row semantic invariant both in the API and in D1.
- Keep the implementation small enough to land as one focused score-contract change.

## 4. Non-goals

- Store a full unbounded play history.
- Change DTXManiaCX to record richer history.
- Repair historical judgment blocks written through the legacy score-service overload.
- Add leaderboards or public score data.
- Redesign score matching, upload batching, pagination, or navigation.
- Add a compatibility layer, versioned GraphQL mutation, aliases, or dual-write path for old desktop/web clients.

## 5. Chosen model

### 5.1 `ChartScore` owns chart-wide records

Extend `chart_scores` with:

```text
playCount            = SongScores.PlayCount
clearCount           = SongScores.ClearCount
fullCombo            = SongScores.FullCombo
maxCombo             = SongScores.MaxCombo
bestAchievementRate  = SongScores.BestAchievementRate when finite/valid
bestRankLabel        = rank derived from bestAchievementRate
lastPlayedAt         = SongScores.LastPlayedAt
```

`fullCombo`, `maxCombo`, `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt` move beside the existing counters because they are chart records, not guaranteed properties of the `BestScore` play.

`maxCombo` is a non-negative integer with default `0`. `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt` are nullable because the current importer already tolerates invalid/non-finite rate data and older databases may not carry a timestamp.

### 5.2 Best `Score` contains only the best-score stat block

The distinguished best row remains because the existing persistence ordering, API shape, and presentation already model one numeric best score cleanly.

It contains:

```text
isBest           = true
score            = SongScores.BestScore
perfect/great/good/poor/miss = SongScores.Best* stat block
achievementRate  = null
rankLabel        = null
cleared          = null
performedAt      = null
displayOrder     = null
```

The chart-level best achievement/rank is still available through `ChartScore`; it is simply no longer represented as if it belonged to the best-score play.

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
3. Add nullable `best_achievement_rate REAL CHECK (best_achievement_rate IS NULL OR (best_achievement_rate >= 0 AND best_achievement_rate <= 100))`.
4. Add nullable `best_rank_label TEXT CHECK (best_rank_label IS NULL OR best_rank_label IN ('SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'))`.
5. Add nullable `last_played_at TEXT`.
6. Backfill those five fields from the existing best score row. Their values are already sourced from `SongScores`; only their current location is wrong.
7. Rebuild `scores` without `full_combo` and `max_combo`.
8. Keep `achievement_rate` and `rank_label` columns for recent rows, but set them to `NULL` on the best row during the copy.
9. Make `scores.cleared` nullable with `CHECK (cleared IS NULL OR cleared IN (0, 1))`.
10. Set best `cleared`, `performed_at`, and `display_order` to `NULL` during the copy.
11. Add a table-level invariant:

```sql
CHECK (
  is_best = 0 OR (
    achievement_rate IS NULL AND
    rank_label IS NULL AND
    cleared IS NULL AND
    performed_at IS NULL AND
    display_order IS NULL
  )
)
```

12. Recreate the existing score indexes and constraints.

The migration must preserve score IDs and the table's autoincrement sequence while rebuilding `scores`.

This is intentionally a breaking schema cleanup. There is no compatibility table, duplicate write path, or transitional field alias.

## 7. Common DB contract

Update shared D1 types and the query layer to match the ownership:

```ts
interface ChartScoreRow {
	// existing fields
	play_count: number;
	clear_count: number;
	full_combo: 0 | 1;
	max_combo: number;
	best_achievement_rate: number | null;
	best_rank_label: string | null;
	last_played_at: string | null;
}

interface ScoreRow {
	// score + judgment/recent fields remain
	achievement_rate: number | null;
	rank_label: string | null;
	cleared: 0 | 1 | null;
	// no full_combo
	// no max_combo
}
```

`upsertChartScoreAndReplaceScores` gains chart-level `fullCombo`, `maxCombo`, `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt` parameters. It persists them in the existing chart-score upsert and preserves nullable `ScoreInsert.cleared` without converting `null` to `0`.

The replace-all D1 batch and visibility gate stay unchanged.

## 8. GraphQL contract

### `ChartScore`

Add:

```graphql
fullCombo: Boolean!
maxCombo: Int!
bestAchievementRate: Float
bestRankLabel: String
lastPlayedAt: String
```

### `Score`

Keep recent-capable fields but change:

```graphql
cleared: Boolean
```

Remove:

```graphql
fullCombo
maxCombo
```

A best `Score` resolves `achievementRate`, `rankLabel`, `cleared`, `performedAt`, and `displayOrder` as `null` because the server canonicalizes those fields before persistence.

### Upload input

`ChartScoresInput` gains required `fullCombo` and `maxCombo`, plus nullable `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt`. `ScoreInput.cleared` becomes nullable, and `ScoreInput` no longer accepts `fullCombo` or `maxCombo`.

The API validates chart-level rate/rank/max-combo values, keeps exactly-one-best and recent-row rules, and canonicalizes every best row to:

```text
achievementRate = null
rankLabel       = null
cleared         = null
performedAt     = null
displayOrder    = null
```

This extends the existing best-`displayOrder` cleanup seam rather than adding another normalization pipeline.

No versioned GraphQL input is introduced.

## 9. Desktop importer and uploader

### Rust parser

Keep one `ScorePayload` for best/recent rows, but make the best row sparse and move chart records into `ChartAggregate`:

```rust
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
    pub full_combo: bool,
    pub max_combo: i64,
    pub best_achievement_rate: Option<f64>,
    pub best_rank_label: Option<String>,
    pub last_played_at: Option<String>,
}
```

`build_best` emits only `BestScore` plus the `BestPerfect...BestMiss` stat block and sets rate/rank/result/timestamp/order to `None`.

`group_joined_rows` moves `SongScores.FullCombo`, `MaxCombo`, `BestAchievementRate`, derived rank, and `LastPlayedAt` into `ChartAggregate`. Recent rows forward `parse_history_line(...).cleared` directly instead of `unwrap_or(false)`.

### Renderer

Update renderer types to the same shape. `buildUpload` sends all chart records beside `playCount` / `clearCount`.

The local score preview must not recombine the independent records into one fake performance:

- best-score line: numeric best score + judgment block only;
- chart-record summary: best achievement/rank, max combo, full-combo state, play/clear counters;
- recent rows: history-derived rate/rank/result/time.

`lastPlayedAt` is retained in the local aggregate and upload contract even if the existing compact preview does not add new copy for it in this ticket.

## 10. Web presentation

The scored-simfiles query requests the new chart records from `myChartScore`.

The web adapter mirrors GraphQL ownership:

- `ChartScoreView` gains `fullCombo`, `maxCombo`, `bestAchievementRate`, `bestRankLabel`, and `lastPlayedAt`;
- `ScoreView.cleared` becomes `boolean | null`;
- `ScoreView` no longer owns `fullCombo` / `maxCombo`;
- best `ScoreView.achievementRate` / `rankLabel` remain nullable and are `null` for the best row.

`ScoreCard` keeps best score/judgments separate from the chart-record summary. Best achievement/rank, full combo, and max combo are rendered from `ChartScore`; recent result text uses the same true / false / unknown tri-state as desktop.

`lastPlayedAt` remains available to the web view model/API without requiring a new presentation element in this focused semantics fix.

## 11. Database and API invariants

After HPA-308:

1. A field on an individual best `Score` row must belong to the supported best-score stat block.
2. Chart-wide/best-skill/latest-play records live on `ChartScore`.
3. A persisted best row has `achievement_rate`, `rank_label`, `cleared`, `performed_at`, and `display_order` all `NULL`.
4. The API canonicalizer and D1 CHECK enforce the same best-row rule.
5. An unparseable recent outcome remains unknown instead of becoming a failure.
6. Upload remains replace-all and atomic per `(user, chart)` exactly as today.
7. Best + recent ordering and the five-recent-row cap do not change.

## 12. Deployment contract

This is deliberately breaking, so there is no zero-downtime compatibility phase.

The existing API deploy script already applies D1 migrations before deploying the Worker. Deployment order is therefore:

1. Preproduction API (migration + Worker).
2. Preproduction web immediately after the API.
3. Smoke the existing score upload/query/page flow.
4. Production API (migration + Worker).
5. Production web immediately after the API.
6. Desktop release last so new clients send the required chart-level fields.

There is an unavoidable short API→web validation window because the old web query selects fields removed from `Score`; reversing the order would make the new web query invalid against the old API.

Existing installed desktop builds will fail `uploadScores` at GraphQL validation after the API cutover because they do not send the newly required chart-level inputs. That loud failure is accepted instead of adding a compatibility mutation. The desktop updater release should follow the web deployment immediately.

## 13. Alternatives considered

### Put the entire best block on `ChartScore`

This causes unnecessary churn to `is_best`, score ordering, recent-row storage, and existing helpers. Keep the numeric best-score/stat-block row and move only the independent records.

### Keep `BestAchievementRate` on the best row because NX import writes it with `BestScore`

Rejected. The normal gameplay writer updates `BestAchievementRate` under the independent best-skill condition. The broader `SongScores` semantics govern DTXWeb, not one import path.

### Drop `LastPlayedAt`

Rejected. It is trustworthy latest-play data and is currently imported; moving it to `ChartScore` costs one column now and avoids silently losing the value when the best row is canonicalized.

### Keep the current schema and only hide misleading fields in the UI

Rejected because persistence/API consumers would still see the synthetic row.

### Recover the exact best play from `PerformanceHistory`

Not possible with the current history schema because it lacks score/judgment data.

## 14. Verification strategy

The implementation must pin semantics at each existing boundary:

- migration/schema parity across `0002 + 0007`;
- a real migration regression that applies `0001`–`0006`, seeds old-shape data, then applies `0007` and checks all five chart-record backfills plus best-row nulling;
- D1 CHECK coverage for the best-row invariant;
- GraphQL validation/query tests for chart records and canonicalized best metadata;
- Rust parser tests proving `BestAchievementRate`/rank and `LastPlayedAt` move to `ChartAggregate`, while malformed recent history remains unknown;
- desktop renderer/upload tests for separated chart records and best-score data;
- web adapter/component/page fixtures for the same ownership;
- the existing Playwright score upload/query/page scenario updated to the breaking contract;
- deployment commands ordered API → web → desktop, first in preproduction and then production.

No new table, history model, evaluator, registry, versioned input, or E2E scenario is required.
