use super::*;
use tempfile::tempdir;

#[test]
fn derive_rank_label_covers_all_bands() {
    assert_eq!(derive_rank_label(100.0), "SS");
    assert_eq!(derive_rank_label(99.99), "S");
    assert_eq!(derive_rank_label(95.0), "S");
    assert_eq!(derive_rank_label(94.99), "A");
    assert_eq!(derive_rank_label(90.0), "A");
    assert_eq!(derive_rank_label(80.0), "B");
    assert_eq!(derive_rank_label(70.0), "C");
    assert_eq!(derive_rank_label(60.0), "D");
    assert_eq!(derive_rank_label(50.0), "E");
    assert_eq!(derive_rank_label(49.99), "F");
    assert_eq!(derive_rank_label(0.0), "F");
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
    assert_eq!(
        resolved,
        Some(dtx_dir.join("songs.db").to_string_lossy().into_owned())
    );
}

#[test]
fn default_path_absent_when_db_missing() {
    let dir = tempdir().expect("tempdir");
    assert_eq!(
        default_dtxmania_db_path_from(Some(dir.path().to_path_buf())),
        None
    );
    assert_eq!(default_dtxmania_db_path_from(None), None);
}

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
    assert!(best.cleared); // clear_count > 0
    assert!(best.full_combo);
    assert_eq!(best.max_combo, Some(800));
    assert_eq!(best.perfect, Some(500));
    assert_eq!(best.performed_at.as_deref(), Some("2026-06-02"));
    assert_eq!(best.display_order, None);

    // Recent: 2 rows, ordered by DisplayOrder; score NULL; garbage tolerated.
    assert_eq!(chart.recent.len(), 2);
    let r1 = &chart.recent[0];
    assert!(!r1.is_best);
    assert_eq!(r1.score, None);
    assert_eq!(r1.rank_label.as_deref(), Some("S"));
    assert_eq!(r1.achievement_rate, Some(91.30));
    assert!(r1.cleared);
    assert_eq!(r1.display_order, Some(1));
    let r2 = &chart.recent[1];
    assert_eq!(r2.rank_label, None); // malformed line
    assert!(!r2.cleared); // defaults to false
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

#[test]
fn parse_dtxmania_scores_command_delegates_to_impl() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db(&db);

    let songs = parse_dtxmania_scores(db.to_string_lossy().into_owned()).expect("parse");
    assert_eq!(songs.len(), 2);
    assert_eq!(songs[0].title, "Played Song");
}

#[test]
fn parse_dtxmania_scores_command_errors_for_missing_db() {
    let dir = tempdir().expect("tempdir");
    let missing = dir.path().join("nope.db");
    assert!(parse_dtxmania_scores(missing.to_string_lossy().into_owned()).is_err());
}

/// A chart with no drums score row at all is skipped (the `continue` branch
/// in `read_song_charts`), so its parent song only appears if another chart
/// has a drums score.
fn seed_db_with_scoreless_chart(path: &std::path::Path) {
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

         INSERT INTO Songs VALUES (1, 'Mixed Song', 'Artist', 'Rock');

         -- Chart 1: has a drums score row (played).
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         -- Chart 2: NO drums score row at all -> must be skipped.
         INSERT INTO SongCharts VALUES (2, 1, 5, 'EXTREME', 88, 'hash-extreme');

         INSERT INTO SongScores VALUES (20, 1, 0, 880000, 88.0, 0, 3, 2, 700, 400, 50, 20, 10, 5, '2026-06-01');",
    )
    .expect("seed");
}

#[test]
fn parse_skips_chart_with_no_drums_score_row() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_with_scoreless_chart(&db);

    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);
    // Only the chart with a drums score row appears; the scoreless chart is dropped.
    assert_eq!(songs[0].charts.len(), 1);
    assert_eq!(songs[0].charts[0].file_hash, "hash-basic");
}

#[test]
fn default_dtxmania_db_path_does_not_panic() {
    // `dirs::data_dir()` resolves from the OS environment. In a test runner this
    // is the developer's real machine, so we only assert it returns a consistent
    // Option<String> without panicking — the path-existence logic is covered by
    // the `default_dtxmania_db_path_from` unit tests above.
    let _ = default_dtxmania_db_path();
}
