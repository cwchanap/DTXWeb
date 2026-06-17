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
        fs::write(&secret, "#TITLE: Secret")
            .await
            .expect("write");

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
        fs::create_dir(root.path().join("sub")).await.expect("mkdir");
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
        fs::create_dir(root.path().join("b")).await.expect("mkdir b");
        fs::create_dir(root.path().join("a")).await.expect("mkdir a");
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
        assert_eq!(
            parse_title("#TITLE: My Song"),
            Some("My Song".to_string())
        );
    }

    #[test]
    fn parse_title_extracts_whitespace_format() {
        assert_eq!(
            parse_title("#TITLE My Song"),
            Some("My Song".to_string())
        );
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
        let result = join_path_parts(
            "base".to_string(),
            vec!["a".to_string(), "b".to_string()],
        );
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
                !fraction.is_empty()
                    && fraction.chars().all(|character| character.is_ascii_digit()),
                "fraction: {time}"
            );
        }
    }
