use std::path::PathBuf;

use serde::Serialize;

/// Individual score row destined for the GraphQL `ScoreInput`. Serializes to the
/// exact `ScoreInput` field set (camelCase), so the renderer forwards these
/// objects to `uploadScores` verbatim.
///
/// Not yet constructed in this task — `scores::parse_dtxmania_scores` (Task 2)
/// is the reader that builds these from the DTXMania SQLite database.
#[allow(dead_code)]
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
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartAggregate {
    pub play_count: i64,
    pub clear_count: i64,
}

/// Not yet constructed in this task — see `ScorePayload`.
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
