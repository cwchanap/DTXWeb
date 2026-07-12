use std::path::PathBuf;

use serde::Serialize;

use rusqlite::{Connection, OpenFlags, OptionalExtension};

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
pub fn parse_dtxmania_scores(db_path: String) -> Result<Vec<DtxmaniaSong>> {
    parse_dtxmania_scores_impl(&db_path)
}

#[cfg(test)]
#[path = "tests/scores_tests.rs"]
mod tests;
