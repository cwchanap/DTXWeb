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

/// `build_best` reads `best_achievement_rate` straight from songs.db
/// (BestAchievementRate REAL). A corrupt NaN/Inf is not JSON-serializable and
/// would abort the whole ScorePayload across the Tauri IPC boundary, failing
/// the entire database parse for one bad row. Mirror `parse_history_line`'s
/// finiteness guard: drop both `achievement_rate` and the derived `rank_label`
/// (a rank derived from NaN/Inf would be misleading) instead of propagating
/// the non-finite value.
#[test]
fn build_best_drops_non_finite_achievement_rate() {
    let mut row = DrumsScoreRow {
        best_score: 950000,
        best_achievement_rate: 91.3,
        full_combo: 0,
        play_count: 7,
        clear_count: 5,
        max_combo: 800,
        best_perfect: 500,
        best_great: 30,
        best_good: 10,
        best_poor: 5,
        best_miss: 2,
        last_played_at: Some("2026-06-02".to_string()),
    };

    // Sanity: a finite rate round-trips with a derived rank label.
    let finite = build_best(&row).expect("best present");
    assert_eq!(finite.achievement_rate, Some(91.3));
    assert_eq!(finite.rank_label.as_deref(), Some("S"));

    // NaN: must NOT propagate as Some(NaN); both rate and rank drop to None.
    row.best_achievement_rate = f64::NAN;
    let nan = build_best(&row).expect("best present");
    assert_eq!(nan.achievement_rate, None);
    assert_eq!(nan.rank_label, None);
    // Other fields are unaffected — the row still loads.
    assert_eq!(nan.score, Some(950000));
    assert!(nan.cleared);
    assert_eq!(nan.max_combo, Some(800));

    // +Inf: same guard.
    row.best_achievement_rate = f64::INFINITY;
    let inf = build_best(&row).expect("best present");
    assert_eq!(inf.achievement_rate, None);
    assert_eq!(inf.rank_label, None);

    // -Inf: same guard.
    row.best_achievement_rate = f64::NEG_INFINITY;
    let neg_inf = build_best(&row).expect("best present");
    assert_eq!(neg_inf.achievement_rate, None);
    assert_eq!(neg_inf.rank_label, None);

    // play_count == 0 still short-circuits to None regardless of rate.
    row.play_count = 0;
    row.best_achievement_rate = f64::NAN;
    assert!(build_best(&row).is_none());
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
fn parse_history_line_drops_unknown_rank_tokens() {
    // Keep the play (cleared + rate) but drop a rank the API would reject.
    let parsed = parse_history_line("10.26/6/2 Cleared (EX: 91.30)");
    assert_eq!(parsed.cleared, Some(true));
    assert_eq!(parsed.rank_label, None);
    assert_eq!(parsed.achievement_rate, Some(91.30));

    let e = parse_history_line("Failed (E: 40.00)");
    assert_eq!(e.rank_label.as_deref(), Some("E"));
    assert_eq!(e.achievement_rate, Some(40.00));
}

#[test]
fn parse_history_line_rejects_non_finite_rates() {
    // "NaN" and "inf" parse as f64 but are not JSON-serializable; treat them
    // as missing so a malformed history line never aborts the whole parse.
    let nan = parse_history_line("Cleared (S: NaN)");
    assert_eq!(nan.cleared, Some(true));
    assert_eq!(nan.rank_label.as_deref(), Some("S"));
    assert_eq!(nan.achievement_rate, None);

    let inf = parse_history_line("Cleared (A: inf)");
    assert_eq!(inf.rank_label.as_deref(), Some("A"));
    assert_eq!(inf.achievement_rate, None);

    let neg_inf = parse_history_line("Failed (B: -inf)");
    assert_eq!(neg_inf.cleared, Some(false));
    assert_eq!(neg_inf.achievement_rate, None);
}

// Pins the word-boundary rejection on BOTH sides: "Cleared"/"Failed" must
// appear as a standalone outcome token (at a line edge or adjacent to a
// non-alphanumeric character) to be detected. A token glued to a neighboring
// word on either side — a preceding word (e.g. "NotCleared") or a trailing
// suffix (e.g. "ClearedExtra") — must NOT be read as a clear. The
// `contains_outcome_token` helper enforces both boundaries. This guards
// against a future regression that loosens the match to a bare
// `contains("Cleared")`.
#[test]
fn parse_history_line_rejects_outcome_token_without_left_word_boundary() {
    // "NotCleared" has no left boundary before "Cleared".
    let glued_cleared = parse_history_line("10.26/6/2 NotCleared (S: 91.30)");
    assert_eq!(glued_cleared.cleared, None);
    // The rank/rate inside the parens still parse independently of the token.
    assert_eq!(glued_cleared.rank_label.as_deref(), Some("S"));
    assert_eq!(glued_cleared.achievement_rate, Some(91.30));

    let glued_failed = parse_history_line("10.26/6/2 NotFailed (B: 70.10)");
    assert_eq!(glued_failed.cleared, None);
    assert_eq!(glued_failed.rank_label.as_deref(), Some("B"));

    // "ClearedExtra" / "FailedExtra" have no right boundary after the token.
    let suffixed_cleared = parse_history_line("10.26/6/2 ClearedExtra (S: 91.30)");
    assert_eq!(suffixed_cleared.cleared, None);
    assert_eq!(suffixed_cleared.rank_label.as_deref(), Some("S"));
    assert_eq!(suffixed_cleared.achievement_rate, Some(91.30));

    let suffixed_failed = parse_history_line("10.26/6/2 FailedExtra (B: 70.10)");
    assert_eq!(suffixed_failed.cleared, None);
    assert_eq!(suffixed_failed.rank_label.as_deref(), Some("B"));
    assert_eq!(suffixed_failed.achievement_rate, Some(70.10));
}

// A realistic history line with a valid date and rank/rate but NO
// "Cleared"/"Failed" outcome token. `parse_history_line` returns
// `cleared: None`, and `group_joined_rows` applies the safe default
// `cleared: false` (the `unwrap_or(false)` tolerance contract): the row
// exists in the user's DTXMania DB so a play happened, but the outcome is
// unknown — render the safe default without overclaiming a clear. This
// complements `parse_maps_best_recent_and_ignores_non_drums` (which pins the
// same default for a fully garbage line) with a realistic partial-parse case.
#[test]
fn parse_history_line_without_outcome_token_yields_cleared_none() {
    let parsed = parse_history_line("10.26/6/2 (S: 91.30)");
    assert_eq!(parsed.cleared, None);
    assert_eq!(parsed.rank_label.as_deref(), Some("S"));
    assert_eq!(parsed.achievement_rate, Some(91.30));
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
    assert_eq!(played.song_id, 1); // DTXMania Songs.Id, used as the renderer songKey
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
    assert_eq!(best.rank_label.as_deref(), Some("S")); // 91.3 -> S (DTXManiaCX: >= 80)
    assert!(best.cleared); // clear_count > 0
    assert!(best.full_combo);
    assert_eq!(best.max_combo, Some(800));
    assert_eq!(best.perfect, Some(500));
    assert_eq!(best.performed_at.as_deref(), Some("2026-06-02"));
    assert_eq!(best.display_order, None);

    // Recent: 2 rows, ordered by DisplayOrder; score NULL; garbage tolerated.
    // The malformed row is KEPT (not dropped) with cleared=false: the row
    // exists in the user's DTXMania DB, so a play happened — we just can't
    // parse the outcome. This pins the deliberate tolerance contract
    // documented at the `unwrap_or(false)` call site in `group_joined_rows`.
    // An unparseable line is not the same as a known failure, but the binary
    // `cleared: bool` field admits no "unknown" state without a schema/UI
    // change. If you change this assertion, update that comment too.
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
    assert!(!r2.cleared); // unparseable -> safe default (NOT a known failure)
    assert_eq!(r2.performed_at.as_deref(), Some("2026-05-28T00:00:00"));

    // Never-played chart: present, best null, recent empty.
    let never = &songs[1];
    assert_eq!(never.song_id, 2); // distinct from song 1 — songKey can't collide
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
    let db_path = db.to_string_lossy().into_owned();

    // The command validates the path against the allowed set (default OS
    // DTXMania path or a dialog-selected path) before parsing. Simulate the
    // dialog path being set to the temp DB so the validation passes.
    let songs = parse_dtxmania_scores_with_dialog_path(&db_path, Some(&db)).expect("parse");
    assert_eq!(songs.len(), 2);
    assert_eq!(songs[0].title, "Played Song");
}

#[test]
fn parse_dtxmania_scores_command_errors_for_missing_db() {
    let dir = tempdir().expect("tempdir");
    let missing = dir.path().join("nope.db");
    // Register the missing path as a dialog path so the validation passes and
    // the error comes from the SQLite open, not the path guard.
    assert!(
        parse_dtxmania_scores_with_dialog_path(missing.to_str().unwrap(), Some(&missing)).is_err()
    );
}

#[test]
fn parse_rejects_path_not_in_allowed_set() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db(&db);

    // No dialog path registered and the temp path is not the default DTXMania
    // path, so the path guard must reject it before opening the database.
    let err = parse_dtxmania_scores_with_dialog_path(db.to_str().unwrap(), None).unwrap_err();
    assert!(
        err.to_string().contains("not allowed"),
        "expected 'not allowed' in error, got: {err}"
    );
}

#[test]
fn parse_accepts_dialog_path_matching_canonical_form() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db(&db);

    // A relative path that resolves to the same file as the dialog path must
    // be accepted (canonicalization handles representation differences).
    let canonical = std::fs::canonicalize(&db).expect("canonicalize");
    let songs = parse_dtxmania_scores_with_dialog_path(canonical.to_str().unwrap(), Some(&db))
        .expect("parse");
    assert_eq!(songs.len(), 2);
}

/// A chart with no drums score row at all is skipped: `JOINED_QUERY` uses an
/// INNER JOIN on `SongScores` with `Instrument = 0`, so a scoreless chart
/// never produces a row. Its parent song only appears if another chart has a
/// drums score.
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

/// Seed a single song with TWO drums-scored charts (BASIC + EXTREME), each with
/// its own drums `SongScores` row (Instrument = 0). This exercises the
/// chart-boundary logic in `group_joined_rows` that the other seeds don't
/// cover: both `seed_db` and `seed_db_with_scoreless_chart` give each song at
/// most one drums-scored chart, so the "push the in-progress chart, start a new
/// one" branch at scores.rs:367-388 is never exercised with a real second
/// chart.
fn seed_db_with_two_drums_charts(path: &std::path::Path) {
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

         INSERT INTO Songs VALUES (1, 'Two-Chart Song', 'Artist', 'Rock');

         -- Chart 1: BASIC, drums score (played).
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         -- Chart 2: EXTREME, drums score (played) — a SECOND drums-scored chart
         -- for the same song, which the other seeds never produce.
         INSERT INTO SongCharts VALUES (2, 1, 5, 'EXTREME', 88, 'hash-extreme');

         INSERT INTO SongScores VALUES (10, 1, 0, 950000, 91.3, 1, 7, 5, 800, 500, 30, 10, 5, 2, '2026-06-02');
         INSERT INTO SongScores VALUES (11, 2, 0, 880000, 88.0, 0, 3, 2, 700, 400, 50, 20, 10, 5, '2026-06-01');

         INSERT INTO PerformanceHistory VALUES (100, 10, '2026-06-02T00:00:00', '10.26/6/2 Cleared (S: 91.30)', 1);
         INSERT INTO PerformanceHistory VALUES (101, 11, '2026-06-01T00:00:00', '9.26/5/28 Cleared (A: 88.00)', 1);",
    )
    .expect("seed");
}

#[test]
fn parse_groups_multiple_drums_charts_per_song() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_with_two_drums_charts(&db);

    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);

    // The critical assertion: both drums-scored charts appear under the same
    // song. This exercises the chart-boundary branch in group_joined_rows that
    // pushes the in-progress chart and starts a new one when chart_id changes.
    let song = &songs[0];
    assert_eq!(song.charts.len(), 2);

    // Charts appear in DB order (ORDER BY c.Id): BASIC first, EXTREME second.
    assert_eq!(song.charts[0].difficulty_label, "BASIC");
    assert_eq!(song.charts[0].file_hash, "hash-basic");
    assert_eq!(song.charts[0].drum_level, 55);
    assert!(song.charts[0].best.is_some());
    assert_eq!(song.charts[0].recent.len(), 1);

    assert_eq!(song.charts[1].difficulty_label, "EXTREME");
    assert_eq!(song.charts[1].file_hash, "hash-extreme");
    assert_eq!(song.charts[1].drum_level, 88);
    assert!(song.charts[1].best.is_some());
    assert_eq!(song.charts[1].recent.len(), 1);

    // Best scores are distinct per chart.
    assert_eq!(song.charts[0].best.as_ref().unwrap().score, Some(950000));
    assert_eq!(song.charts[1].best.as_ref().unwrap().score, Some(880000));
}

/// Seed a single chart with 6 PerformanceHistory rows (DisplayOrder 1..6) to
/// exercise the 5-recent-row cap in group_joined_rows (scores.rs:396). The
/// other seeds insert at most 2 history rows, so the `recent_count < 5` guard
/// is never tested with enough rows to actually trigger the cap.
fn seed_db_with_six_history_rows(path: &std::path::Path) {
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

         INSERT INTO Songs VALUES (1, 'Capped Song', 'Artist', 'Rock');
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         INSERT INTO SongScores VALUES (10, 1, 0, 950000, 91.3, 1, 7, 5, 800, 500, 30, 10, 5, 2, '2026-06-02');

         -- 6 history rows (DisplayOrder 1..6); the cap at recent_count < 5 must
         -- keep only the first 5 and drop the 6th.
         INSERT INTO PerformanceHistory VALUES (100, 10, '2026-06-02T00:00:00', '10.26/6/2 Cleared (S: 91.30)', 1);
         INSERT INTO PerformanceHistory VALUES (101, 10, '2026-06-01T00:00:00', '9.26/5/28 Cleared (A: 88.00)', 2);
         INSERT INTO PerformanceHistory VALUES (102, 10, '2026-05-30T00:00:00', '8.26/5/25 Cleared (B: 80.00)', 3);
         INSERT INTO PerformanceHistory VALUES (103, 10, '2026-05-28T00:00:00', '7.26/5/20 Failed (C: 70.00)', 4);
         INSERT INTO PerformanceHistory VALUES (104, 10, '2026-05-25T00:00:00', '6.26/5/18 Cleared (D: 60.00)', 5);
         INSERT INTO PerformanceHistory VALUES (105, 10, '2026-05-20T00:00:00', '5.26/5/15 Failed (F: 45.00)', 6);",
    )
    .expect("seed");
}

#[test]
fn parse_caps_recent_scores_at_five() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_with_six_history_rows(&db);

    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);
    assert_eq!(songs[0].charts.len(), 1);

    let chart = &songs[0].charts[0];
    // The cap keeps only the first 5 rows (by DisplayOrder); the 6th is dropped.
    assert_eq!(chart.recent.len(), 5);

    // Verify the kept rows are DisplayOrder 1..5 (the first 5 in order).
    for (i, recent) in chart.recent.iter().enumerate() {
        assert_eq!(recent.display_order, Some((i + 1) as i64));
    }

    // The 6th row (DisplayOrder 6) must not appear.
    assert!(chart.recent.iter().all(|r| r.display_order != Some(6)));
}

/// Seed a chart with 3 PerformanceHistory rows using NON-contiguous
/// DisplayOrder values (10, 20, 30) to verify that group_joined_rows
/// renormalizes display_order to 1..n based on row position rather than
/// passing the raw DTXMania values through. The app validator (score.ts)
/// requires displayOrder in 1..5, so raw values like 10/20/30 would cause
/// the entire chart to be rejected.
fn seed_db_with_non_contiguous_display_order(path: &std::path::Path) {
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

         INSERT INTO Songs VALUES (1, 'Non-Contiguous Song', 'Artist', 'Rock');
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         INSERT INTO SongScores VALUES (10, 1, 0, 950000, 91.3, 1, 3, 2, 800, 500, 30, 10, 5, 2, '2026-06-02');

         -- Non-contiguous DisplayOrder values (10, 20, 30) that would fail
         -- the app validator's 1..5 range check if passed through raw.
         INSERT INTO PerformanceHistory VALUES (100, 10, '2026-06-02T00:00:00', '10.26/6/2 Cleared (S: 91.30)', 10);
         INSERT INTO PerformanceHistory VALUES (101, 10, '2026-05-28T00:00:00', '9.26/5/28 Cleared (A: 88.00)', 20);
         INSERT INTO PerformanceHistory VALUES (102, 10, '2026-05-20T00:00:00', '8.26/5/20 Failed (B: 70.00)', 30);",
    )
    .expect("seed");
}

#[test]
fn parse_renormalizes_display_order_to_contiguous_1_to_n() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_with_non_contiguous_display_order(&db);

    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);
    let chart = &songs[0].charts[0];
    assert_eq!(chart.recent.len(), 3);

    // display_order must be renormalized to 1, 2, 3 — NOT the raw 10, 20, 30
    // from DTXMania. The rows arrive in ORDER BY ph.DisplayOrder, so the
    // first row (DisplayOrder 10) becomes 1, the second (20) becomes 2, etc.
    assert_eq!(chart.recent[0].display_order, Some(1));
    assert_eq!(chart.recent[1].display_order, Some(2));
    assert_eq!(chart.recent[2].display_order, Some(3));

    // No raw DTXMania values should leak through.
    assert!(chart.recent.iter().all(|r| r.display_order != Some(10)));
    assert!(chart.recent.iter().all(|r| r.display_order != Some(20)));
    assert!(chart.recent.iter().all(|r| r.display_order != Some(30)));
}

fn seed_db_with_null_integers(path: &std::path::Path) {
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

         INSERT INTO Songs VALUES (1, 'Null Song', 'Artist', 'Rock');
         INSERT INTO SongCharts VALUES (1, 1, NULL, 'BASIC', NULL, 'hash');
         INSERT INTO SongScores VALUES (10, 1, 0, NULL, NULL, NULL, 5, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL);",
    )
    .expect("seed");
}

#[test]
fn parse_tolerates_null_integer_columns() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_with_null_integers(&db);

    // With tolerant reads, NULLs in integer columns default to 0 instead of
    // aborting the entire parse. The song appears with zeroed values.
    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);
    let chart = &songs[0].charts[0];
    assert_eq!(chart.difficulty_level, 0);
    assert_eq!(chart.drum_level, 0);
    assert_eq!(chart.aggregate.play_count, 5);
    assert_eq!(chart.aggregate.clear_count, 2);
    let best = chart.best.as_ref().expect("best present");
    assert_eq!(best.score, Some(0));
    assert_eq!(best.achievement_rate, Some(0.0));
    assert!(!best.full_combo);
    assert_eq!(best.max_combo, Some(0));
}

/// Seed a DTXMania-shaped DB WITHOUT the `PerformanceHistory` table, simulating
/// an older/other DTXManiaCX build whose schema lacks the per-play history
/// table. The best-only fallback must still load songs + best scores (with
/// empty `recent`), rather than aborting the whole parse with a generic SQLite
/// "no such table" error.
fn seed_db_without_performance_history(path: &std::path::Path) {
    let conn = Connection::open(path).expect("open seed db");
    conn.execute_batch(
        "CREATE TABLE Songs (Id INTEGER PRIMARY KEY, Title TEXT, Artist TEXT, Genre TEXT);
         CREATE TABLE SongCharts (Id INTEGER PRIMARY KEY, SongId INTEGER, DifficultyLevel INTEGER,
             DifficultyLabel TEXT, DrumLevel INTEGER, FileHash TEXT);
         CREATE TABLE SongScores (Id INTEGER PRIMARY KEY, ChartId INTEGER, Instrument INTEGER,
             BestScore INTEGER, BestAchievementRate REAL, FullCombo INTEGER, PlayCount INTEGER,
             ClearCount INTEGER, MaxCombo INTEGER, BestPerfect INTEGER, BestGreat INTEGER,
             BestGood INTEGER, BestPoor INTEGER, BestMiss INTEGER, LastPlayedAt TEXT);
         -- No PerformanceHistory table: simulates a schema-drift build.

         INSERT INTO Songs VALUES (1, 'Drift Song', 'Artist', 'Rock');
         INSERT INTO SongCharts VALUES (1, 1, 2, 'BASIC', 55, 'hash-basic');
         INSERT INTO SongScores VALUES (10, 1, 0, 950000, 91.3, 1, 7, 5, 800, 500, 30, 10, 5, 2, '2026-06-02');",
    )
    .expect("seed");
}

#[test]
fn parse_degrades_to_best_only_when_performance_history_missing() {
    let dir = tempdir().expect("tempdir");
    let db = dir.path().join("songs.db");
    seed_db_without_performance_history(&db);

    // Without the schema-drift pre-check, JOINED_QUERY would fail with
    // "no such table: PerformanceHistory" and return no songs at all. With the
    // pre-check, the best-only fallback runs and the song loads with its best
    // score intact and an empty recent list.
    let songs = parse_dtxmania_scores_impl(db.to_str().unwrap()).expect("parse");
    assert_eq!(songs.len(), 1);
    let chart = &songs[0].charts[0];
    assert_eq!(chart.aggregate.play_count, 7);
    let best = chart.best.as_ref().expect("best present");
    assert_eq!(best.score, Some(950000));
    assert_eq!(best.rank_label.as_deref(), Some("S"));
    // No PerformanceHistory rows -> recent is empty, but the chart still loads.
    assert!(chart.recent.is_empty());
}

// ---------------------------------------------------------------------------
// DtxmaniaDbState (Tauri-managed state for the dialog-selected DB path)
// ---------------------------------------------------------------------------

#[test]
fn dtxmania_db_state_defaults_to_none() {
    let state = DtxmaniaDbState::default();
    assert!(state.get().is_none());
}

#[test]
fn dtxmania_db_state_set_then_get_round_trips() {
    let state = DtxmaniaDbState::default();
    let path = PathBuf::from("/tmp/dtxmania/songs.db");
    state.set(path.clone());
    assert_eq!(state.get(), Some(path));
}

#[test]
fn dtxmania_db_state_set_overwrites_previous_path() {
    let state = DtxmaniaDbState::default();
    state.set(PathBuf::from("/tmp/first.db"));
    state.set(PathBuf::from("/tmp/second.db"));
    assert_eq!(state.get(), Some(PathBuf::from("/tmp/second.db")));
}

// ---------------------------------------------------------------------------
// paths_equal (canonicalizing path comparison used by the DB path guard)
// ---------------------------------------------------------------------------

#[test]
fn paths_equal_returns_true_for_identical_strings() {
    // The fast path: raw string equality short-circuits before touching the
    // filesystem, so a non-existent path still compares equal to itself.
    assert!(paths_equal("/this/does/not/exist", "/this/does/not/exist"));
}

#[test]
fn paths_equal_returns_false_when_neither_path_exists() {
    // Two different non-existent paths: canonicalization fails for both, so
    // the `_ => false` arm fires. This is the guard that stops a compromised
    // renderer from opening an arbitrary SQLite file by claiming it matches
    // an allowed path that doesn't exist on disk.
    assert!(!paths_equal("/nonexistent/a.db", "/nonexistent/b.db"));
}

#[test]
fn paths_equal_returns_false_when_one_path_exists_and_other_does_not() {
    let dir = tempdir().expect("tempdir");
    let real = dir.path().join("songs.db");
    std::fs::write(&real, b"x").expect("write");
    // The existing path canonicalizes; the missing one does not, so the
    // mismatched (Ok, Err) / (Err, Ok) arms resolve to false.
    assert!(!paths_equal(
        real.to_str().unwrap(),
        "/nonexistent/other.db"
    ));
    assert!(!paths_equal(
        "/nonexistent/other.db",
        real.to_str().unwrap()
    ));
}
