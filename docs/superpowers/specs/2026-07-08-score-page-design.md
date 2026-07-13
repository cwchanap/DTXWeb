# Score Page (dtx-web + dtx-desktop) — Design

**Date:** 2026-07-08
**Status:** Approved for planning

## 1. Overview

Add a score-tracking feature spanning all three packages:

- **`dtx-desktop`** reads a DTXManiaCX `songs.db` (SQLite), parses each chart's **best** score plus up to **5 recent** plays (drums only), lets the user link each DTXMania song to one of their cloud simfiles, matches charts by difficulty, and uploads the scores to the API.
- **`dtx-api`** stores scores in Cloudflare D1 behind a new per-user intermediate table, exposed through GraphQL.
- **`dtx-web`** shows the signed-in user's own scores as a personal dashboard at `(app)/app/score`, grouped song → chart → scores.

### Relationship chain

```
Song (simfiles) →1:N  Chart (dtx_files) →1:N  ChartScore (per user) →1:N  Score (individual)
```

`dtx_files` stays a **global** chart definition. The new `chart_scores` intermediate row is **per (user, chart)** and holds the per-user aggregates. Individual `scores` (one best + up to five recent) hang off a `chart_scores` row. Different users therefore have independent aggregates and scores on the same shared chart, which also makes per-chart leaderboards possible later.

### Goals

- Parse DTXManiaCX scores on desktop and upload them to the user's account.
- Persist best + 5 recent individual scores per (user, chart), plus per-user play/clear aggregates.
- Personal score dashboard on web.

### Non-goals (v1)

- Guitar/bass scores (drums only — `Instrument = 0`).
- Public leaderboards / cross-user score viewing (schema is leaderboard-ready; UI is not built).
- Automatic file-hash chart matching (matching is via user-selected cloud-song link + difficulty).
- In-app (Phaser) gameplay writing scores directly — v1 imports from DTXManiaCX only.

## 2. Data model (D1)

New migration: `packages/dtx-api/d1-migrations/0002_scores.sql`. `dtx_files` is untouched.

```sql
-- Intermediate: one row per (user, chart) — holds per-user aggregates
CREATE TABLE IF NOT EXISTS chart_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id INTEGER NOT NULL,            -- FK dtx_files.id
    user_id TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    clear_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_id) REFERENCES dtx_files(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chart_scores_user_chart ON chart_scores(user_id, chart_id);
CREATE INDEX idx_chart_scores_chart ON chart_scores(chart_id);   -- leaderboard-ready

-- Individual scores (best + up to 5 recent) under a chart_score
CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_score_id INTEGER NOT NULL,      -- FK chart_scores.id
    is_best INTEGER NOT NULL DEFAULT 0,   -- marks the single best individual score
    score INTEGER,                        -- numeric score (nullable; see §5.2)
    achievement_rate REAL,                -- percentage 0–100
    rank_label TEXT,                      -- SS/S/A/B/C/D/E/F
    full_combo INTEGER NOT NULL DEFAULT 0,
    cleared INTEGER NOT NULL DEFAULT 0,
    max_combo INTEGER,
    perfect INTEGER, great INTEGER, good INTEGER, poor INTEGER, miss INTEGER,
    performed_at TEXT,
    display_order INTEGER,                -- 1..5 for recent rows; NULL for best
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (chart_score_id) REFERENCES chart_scores(id) ON DELETE CASCADE
);
CREATE INDEX idx_scores_chart_score ON scores(chart_score_id);
CREATE UNIQUE INDEX idx_scores_one_best ON scores(chart_score_id) WHERE is_best = 1;
```

### Semantics

- **`is_best`**: exactly one row per `chart_scores` (enforced by the partial unique index). Carries full best-play detail (`score`, `achievement_rate`, `rank_label`, `full_combo`, `max_combo`, judgement breakdown). `display_order` is NULL.
- **Recent rows**: `is_best = 0`, `display_order` 1–5 (1 = most recent). Carry `performed_at`, `achievement_rate`, `rank_label`, `cleared`; `score`/`max_combo`/judgement columns may be NULL (not available from DTXMania history — see §5.2).
- **Aggregates** (`play_count`, `clear_count`) live on `chart_scores`, never duplicated onto individual rows.

### Upload semantics — replace per (user, chart)

For each uploaded chart, in a single D1 batch/transaction:

1. Upsert `chart_scores` for `(user_id, chart_id)` — set `play_count`, `clear_count`, `updated_at`.
2. `DELETE FROM scores WHERE chart_score_id = ?` (the row from step 1).
3. Insert the best row + up to 5 recent rows.

This makes re-uploads idempotent (last upload wins) and keeps the recent window bounded at 5.

**Concurrency caveat:** "last upload wins" means concurrent uploads from multiple devices for the same `(user, chart)` will silently overwrite each other — the later-committed batch replaces all scores from the earlier one. `chart_scores.updated_at` is refreshed on every upsert so the most recent write is observable, but no merge or conflict-resolution is performed. This is acceptable for the DTXMania import use case (single-user, typically one device at a time); cross-device sync is a future extension (§11).

## 3. Query layer (`@dtx/common/server`)

All new DB functions live in `packages/common/src/lib/server/db.ts`, with Drizzle table definitions in `packages/common/src/lib/server/db/schema.ts` and row types in `packages/common/src/lib/types/d1.types.ts`.

- **Drizzle schema**: add `chartScores` and `scores` tables mirroring §2.
- **Row types**: `ChartScoreRow`, `ChartScoreInsert`, `ScoreRow`, `ScoreInsert`.
- **New functions**:
    - `upsertChartScore(db, { chartId, userId, playCount, clearCount })` → `ChartScoreRow`.
    - `replaceScores(db, chartScoreId, scores: ScoreInsert[])` → deletes existing + inserts new (steps 2–3 above).
    - `getUserChartScore(db, userId, chartId)` → `{ chartScore, scores } | null`, scores ordered best-first then `display_order`.
    - `listUserScoredSimfiles(db, { userId, page, pageSize })` → `{ data: SimfileWithDtxFiles[]; count }` — simfiles the user has at least one `chart_scores` row on.
    - `getChartVisibility(db, chartId)` → owning simfile's `{ user_id, is_published }`, for the upload auth check. (Reuses `getSimfileOwner` semantics joined through `dtx_files.simfile_id`.)
- **Change to existing selects**: `getSimfile` and `listSimfiles` currently select only `level` + `label` from `dtx_files`. Add `id` to those selects so the GraphQL `DtxFile` can expose a stable chart id and resolve scores. `SimfileWithDtxFiles.dtx_files` is already `Partial<DtxFileRow>[]`, so carrying `id` is type-compatible.

All new functions get unit tests in `db.test.ts` (miniflare/D1 test harness already used there), covering upsert, replace/idempotency, best-row uniqueness, and the scored-simfiles listing.

## 4. GraphQL API (`dtx-api`)

New schema module `packages/dtx-api/src/schema/score.ts`, registered in `schema/index.ts`.

### Object types

- **`Score`**: `id: ID!, isBest: Boolean!, score: Int, achievementRate: Float, rankLabel: String, fullCombo: Boolean!, cleared: Boolean!, maxCombo: Int, perfect: Int, great: Int, good: Int, poor: Int, miss: Int, performedAt: String, displayOrder: Int`.
- **`ChartScore`**: `id: ID!, playCount: Int!, clearCount: Int!, scores: [Score!]!` (best first, then `displayOrder`).
- **Extend `DtxFile`** (in `schema/simfile.ts`): expose `id: ID!` (the `dtx_files.id`, carried through `DtxFileParent`) and `myChartScore: ChartScore` (nullable — the signed-in user's `chart_scores` + scores for that chart; resolves to null when unauthenticated or no scores). `DtxFileParent` gains a `chartId` field sourced from the extended `dtx_files` select.

### Input types

- **`ScoreInput`**: `isBest, score, achievementRate, rankLabel, fullCombo, cleared, maxCombo, perfect, great, good, poor, miss, performedAt, displayOrder`.
- **`ChartScoresInput`**: `chartId: ID!, playCount: Int!, clearCount: Int!, scores: [ScoreInput!]!`.
- **`UploadScoresInput`**: `charts: [ChartScoresInput!]!`.

### Mutation

- **`uploadScores(input: UploadScoresInput!): UploadScoresResult!`** — scope `user`.
    - For each chart: verify the chart exists and is **visible** to the caller (`is_published = 1` or owned by the caller) via `getChartVisibility`; charts failing this are collected into `skipped` rather than aborting the batch.
    - Validate each chart's `scores`: at most one `isBest = true`; at most five rows with a non-null `displayOrder`; numeric fields finite; `achievementRate` within 0–100. Invalid chart payloads are skipped (with reason).
    - For valid charts, run the §2 replace transaction (`upsertChartScore` + `replaceScores`).
    - **Result** `UploadScoresResult { updatedCharts: Int!, insertedScores: Int!, skipped: [SkippedChart!]! }` where `SkippedChart { chartId: ID!, reason: String! }`.

### Query

- **`myScoredSimfiles(page: Int = 1, pageSize: Int = 20): SimfileConnection!`** — scope `user`. Returns the caller's scored simfiles via `listUserScoredSimfiles`. The web page selects `data { id title artist dtxFiles { id label level myChartScore { playCount clearCount scores { … } } } }`, reusing `SimfileRef` so title/artist come for free.

### Auth notes

- Upload requires authentication only (`user` scope). A user may record scores against any chart they can see (their own or published), scoped to their own `chart_scores`. `myChartScore` and `myScoredSimfiles` are always filtered to `ctx.user.id`, so one user never sees another's scores in v1.
- Tests in `schema/score.test.ts`: unauthenticated rejection, skip-on-invisible-chart, best-row uniqueness enforcement, replace/idempotency, `myScoredSimfiles` isolation between users, and `>5` recent rejection.

## 5. Desktop (`dtx-desktop`)

### 5.1 Rust backend (`src-tauri`)

- **Dependency**: add `rusqlite = { version = "0.32", features = ["bundled"] }` to `Cargo.toml` (bundled SQLite; no system dependency). Read-only access; open the DB with `OpenFlags::SQLITE_OPEN_READ_ONLY`.
- **New module `scores.rs`** with Tauri commands (registered in `lib.rs`):
    - `default_dtxmania_db_path() -> Option<String>`: returns the platform default if the file exists, using the existing `dirs` crate.
        - macOS: `~/Library/Application Support/DTXManiaCX/songs.db`
        - Windows: `%APPDATA%\DTXManiaCX\songs.db`
        - Linux: `$XDG_DATA_HOME`/`~/.local/share/DTXManiaCX/songs.db` (best effort)
    - `parse_dtxmania_scores(db_path: String) -> Vec<DtxmaniaSong>`: opens `songs.db`, reads `Songs → SongCharts → SongScores` filtered to `Instrument = 0`, plus up to five `PerformanceHistory` rows per score ordered by `DisplayOrder`. Returns JSON (see §5.2 shape).
    - `upload_scores(app: AppHandle, payload: Value) -> Result<Value>`: calls the `uploadScores` mutation through the existing `run_graphql_value` helper (authenticated session), returning the `UploadScoresResult`.

### 5.2 DTXMania → payload mapping

Per DTXMania chart (`SongCharts` row) with a drums `SongScores` row:

| Target                              | Source                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `chart` aggregate `playCount`       | `SongScores.PlayCount`                                                                 |
| `chart` aggregate `clearCount`      | `SongScores.ClearCount`                                                                |
| best `score`                        | `SongScores.BestScore`                                                                 |
| best `achievementRate`              | `SongScores.BestAchievementRate`                                                       |
| best `rankLabel`                    | derived from `BestAchievementRate` via the rank table below                            |
| best `fullCombo`                    | `SongScores.FullCombo`                                                                 |
| best `cleared`                      | `SongScores.ClearCount > 0`                                                            |
| best `maxCombo`                     | `SongScores.MaxCombo`                                                                  |
| best `perfect/great/good/poor/miss` | `SongScores.BestPerfect/BestGreat/BestGood/BestPoor/BestMiss`                          |
| best `performedAt`                  | `SongScores.LastPlayedAt` (DTXMania does not store when the best was set; best-effort) |
| best `displayOrder`                 | NULL                                                                                   |

Per recent play (`PerformanceHistory` row, up to 5 by `DisplayOrder`):

- `HistoryLine` format observed: `` `<counter>.<YY>/<M>/<D> <Cleared|Failed> (<RANK>: <achievement>)` `` — e.g. `10.26/6/2 Cleared (S: 91.30)`.
- Parse → `cleared` (`"Cleared"` vs `"Failed"`), `rankLabel` (`RANK` token), `achievementRate` (float). `performedAt` comes from `PerformanceHistory.PerformedAt` (fuller timestamp than the abbreviated date in the line). `score` is **NULL** for recent rows (not present in the history line). `displayOrder` = `PerformanceHistory.DisplayOrder`.
- Parsing is tolerant: a line that doesn't match keeps `performedAt` and leaves the parsed fields null rather than failing the whole song.

**Rank table (validated against DTXManiaCX source):** SS ≥ 95, S ≥ 80, A ≥ 73, B ≥ 62, C ≥ 50, D < 50. Recent rows use the `RANK` token from the line verbatim; only the best row derives its label from the table. See [DTXManiaCX](https://github.com/cwchanap/DTXManiaCX) for the source scoring bands.

Returned `DtxmaniaSong` shape (JSON):

```ts
{ title, artist, genre,
  charts: [{ difficultyLevel, difficultyLabel, drumLevel, fileHash,
             aggregate: { playCount, clearCount },
             best: ScorePayload | null,
             recent: ScorePayload[] }] }
```

### 5.3 Frontend (Svelte) — Scores view

New `Scores.svelte` component surfaced as a **Scores** entry in the desktop shell navigation (mirroring how `Workspace` / `Templates` / `Settings` views are shown). Flow:

1. On open, call `default_dtxmania_db_path`; if found, parse it. Offer a file-picker override (existing dialog plumbing) to choose a different `songs.db`.
2. Render the parsed DTXMania songs → charts → scores (best + recent).
3. Per song, a cloud-song link control using the existing `CloudSongAutocomplete` (backed by `search_cloud_songs` / `fetch_user_simfiles`) to pick the target cloud simfile.
4. Auto-match local charts → server `dtx_files` by difficulty (see §6); show the matched target per chart with a manual override dropdown; unmatched charts are flagged and excluded.
5. **Upload** button builds the `UploadScoresInput` from linked songs + matched charts and calls `upload_scores`; show per-song/chart status and the returned `skipped` list.
6. Persist the local→cloud mapping (keyed by DTXMania song identity, e.g. title+artist or `FileHash`) via the existing `preferences` store so re-uploads don't require re-linking.

Component test (`Scores.test.ts`) mocks `@tauri-apps/api` `invoke` for `default_dtxmania_db_path`, `parse_dtxmania_scores`, `search_cloud_songs`, and `upload_scores`, covering: parse render, link + auto-match, unmatched-chart flagging, and upload payload construction.

## 6. Chart matching & song linking

- **Song link**: the user explicitly picks the cloud simfile for each DTXMania song (reuses `CloudSongAutocomplete`). No automatic song identity is assumed.
- **Chart match** within the linked simfile: pair local charts to server `dtx_files` by numeric difficulty — DTXMania `DrumLevel` normalized (`DrumLevel / 10`, e.g. `55 → 5.5`) compared against `dtx_files.level`, with `DifficultyLabel` ↔ `label` as a tiebreaker. Nearest-level match; ties or no confident match are left unmatched for manual selection.
- The user can override any match via a dropdown of the simfile's charts. Only matched charts are included in the upload.

## 7. Web (`dtx-web`) — personal dashboard

- Replace the `Hello World` placeholder in `packages/dtx-web/src/routes/(app)/app/score/+page.svelte`.
- **API operation**: add `packages/dtx-web/src/lib/api/score.ts` with a `myScoredSimfiles` query wrapper; run `bun run --filter=dtx-web codegen` to regenerate `src/lib/api/generated/` and commit it.
- **Components**:
    - `ScoreList.svelte` — fetches `myScoredSimfiles`, paginates (reusing the `Pagination` pattern from `ChartList`), groups by song.
    - `ScoreCard.svelte` (or a table row) — per chart: aggregate line (`playCount`, `clearCount`), the **best** row (score, achievement %, rank, max combo, FC badge, judgement breakdown), and the **≤5 recent** plays (date, cleared/failed, rank, achievement %, score when present).
- Owner-only: the query is `ctx.user`-scoped, so the page shows only the signed-in user's scores. Empty state prompts the user to upload from the desktop app.
- Replace the trivial `score-page.test.ts` (currently asserts `"Hello World"`) with a real test that mocks `$lib/api` and asserts song/chart/score rendering + empty state.

## 8. Error handling

- **Missing/locked `songs.db`**: `parse_dtxmania_scores` returns a typed `DesktopError`; the UI shows a clear message and the file-picker fallback. Read-only open avoids lock contention with a running DTXMania.
- **Malformed `HistoryLine`**: tolerated per-row (§5.2); never aborts a song.
- **Unlinked song**: cannot upload; UI blocks upload for that song and prompts to link.
- **Unmatched chart**: excluded from upload and flagged in the UI.
- **Partial upload**: server returns `skipped[]`; UI lists which charts were skipped and why. Network/auth failure surfaces a retry; expired session prompts re-login (existing auth flow).
- **API validation**: `>1 best`, `>5 recent`, non-finite numbers, out-of-range `achievementRate`, or invisible chart → that chart is skipped with a reason (never a hard 500).

## 9. Testing summary

- **Rust** (`src-tauri/src/tests/`): `parse_dtxmania_scores` against a `tempfile` `songs.db` seeded to mirror the sample (best-only, recent-history, all-zero/never-played, malformed history line, non-drums rows ignored); `HistoryLine` parser unit tests; `default_dtxmania_db_path` behavior.
- **Common** (`db.test.ts`): new query functions (upsert, replace/idempotency, best uniqueness, scored-simfiles listing, extended dtx_files select includes `id`).
- **API** (`schema/score.test.ts`): auth, skip-on-invisible, validation limits, replace semantics, per-user isolation.
- **Web**: `ScoreList`/`ScoreCard` component tests (mock `$lib/api`) + rewritten `score-page.test.ts`.
- **Desktop frontend**: `Scores.test.ts` (mock `invoke`).

## 10. Phasing & rollout

1. **Server**: migration `0002_scores.sql`, Drizzle schema + row types, `db.ts` functions + tests, GraphQL `score.ts` + `DtxFile` extension + tests, `gen-schema`.
2. **Web**: `score.ts` api op + codegen, `ScoreList`/`ScoreCard`, dashboard page + tests.
3. **Desktop**: `rusqlite` + `scores.rs` (parse + upload) + Rust tests, `Scores.svelte` + shell nav + linking/matching + tests.

Each phase is independently testable; phase 2 and phase 3 both depend on phase 1's schema.

**Migrations are manual** (per project convention — no CI/CD for Worker/D1). Apply `0002_scores.sql` to local, preprod, and prod D1 via `wrangler d1` as part of deploying the API. `gen-schema` + web `codegen` outputs must be committed (CI `lint:codegen` fails on staleness).

## 11. Future extensions (not in scope)

- Per-chart leaderboards (the `idx_chart_scores_chart`/`idx_scores_chart_score` indexes and per-user `chart_scores` split already support ranked cross-user reads).
- Guitar/bass instruments (add an `instrument` dimension to `chart_scores`).
- Writing scores directly from in-app Phaser gameplay.
- File-hash-based automatic chart matching (store a content hash on `dtx_files` at upload).
