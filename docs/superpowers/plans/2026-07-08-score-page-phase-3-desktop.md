# Score Page — Phase 3 (Desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Tauri desktop app read a DTXManiaCX `songs.db`, parse each drum chart's best + up to 5 recent scores, link each DTXMania song to a cloud simfile, match charts by difficulty, and upload the scores to the (already-built) `uploadScores` GraphQL mutation.

**Architecture:** A new Rust module `scores.rs` holds pure parsing (rank derivation, `HistoryLine` parsing, payload structs) and a `rusqlite` read-only reader of `songs.db`. Two network commands (`fetch_cloud_song_charts`, `upload_scores`) are added to the existing `api.rs`, reusing its `run_graphql_value` GraphQL plumbing. A file-picker command is added to `filesystem.rs`. On the frontend, a pure `scoreMatching.ts` helper pairs local charts to cloud `dtx_files` by difficulty, and a new `Scores.svelte` view (added to the shell navigation) drives parse → link → match → upload. A small `score_links.rs` persistence store remembers song→cloud links across sessions.

**Tech Stack:** Rust 1.77 / Tauri 2 / `rusqlite` 0.32 (bundled SQLite); Svelte 5 + TypeScript + Vitest; `@testing-library/svelte`; `wiremock` + `tempfile` for Rust tests.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `docs/superpowers/specs/2026-07-08-score-page-design.md` §5–§6 and the project conventions.

- **Branch:** `feat/score-page` (continues Phases 1 & 2; do not create a new branch).
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (matches Phases 1 & 2).
- **No GraphQL schema change this phase.** The server (Phase 1) already exposes `uploadScores`, `DtxFile.id`, and `dtxFiles { id label level }`. Do **not** run `gen-schema` or web `codegen`; do not touch `packages/dtx-api` schema files or `packages/dtx-web`. The desktop only _consumes_ the existing schema.
- **Drums only:** every `SongScores` read is filtered to `Instrument = 0`.
- **Read-only DB open:** open `songs.db` with `OpenFlags::SQLITE_OPEN_READ_ONLY` (avoids lock contention with a running DTXMania).
- **rusqlite dependency (exact):** `rusqlite = { version = "0.32", features = ["bundled"] }` (bundled SQLite; no system dependency).
- **Rank table (best row only):** `SS ≥ 95`, `S ≥ 80`, `A ≥ 73`, `B ≥ 62`, `C ≥ 50`, `D < 50` (validated against DTXManiaCX source; matches spec §5.2). Recent rows use the `RANK` token from the `HistoryLine` verbatim; only the best row derives its label from this table.
- **DrumLevel normalization:** the DTXMania `DrumLevel` integer is stored ×10; the normalized numeric level is `DrumLevel / 10` (e.g. `55 → 5.5`), compared against `dtx_files.level`.
- **Recent window:** at most 5 recent rows per chart, ordered by `PerformanceHistory.DisplayOrder` (1 = most recent). `score` is **NULL** for recent rows.
- **Tolerant parsing:** a `HistoryLine` that doesn't match keeps `performedAt` and leaves parsed fields null; it never aborts the song.
- **`_impl` split:** every `#[tauri::command]` that needs `AppHandle`/env/token delegates to a plain `_impl(...)` function so the logic is unit-testable (existing `api.rs` pattern). Register every new command in `lib.rs`'s `invoke_handler!` list.
- **Rust formatting:** run `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml` before every commit that stages `.rs` files (the pre-commit hook enforces `cargo fmt --check` on staged Rust). Keep `cargo clippy` clean.
- **Test locations:** Rust unit tests live in `packages/dtx-desktop/src-tauri/src/tests/<module>_tests.rs`, attached via `#[cfg(test)] #[path = "tests/<module>_tests.rs"] mod tests;` at the bottom of the source module. Frontend tests are Vitest and mock the `../services/desktopHost` module.

### Test commands

- Rust (all): `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
- Rust (one test by name substring): `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml <name>`
- Rust fmt check: `cargo fmt --check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
- Rust clippy: `cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
- Frontend (one file): `bun run --filter=dtx-desktop test -- <File>.test.ts`
- Frontend typecheck: `bun run --filter=dtx-desktop typecheck`

### DTXManiaCX `songs.db` schema (relevant columns, verified against the sample DB)

- `Songs(Id, Title, Artist, Genre, ...)`
- `SongCharts(Id, SongId, DifficultyLevel, DifficultyLabel, DrumLevel, FileHash, ...)` — one row per chart. `DrumLevel` is ×10 (e.g. `55`). `DifficultyLabel` is often the empty string.
- `SongScores(Id, ChartId, Instrument, BestScore, BestAchievementRate, FullCombo, PlayCount, ClearCount, MaxCombo, BestPerfect, BestGreat, BestGood, BestPoor, BestMiss, LastPlayedAt, ...)` — unique on `(ChartId, Instrument)`. `LastPlayedAt` is nullable; the rest of these are NOT NULL.
- `PerformanceHistory(Id, SongScoreId, PerformedAt, HistoryLine, DisplayOrder, ...)` — recent plays; `SongScoreId` → `SongScores.Id`. `HistoryLine` example: `10.26/6/2 Cleared (S: 91.30)`.

### Existing GraphQL surface consumed by this phase (from Phase 1, already deployed in the schema)

```graphql
type DtxFile {
	id: ID!
	label: String!
	level: Float!
	myChartScore: ChartScore
}
input ScoreInput {
	isBest: Boolean!
	score: Int
	achievementRate: Float
	rankLabel: String
	fullCombo: Boolean!
	cleared: Boolean!
	maxCombo: Int
	perfect: Int
	great: Int
	good: Int
	poor: Int
	miss: Int
	performedAt: String
	displayOrder: Int
}
input ChartScoresInput {
	chartId: ID!
	playCount: Int!
	clearCount: Int!
	scores: [ScoreInput!]!
}
input UploadScoresInput {
	charts: [ChartScoresInput!]!
}
type SkippedChart {
	chartId: ID!
	reason: String!
}
type UploadScoresResult {
	updatedCharts: Int!
	insertedScores: Int!
	skipped: [SkippedChart!]!
}
type Mutation {
	uploadScores(input: UploadScoresInput!): UploadScoresResult!
} # scope: user
```

The desktop `ScorePayload` serializes (camelCase) to exactly the `ScoreInput` field set, so parsed score objects can be sent to `uploadScores` verbatim.

---

## File Structure

**Rust (`packages/dtx-desktop/src-tauri/src/`):**

- `scores.rs` _(new)_ — pure parsing (`derive_rank_label`, `parse_history_line`), payload structs (`ScorePayload`, `ChartAggregate`, `DtxmaniaChart`, `DtxmaniaSong`), `default_dtxmania_db_path` command, and the `rusqlite` reader `parse_dtxmania_scores`.
- `api.rs` _(modify)_ — add `fetch_cloud_song_charts` (real `dtx_files.id` for a linked simfile) and `upload_scores` commands, reusing `run_graphql_value`/`graphql_result_with_url`/`api_success`/`api_failure`.
- `filesystem.rs` _(modify)_ — add `select_dtxmania_db` file-picker command (reuses `DialogResult` + private `file_path_to_string`).
- `error.rs` _(modify)_ — add a `Sqlite` variant so `rusqlite::Error` converts via `?`.
- `score_links.rs` _(new)_ — `read_score_song_links` / `write_score_song_links` persistence (`~/.dtxweb/score_links.json`).
- `lib.rs` _(modify)_ — declare `mod scores;` / `mod score_links;`, register every new command.
- `tests/scores_tests.rs`, `tests/score_links_tests.rs` _(new)_; `tests/api_tests.rs` _(modify)_.

**Frontend (`packages/dtx-desktop/src/renderer/src/`):**

- `lib/scoreMatching.ts` _(new)_ — pure `matchCharts(local, cloud)` difficulty matcher + types.
- `services/desktopHost.ts` _(modify)_ — thin invoke wrappers for the 5 new commands.
- `stores/workspaceStore.ts` _(modify)_ — add `'scores'` to `ShellSection`.
- `components/shell/NavRail.svelte` _(modify)_ — add the auth-only **Scores** nav item.
- `components/shell/AppShell.svelte` _(modify)_ — render `<Scores />` for `section === 'scores'`; reset `'scores'` → `'library'` when signed out.
- `components/Scores.svelte` _(new)_ — the parse → link → match → upload view.
- `lib/scoreMatching.test.ts`, `components/Scores.test.ts` _(new)_.

---

## Task 1: Rust — `scores.rs` foundation (parsers, payload types, DB-path resolution)

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/scores.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/filesystem.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`

**Interfaces:**

- Produces (consumed by Task 2): `pub fn derive_rank_label(rate: f64) -> &'static str`; `pub struct ParsedHistory { pub cleared: Option<bool>, pub rank_label: Option<String>, pub achievement_rate: Option<f64> }`; `pub fn parse_history_line(line: &str) -> ParsedHistory`; the serde structs `ScorePayload`, `ChartAggregate`, `DtxmaniaChart`, `DtxmaniaSong`.
- Produces (Tauri commands, consumed by the frontend in Task 5): `default_dtxmania_db_path() -> Option<String>`, `select_dtxmania_db(app) -> Result<DialogResult>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`:

```rust
use super::*;
use tempfile::tempdir;

#[test]
fn derive_rank_label_covers_all_bands() {
    // DTXManiaCX thresholds: SS >= 95, S >= 80, A >= 73, B >= 62, C >= 50, D < 50.
    assert_eq!(derive_rank_label(100.0), "SS");
    assert_eq!(derive_rank_label(95.0), "SS");
    assert_eq!(derive_rank_label(94.99), "S");
    assert_eq!(derive_rank_label(80.0), "S");
    assert_eq!(derive_rank_label(79.99), "A");
    assert_eq!(derive_rank_label(73.0), "A");
    assert_eq!(derive_rank_label(72.99), "B");
    assert_eq!(derive_rank_label(62.0), "B");
    assert_eq!(derive_rank_label(61.99), "C");
    assert_eq!(derive_rank_label(50.0), "C");
    assert_eq!(derive_rank_label(49.99), "D");
    assert_eq!(derive_rank_label(0.0), "D");
}

#[test]
fn parse_history_line_reads_cleared_rank_and_rate() {
    let parsed = parse_history_line("10.26/6/2 Cleared (S: 91.30)");
    assert_eq!(parsed.cleared, Some(true));
    assert_eq!(parsed.rank_label.as_deref(), Some("S"));
    assert_eq!(parsed.achievement_rate, Some(91.30));
}

#[test]
fn parse_history_line_reads_failed_and_double_letter_rank() {
    let failed = parse_history_line("9.26/5/28 Failed (B: 70.10)");
    assert_eq!(failed.cleared, Some(false));
    assert_eq!(failed.rank_label.as_deref(), Some("B"));
    assert_eq!(failed.achievement_rate, Some(70.10));

    let ss = parse_history_line("42.26/5/20 Cleared (SS: 98.52)");
    assert_eq!(ss.rank_label.as_deref(), Some("SS"));
    assert_eq!(ss.achievement_rate, Some(98.52));
}

#[test]
fn parse_history_line_tolerates_garbage() {
    let parsed = parse_history_line("not a real history line");
    assert_eq!(parsed.cleared, None);
    assert_eq!(parsed.rank_label, None);
    assert_eq!(parsed.achievement_rate, None);
}

#[test]
fn default_path_present_when_db_exists() {
    let dir = tempdir().expect("tempdir");
    let dtx_dir = dir.path().join("DTXManiaCX");
    std::fs::create_dir_all(&dtx_dir).expect("mkdir");
    std::fs::write(dtx_dir.join("songs.db"), b"x").expect("write db");

    let resolved = default_dtxmania_db_path_from(Some(dir.path().to_path_buf()));
    assert_eq!(resolved, Some(dtx_dir.join("songs.db").to_string_lossy().into_owned()));
}

#[test]
fn default_path_absent_when_db_missing() {
    let dir = tempdir().expect("tempdir");
    assert_eq!(default_dtxmania_db_path_from(Some(dir.path().to_path_buf())), None);
    assert_eq!(default_dtxmania_db_path_from(None), None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores`
Expected: FAIL — the `scores` module / `scores_tests` file does not exist yet (compile error, `unresolved module`).

- [ ] **Step 3: Create `scores.rs` with the parsers, payload types, and path resolution**

Create `packages/dtx-desktop/src-tauri/src/scores.rs`:

```rust
use std::path::PathBuf;

use serde::Serialize;

/// Individual score row destined for the GraphQL `ScoreInput`. Serializes to the
/// exact `ScoreInput` field set (camelCase), so the renderer forwards these
/// objects to `uploadScores` verbatim.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScorePayload {
    pub is_best: bool,
    pub score: Option<i64>,
    pub achievement_rate: Option<f64>,
    pub rank_label: Option<String>,
    pub full_combo: bool,
    pub cleared: bool,
    pub max_combo: Option<i64>,
    pub perfect: Option<i64>,
    pub great: Option<i64>,
    pub good: Option<i64>,
    pub poor: Option<i64>,
    pub miss: Option<i64>,
    pub performed_at: Option<String>,
    pub display_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DtxmaniaChart {
    pub difficulty_level: i64,
    pub difficulty_label: String,
    pub drum_level: i64,
    pub file_hash: String,
    pub aggregate: ChartAggregate,
    pub best: Option<ScorePayload>,
    pub recent: Vec<ScorePayload>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DtxmaniaSong {
    pub title: String,
    pub artist: String,
    pub genre: String,
    pub charts: Vec<DtxmaniaChart>,
}

/// Rank label for the best row, derived from the achievement rate (0–100).
/// Recent rows keep the RANK token parsed from the history line instead.
/// Thresholds match DTXManiaCX: SS >= 95, S >= 80, A >= 73, B >= 62, C >= 50, D < 50.
pub fn derive_rank_label(rate: f64) -> &'static str {
    if rate >= 95.0 {
        "SS"
    } else if rate >= 80.0 {
        "S"
    } else if rate >= 73.0 {
        "A"
    } else if rate >= 62.0 {
        "B"
    } else if rate >= 50.0 {
        "C"
    } else {
        "D"
    }
}

pub struct ParsedHistory {
    pub cleared: Option<bool>,
    pub rank_label: Option<String>,
    pub achievement_rate: Option<f64>,
}

/// Tolerant parser for a DTXMania `HistoryLine`, e.g. `10.26/6/2 Cleared (S: 91.30)`.
/// Any field that cannot be read is left `None`; the parser never fails.
pub fn parse_history_line(line: &str) -> ParsedHistory {
    let cleared = if line.contains("Cleared") {
        Some(true)
    } else if line.contains("Failed") {
        Some(false)
    } else {
        None
    };

    let (rank_label, achievement_rate) = match (line.find('('), line.find(')')) {
        (Some(open), Some(close)) if close > open + 1 => {
            let inner = &line[open + 1..close];
            match inner.split_once(':') {
                Some((rank, rate)) => {
                    let rank = rank.trim();
                    let rank_label = if rank.is_empty() {
                        None
                    } else {
                        Some(rank.to_string())
                    };
                    (rank_label, rate.trim().parse::<f64>().ok())
                }
                None => (None, None),
            }
        }
        _ => (None, None),
    };

    ParsedHistory {
        cleared,
        rank_label,
        achievement_rate,
    }
}

/// Pure resolver: `<data_dir>/DTXManiaCX/songs.db` when it exists. `dirs::data_dir()`
/// maps to `~/Library/Application Support` (macOS), `%APPDATA%` (Windows), and
/// `$XDG_DATA_HOME`/`~/.local/share` (Linux) — the three platform paths in the spec.
fn default_dtxmania_db_path_from(data_dir: Option<PathBuf>) -> Option<String> {
    let path = data_dir?.join("DTXManiaCX").join("songs.db");
    if path.exists() {
        path.to_str().map(|value| value.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub fn default_dtxmania_db_path() -> Option<String> {
    default_dtxmania_db_path_from(dirs::data_dir())
}

#[cfg(test)]
#[path = "tests/scores_tests.rs"]
mod tests;
```

(No `crate::error` import in Task 1 — none of these functions return `Result`. Task 2 adds that import when it introduces the reader.)

- [ ] **Step 4: Add the `select_dtxmania_db` file-picker command to `filesystem.rs`**

`filesystem.rs` already has `use tauri_plugin_dialog::{DialogExt, FilePath};`, the private `file_path_to_string`, and returns `crate::models::DialogResult` (fields `canceled`, `file_paths`). Add this command next to `select_folder` (immediately after the `select_folder` function body):

```rust
#[tauri::command]
pub async fn select_dtxmania_db(app: AppHandle) -> Result<DialogResult> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("DTXMania database", &["db"])
        .pick_file(move |file_path| {
            let _ = sender.send(file_path);
        });

    let picked = receiver
        .await
        .map_err(|error| DesktopError::Message(error.to_string()))?;
    let file_paths = match picked {
        Some(path) => vec![file_path_to_string(path)?],
        None => Vec::new(),
    };

    Ok(DialogResult {
        canceled: file_paths.is_empty(),
        file_paths,
    })
}
```

(`DialogResult` and `DesktopError` are already imported at the top of `filesystem.rs`; confirm — the existing `use crate::models::{ DialogResult, ... }` and `use crate::error::{DesktopError, Result}` lines cover both. This dialog command is exercised through the frontend mock in Task 5, not by a Rust unit test — a native file dialog cannot be driven headlessly.)

- [ ] **Step 5: Register the module and commands in `lib.rs`**

In `packages/dtx-desktop/src-tauri/src/lib.rs`, add `mod scores;` to the module list (after `mod preferences;`):

```rust
mod preferences;
mod scores;
mod songs;
```

Then add these three lines inside the `tauri::generate_handler![ ... ]` list (place near the other `filesystem::` and after `songs::parse_dtx_files,`):

```rust
            filesystem::select_dtxmania_db,
            scores::default_dtxmania_db_path,
```

(The `scores::parse_dtxmania_scores` registration is added in Task 2; `api::*` and `score_links::*` in Tasks 3 and 6.)

- [ ] **Step 6: Run tests to verify they pass, format, lint**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores`
Expected: PASS — all six `scores_tests` pass.

Run: `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Then: `cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Expected: clippy clean (no warnings on the new code).

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/scores.rs \
        packages/dtx-desktop/src-tauri/src/filesystem.rs \
        packages/dtx-desktop/src-tauri/src/lib.rs \
        packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs
git commit -m "feat(desktop): add score parsers, payload types, and db-path resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rust — `parse_dtxmania_scores` (rusqlite reader)

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Modify: `packages/dtx-desktop/src-tauri/src/error.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/scores.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`

**Interfaces:**

- Consumes (from Task 1): `derive_rank_label`, `parse_history_line`, `ScorePayload`, `ChartAggregate`, `DtxmaniaChart`, `DtxmaniaSong`.
- Produces (Tauri command, consumed by the frontend in Task 5): `parse_dtxmania_scores(db_path: String) -> Result<Vec<DtxmaniaSong>>` — reads `Songs → SongCharts → SongScores (Instrument = 0) → PerformanceHistory` and returns the payload. A chart with no drums `SongScores` row is omitted; a song with no drums charts is omitted. A never-played chart (`PlayCount = 0`) is present with `best: null` and `recent: []`.

- [ ] **Step 1: Add the `rusqlite` dependency**

In `packages/dtx-desktop/src-tauri/Cargo.toml`, under `[dependencies]` (keep the list alphabetical-ish; place after `reqwest`), add:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Add a `Sqlite` error variant**

In `packages/dtx-desktop/src-tauri/src/error.rs`, add a variant to `DesktopError` (after the `Zip` variant) so `rusqlite::Error` propagates through `?`:

```rust
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
```

- [ ] **Step 3: Write the failing tests**

Append to `packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs`:

```rust
use rusqlite::Connection;

/// Minimal DTXMania-shaped schema holding only the columns the parser reads.
fn seed_db(path: &std::path::Path) {
    let conn = Connection::open(path).expect("open seed db");
    conn.execute_batch(
        "CREATE TABLE Songs (Id INTEGER PRIMARY KEY, Title TEXT, Artist TEXT, Genre TEXT);
         CREATE TABLE SongCharts (Id INTEGER PRIMARY KEY, SongId INTEGER, DifficultyLevel INTEGER,
             DifficultyLabel TEXT, DrumLevel INTEGER, FileHash TEXT);
         CREATE TABLE SongScores (Id INTEGER PRIMARY KEY, ChartId INTEGER, Instrument INTEGER,
             BestScore INTEGER, BestAchievementRate REAL, FullCombo INTEGER, PlayCount INTEGER,
             ClearCount INTEGER, MaxCombo INTEGER, BestPerfect INTEGER, BestGreat INTEGER,
             BestGood INTEGER, BestPoor INTEGER, BestMiss INTEGER, LastPlayedAt TEXT);
         CREATE TABLE PerformanceHistory (Id INTEGER PRIMARY KEY, SongScoreId INTEGER,
             PerformedAt TEXT, HistoryLine TEXT, DisplayOrder INTEGER);

         INSERT INTO Songs VALUES (1, 'Played Song', 'Artist A', 'Rock');
         INSERT INTO Songs VALUES (2, 'Never Played', 'Artist B', 'Pop');

         -- Song 1: chart 1 played (with history), chart 2 has a NON-drums score only.
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         INSERT INTO SongCharts VALUES (2, 1, 5, 'EXTREME', 88, 'hash-extreme');
         -- Song 2: chart 3 never played (drums score exists, all zero).
         INSERT INTO SongCharts VALUES (3, 2, 1, '', 33, 'hash-np');

         -- Drums score for chart 1 (played), with judgement breakdown.
         INSERT INTO SongScores VALUES (10, 1, 0, 950000, 91.3, 1, 7, 5, 800, 500, 30, 10, 5, 2, '2026-06-02');
         -- Guitar score for chart 2 (Instrument=1) -> must be ignored, no drums row.
         INSERT INTO SongScores VALUES (11, 2, 1, 111, 50.0, 0, 3, 1, 100, 0, 0, 0, 0, 0, '2026-06-01');
         -- Drums score for chart 3 (never played -> PlayCount 0).
         INSERT INTO SongScores VALUES (12, 3, 0, 0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL);

         -- Two recent rows for score 10 (one parseable, one garbage), plus a 6th
         -- ignored by the LIMIT 5 is not needed here; order by DisplayOrder.
         INSERT INTO PerformanceHistory VALUES (100, 10, '2026-06-02T00:00:00', '10.26/6/2 Cleared (S: 91.30)', 1);
         INSERT INTO PerformanceHistory VALUES (101, 10, '2026-05-28T00:00:00', 'totally malformed line', 2);",
    )
    .expect("seed");
}

#[test]
fn parse_maps_best_recent_and_ignores_non_drums() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db(&db);

    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");

    // Song 2 (never played) still appears because chart 3 has a drums score row.
    assert_eq!(songs.len(), 2);

    let played = &songs[0];
    assert_eq!(played.title, "Played Song");
    // Chart 2 (guitar-only) is dropped; only the played drums chart remains.
    assert_eq!(played.charts.len(), 1);
    let chart = &played.charts[0];
    assert_eq!(chart.drum_level, 55);
    assert_eq!(chart.difficulty_label, "BASIC");
    assert_eq!(chart.aggregate.play_count, 7);
    assert_eq!(chart.aggregate.clear_count, 5);

    let best = chart.best.as_ref().expect("best present");
    assert!(best.is_best);
    assert_eq!(best.score, Some(950000));
    assert_eq!(best.rank_label.as_deref(), Some("A")); // 91.3 -> A
    assert_eq!(best.cleared, true); // clear_count > 0
    assert_eq!(best.full_combo, true);
    assert_eq!(best.max_combo, Some(800));
    assert_eq!(best.perfect, Some(500));
    assert_eq!(best.performed_at.as_deref(), Some("2026-06-02"));
    assert_eq!(best.display_order, None);

    // Recent: 2 rows, ordered by DisplayOrder; score NULL; garbage tolerated.
    assert_eq!(chart.recent.len(), 2);
    let r1 = &chart.recent[0];
    assert_eq!(r1.is_best, false);
    assert_eq!(r1.score, None);
    assert_eq!(r1.rank_label.as_deref(), Some("S"));
    assert_eq!(r1.achievement_rate, Some(91.30));
    assert_eq!(r1.cleared, true);
    assert_eq!(r1.display_order, Some(1));
    let r2 = &chart.recent[1];
    assert_eq!(r2.rank_label, None); // malformed line
    assert_eq!(r2.cleared, false); // defaults to false
    assert_eq!(r2.performed_at.as_deref(), Some("2026-05-28T00:00:00"));

    // Never-played chart: present, best null, recent empty.
    let never = &songs[1];
    assert_eq!(never.charts.len(), 1);
    assert!(never.charts[0].best.is_none());
    assert!(never.charts[0].recent.is_empty());
    assert_eq!(never.charts[0].aggregate.play_count, 0);
}

#[test]
fn parse_missing_db_errors() {
    let dir = tempdir().expect("tempdir");
    let missing = dir.path().join("nope.db");
    assert!(parse_dtxmania_scores_impl(missing.to_str().unwrap()).is_err());
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores`
Expected: FAIL — `parse_dtxmania_scores_impl` not defined (compile error).

- [ ] **Step 5: Implement the reader in `scores.rs`**

Add these `use` lines to the top of `scores.rs` (after the existing imports):

```rust
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::error::{DesktopError, Result};
```

Add the reader below `default_dtxmania_db_path` (and before the `#[cfg(test)]` block):

```rust
struct DrumsScoreRow {
    score_id: i64,
    best_score: i64,
    best_achievement_rate: f64,
    full_combo: i64,
    play_count: i64,
    clear_count: i64,
    max_combo: i64,
    best_perfect: i64,
    best_great: i64,
    best_good: i64,
    best_poor: i64,
    best_miss: i64,
    last_played_at: Option<String>,
}

fn read_drums_score(conn: &Connection, chart_id: i64) -> Result<Option<DrumsScoreRow>> {
    let row = conn
        .query_row(
            "SELECT Id, BestScore, BestAchievementRate, FullCombo, PlayCount, ClearCount, MaxCombo, \
             BestPerfect, BestGreat, BestGood, BestPoor, BestMiss, LastPlayedAt \
             FROM SongScores WHERE ChartId = ?1 AND Instrument = 0",
            [chart_id],
            |row| {
                Ok(DrumsScoreRow {
                    score_id: row.get(0)?,
                    best_score: row.get(1)?,
                    best_achievement_rate: row.get(2)?,
                    full_combo: row.get(3)?,
                    play_count: row.get(4)?,
                    clear_count: row.get(5)?,
                    max_combo: row.get(6)?,
                    best_perfect: row.get(7)?,
                    best_great: row.get(8)?,
                    best_good: row.get(9)?,
                    best_poor: row.get(10)?,
                    best_miss: row.get(11)?,
                    last_played_at: row.get(12)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

fn build_best(score: &DrumsScoreRow) -> Option<ScorePayload> {
    if score.play_count == 0 {
        return None;
    }
    Some(ScorePayload {
        is_best: true,
        score: Some(score.best_score),
        achievement_rate: Some(score.best_achievement_rate),
        rank_label: Some(derive_rank_label(score.best_achievement_rate).to_string()),
        full_combo: score.full_combo != 0,
        cleared: score.clear_count > 0,
        max_combo: Some(score.max_combo),
        perfect: Some(score.best_perfect),
        great: Some(score.best_great),
        good: Some(score.best_good),
        poor: Some(score.best_poor),
        miss: Some(score.best_miss),
        performed_at: score.last_played_at.clone(),
        display_order: None,
    })
}

fn read_recent(conn: &Connection, score_id: i64) -> Result<Vec<ScorePayload>> {
    let mut stmt = conn.prepare(
        "SELECT PerformedAt, HistoryLine, DisplayOrder FROM PerformanceHistory \
         WHERE SongScoreId = ?1 ORDER BY DisplayOrder LIMIT 5",
    )?;
    let rows = stmt
        .query_map([score_id], |row| {
            let performed_at: String = row.get(0)?;
            let history_line: String = row.get(1)?;
            let display_order: i64 = row.get(2)?;
            Ok((performed_at, history_line, display_order))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(rows
        .into_iter()
        .map(|(performed_at, history_line, display_order)| {
            let parsed = parse_history_line(&history_line);
            ScorePayload {
                is_best: false,
                score: None,
                achievement_rate: parsed.achievement_rate,
                rank_label: parsed.rank_label,
                full_combo: false,
                cleared: parsed.cleared.unwrap_or(false),
                max_combo: None,
                perfect: None,
                great: None,
                good: None,
                poor: None,
                miss: None,
                performed_at: Some(performed_at),
                display_order: Some(display_order),
            }
        })
        .collect())
}

fn read_song_charts(conn: &Connection, song_id: i64) -> Result<Vec<DtxmaniaChart>> {
    let mut stmt = conn.prepare(
        "SELECT Id, DifficultyLevel, DifficultyLabel, DrumLevel, FileHash \
         FROM SongCharts WHERE SongId = ?1 ORDER BY Id",
    )?;
    let chart_rows = stmt
        .query_map([song_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut charts = Vec::new();
    for (chart_id, difficulty_level, difficulty_label, drum_level, file_hash) in chart_rows {
        let Some(score) = read_drums_score(conn, chart_id)? else {
            continue; // no drums score row -> nothing to upload for this chart
        };
        let recent = read_recent(conn, score.score_id)?;
        let best = build_best(&score);
        charts.push(DtxmaniaChart {
            difficulty_level,
            difficulty_label,
            drum_level,
            file_hash,
            aggregate: ChartAggregate {
                play_count: score.play_count,
                clear_count: score.clear_count,
            },
            best,
            recent,
        });
    }
    Ok(charts)
}

pub(crate) fn parse_dtxmania_scores_impl(db_path: &str) -> Result<Vec<DtxmaniaSong>> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| DesktopError::Message(format!("Failed to open songs.db: {error}")))?;

    let mut stmt = conn.prepare("SELECT Id, Title, Artist, Genre FROM Songs ORDER BY Id")?;
    let song_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut songs = Vec::new();
    for (song_id, title, artist, genre) in song_rows {
        let charts = read_song_charts(&conn, song_id)?;
        if charts.is_empty() {
            continue; // no drums charts -> nothing to show/upload
        }
        songs.push(DtxmaniaSong {
            title,
            artist,
            genre,
            charts,
        });
    }
    Ok(songs)
}

#[tauri::command]
pub async fn parse_dtxmania_scores(db_path: String) -> Result<Vec<DtxmaniaSong>> {
    parse_dtxmania_scores_impl(&db_path)
}
```

- [ ] **Step 6: Register the command in `lib.rs`**

Add to the `generate_handler!` list (next to `scores::default_dtxmania_db_path,`):

```rust
            scores::parse_dtxmania_scores,
```

- [ ] **Step 7: Run tests, format, lint**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml scores`
Expected: PASS — all `scores_tests` pass (Task 1's plus the two new parse tests).

Run: `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Then: `cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Expected: clippy clean.

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-desktop/src-tauri/Cargo.toml \
        packages/dtx-desktop/src-tauri/Cargo.lock \
        packages/dtx-desktop/src-tauri/src/error.rs \
        packages/dtx-desktop/src-tauri/src/scores.rs \
        packages/dtx-desktop/src-tauri/src/lib.rs \
        packages/dtx-desktop/src-tauri/src/tests/scores_tests.rs
git commit -m "feat(desktop): parse DTXManiaCX songs.db scores via rusqlite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rust — `fetch_cloud_song_charts` + `upload_scores` (GraphQL commands)

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

**Interfaces:**

- Consumes: existing `api.rs` helpers `run_graphql_value` / `graphql_result_with_url` / `api_success` / `api_failure` / `api_base_url_from_env` / `access_token_from_auth_state`.
- Produces (Tauri commands, consumed by the frontend in Task 5):
    - `fetch_cloud_song_charts(cloud_song_id: Value) -> Result<Value>` → `{ success, data?: [{ id, label, level }], error? }` — the **real** `dtx_files.id` values for a linked simfile (the existing `SimfileFull` fragment only selects `level`/`label` and synthesizes ids, so a dedicated query is required to get chart ids for upload).
    - `upload_scores(payload: Value) -> Result<Value>` where `payload` is the `UploadScoresInput` object `{ charts: [...] }`. Returns `{ success: true, data: UploadScoresResult }` or `{ success: false, error }`.

- [ ] **Step 1: Write the failing tests**

The existing `tests/api_tests.rs` already uses `wiremock` (`MockServer`, `Mock`, `ResponseTemplate`, matchers) and imports `super::*`. Append these tests (match the file's existing style — inspect a nearby GraphQL test such as one calling `search_cloud_songs_impl` for the exact `MockServer`/`Mock` setup helpers already in the file, and mirror them):

```rust
#[tokio::test]
async fn fetch_cloud_song_charts_returns_real_ids() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "simfile": { "dtxFiles": [
                { "id": "10", "label": "BASIC", "level": 5.5 },
                { "id": "11", "label": "EXTREME", "level": 8.8 }
            ] } }
        })))
        .mount(&server)
        .await;

    let result = fetch_cloud_song_charts_impl(&server.uri(), "token", serde_json::json!("42"))
        .await
        .expect("charts");

    assert_eq!(result["success"], serde_json::json!(true));
    let charts = result["data"].as_array().expect("data array");
    assert_eq!(charts.len(), 2);
    assert_eq!(charts[0]["id"], serde_json::json!("10"));
    assert_eq!(charts[0]["level"], serde_json::json!(5.5));
    assert_eq!(charts[1]["id"], serde_json::json!("11"));
}

#[tokio::test]
async fn upload_scores_returns_result() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": { "uploadScores": {
                "updatedCharts": 1, "insertedScores": 3,
                "skipped": [ { "chartId": "99", "reason": "Chart not visible" } ]
            } }
        })))
        .mount(&server)
        .await;

    let payload = serde_json::json!({ "charts": [
        { "chartId": "10", "playCount": 7, "clearCount": 5, "scores": [
            { "isBest": true, "cleared": true, "fullCombo": false, "score": 950000 }
        ] }
    ] });
    let result = upload_scores_impl(&server.uri(), "token", payload)
        .await
        .expect("upload");

    assert_eq!(result["success"], serde_json::json!(true));
    assert_eq!(result["data"]["updatedCharts"], serde_json::json!(1));
    assert_eq!(result["data"]["insertedScores"], serde_json::json!(3));
    assert_eq!(result["data"]["skipped"][0]["chartId"], serde_json::json!("99"));
}

#[tokio::test]
async fn upload_scores_surfaces_graphql_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "errors": [ { "message": "Not authenticated", "extensions": { "code": "FORBIDDEN" } } ]
        })))
        .mount(&server)
        .await;

    let result = upload_scores_impl(&server.uri(), "token", serde_json::json!({ "charts": [] }))
        .await
        .expect("upload");

    assert_eq!(result["success"], serde_json::json!(false));
    assert!(result["error"].as_str().unwrap().contains("Not authenticated"));
}
```

If the imports `MockServer, Mock, ResponseTemplate, method, path` are not already brought into scope at the top of `api_tests.rs`, they are — the existing GraphQL tests use them; reuse the same `use` lines. Do not add new imports if they already exist.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api`
Expected: FAIL — `fetch_cloud_song_charts_impl` / `upload_scores_impl` not defined.

- [ ] **Step 3: Add the query/mutation constants and command impls to `api.rs`**

Add these two document constants near the other `const *_QUERY`/`*_MUTATION` strings at the top of `api.rs`:

```rust
const SIMFILE_CHARTS_QUERY: &str = r#"
query SimfileCharts($id: ID!) {
  simfile(id: $id) {
    dtxFiles {
      id
      label
      level
    }
  }
}
"#;

const UPLOAD_SCORES_MUTATION: &str = r#"
mutation UploadScores($input: UploadScoresInput!) {
  uploadScores(input: $input) {
    updatedCharts
    insertedScores
    skipped {
      chartId
      reason
    }
  }
}
"#;
```

Add the impls + command wrappers near the other command functions (e.g. after `fetch_cloud_song`):

```rust
pub(crate) async fn fetch_cloud_song_charts_impl(
    base_url: &str,
    token: &str,
    cloud_song_id: Value,
) -> Result<Value> {
    let result = graphql_result_with_url(
        base_url,
        token,
        SIMFILE_CHARTS_QUERY,
        json!({ "id": cloud_song_id.to_string().trim_matches('"') }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    let charts = data
        .pointer("/simfile/dtxFiles")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .map(|file| {
                    json!({
                        "id": file["id"],
                        "label": file["label"],
                        "level": file["level"],
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(api_success(Value::Array(charts)))
}

#[tauri::command]
pub async fn fetch_cloud_song_charts(app: AppHandle, cloud_song_id: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    fetch_cloud_song_charts_impl(&base_url, &token, cloud_song_id).await
}

pub(crate) async fn upload_scores_impl(
    base_url: &str,
    token: &str,
    payload: Value,
) -> Result<Value> {
    let result = graphql_result_with_url(
        base_url,
        token,
        UPLOAD_SCORES_MUTATION,
        json!({ "input": payload }),
    )
    .await?;
    let data = match result.success_data() {
        Ok(data) => data,
        Err((error, _)) => return Ok(api_failure(error)),
    };

    Ok(json!({
        "success": true,
        "data": data.get("uploadScores").cloned().unwrap_or(Value::Null),
    }))
}

#[tauri::command]
pub async fn upload_scores(app: AppHandle, payload: Value) -> Result<Value> {
    let base_url = api_base_url_from_env()?;
    let token = access_token_from_auth_state(&app.state::<AuthState>(), Some(&app)).await?;
    upload_scores_impl(&base_url, &token, payload).await
}
```

- [ ] **Step 4: Register the commands in `lib.rs`**

Add to the `generate_handler!` list (next to the other `api::` entries, e.g. after `api::upload_file,`):

```rust
            api::fetch_cloud_song_charts,
            api::upload_scores,
```

- [ ] **Step 5: Run tests, format, lint**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api`
Expected: PASS — the three new tests plus all pre-existing `api_tests`.

Run: `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Then: `cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Expected: clippy clean.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs \
        packages/dtx-desktop/src-tauri/src/lib.rs \
        packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "feat(desktop): add fetch_cloud_song_charts and upload_scores commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — `scoreMatching.ts` (pure difficulty matcher)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.ts`
- Test: `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.test.ts`

**Interfaces:**

- Produces (consumed by Task 5): `interface LocalChart { drumLevel: number; difficultyLabel: string }`; `interface CloudChart { id: string; label: string; level: number }`; `function matchCharts(local: LocalChart[], cloud: CloudChart[]): (string | null)[]` — returns, aligned to `local` by index, the matched cloud chart `id` or `null`. Each cloud chart is assigned to at most one local chart (greedy, in local order). Matching is by nearest `|cloud.level − drumLevel/10|`; an exact tie is broken by a non-empty case-insensitive `label` equality, and an unbroken tie (or no cloud charts left) yields `null`.

- [ ] **Step 1: Write the failing tests**

Create `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchCharts, type CloudChart, type LocalChart } from './scoreMatching';

const cloud = (id: string, level: number, label = ''): CloudChart => ({ id, level, label });
const local = (drumLevel: number, difficultyLabel = ''): LocalChart => ({
	drumLevel,
	difficultyLabel
});

describe('matchCharts', () => {
	it('matches each local chart to the nearest cloud level', () => {
		const result = matchCharts([local(55), local(88)], [cloud('a', 5.5), cloud('b', 8.8)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('assigns each cloud chart at most once (greedy in local order)', () => {
		const result = matchCharts([local(55), local(55)], [cloud('a', 5.5), cloud('b', 5.6)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('leaves an ambiguous tie unmatched when no label breaks it', () => {
		const result = matchCharts([local(50)], [cloud('a', 4.0), cloud('b', 6.0)]);
		expect(result).toEqual([null]);
	});

	it('breaks an equidistant tie by matching difficulty label', () => {
		const result = matchCharts(
			[local(50, 'ADVANCED')],
			[cloud('a', 4.0, 'BASIC'), cloud('b', 6.0, 'ADVANCED')]
		);
		expect(result).toEqual(['b']);
	});

	it('returns null for every local chart when there are no cloud charts', () => {
		expect(matchCharts([local(55), local(66)], [])).toEqual([null, null]);
	});

	it('leaves surplus local charts unmatched once cloud charts run out', () => {
		const result = matchCharts([local(55), local(56), local(57)], [cloud('a', 5.5)]);
		expect(result).toEqual(['a', null, null]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- scoreMatching.test.ts`
Expected: FAIL — `./scoreMatching` module does not exist.

- [ ] **Step 3: Implement `scoreMatching.ts`**

Create `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.ts`:

```ts
export interface LocalChart {
	/** DTXMania DrumLevel, stored ×10 (e.g. 55 == level 5.5). */
	drumLevel: number;
	difficultyLabel: string;
}

export interface CloudChart {
	id: string;
	label: string;
	/** Server dtx_files.level (e.g. 5.5). */
	level: number;
}

const EPSILON = 1e-9;

/**
 * Pair local DTXMania charts to a linked simfile's cloud charts by difficulty.
 * Returns, aligned to `local` by index, the matched cloud chart id or null.
 * Each cloud chart is used at most once (greedy, in local order); an equidistant
 * tie is broken by a non-empty, case-insensitive label match, and an unbroken
 * tie (or exhausted cloud charts) yields null for manual selection.
 */
export const matchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	const used = new Set<string>();

	return local.map((lc) => {
		const candidates = cloud.filter((c) => !used.has(c.id));
		if (candidates.length === 0) return null;

		const target = lc.drumLevel / 10;
		const diffs = candidates.map((c) => Math.abs(c.level - target));
		const minDiff = Math.min(...diffs);
		const tied = candidates.filter((_, i) => diffs[i] - minDiff < EPSILON);

		let chosen: CloudChart | null;
		if (tied.length === 1) {
			chosen = tied[0];
		} else {
			const label = lc.difficultyLabel.trim().toLowerCase();
			const labelMatches = label
				? tied.filter((c) => c.label.trim().toLowerCase() === label)
				: [];
			chosen = labelMatches.length === 1 ? labelMatches[0] : null;
		}

		if (!chosen) return null;
		used.add(chosen.id);
		return chosen.id;
	});
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- scoreMatching.test.ts`
Expected: PASS — all 6 cases.

- [ ] **Step 5: Typecheck and commit**

Run: `bun run --filter=dtx-desktop typecheck`
Expected: no new errors.

```bash
git add packages/dtx-desktop/src/renderer/src/lib/scoreMatching.ts \
        packages/dtx-desktop/src/renderer/src/lib/scoreMatching.test.ts
git commit -m "feat(desktop): add pure chart-matching helper for score upload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `Scores.svelte` view + host wiring + shell navigation

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/NavRail.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte`
- Create: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`

**Interfaces:**

- Consumes: `desktopHost` (Rust commands from Tasks 1–3), `matchCharts`/`CloudChart` (Task 4), `CloudSongAutocomplete` (`onselect(song)` / `onclose()` props; `song` is `{ id, title, artist, is_published }`).
- Produces: a self-contained view; the `desktopHost` methods `defaultDtxmaniaDbPath`, `selectDtxmaniaDb`, `parseDtxmaniaScores`, `fetchCloudSongCharts`, `uploadScores`; `ShellSection` gains `'scores'`.

- [ ] **Step 1: Add the `desktopHost` methods**

In `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`, add a `DialogResult` type near the other private types (after `type SelectFolderResult`):

```ts
type DialogResult = {
	canceled: boolean;
	filePaths: string[];
};
```

Add these methods to the `desktopHost` object (place after `searchCloudSongs`):

```ts
	defaultDtxmaniaDbPath: async (): Promise<string | null> =>
		await invokeHost<string | null>('default_dtxmania_db_path'),

	selectDtxmaniaDb: async (): Promise<DialogResult> =>
		await invokeHost<DialogResult>('select_dtxmania_db'),

	parseDtxmaniaScores: async <T = unknown>(dbPath: string): Promise<T> =>
		await invokeHost<T>('parse_dtxmania_scores', { dbPath }),

	fetchCloudSongCharts: async <T = unknown>(cloudSongId: string): Promise<T> =>
		await invokeHost<T>('fetch_cloud_song_charts', { cloudSongId }),

	uploadScores: async <T = unknown>(payload: unknown): Promise<T> =>
		await invokeHost<T>('upload_scores', { payload }),
```

- [ ] **Step 2: Add `'scores'` to `ShellSection`**

In `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`, change the type:

```ts
export type ShellSection = 'library' | 'cloud' | 'templates' | 'settings' | 'scores';
```

- [ ] **Step 3: Add the auth-only Scores nav item**

In `packages/dtx-desktop/src/renderer/src/components/shell/NavRail.svelte`, add `Trophy` to the lucide import and a nav item:

```svelte
import {(HardDrive, Cloud, FileText, Settings, Trophy)} from '@lucide/svelte';
```

Add to the `items` array (after the `cloud` entry so Scores sits with the other auth-only section):

```ts
		{ id: 'scores', label: 'Scores', icon: Trophy, authOnly: true },
```

- [ ] **Step 4: Render the Scores section and reset it when signed out**

In `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte`:

Add the import (after `import Settings from '../Settings.svelte';`):

```svelte
import Scores from '../Scores.svelte';
```

Extend the signed-out reset effect so `'scores'` (auth-only) falls back to the library, matching `'cloud'`:

```svelte
	$effect(() => {
		if (
			!$authStore.isAuthenticated &&
			($workspaceStore.activeSection === 'cloud' || $workspaceStore.activeSection === 'scores')
		) {
			workspaceStore.setActiveSection('library');
		}
	});
```

Add the render branch (after the `{:else if section === 'templates'}` branch, before `{:else if $workspaceStore.showNewSong}`):

```svelte
			{:else if section === 'scores'}
				<Scores />
```

- [ ] **Step 5: Write the failing test**

Create `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`. It mocks `../services/desktopHost` (which both `Scores.svelte` and the embedded `CloudSongAutocomplete` import), drives the real autocomplete with real timers (its 300 ms debounce elapses inside `waitFor`), and asserts parse render, auto-match, unmatched flagging, and the exact upload payload:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const host = vi.hoisted(() => ({
	defaultDtxmaniaDbPath: vi.fn(),
	selectDtxmaniaDb: vi.fn(),
	parseDtxmaniaScores: vi.fn(),
	fetchCloudSongCharts: vi.fn(),
	uploadScores: vi.fn(),
	searchCloudSongs: vi.fn()
}));
vi.mock('../services/desktopHost', () => ({ desktopHost: host }));

import Scores from './Scores.svelte';

const bestRow = {
	isBest: true,
	score: 950000,
	achievementRate: 91.3,
	rankLabel: 'A',
	fullCombo: true,
	cleared: true,
	maxCombo: 800,
	perfect: 500,
	great: 30,
	good: 10,
	poor: 5,
	miss: 2,
	performedAt: '2026-06-02',
	displayOrder: null
};
const recentRow = {
	isBest: false,
	score: null,
	achievementRate: 91.3,
	rankLabel: 'S',
	fullCombo: false,
	cleared: true,
	maxCombo: null,
	perfect: null,
	great: null,
	good: null,
	poor: null,
	miss: null,
	performedAt: '2026-06-02T00:00:00',
	displayOrder: 1
};
const parsedSongs = [
	{
		title: 'Played Song',
		artist: 'Artist A',
		genre: 'Rock',
		charts: [
			{
				difficultyLevel: 2,
				difficultyLabel: 'BASIC',
				drumLevel: 55,
				fileHash: 'hash-basic',
				aggregate: { playCount: 7, clearCount: 5 },
				best: bestRow,
				recent: [recentRow]
			}
		]
	}
];

beforeEach(() => {
	Object.values(host).forEach((fn) => fn.mockReset());
	host.defaultDtxmaniaDbPath.mockResolvedValue('/path/songs.db');
	host.parseDtxmaniaScores.mockResolvedValue(parsedSongs);
	host.searchCloudSongs.mockResolvedValue({
		success: true,
		data: [{ id: '42', title: 'Cloud Song', artist: 'Artist A', is_published: true }]
	});
	host.fetchCloudSongCharts.mockResolvedValue({
		success: true,
		data: [{ id: '10', label: 'BASIC', level: 5.5 }]
	});
	host.uploadScores.mockResolvedValue({
		success: true,
		data: { updatedCharts: 1, insertedScores: 2, skipped: [] }
	});
});

afterEach(() => cleanup());

describe('Scores', () => {
	it('parses the default db and renders songs, charts, and the best score', async () => {
		render(Scores);
		await waitFor(() =>
			expect(host.parseDtxmaniaScores).toHaveBeenCalledWith('/path/songs.db')
		);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
		expect(screen.getByText(/950,?000/)).toBeInTheDocument();
	});

	it('links a cloud song, auto-matches the chart, and uploads the expected payload', async () => {
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Open the link autocomplete for the song.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));

		// Drive the real CloudSongAutocomplete (300ms debounce elapses inside waitFor).
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		const suggestion = await screen.findByText('Cloud Song');
		await fireEvent.click(suggestion);

		// After select, charts are fetched and matched.
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Upload.
		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '10',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);
		expect(await screen.findByText(/uploaded 1 chart/i)).toBeInTheDocument();
	});

	it('flags an unmatched chart when no cloud chart matches', async () => {
		host.fetchCloudSongCharts.mockResolvedValue({ success: true, data: [] });
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		expect(await screen.findByText(/unmatched/i)).toBeInTheDocument();
	});
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- Scores.test.ts`
Expected: FAIL — `./Scores.svelte` does not exist.

- [ ] **Step 7: Implement `Scores.svelte`**

Create `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, FolderOpen, Trophy, Upload, AlertTriangle } from '@lucide/svelte';
	import { desktopHost } from '$lib/services/desktopHost';
	import CloudSongAutocomplete from '$lib/components/CloudSongAutocomplete.svelte';
	import { matchCharts, type CloudChart } from '$lib/lib/scoreMatching';

	interface ScorePayload {
		isBest: boolean;
		score: number | null;
		achievementRate: number | null;
		rankLabel: string | null;
		fullCombo: boolean;
		cleared: boolean;
		maxCombo: number | null;
		perfect: number | null;
		great: number | null;
		good: number | null;
		poor: number | null;
		miss: number | null;
		performedAt: string | null;
		displayOrder: number | null;
	}
	interface LocalChartData {
		difficultyLevel: number;
		difficultyLabel: string;
		drumLevel: number;
		fileHash: string;
		aggregate: { playCount: number; clearCount: number };
		best: ScorePayload | null;
		recent: ScorePayload[];
	}
	interface DtxmaniaSong {
		title: string;
		artist: string;
		genre: string;
		charts: LocalChartData[];
	}
	interface CloudSong {
		id: string;
		title: string;
		artist: string;
		is_published: boolean;
	}

	let dbPath = $state<string | null>(null);
	let songs = $state<DtxmaniaSong[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let links = $state<Record<number, CloudSong>>({});
	let cloudChartsBySong = $state<Record<number, CloudChart[]>>({});
	let matchesBySong = $state<Record<number, (string | null)[]>>({});
	let autocompleteFor = $state<number | null>(null);

	let uploadStatus = $state<string | null>(null);
	let skipped = $state<{ chartId: string; reason: string }[]>([]);

	const formatScore = (value: number | null): string =>
		value === null ? '—' : value.toLocaleString('en-US');

	onMount(async () => {
		const path = await desktopHost.defaultDtxmaniaDbPath();
		if (path) {
			dbPath = path;
			await loadScores(path);
		}
	});

	const loadScores = async (path: string) => {
		loading = true;
		error = null;
		try {
			songs = await desktopHost.parseDtxmaniaScores<DtxmaniaSong[]>(path);
			links = {};
			cloudChartsBySong = {};
			matchesBySong = {};
			uploadStatus = null;
			skipped = [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read songs.db';
			songs = [];
		} finally {
			loading = false;
		}
	};

	const handleChooseDb = async () => {
		const result = await desktopHost.selectDtxmaniaDb();
		if (!result.canceled && result.filePaths[0]) {
			dbPath = result.filePaths[0];
			await loadScores(dbPath);
		}
	};

	const handleLinkSelect = async (songIndex: number, song: CloudSong) => {
		links[songIndex] = song;
		autocompleteFor = null;
		const result = await desktopHost.fetchCloudSongCharts<{
			success: boolean;
			data?: CloudChart[];
		}>(song.id);
		const charts = result.success ? (result.data ?? []) : [];
		cloudChartsBySong[songIndex] = charts;
		matchesBySong[songIndex] = matchCharts(songs[songIndex].charts, charts);
	};

	const handleOverrideMatch = (songIndex: number, chartIndex: number, cloudChartId: string) => {
		const next = [...(matchesBySong[songIndex] ?? [])];
		next[chartIndex] = cloudChartId || null;
		matchesBySong[songIndex] = next;
	};

	const buildUpload = () => {
		const charts: Array<{
			chartId: string;
			playCount: number;
			clearCount: number;
			scores: ScorePayload[];
		}> = [];
		songs.forEach((song, songIndex) => {
			if (!links[songIndex]) return;
			const matches = matchesBySong[songIndex] ?? [];
			song.charts.forEach((chart, chartIndex) => {
				const chartId = matches[chartIndex];
				if (!chartId) return;
				const scores = [...(chart.best ? [chart.best] : []), ...chart.recent];
				if (scores.length === 0) return;
				charts.push({
					chartId,
					playCount: chart.aggregate.playCount,
					clearCount: chart.aggregate.clearCount,
					scores
				});
			});
		});
		return { charts };
	};

	const handleUpload = async () => {
		uploadStatus = 'Uploading…';
		skipped = [];
		const input = buildUpload();
		if (input.charts.length === 0) {
			uploadStatus = 'Nothing to upload — link a song and match at least one chart first.';
			return;
		}
		try {
			const result = await desktopHost.uploadScores<{
				success: boolean;
				data?: { updatedCharts: number; insertedScores: number; skipped: typeof skipped };
				error?: string;
			}>(input);
			if (result.success && result.data) {
				uploadStatus = `Uploaded ${result.data.updatedCharts} chart(s), ${result.data.insertedScores} score(s).`;
				skipped = result.data.skipped ?? [];
			} else {
				uploadStatus = result.error ?? 'Upload failed.';
			}
		} catch (e) {
			uploadStatus = e instanceof Error ? e.message : 'Upload failed.';
		}
	};
</script>

<div class="bg-base text-base-text min-h-full overflow-auto p-6">
	<div class="mb-4 flex items-center gap-3">
		<Trophy size={22} class="text-cyan" />
		<h1 class="font-display text-hi text-xl font-semibold">Scores</h1>
		<div class="ml-auto flex items-center gap-2">
			<button
				class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
				onclick={handleChooseDb}
			>
				<FolderOpen size={16} /> Choose songs.db
			</button>
			{#if dbPath}
				<button
					class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
					onclick={() => dbPath && loadScores(dbPath)}
				>
					<RefreshCw size={16} /> Reparse
				</button>
				<button
					class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium"
					onclick={handleUpload}
				>
					<Upload size={16} /> Upload
				</button>
			{/if}
		</div>
	</div>

	{#if uploadStatus}
		<p class="text-dim mb-3 text-sm">{uploadStatus}</p>
	{/if}
	{#if skipped.length > 0}
		<ul class="mb-3 text-xs text-red-300">
			{#each skipped as row}
				<li>Chart {row.chartId} skipped: {row.reason}</li>
			{/each}
		</ul>
	{/if}

	{#if loading}
		<p class="text-dim text-sm">Reading songs.db…</p>
	{:else if error}
		<p class="text-sm text-red-300">{error}</p>
	{:else if !dbPath}
		<p class="text-dim text-sm">
			No DTXManiaCX <code>songs.db</code> found. Use “Choose songs.db” to locate it.
		</p>
	{:else if songs.length === 0}
		<p class="text-dim text-sm">No drum scores found in this database.</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each songs as song, songIndex (song.title + song.artist + songIndex)}
				<div class="border-hairline bg-surface-1 rounded-xl border p-4">
					<div class="mb-2 flex items-center gap-3">
						<div class="min-w-0">
							<div class="text-hi truncate font-medium">{song.title}</div>
							<div class="text-dim truncate text-sm">{song.artist}</div>
						</div>
						<div class="relative ml-auto">
							{#if links[songIndex]}
								<span class="text-cyan text-sm"
									>Linked: {links[songIndex].title}</span
								>
								<button
									class="text-faint hover:text-hi ml-2 text-xs underline"
									onclick={() => (autocompleteFor = songIndex)}>change</button
								>
							{:else}
								<button
									class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 rounded-lg border px-3 py-1.5 text-sm"
									onclick={() => (autocompleteFor = songIndex)}
									aria-label="Link to cloud song"
								>
									Link to cloud song
								</button>
							{/if}
							<CloudSongAutocomplete
								isOpen={autocompleteFor === songIndex}
								onclose={() => (autocompleteFor = null)}
								onselect={(cloudSong) => handleLinkSelect(songIndex, cloudSong)}
							/>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						{#each song.charts as chart, chartIndex (chart.fileHash + chartIndex)}
							{@const matchedId =
								(matchesBySong[songIndex] ?? [])[chartIndex] ?? null}
							{@const cloudCharts = cloudChartsBySong[songIndex] ?? []}
							<div class="border-hairline rounded-lg border p-3">
								<div class="mb-1 flex items-center gap-2 text-sm">
									<span class="text-hi font-medium"
										>{chart.difficultyLabel || 'DRUMS'}</span
									>
									<span class="text-faint">Lv {chart.drumLevel / 10}</span>
									<span class="text-dim"
										>· plays {chart.aggregate.playCount} · clears {chart
											.aggregate.clearCount}</span
									>
									{#if links[songIndex]}
										{#if matchedId}
											<span class="text-green ml-auto text-xs">
												→ matched
											</span>
										{:else}
											<span
												class="ml-auto inline-flex items-center gap-1 text-xs text-red-300"
											>
												<AlertTriangle size={12} /> Unmatched
											</span>
										{/if}
									{/if}
								</div>

								{#if links[songIndex] && cloudCharts.length > 0}
									<label class="text-faint mb-2 block text-xs">
										Target chart:
										<select
											class="border-hairline bg-surface-2 text-hi ml-1 rounded px-2 py-1 text-xs"
											value={matchedId ?? ''}
											onchange={(e) =>
												handleOverrideMatch(
													songIndex,
													chartIndex,
													(e.currentTarget as HTMLSelectElement).value
												)}
										>
											<option value="">— none —</option>
											{#each cloudCharts as cc}
												<option value={cc.id}
													>{cc.label || 'chart'} (Lv {cc.level})</option
												>
											{/each}
										</select>
									</label>
								{/if}

								{#if chart.best}
									<div class="text-dim text-xs">
										Best: {formatScore(chart.best.score)} · {chart.best
											.rankLabel} ·
										{chart.best.achievementRate}% · combo {chart.best.maxCombo}
										{#if chart.best.fullCombo}· FC{/if}
									</div>
								{:else}
									<div class="text-faint text-xs">No best score recorded.</div>
								{/if}

								{#if chart.recent.length > 0}
									<ul class="text-faint mt-1 text-xs">
										{#each chart.recent as recent}
											<li>
												<span
													class:text-green-300={recent.cleared}
													class:text-red-300={!recent.cleared}
													>{recent.cleared ? 'Cleared' : 'Failed'}</span
												>
												· {recent.rankLabel ?? '—'} · {recent.achievementRate ??
													'—'}% · {recent.performedAt}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
```

> Note: handlers are prefixed with 'handle' per project convention (CLAUDE.md).

> Note: the implemented version calls `restoreLinks()` at the end of every `loadScores`, which covers both `handleChooseDb` and the Reparse flow. Each successful load restores persisted links after `loadScores` clears them.

> Note: `handleOverrideMatch` enforces one-to-one assignments — if the chosen cloud chart is already assigned to another local chart, that other chart's match is cleared first. `buildUpload` also deduplicates chart IDs as a safety net.

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- Scores.test.ts`
Expected: PASS — all three cases.

If the `screen.findByText('Cloud Song')` in the autocomplete dropdown is ambiguous (the linked label also renders "Cloud Song" after selection), scope the suggestion query to the dropdown button, e.g. `within(screen.getByRole('button', { name: /Cloud Song/ }))` — but selection happens _before_ the label renders, so the dropdown match should be unique at click time. Only adjust if the test reports multiple matches.

- [ ] **Step 9: Full desktop-frontend sweep, typecheck**

Run: `bun run --filter=dtx-desktop typecheck`
Expected: no new errors.

Run: `bun run --filter=dtx-desktop test`
Expected: PASS — the full desktop frontend suite (existing + `scoreMatching` + `Scores`), no regressions. NavRail/AppShell tests still green (the added auth-only item and section branch don't change existing assertions; if `NavRail.test.ts` asserts an exact item count, update it to include the new Scores item).

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/services/desktopHost.ts \
        packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts \
        packages/dtx-desktop/src/renderer/src/components/shell/NavRail.svelte \
        packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte \
        packages/dtx-desktop/src/renderer/src/components/Scores.svelte \
        packages/dtx-desktop/src/renderer/src/components/Scores.test.ts
git commit -m "feat(desktop): add Scores view with link, chart-match, and upload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Persist song → cloud links across sessions

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/score_links.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Test: `packages/dtx-desktop/src-tauri/src/tests/score_links_tests.rs`
- Test: `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`

**Interfaces:**

- Produces (Tauri commands): `read_score_song_links() -> HashMap<String, String>` (song key → cloud simfile id); `write_score_song_links(links: HashMap<String, String>) -> Result<()>`. Stored at `~/.dtxweb/score_links.json`.
- Produces (frontend): `desktopHost.readScoreSongLinks()`, `desktopHost.writeScoreSongLinks(links)`.

> **Design note (controller-resolved ambiguity):** the spec (§5.3.6) says "via the existing preferences store." The existing `Preferences` struct is a fixed, strongly-typed UI-prefs record persisted whole by `preferencesStore`; adding a links map there would let a pane-width save silently clobber the links (serde default → empty map). This task instead uses a **dedicated sibling file** (`~/.dtxweb/score_links.json`) with the same atomic-write mechanism and directory — honoring "the existing preferences mechanism" without the clobber risk. Isolated so the whole-branch review can gate/defer it independently.
>
> **Implementation deviation (accepted 2026-07-14):** the implementation folded `score_links` directly into the `Preferences` struct (`preferences.rs`) rather than using a dedicated sibling file. The clobber risk the design note warned about is mitigated by: (1) a `OnceLock<Mutex>` held across the full read-modify-write in both `write_preferences` and `write_score_song_links`, so concurrent calls can't interleave; (2) an empty-means-preserve merge — `write_preferences` detects an empty incoming `score_links` map and preserves the existing on-disk map, so the UI pref store (which doesn't send `score_links`) can't wipe it; (3) `write_score_song_links` does a direct replace (not a merge) since its contract is to set the map to exactly `links`. The mitigation is covered by stress tests. This was accepted as a simpler single-file approach that avoids a second persistence path.

- [ ] **Step 1: Write the failing Rust test**

Create `packages/dtx-desktop/src-tauri/src/tests/score_links_tests.rs`:

```rust
use super::*;
use tempfile::tempdir;

#[test]
fn read_missing_returns_empty_map() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");
    assert!(read_score_song_links_from(&path).is_empty());
}

#[test]
fn write_then_read_round_trips() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");

    let mut links = std::collections::HashMap::new();
    links.insert("Played Song\u{1f}Artist A".to_string(), "42".to_string());
    write_score_song_links_to(&path, &links).expect("write");

    let read = read_score_song_links_from(&path);
    assert_eq!(read.get("Played Song\u{1f}Artist A").map(String::as_str), Some("42"));
}

#[test]
fn read_tolerates_corrupt_file() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");
    std::fs::write(&path, b"{ not json").expect("write garbage");
    assert!(read_score_song_links_from(&path).is_empty());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml score_links`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `score_links.rs`**

Create `packages/dtx-desktop/src-tauri/src/score_links.rs` (mirrors the atomic-write pattern from `preferences.rs`):

```rust
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{DesktopError, Result};

type LinkMap = HashMap<String, String>;

fn score_links_path(home: &Path) -> PathBuf {
    home.join(".dtxweb").join("score_links.json")
}

/// Returns an empty map when the file is missing or unparseable.
fn read_score_song_links_from(path: &Path) -> LinkMap {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str::<LinkMap>(&contents).unwrap_or_default(),
        Err(_) => LinkMap::new(),
    }
}

/// Creates `~/.dtxweb/` if absent, then writes the map atomically (temp + rename).
fn write_score_song_links_to(path: &Path, links: &LinkMap) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(links)?;
    let mut tmp = path.to_path_buf();
    tmp.set_extension("json.tmp");
    fs::write(&tmp, json)?;
    let rename_result = fs::rename(&tmp, path);
    if rename_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    rename_result?;
    Ok(())
}

#[tauri::command]
pub fn read_score_song_links() -> LinkMap {
    match dirs::home_dir() {
        Some(home) => read_score_song_links_from(&score_links_path(&home)),
        None => LinkMap::new(),
    }
}

#[tauri::command]
pub fn write_score_song_links(links: LinkMap) -> Result<()> {
    match dirs::home_dir() {
        Some(home) => write_score_song_links_to(&score_links_path(&home), &links),
        None => Err(DesktopError::Message(
            "Could not resolve home directory".to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "tests/score_links_tests.rs"]
mod tests;
```

- [ ] **Step 4: Register the module and commands in `lib.rs`**

Add `mod score_links;` to the module list (after `mod scores;` — keep alphabetical: `score_links` before `scores`? use the order `mod score_links; mod scores;`). Then add to `generate_handler!` (near `preferences::`):

```rust
            score_links::read_score_song_links,
            score_links::write_score_song_links,
```

- [ ] **Step 5: Run the Rust test, format, lint**

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml score_links`
Expected: PASS.

Run: `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Then: `cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Expected: clippy clean.

- [ ] **Step 6: Add the `desktopHost` methods**

In `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`, add (after `uploadScores`):

```ts
	readScoreSongLinks: async (): Promise<Record<string, string>> =>
		await invokeHost<Record<string, string>>('read_score_song_links'),

	writeScoreSongLinks: async (links: Record<string, string>): Promise<void> =>
		await sendHost('write_score_song_links', { links }),
```

- [ ] **Step 7: Wire persistence into `Scores.svelte`**

Add a stable song key and load/save calls. In the `<script>` of `Scores.svelte`:

Add a helper (near `formatScore`):

```ts
const songKey = (song: DtxmaniaSong): string => `${song.title}${song.artist}`;
let savedLinks = $state<Record<string, string>>({});
```

Extend `onMount` to load saved links first, and after parsing prefill links whose cloud id was remembered:

```ts
onMount(async () => {
	savedLinks = await desktopHost.readScoreSongLinks();
	const path = await desktopHost.defaultDtxmaniaDbPath();
	if (path) {
		dbPath = path;
		await loadScores(path);
		await restoreLinks();
	}
});

const restoreLinks = async () => {
	for (let i = 0; i < songs.length; i++) {
		const cloudId = savedLinks[songKey(songs[i])];
		if (!cloudId) continue;
		await handleLinkSelect(i, {
			id: cloudId,
			title: `Simfile #${cloudId}`,
			artist: songs[i].artist,
			is_published: false
		});
	}
};
```

In `handleLinkSelect`, after setting `links[songIndex] = song`, persist the mapping:

```ts
links[songIndex] = song;
savedLinks = { ...savedLinks, [songKey(songs[songIndex])]: song.id };
void desktopHost.writeScoreSongLinks(savedLinks);
autocompleteFor = null;
```

(`restoreLinks` reuses `handleLinkSelect`, which now also re-writes the same mapping — idempotent. The placeholder title `Simfile #<id>` is shown only until the user changes it; matching still works because it fetches real charts by id.)

- [ ] **Step 8: Extend `Scores.test.ts` for persistence**

Add `readScoreSongLinks: vi.fn()` and `writeScoreSongLinks: vi.fn()` to the hoisted `host` object, and in `beforeEach` default them:

```ts
host.readScoreSongLinks.mockResolvedValue({});
host.writeScoreSongLinks.mockResolvedValue(undefined);
```

Add a test:

```ts
it('persists a link selection and restores it on next mount', async () => {
	const { unmount } = render(Scores);
	expect(await screen.findByText('Played Song')).toBeInTheDocument();
	await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
	const input = await screen.findByPlaceholderText(/search by song title or artist/i);
	await fireEvent.input(input, { target: { value: 'Cloud Song' } });
	await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
	await fireEvent.click(await screen.findByText('Cloud Song'));

	await waitFor(() =>
		expect(host.writeScoreSongLinks).toHaveBeenCalledWith({
			['Played SongArtist A']: '42'
		})
	);
	unmount();

	// Next mount: saved link is restored -> fetchCloudSongCharts called for '42'.
	host.readScoreSongLinks.mockResolvedValue({ ['Played SongArtist A']: '42' });
	host.fetchCloudSongCharts.mockClear();
	render(Scores);
	await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));
});
```

- [ ] **Step 9: Run tests, typecheck, sweep**

Run: `bun run --filter=dtx-desktop test -- Scores.test.ts`
Expected: PASS — all four cases.

Run: `bun run --filter=dtx-desktop typecheck`
Expected: no new errors.

Run: `bun run --filter=dtx-desktop test`
Expected: full desktop frontend suite green.

Run: `cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`
Expected: full Rust suite green.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/score_links.rs \
        packages/dtx-desktop/src-tauri/src/lib.rs \
        packages/dtx-desktop/src-tauri/src/tests/score_links_tests.rs \
        packages/dtx-desktop/src/renderer/src/services/desktopHost.ts \
        packages/dtx-desktop/src/renderer/src/components/Scores.svelte \
        packages/dtx-desktop/src/renderer/src/components/Scores.test.ts
git commit -m "feat(desktop): persist song-to-cloud score links across sessions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deployment note (post-merge, manual — not part of these tasks)

Phase 1's migration `packages/dtx-api/d1-migrations/0002_scores.sql` must be applied to local/preprod/prod D1 via `wrangler d1` when the API is deployed (migrations are manual — no CI/CD). Until the API deploy + migration land, uploads from the desktop will fail server-side. This is out of scope for the desktop code but is the operational prerequisite for the end-to-end feature.

---

## Self-Review

**1. Spec coverage (§5–§6, §8–§9):**

- §5.1 `rusqlite` bundled + read-only → Task 2 (dep + `OpenFlags::SQLITE_OPEN_READ_ONLY`). ✅
- §5.1 `default_dtxmania_db_path` (3 platforms) → Task 1 via `dirs::data_dir()`. ✅
- §5.1 `parse_dtxmania_scores` (Songs→SongCharts→SongScores Instrument=0→≤5 PerformanceHistory) → Task 2. ✅
- §5.1 `upload_scores` via `run_graphql_value` → Task 3. ✅
- §5.2 best mapping table, rank derivation, recent HistoryLine parse, score NULL for recent, tolerant parsing → Tasks 1 (parsers) + 2 (assembly). ✅
- §5.2 returned `DtxmaniaSong` JSON shape → Task 1 structs (camelCase). ✅
- §5.3 Scores view: default path + file-picker override, render, `CloudSongAutocomplete` link, auto-match + override dropdown + unmatched flag, Upload building `UploadScoresInput` + skipped list, persist mapping → Tasks 1 (picker), 5 (view), 6 (persistence). ✅
- §5.3 `Scores.test.ts` (mock invoke): parse render, link+auto-match, unmatched flag, upload payload → Task 5 test. ✅
- §6 song link (explicit) + chart match by `DrumLevel/10` vs `level`, label tiebreaker, override, only matched uploaded → Task 4 (`matchCharts`) + Task 5 (wiring). ✅
- §8 error handling: missing/locked db (Task 2 error + Task 5 error state + picker fallback), malformed HistoryLine tolerated (Task 1), unlinked/unmatched excluded from upload (Task 5 `buildUpload`), partial upload `skipped[]` surfaced (Task 5). ✅
- §9 testing: Rust parser + HistoryLine + default-path (Tasks 1–2), API commands (Task 3), matcher + view (Tasks 4–5), persistence (Task 6). ✅
- **Gap check:** the extra `fetch_cloud_song_charts` command (not named in the spec) is required because the spec's chart-match step needs the real `dtx_files.id`, which the existing `SimfileFull` fragment does not expose — documented in Task 3. Not a spec gap; a necessary enabler.

**2. Placeholder scan:** no TBD/TODO; every code step carries complete code; every test step has real assertions. One typo corrected inline (Task 2 Cargo.toml path). ✅

**3. Type consistency:** `ScorePayload` (Task 1) ⇄ `ScoreInput` field set (schema) ⇄ frontend `ScorePayload` (Task 5) ⇄ upload payload (Task 5 `buildUpload`) all agree. `matchCharts` signature (Task 4) matches its call in Task 5. `CloudChart { id, label, level }` matches `fetch_cloud_song_charts` output (Task 3) and the `select`/dropdown in Task 5. `DialogResult { canceled, filePaths }` matches `select_dtxmania_db` (Task 1, via `models::DialogResult`) and `desktopHost.selectDtxmaniaDb` (Task 5). Command arg camelCase→snake_case (`dbPath`→`db_path`, `cloudSongId`→`cloud_song_id`, `payload`→`payload`, `links`→`links`) follows the existing Tauri convention (`excludeLinkedSongIds`→`exclude_linked_song_ids`). ✅
