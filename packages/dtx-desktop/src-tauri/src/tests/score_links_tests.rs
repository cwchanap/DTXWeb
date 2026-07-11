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
    assert_eq!(
        read.get("Played Song\u{1f}Artist A").map(String::as_str),
        Some("42")
    );
}

#[test]
fn read_tolerates_corrupt_file() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("score_links.json");
    std::fs::write(&path, b"{ not json").expect("write garbage");
    assert!(read_score_song_links_from(&path).is_empty());
}
