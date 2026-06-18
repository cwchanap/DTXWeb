use super::*;
use crate::models::ReadFileResult;
use tempfile::tempdir;
use tokio::fs;

#[tokio::test]
async fn read_file_rejects_path_outside_workspace() {
    let root = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside");
    let file = outside.path().join("song.dtx");
    fs::write(&file, "#TITLE: Bad").await.expect("write");

    let result = read_file_path(&file, Some(root.path())).await;

    assert!(matches!(result, ReadFileResult::Error { .. }));
}

#[cfg(unix)]
#[tokio::test]
async fn read_file_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = tempdir().expect("root");
    let outside = tempdir().expect("outside");
    let secret = outside.path().join("secret.dtx");
    fs::write(&secret, "#TITLE: Secret").await.expect("write");

    // A symlink inside the workspace that resolves to a file outside.
    // canonicalize() follows the link, so starts_with(&root) must fail.
    let link = root.path().join("escape.dtx");
    symlink(&secret, &link).expect("symlink");

    let result = read_file_path(&link, Some(root.path())).await;

    assert!(matches!(result, ReadFileResult::Error { .. }));
}

#[cfg(unix)]
#[tokio::test]
async fn list_files_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = tempdir().expect("root");
    let outside = tempdir().expect("outside");
    fs::write(outside.path().join("leak.txt"), "secret")
        .await
        .expect("write");

    // A symlink directory inside the workspace pointing outside.
    let link = root.path().join("escape_dir");
    symlink(outside.path(), &link).expect("symlink");

    let result = list_files(
        link.to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("envelope");

    assert_eq!(result["files"], serde_json::json!([]));
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| error.contains("outside the workspace")));
}

#[tokio::test]
async fn read_file_rejects_missing_workspace_root() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("song.dtx");
    fs::write(&file, "#TITLE: Song").await.expect("write");

    // A missing workspace root must be rejected rather than falling back to
    // the file's own parent, which would bypass the containment check.
    let result = read_file_path(&file, None).await;

    assert!(matches!(result, ReadFileResult::Error { .. }));
    assert_eq!(
        serde_json::to_value(result).expect("json")["error"],
        "A workspace root is required to read files"
    );
}

#[tokio::test]
async fn read_file_rejects_unknown_extension() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("notes.txt");
    fs::write(&file, "hello").await.expect("write");

    let result = read_file_path(&file, Some(root.path())).await;

    assert_eq!(
        serde_json::to_value(result).expect("json")["error"],
        "File type not allowed"
    );
}

#[tokio::test]
async fn list_directory_returns_error_envelope_for_missing_directory() {
    let root = tempdir().expect("tempdir");
    let missing = root.path().join("missing");

    let result = list_directory(
        missing.to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("envelope");

    assert_eq!(result["files"], serde_json::json!([]));
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| !error.is_empty()));
}

#[tokio::test]
async fn list_files_returns_error_envelope_for_missing_directory() {
    let root = tempdir().expect("tempdir");
    let missing = root.path().join("missing");

    let result = list_files(
        missing.to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("envelope");

    assert_eq!(result["files"], serde_json::json!([]));
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| !error.is_empty()));
}

#[tokio::test]
async fn list_directories_rejects_missing_workspace_root() {
    let root = tempdir().expect("tempdir");

    let result = list_directories(root.path().to_string_lossy().into_owned(), None).await;

    assert!(result.is_err());
    assert!(result
        .expect_err("error")
        .to_string()
        .contains("A workspace root is required"));
}

#[tokio::test]
async fn list_directories_rejects_path_outside_workspace() {
    let root = tempdir().expect("root");
    let outside = tempdir().expect("outside");

    let result = list_directories(
        outside.path().to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await;

    assert!(result.is_err());
    assert!(result
        .expect_err("error")
        .to_string()
        .contains("outside the workspace"));
}

#[tokio::test]
async fn list_files_rejects_path_outside_workspace() {
    let root = tempdir().expect("root");
    let outside = tempdir().expect("outside");
    fs::write(outside.path().join("leak.txt"), "secret")
        .await
        .expect("write");

    let result = list_files(
        outside.path().to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("envelope");

    assert_eq!(result["files"], serde_json::json!([]));
    assert!(result["error"]
        .as_str()
        .is_some_and(|error| error.contains("outside the workspace")));
}

#[tokio::test]
async fn list_files_returns_real_iso_last_modified() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("main.dtx");
    fs::write(&file, "#TITLE: Chart").await.expect("write");

    let result = list_files(
        root.path().to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("listing");

    let files = result["files"].as_array().expect("files");
    assert_eq!(files.len(), 1);
    let last_modified = files[0]["lastModified"].as_str().expect("lastModified");
    assert_ne!(last_modified, "1970-01-01T00:00:00.000Z");
    assert_iso_utc_timestamp(last_modified);
}

#[tokio::test]
async fn load_tree_includes_dtx_folder_with_set_def_colon_title() {
    let root = tempdir().expect("tempdir");
    let song = root.path().join("DTXFiles.Test");
    fs::create_dir(&song).await.expect("mkdir");
    fs::write(song.join("main.dtx"), "#TITLE: Chart")
        .await
        .expect("dtx");
    fs::write(song.join("SET.def"), "#TITLE: Song Title")
        .await
        .expect("def");

    let nodes = load_tree_structure_path(root.path()).await.expect("tree");

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].name, "DTXFiles.Test");
    assert!(nodes[0].contains_dtx_files);
    assert_eq!(nodes[0].song_title.as_deref(), Some("Song Title"));
}

#[tokio::test]
async fn load_tree_includes_dtx_folder_with_set_def_whitespace_title() {
    let root = tempdir().expect("tempdir");
    let song = root.path().join("DTXFiles.Test");
    fs::create_dir(&song).await.expect("mkdir");
    fs::write(song.join("main.dtx"), "#TITLE: Chart")
        .await
        .expect("dtx");
    fs::write(song.join("SET.def"), "#TITLE Song Title")
        .await
        .expect("def");

    let nodes = load_tree_structure_path(root.path()).await.expect("tree");

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].name, "DTXFiles.Test");
    assert!(nodes[0].contains_dtx_files);
    assert_eq!(nodes[0].song_title.as_deref(), Some("Song Title"));
}

#[tokio::test]
async fn read_file_decodes_utf16le_set_def_with_level_directives() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("SET.def");
    let content = "#L1LABEL Basic\n#L1FILE main.dtx\n";
    let bytes = content
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect::<Vec<u8>>();
    fs::write(&file, bytes).await.expect("write");

    let result = read_file_path(&file, Some(root.path())).await;

    match result {
        ReadFileResult::Text {
            error: None,
            content: actual,
        } => assert_eq!(actual, content),
        other => panic!("expected decoded text, got {other:?}"),
    }
}

#[tokio::test]
async fn path_exists_confirms_existing_file() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("song.dtx");
    fs::write(&file, "#TITLE: Song").await.expect("write");

    let result = path_exists(
        root.path().to_string_lossy().into_owned(),
        vec!["song.dtx".to_string()],
    )
    .await;

    assert!(result.exists);
    assert_eq!(result.error, None);
}

#[tokio::test]
async fn path_exists_reports_missing_file() {
    let root = tempdir().expect("tempdir");

    let result = path_exists(
        root.path().to_string_lossy().into_owned(),
        vec!["missing.dtx".to_string()],
    )
    .await;

    assert!(!result.exists);
    assert_eq!(result.error.as_deref(), Some("not-found"));
}

#[tokio::test]
async fn read_file_path_returns_text_for_dtx_file() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("song.dtx");
    let content = "#TITLE: Test Song\n#BPM: 120\n";
    fs::write(&file, content).await.expect("write");

    let result = read_file_path(&file, Some(root.path())).await;

    match result {
        ReadFileResult::Text {
            error: None,
            content: actual,
        } => assert_eq!(actual, content),
        other => panic!("expected text result, got {other:?}"),
    }
}

#[tokio::test]
async fn read_file_path_returns_binary_for_audio_file() {
    let root = tempdir().expect("tempdir");
    let file = root.path().join("sound.ogg");
    let bytes = [0x4F, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00];
    fs::write(&file, bytes).await.expect("write");

    let result = read_file_path(&file, Some(root.path())).await;

    match result {
        ReadFileResult::Binary {
            error: None,
            content,
        } => assert_eq!(content, bytes.to_vec()),
        other => panic!("expected binary result, got {other:?}"),
    }
}

#[tokio::test]
async fn list_directory_returns_entries_with_types() {
    let root = tempdir().expect("tempdir");
    fs::create_dir(root.path().join("sub"))
        .await
        .expect("mkdir");
    fs::write(root.path().join("a.dtx"), "#TITLE: A")
        .await
        .expect("write");

    let result = list_directory(
        root.path().to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("envelope");

    let files = result["files"].as_array().expect("files array");
    assert_eq!(files.len(), 2);
    assert_eq!(result["error"], serde_json::Value::Null);

    let by_name: std::collections::HashMap<&str, &serde_json::Value> = files
        .iter()
        .map(|entry| (entry["name"].as_str().expect("name"), entry))
        .collect();
    assert_eq!(by_name["sub"]["type"], "directory");
    assert_eq!(by_name["a.dtx"]["type"], "file");
}

#[tokio::test]
async fn list_directories_returns_sorted_directory_names() {
    let root = tempdir().expect("tempdir");
    fs::create_dir(root.path().join("b"))
        .await
        .expect("mkdir b");
    fs::create_dir(root.path().join("a"))
        .await
        .expect("mkdir a");
    fs::write(root.path().join("file.dtx"), "#TITLE: F")
        .await
        .expect("write");

    let result = list_directories(
        root.path().to_string_lossy().into_owned(),
        Some(root.path().to_string_lossy().into_owned()),
    )
    .await
    .expect("directories");

    assert_eq!(result, vec!["a".to_string(), "b".to_string()]);
}

#[tokio::test]
async fn load_tree_excludes_folder_without_dtx_files_or_prefix() {
    let root = tempdir().expect("tempdir");
    let other = root.path().join("OtherStuff");
    fs::create_dir(&other).await.expect("mkdir");
    fs::write(other.join("notes.txt"), "hello")
        .await
        .expect("write");

    let nodes = load_tree_structure_path(root.path()).await.expect("tree");

    assert!(nodes.is_empty());
}

#[tokio::test]
async fn load_tree_includes_dtx_prefixed_folder_with_subdirs() {
    let root = tempdir().expect("tempdir");
    let song = root.path().join("DTXFiles.Empty");
    fs::create_dir(&song).await.expect("mkdir");
    fs::create_dir(song.join("sub")).await.expect("mkdir sub");

    let nodes = load_tree_structure_path(root.path()).await.expect("tree");

    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].name, "DTXFiles.Empty");
    assert!(nodes[0].has_children);
    assert!(!nodes[0].contains_dtx_files);
}

#[test]
fn parse_title_extracts_colon_format() {
    assert_eq!(parse_title("#TITLE: My Song"), Some("My Song".to_string()));
}

#[test]
fn parse_title_extracts_whitespace_format() {
    assert_eq!(parse_title("#TITLE My Song"), Some("My Song".to_string()));
}

#[test]
fn parse_title_returns_none_for_empty_title() {
    assert_eq!(parse_title("#TITLE:"), None);
}

#[test]
fn parse_title_returns_none_when_no_title_directive() {
    assert_eq!(parse_title("#OTHER: stuff"), None);
}

#[test]
fn strip_bom_bytes_removes_utf8_bom() {
    assert_eq!(strip_bom_bytes(&[0xef, 0xbb, 0xbf, b'h', b'i']), b"hi");
}

#[test]
fn strip_bom_bytes_removes_utf16le_bom() {
    assert_eq!(strip_bom_bytes(&[0xff, 0xfe, b'h', b'i']), b"hi");
}

#[test]
fn strip_bom_bytes_removes_utf16be_bom() {
    assert_eq!(strip_bom_bytes(&[0xfe, 0xff, b'h', b'i']), b"hi");
}

#[test]
fn strip_bom_bytes_leaves_content_without_bom_unchanged() {
    assert_eq!(strip_bom_bytes(b"hello"), b"hello");
}

#[test]
fn is_set_def_directive_line_recognizes_title() {
    assert!(is_set_def_directive_line("#TITLE: value"));
}

#[test]
fn is_set_def_directive_line_recognizes_artist() {
    assert!(is_set_def_directive_line("#ARTIST: value"));
}

#[test]
fn is_set_def_directive_line_recognizes_bpm() {
    assert!(is_set_def_directive_line("#BPM: value"));
}

#[test]
fn is_set_def_directive_line_recognizes_level_label() {
    assert!(is_set_def_directive_line("#L1LABEL: value"));
}

#[test]
fn is_set_def_directive_line_rejects_random_directive() {
    assert!(!is_set_def_directive_line("#RANDOM: value"));
}

#[test]
fn is_set_def_directive_line_rejects_section_header() {
    assert!(!is_set_def_directive_line("[Section]"));
}

#[test]
fn is_set_def_directive_line_rejects_regular_text() {
    assert!(!is_set_def_directive_line("regular text"));
}

#[test]
fn is_level_directive_line_recognizes_single_digit_label() {
    assert!(is_level_directive_line("#L1LABEL"));
}

#[test]
fn is_level_directive_line_recognizes_file_directive() {
    assert!(is_level_directive_line("#L1FILE"));
}

#[test]
fn is_level_directive_line_recognizes_nine_label() {
    assert!(is_level_directive_line("#L9LABEL"));
}

#[test]
fn is_level_directive_line_rejects_non_digit_after_l() {
    assert!(!is_level_directive_line("#LXLABEL"));
}

#[test]
fn is_level_directive_line_rejects_unrecognized_suffix() {
    assert!(!is_level_directive_line("#L1FOO"));
}

#[test]
fn is_level_directive_line_accepts_multi_digit_number() {
    assert!(is_level_directive_line("#L10LABEL"));
}

#[test]
fn is_level_directive_line_accepts_zero_digit() {
    assert!(is_level_directive_line("#L0LABEL"));
}

#[test]
fn is_directive_boundary_accepts_empty_string() {
    assert!(is_directive_boundary(""));
}

#[test]
fn is_directive_boundary_accepts_colon_prefix() {
    assert!(is_directive_boundary(": value"));
}

#[test]
fn is_directive_boundary_accepts_whitespace_prefix() {
    assert!(is_directive_boundary(" value"));
}

#[test]
fn is_directive_boundary_rejects_regular_text() {
    assert!(!is_directive_boundary("regular"));
}

#[test]
fn join_path_parts_joins_multiple_parts() {
    let result = join_path_parts("base".to_string(), vec!["a".to_string(), "b".to_string()]);
    assert_eq!(result, PathBuf::from("base").join("a").join("b"));
}

#[test]
fn join_path_parts_returns_base_with_no_parts() {
    let result = join_path_parts("base".to_string(), vec![]);
    assert_eq!(result, PathBuf::from("base"));
}

#[test]
fn has_acceptable_null_ratio_accepts_normal_text() {
    assert!(has_acceptable_null_ratio("hello world"));
}

#[test]
fn has_acceptable_null_ratio_rejects_empty_content() {
    assert!(!has_acceptable_null_ratio(""));
}

#[test]
fn has_acceptable_null_ratio_rejects_null_heavy_content() {
    assert!(!has_acceptable_null_ratio("\0\0\0\0\0\0\0\0\0\0x"));
}

#[test]
fn text_decoding_priority_returns_dtx_priority_for_dtx() {
    let priority = text_decoding_priority("dtx");
    assert_eq!(priority[0].name(), SHIFT_JIS.name());
}

#[test]
fn text_decoding_priority_returns_def_priority_for_def() {
    let priority = text_decoding_priority("def");
    assert_eq!(priority[0].name(), UTF_16LE.name());
}

#[test]
fn text_decoding_priority_returns_def_priority_for_other_extensions() {
    let priority = text_decoding_priority("xyz");
    assert_eq!(priority[0].name(), UTF_16LE.name());
}

fn assert_iso_utc_timestamp(value: &str) {
    assert!(value.ends_with('Z'), "timestamp should end with Z: {value}");
    let value = value.strip_suffix('Z').expect("Z suffix");
    let (date, time) = value.split_once('T').expect("date-time separator");
    let date_parts = date.split('-').collect::<Vec<_>>();
    assert_eq!(date_parts.len(), 3, "date parts: {date}");
    assert_eq!(date_parts[0].len(), 4, "year: {date}");
    assert_eq!(date_parts[1].len(), 2, "month: {date}");
    assert_eq!(date_parts[2].len(), 2, "day: {date}");
    assert!(date_parts
        .iter()
        .all(|part| part.chars().all(|character| character.is_ascii_digit())));

    let time_parts = time.split(':').collect::<Vec<_>>();
    assert_eq!(time_parts.len(), 3, "time parts: {time}");
    assert_eq!(time_parts[0].len(), 2, "hour: {time}");
    assert_eq!(time_parts[1].len(), 2, "minute: {time}");
    assert!(time_parts[0]
        .chars()
        .all(|character| character.is_ascii_digit()));
    assert!(time_parts[1]
        .chars()
        .all(|character| character.is_ascii_digit()));

    let (seconds, fraction) = time_parts[2]
        .split_once('.')
        .map_or((time_parts[2], None), |(seconds, fraction)| {
            (seconds, Some(fraction))
        });
    assert_eq!(seconds.len(), 2, "seconds: {time}");
    assert!(seconds.chars().all(|character| character.is_ascii_digit()));
    if let Some(fraction) = fraction {
        assert!(
            !fraction.is_empty() && fraction.chars().all(|character| character.is_ascii_digit()),
            "fraction: {time}"
        );
    }
}

#[test]
fn path_access_error_maps_not_found_kind_to_machine_readable_token() {
    // The renderer matches on the exact tokens "not-found"/"permission-denied"
    // to decide whether to show a "missing folder" hint vs. a generic error.
    let not_found = std::io::Error::from(ErrorKind::NotFound);
    assert_eq!(path_access_error(&not_found), "not-found");

    let denied = std::io::Error::from(ErrorKind::PermissionDenied);
    assert_eq!(path_access_error(&denied), "permission-denied");

    let other = std::io::Error::from(ErrorKind::AlreadyExists);
    assert_eq!(path_access_error(&other), "unknown");
}

#[test]
fn list_error_value_returns_envelope_with_empty_files_and_error_message() {
    // The renderer reads `files` (always present, possibly empty) and
    // surfaces `error` when non-null. The shape must be stable across all
    // error paths so the renderer's destructuring doesn't crash.
    let value = list_error_value(DesktopError::Message("boom".to_string()));

    assert_eq!(value["files"], serde_json::json!([]));
    assert_eq!(value["error"], "boom");
}

#[test]
fn normalized_extension_lowercases_extension_and_returns_empty_when_missing() {
    // File systems on macOS/Windows are case-insensitive; the normalized
    // extension is used to drive allow-list checks, so casing must not
    // affect matching.
    assert_eq!(
        normalized_extension(std::path::Path::new("chart.DTX")),
        "dtx"
    );
    assert_eq!(normalized_extension(std::path::Path::new("SET.DEF")), "def");
    assert_eq!(normalized_extension(std::path::Path::new("noext")), "");
    // Dotfiles (".gitignore", ".dtx") have no extension by Rust's Path rules
    // — the entire name is treated as the stem. The renderer never feeds
    // dotfiles into this helper, but the contract is: no extension → empty.
    assert_eq!(normalized_extension(std::path::Path::new(".gitignore")), "");
}

#[test]
fn validate_text_content_rejects_empty_input() {
    // Empty content is treated as a decode failure so encoding fallback can
    // try the next candidate rather than accepting an empty string.
    assert!(!validate_text_content("", "dtx"));
    assert!(!validate_text_content("", "def"));
}

#[test]
fn validate_text_content_accepts_dtx_with_known_directives() {
    // Any of the DTX-shaped markers (#TITLE/#ARTIST/#BPM/#WAV) confirms the
    // decode produced real chart content rather than mojibake.
    assert!(validate_text_content("#TITLE: Song\n", "dtx"));
    assert!(validate_text_content("#ARTIST: A\n", "dtx"));
    assert!(validate_text_content("#BPM: 120\n", "dtx"));
    assert!(validate_text_content("#WAV01 foo.wav\n", "dtx"));
}

#[test]
fn validate_text_content_rejects_dtx_without_known_directives() {
    // Random text without any DTX directive is not a valid decode.
    assert!(!validate_text_content("just notes here\n", "dtx"));
}

#[test]
fn validate_text_content_accepts_def_with_directive_or_section_header() {
    // SET.def files use either #L1FILE directives or [section] headers (some
    // legacy formats); the validator must accept either to avoid rejecting
    // legitimate def content during encoding fallback.
    assert!(validate_text_content("#TITLE: Song\n", "def"));
    assert!(validate_text_content("#L1FILE basic.dtx\n", "def"));
    assert!(validate_text_content("[Path]\nfoo=bar\n", "def"));
}

#[tokio::test]
async fn canonicalize_within_workspace_rejects_missing_workspace_root() {
    // The workspace root is mandatory — without it the containment check
    // would be meaningless (every canonical path starts_with its own parent).
    let result = canonicalize_within_workspace("/some/path", None).await;
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("workspace root is required"));
}

#[tokio::test]
async fn canonicalize_within_workspace_rejects_path_outside_root() {
    // A target path that resolves outside the workspace must be rejected to
    // prevent traversal attacks (e.g. renderer asking to list /etc).
    let root = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside");

    let result = canonicalize_within_workspace(
        outside.path().to_str().unwrap(),
        Some(root.path().to_str().unwrap()),
    )
    .await;

    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("outside the workspace"));
}

#[tokio::test]
async fn canonicalize_within_workspace_accepts_path_inside_root() {
    // Happy path: a target inside the workspace canonicalizes cleanly.
    // On macOS, tempdir() lives under /var which is a symlink to /private/var,
    // so we compare against the canonicalized root (not root.path()) to
    // avoid spurious failures from the symlink prefix.
    let root = tempdir().expect("tempdir");
    let inner = root.path().join("songs");
    fs::create_dir(&inner).await.expect("create dir");

    let result =
        canonicalize_within_workspace(inner.to_str().unwrap(), Some(root.path().to_str().unwrap()))
            .await;

    assert!(result.is_ok());
    let canonical = result.unwrap();
    let canonical_root = fs::canonicalize(root.path())
        .await
        .expect("canonicalize root");
    assert!(canonical.starts_with(&canonical_root));
}

#[tokio::test]
async fn inspect_tree_folder_detects_dtx_files_and_set_def_title() {
    // A folder with a .dtx file plus a SET.def containing #TITLE should
    // report both contains_dtx_files=true and the parsed song_title.
    let root = tempdir().expect("tempdir");
    fs::write(root.path().join("chart.dtx"), "#TITLE: Ping\n#BPM: 120\n")
        .await
        .expect("write dtx");
    fs::write(root.path().join("SET.def"), "#TITLE: Real Song\n")
        .await
        .expect("write setdef");

    let info = inspect_tree_folder(root.path()).await;
    assert!(info.contains_dtx_files);
    assert_eq!(info.song_title.as_deref(), Some("Real Song"));
}

#[tokio::test]
async fn inspect_tree_folder_reports_has_children_for_subdirectories() {
    // A folder with no dtx files but with subdirectories is still listed
    // (the renderer may navigate into it to find nested chart folders).
    let root = tempdir().expect("tempdir");
    fs::create_dir(root.path().join("subfolder"))
        .await
        .expect("mkdir");

    let info = inspect_tree_folder(root.path()).await;
    assert!(info.has_children);
    assert!(!info.contains_dtx_files);
    assert!(info.song_title.is_none());
}

#[tokio::test]
async fn inspect_tree_folder_returns_default_when_directory_unreadable() {
    // A missing/unreadable folder must produce a safe default rather than
    // panicking — load_tree_structure_path relies on this to skip unreadable
    // entries silently.
    let info = inspect_tree_folder(std::path::Path::new("/this/does/not/exist/xyz")).await;
    assert!(!info.has_children);
    assert!(!info.contains_dtx_files);
    assert!(info.song_title.is_none());
}

#[tokio::test]
async fn inspect_tree_folder_skips_set_def_title_when_no_dtx_files() {
    // SET.def title is only meaningful when there are .dtx files to chart;
    // a folder with only SET.def (no charts) must not be reported as a song.
    let root = tempdir().expect("tempdir");
    fs::write(root.path().join("SET.def"), "#TITLE: Lonely\n")
        .await
        .expect("write setdef");

    let info = inspect_tree_folder(root.path()).await;
    assert!(!info.contains_dtx_files);
    assert!(info.song_title.is_none());
}

#[tokio::test]
async fn format_modified_time_returns_iso_rfc3339_for_real_file() {
    // The renderer parses the timestamp as ISO UTC; the format must round-trip
    // through OffsetDateTime's RFC3339 parser without manual string surgery.
    let root = tempdir().expect("tempdir");
    let file_path = root.path().join("note.dtx");
    fs::write(&file_path, "#TITLE: t\n").await.expect("write");

    let metadata = std::fs::metadata(&file_path).expect("metadata");
    let formatted = format_modified_time(&metadata).expect("formatted timestamp");

    // Round-trip: the formatted string must be a valid RFC3339 timestamp.
    let parsed =
        time::OffsetDateTime::parse(&formatted, &time::format_description::well_known::Rfc3339);
    assert!(parsed.is_ok(), "formatted timestamp was {formatted}");
}

#[test]
fn decode_with_encoding_strips_leading_bom_character() {
    // encoding_rs emits a U+FEFF BOM character at the start of UTF-16/UTF-8
    // decoded text when the input didn't include a BOM byte sequence. The
    // helper trims it so the renderer never sees a stray BOM in content.
    let bytes = "x"
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect::<Vec<_>>();
    let decoded = decode_with_encoding(&bytes, UTF_16LE);
    assert!(!decoded.starts_with('\u{feff}'));
    assert_eq!(decoded, "x");
}

#[test]
fn text_decoding_priority_picks_def_priority_for_def_extension_only() {
    // Only "dtx" maps to the DTX priority (SHIFT_JIS-first); every other
    // extension — including unknown ones — uses the def priority
    // (UTF-16-first). The renderer treats .def, .set, etc. as def variants.
    assert!(!text_decoding_priority("dtx").is_empty());
    assert!(!text_decoding_priority("def").is_empty());
    assert!(!text_decoding_priority("unknown").is_empty());

    // The DTX and DEF priorities are different orderings of the same set.
    let dtx = text_decoding_priority("dtx");
    let def = text_decoding_priority("def");
    assert!(!std::ptr::eq(dtx.as_ptr(), def.as_ptr()));
}

// ---------------------------------------------------------------------------
// File too large check
// ---------------------------------------------------------------------------

#[tokio::test]
async fn read_file_path_rejects_file_exceeding_text_limit() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("big.dtx");
    // Write a file just over 1 MiB (TEXT_FILE_SIZE_LIMIT)
    let big_content = vec![b'x'; (TEXT_FILE_SIZE_LIMIT + 1) as usize];
    fs::write(&file_path, &big_content).await.unwrap();

    let result = read_file_path(&file_path, Some(dir.path())).await;

    match result {
        ReadFileResult::Error { error, .. } => {
            assert_eq!(error, "File too large");
        }
        other => panic!("expected Error, got {other:?}"),
    }
}

#[tokio::test]
async fn read_file_path_rejects_audio_file_exceeding_audio_limit() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("big.mp3");
    // Write a file just over 10 MiB (AUDIO_FILE_SIZE_LIMIT)
    let big_content = vec![b'x'; (AUDIO_FILE_SIZE_LIMIT + 1) as usize];
    fs::write(&file_path, &big_content).await.unwrap();

    let result = read_file_path(&file_path, Some(dir.path())).await;

    match result {
        ReadFileResult::Error { error, .. } => {
            assert_eq!(error, "File too large");
        }
        other => panic!("expected Error, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Encoding detection: decode_text_content fallback path
// ---------------------------------------------------------------------------

#[test]
fn decode_text_content_falls_back_to_shift_jis_for_dtx_with_all_nulls() {
    // Content that fails every validation (all null bytes) should fall
    // through to the SHIFT_JIS fallback for .dtx files.
    let bytes = [0x00u8; 64];
    let result = decode_text_content(&bytes, "dtx");
    // The fallback produces a non-panic string; its exact content depends
    // on SHIFT_JIS decoding of null bytes, which yields null chars.
    assert!(result.contains('\0'));
}

#[test]
fn decode_text_content_falls_back_to_utf8_for_non_dtx_with_all_nulls() {
    let bytes = [0x00u8; 64];
    let result = decode_text_content(&bytes, "txt");
    // For non-dtx files, the fallback is UTF-8.
    assert!(result.contains('\0'));
}

#[test]
fn decode_text_content_strips_utf8_bom_before_decoding() {
    let mut bytes = vec![0xef, 0xbb, 0xbf]; // UTF-8 BOM
    bytes.extend_from_slice(b"#TITLE: Test");
    let result = decode_text_content(&bytes, "dtx");
    assert!(result.starts_with("#TITLE: Test"));
}

// ---------------------------------------------------------------------------
// join_path_parts
// ---------------------------------------------------------------------------

#[test]
fn join_path_parts_joins_base_with_parts() {
    let result = join_path_parts(
        "/base".to_string(),
        vec!["sub".to_string(), "file.dtx".to_string()],
    );
    assert_eq!(result, PathBuf::from("/base/sub/file.dtx"));
}

#[test]
fn join_path_parts_returns_base_when_no_parts() {
    let result = join_path_parts("/base".to_string(), vec![]);
    assert_eq!(result, PathBuf::from("/base"));
}

// ---------------------------------------------------------------------------
// file_path_to_string
// ---------------------------------------------------------------------------

#[test]
fn file_path_to_string_converts_path_to_string() {
    let file_path = FilePath::Path("/some/path/to/file.dtx".into());
    let result = file_path_to_string(file_path).unwrap();
    assert_eq!(result, "/some/path/to/file.dtx");
}
