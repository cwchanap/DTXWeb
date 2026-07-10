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
