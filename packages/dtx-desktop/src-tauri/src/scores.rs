use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use rusqlite::{Connection, OpenFlags};
use tauri::{AppHandle, Manager};

use crate::error::{DesktopError, Result};

/// Individual score row destined for the GraphQL `ScoreInput`. Serializes to the
/// exact `ScoreInput` field set (camelCase), so the renderer forwards these
/// objects to `uploadScores` verbatim.
///
/// Not yet constructed in this task — `scores::parse_dtxmania_scores` (Task 2)
/// is the reader that builds these from the DTXMania SQLite database.
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

/// Not yet constructed in this task — see `ScorePayload`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
}

/// Not yet constructed in this task — see `ScorePayload`.
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

/// Not yet constructed in this task — see `ScorePayload`.
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
///
/// Unit-tested directly (see `tests/scores_tests.rs`); not yet called from
/// production code — `scores::parse_dtxmania_scores` (Task 2) is the caller.
pub fn derive_rank_label(rate: f64) -> &'static str {
    if rate >= 100.0 {
        "SS"
    } else if rate >= 95.0 {
        "S"
    } else if rate >= 90.0 {
        "A"
    } else if rate >= 80.0 {
        "B"
    } else if rate >= 70.0 {
        "C"
    } else if rate >= 60.0 {
        "D"
    } else if rate >= 50.0 {
        "E"
    } else {
        "F"
    }
}

/// Not yet constructed in this task — see `ScorePayload`.
pub struct ParsedHistory {
    pub cleared: Option<bool>,
    pub rank_label: Option<String>,
    pub achievement_rate: Option<f64>,
}

/// Tolerant parser for a DTXMania `HistoryLine`, e.g. `10.26/6/2 Cleared (S: 91.30)`.
/// Any field that cannot be read is left `None`; the parser never fails.
///
/// Unit-tested directly (see `tests/scores_tests.rs`); not yet called from
/// production code — `scores::parse_dtxmania_scores` (Task 2) is the caller.
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

/// Tauri-managed state tracking the last database path selected via the OS
/// file dialog (`select_dtxmania_db`). `parse_dtxmania_scores` only accepts
/// the default DTXMania path or a path stored here, so a compromised renderer
/// cannot open an arbitrary SQLite file.
#[derive(Default)]
pub struct DtxmaniaDbState {
    dialog_path: Mutex<Option<PathBuf>>,
}

impl DtxmaniaDbState {
    pub fn set(&self, path: PathBuf) {
        *self
            .dialog_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(path);
    }

    pub fn get(&self) -> Option<PathBuf> {
        self.dialog_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

/// Compares two filesystem paths by canonicalizing both and comparing the
/// resolved forms, so a path that differs in representation (relative vs
/// absolute, symlink, trailing slash) but points to the same file is accepted.
/// Falls back to a raw string comparison when canonicalization fails for
/// either side (e.g. the path does not exist).
fn paths_equal(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// Validates that `db_path` is either the default DTXMania database path
/// (resolved from the OS data directory) or a path previously selected via
/// the OS file dialog (stored in `DtxmaniaDbState`). Any other path is
/// rejected so a compromised renderer cannot use `parse_dtxmania_scores` to
/// open an arbitrary SQLite database.
fn validate_dtxmania_db_path(db_path: &str, dialog_path: Option<&std::path::Path>) -> Result<()> {
    if let Some(default) = default_dtxmania_db_path() {
        if paths_equal(db_path, &default) {
            return Ok(());
        }
    }
    if let Some(dialog) = dialog_path {
        if paths_equal(db_path, &dialog.to_string_lossy()) {
            return Ok(());
        }
    }
    Err(DesktopError::Message(
        "Database path is not allowed. Use the default DTXMania path or select a database via the file picker.".to_string(),
    ))
}

/// Testable inner: validates the path against the allowed set, then parses.
/// Production code passes the dialog path from `DtxmaniaDbState`; tests pass
/// it directly.
pub(crate) fn parse_dtxmania_scores_with_dialog_path(
    db_path: &str,
    dialog_path: Option<&std::path::Path>,
) -> Result<Vec<DtxmaniaSong>> {
    validate_dtxmania_db_path(db_path, dialog_path)?;
    parse_dtxmania_scores_impl(db_path)
}

struct DrumsScoreRow {
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

/// One row from the joined SELECT. The song/chart/score columns repeat across
/// rows for the same chart; only the history columns (`hist_*`) vary (and are
/// `None` when the chart has no PerformanceHistory rows, via LEFT JOIN).
struct JoinedRow {
    song_id: i64,
    title: String,
    artist: String,
    genre: String,
    chart_id: i64,
    difficulty_level: i64,
    difficulty_label: String,
    drum_level: i64,
    file_hash: String,
    score: DrumsScoreRow,
    hist_performed_at: Option<String>,
    hist_history_line: Option<String>,
    hist_display_order: Option<i64>,
}

const JOINED_QUERY: &str = "\
SELECT s.Id, s.Title, s.Artist, s.Genre, \
       c.Id, c.DifficultyLevel, c.DifficultyLabel, c.DrumLevel, c.FileHash, \
       ss.BestScore, ss.BestAchievementRate, ss.FullCombo, ss.PlayCount, \
       ss.ClearCount, ss.MaxCombo, ss.BestPerfect, ss.BestGreat, ss.BestGood, \
       ss.BestPoor, ss.BestMiss, ss.LastPlayedAt, \
       ph.PerformedAt, ph.HistoryLine, ph.DisplayOrder \
FROM Songs s \
JOIN SongCharts c ON c.SongId = s.Id \
JOIN SongScores ss ON ss.ChartId = c.Id AND ss.Instrument = 0 \
LEFT JOIN PerformanceHistory ph ON ph.SongScoreId = ss.Id \
ORDER BY s.Id, c.Id, ph.DisplayOrder";

fn read_joined_rows(conn: &Connection) -> Result<Vec<JoinedRow>> {
    let mut stmt = conn.prepare(JOINED_QUERY)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(JoinedRow {
                song_id: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                genre: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                chart_id: row.get(4)?,
                difficulty_level: row.get(5)?,
                difficulty_label: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                drum_level: row.get(7)?,
                file_hash: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                score: DrumsScoreRow {
                    best_score: row.get(9)?,
                    best_achievement_rate: row.get(10)?,
                    full_combo: row.get(11)?,
                    play_count: row.get(12)?,
                    clear_count: row.get(13)?,
                    max_combo: row.get(14)?,
                    best_perfect: row.get(15)?,
                    best_great: row.get(16)?,
                    best_good: row.get(17)?,
                    best_poor: row.get(18)?,
                    best_miss: row.get(19)?,
                    last_played_at: row.get(20)?,
                },
                hist_performed_at: row.get(21)?,
                hist_history_line: row.get(22)?,
                hist_display_order: row.get(23)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Groups the flat joined rows into the nested `DtxmaniaSong` → `DtxmaniaChart`
/// → best + recent structure. Rows are ordered by `s.Id, c.Id, ph.DisplayOrder`,
/// so a sequential walk builds each song/chart in order. Recent scores are
/// capped at 5 per chart (matching the original `LIMIT 5`).
fn group_joined_rows(rows: Vec<JoinedRow>) -> Vec<DtxmaniaSong> {
    let mut songs: Vec<DtxmaniaSong> = Vec::new();
    let mut cur_song_id: Option<i64> = None;
    let mut cur_chart_id: Option<i64> = None;
    let mut cur_chart: Option<DtxmaniaChart> = None;
    let mut recent_count: usize = 0;

    for row in rows {
        // Song boundary: push the in-progress chart (if any) and song, reset.
        if cur_song_id != Some(row.song_id) {
            if let Some(chart) = cur_chart.take() {
                if let Some(song) = songs.last_mut() {
                    song.charts.push(chart);
                }
            }
            cur_chart_id = None;
            recent_count = 0;
            cur_song_id = Some(row.song_id);
            songs.push(DtxmaniaSong {
                title: row.title.clone(),
                artist: row.artist.clone(),
                genre: row.genre.clone(),
                charts: Vec::new(),
            });
        }

        // Chart boundary: push the in-progress chart, start a new one.
        if cur_chart_id != Some(row.chart_id) {
            if let Some(chart) = cur_chart.take() {
                if let Some(song) = songs.last_mut() {
                    song.charts.push(chart);
                }
            }
            cur_chart_id = Some(row.chart_id);
            recent_count = 0;
            let best = build_best(&row.score);
            cur_chart = Some(DtxmaniaChart {
                difficulty_level: row.difficulty_level,
                difficulty_label: row.difficulty_label.clone(),
                drum_level: row.drum_level,
                file_hash: row.file_hash.clone(),
                aggregate: ChartAggregate {
                    play_count: row.score.play_count,
                    clear_count: row.score.clear_count,
                },
                best,
                recent: Vec::new(),
            });
        }

        // History row (if present): append to recent, capped at 5.
        if let (Some(performed_at), Some(history_line), Some(display_order)) = (
            row.hist_performed_at,
            row.hist_history_line,
            row.hist_display_order,
        ) {
            if recent_count < 5 {
                let parsed = parse_history_line(&history_line);
                if let Some(chart) = cur_chart.as_mut() {
                    chart.recent.push(ScorePayload {
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
                    });
                }
                recent_count += 1;
            }
        }
    }

    // Push the final in-progress chart into the last song.
    if let Some(chart) = cur_chart {
        if let Some(song) = songs.last_mut() {
            song.charts.push(chart);
        }
    }

    songs
}

pub(crate) fn parse_dtxmania_scores_impl(db_path: &str) -> Result<Vec<DtxmaniaSong>> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| DesktopError::Message(format!("Failed to open songs.db: {error}")))?;
    let rows = read_joined_rows(&conn)?;
    Ok(group_joined_rows(rows))
}

#[tauri::command]
pub async fn parse_dtxmania_scores(app: AppHandle, db_path: String) -> Result<Vec<DtxmaniaSong>> {
    // Offload the sync SQLite work to a blocking thread so the Tauri async
    // runtime (and the webview UI) is not frozen while parsing a large library.
    // The dialog path is read from managed state before spawning so the
    // blocking task can validate + parse in one shot.
    let dialog_path = app.state::<DtxmaniaDbState>().get();
    tokio::task::spawn_blocking(move || {
        parse_dtxmania_scores_with_dialog_path(&db_path, dialog_path.as_deref())
    })
    .await
    .map_err(|error| DesktopError::Message(format!("Parse task failed: {error}")))?
}

#[cfg(test)]
#[path = "tests/scores_tests.rs"]
mod tests;
