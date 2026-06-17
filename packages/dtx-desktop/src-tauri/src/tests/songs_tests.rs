    use super::*;
    use std::fs::File;
    use std::io::Read;
    use tempfile::tempdir;
    use tokio::fs;
    use zip::ZipArchive;

    #[tokio::test]
    async fn create_song_writes_utf16le_set_def_with_bom() {
        let root = tempdir().expect("tempdir");
        let options = CreateSongOptions {
            selected_path: root.path().to_string_lossy().into_owned(),
            sanitized_folder_name: "DTXFiles.Song".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: None,
        };

        let result = create_song_folder(options).await.expect("create song");

        assert!(result.success);
        let set_def_path = root.path().join("DTXFiles.Song").join("SET.def");
        let bytes = fs::read(&set_def_path).await.expect("SET.def bytes");
        assert_eq!(&bytes[..2], &[0xff, 0xfe]);

        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        let content = String::from_utf16(&units).expect("UTF-16LE content");

        assert!(content.contains("#TITLE Song Title"));
        assert!(content.contains("#L1LABEL BASIC"));
        assert!(content.contains("#L1FILE bas.dtx"));
    }

    #[tokio::test]
    async fn copy_template_rejects_copy_into_descendant() {
        let root = tempdir().expect("tempdir");
        let template = root.path().join("Template");
        fs::create_dir_all(&template).await.expect("template");

        let options = CreateSongOptions {
            selected_path: template.to_string_lossy().into_owned(),
            sanitized_folder_name: "Child".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: Some(template.to_string_lossy().into_owned()),
        };

        let error = create_song_folder(options)
            .await
            .expect_err("descendant copy should reject");

        assert!(error
            .to_string()
            .contains("Cannot copy directory into itself or its subdirectory"));
    }

    #[tokio::test]
    async fn create_song_rejects_unsafe_folder_name_component() {
        let root = tempdir().expect("tempdir");
        let options = CreateSongOptions {
            selected_path: root.path().to_string_lossy().into_owned(),
            sanitized_folder_name: "bad/name".to_string(),
            sanitized_song_name: "Song Title".to_string(),
            template_folder_path: None,
        };

        let error = create_song_folder(options)
            .await
            .expect_err("unsafe folder name should reject");

        assert!(error.to_string().contains("Invalid song folder name"));
        assert!(!root.path().join("bad").exists());
    }

    #[tokio::test]
    async fn export_zip_filters_invalid_files() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("main.dtx"), "#TITLE: Song")
            .await
            .expect("dtx");
        fs::write(song.join("notes.txt"), "ignore")
            .await
            .expect("txt");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(result.success);
        assert_eq!(result.files_count, Some(1));
        assert_zip_entries(result.zip_path.as_deref().expect("zip path"), &["main.dtx"]);
    }

    #[tokio::test]
    async fn export_zip_allows_common_valid_extensions() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("song.flac"), b"audio")
            .await
            .expect("flac");
        fs::write(song.join("jacket.gif"), b"image")
            .await
            .expect("gif");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(result.success);
        assert_eq!(result.files_count, Some(2));
        assert_zip_entries(
            result.zip_path.as_deref().expect("zip path"),
            &["jacket.gif", "song.flac"],
        );
    }

    #[tokio::test]
    async fn export_zip_returns_error_envelope_when_no_valid_files() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("notes.txt"), "ignore")
            .await
            .expect("txt");

        let result = export_song_folder_to_zip(&song, "Song", &export)
            .await
            .expect("export envelope");

        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("No valid files found to export")
        );
        assert_eq!(result.zip_path, None);
        assert_eq!(result.files_count, None);
    }

    #[tokio::test]
    async fn export_zip_rejects_unsafe_song_title_without_writing_outside_export_directory() {
        let root = tempdir().expect("tempdir");
        let song = root.path().join("Song");
        let export = root.path().join("Export");
        fs::create_dir_all(&song).await.expect("song");
        fs::create_dir_all(&export).await.expect("export");
        fs::write(song.join("main.dtx"), "#TITLE: Song")
            .await
            .expect("dtx");

        let result = export_song_folder_to_zip(&song, "../escape", &export)
            .await
            .expect("export envelope");

        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Invalid zip file name")));
        assert!(!root.path().join("escape.zip").exists());
    }

    #[tokio::test]
    async fn parse_dtx_files_returns_metadata_and_set_def_labels() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("SET.def"),
            "#L1LABEL BASIC\n#L1FILE main.dtx\n",
        )
        .await
        .expect("SET.def");
        fs::write(
            root.path().join("main.dtx"),
            "#ARTIST: Test Artist\n#BPM: 142.5\n#DLEVEL: 7\n",
        )
        .await
        .expect("main.dtx");

        let result = parse_dtx_folder(root.path()).await.expect("parse result");

        assert_eq!(result.artist.as_deref(), Some("Test Artist"));
        assert_eq!(result.bpm, Some(142.5));
        assert_eq!(result.levels.len(), 1);
        assert_eq!(result.levels[0].label, "BASIC");
        assert_eq!(result.levels[0].level, 7.0);
        assert_eq!(result.parse_failures, None);
    }

    #[tokio::test]
    async fn parse_dtx_files_does_not_emit_set_def_label_without_dlevel() {
        let root = tempdir().expect("tempdir");
        fs::write(
            root.path().join("SET.def"),
            "#L1LABEL BASIC\n#L1FILE main.dtx\n",
        )
        .await
        .expect("SET.def");
        fs::write(
            root.path().join("main.dtx"),
            "#ARTIST: Test Artist\n#BPM: 142.5\n",
        )
        .await
        .expect("main.dtx");

        let result = parse_dtx_folder(root.path()).await.expect("parse result");

        assert_eq!(result.artist.as_deref(), Some("Test Artist"));
        assert_eq!(result.bpm, Some(142.5));
        assert!(result.levels.is_empty());
        assert_eq!(result.parse_failures, None);
    }

    #[tokio::test]
    async fn parse_dtx_files_propagates_io_error_for_nonexistent_folder() {
        let result =
            parse_dtx_files("/nonexistent/path/that/does/not/exist".to_string()).await;
        assert!(result.is_err());
    }

    #[test]
    fn home_dir_from_env_uses_os_homedir_style_fallbacks() {
        assert_eq!(
            home_dir_from_env(
                HomeDirPlatform::Posix,
                Some("/home/dtx"),
                Some("C:\\Users\\DTX"),
                None,
                None,
            )
            .as_deref(),
            Some(Path::new("/home/dtx"))
        );
        assert_eq!(
            home_dir_from_env(
                HomeDirPlatform::Windows,
                Some("/home/dtx"),
                Some("C:\\Users\\DTX"),
                Some("D:"),
                Some("\\Fallback"),
            )
            .as_deref(),
            Some(Path::new("C:\\Users\\DTX"))
        );
        assert_eq!(
            home_dir_from_env(
                HomeDirPlatform::Windows,
                Some("/home/dtx"),
                None,
                Some("C:"),
                Some("\\Users\\DTX"),
            )
            .as_deref(),
            Some(Path::new("C:\\Users\\DTX"))
        );
        assert_eq!(
            home_dir_from_env(
                HomeDirPlatform::Windows,
                Some("/home/dtx"),
                None,
                Some("C:"),
                None
            )
            .as_deref(),
            Some(Path::new("/home/dtx"))
        );
        assert_eq!(
            home_dir_from_env(HomeDirPlatform::Windows, None, None, Some("C:"), None),
            None
        );
    }

    #[test]
    fn safe_file_name_validation_rejects_path_components_and_invalid_names() {
        for name in [
            "",
            ".",
            "..",
            "bad/name",
            "bad\\name",
            " bad",
            "bad ",
            ".bad",
            "bad.",
            "bad:name",
            "bad\nname",
            "CON",
            "COM1",
        ] {
            assert!(
                validate_safe_file_name(name, "song folder name").is_err(),
                "{name:?} should reject"
            );
        }

        assert!(validate_safe_file_name("DTXFiles.Song", "song folder name").is_ok());
    }

    #[test]
    fn data_url_for_asset_selects_mime_type_by_extension() {
        let png = data_url_for_asset("cover.png", &[1u8, 2, 3]);
        assert_eq!(
            png,
            format!("data:image/png;base64,{}", STANDARD.encode(&[1u8, 2, 3]))
        );

        let jpg = data_url_for_asset("photo.jpg", &[4u8, 5]);
        assert!(jpg.starts_with("data:image/jpeg;base64,"));

        let jpeg = data_url_for_asset("photo.jpeg", &[6u8]);
        assert!(jpeg.starts_with("data:image/jpeg;base64,"));

        let other = data_url_for_asset("notes.txt", &[7u8, 8]);
        assert!(other.starts_with("data:application/octet-stream;base64,"));
    }

    #[test]
    fn is_safe_relative_path_rejects_absolute_and_traversal() {
        assert!(is_safe_relative_path("foo/bar.dtx"));
        assert!(!is_safe_relative_path("/etc/passwd"));
        assert!(!is_safe_relative_path("../escape"));
        assert!(is_safe_relative_path(""));
    }

    #[test]
    fn decode_bom_detects_common_byte_order_marks() {
        let utf8 = decode_bom(&[0xef, 0xbb, 0xbf, b'H', b'i']);
        assert_eq!(utf8.as_deref(), Some("Hi"));

        let utf16le = decode_bom(&[0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
        assert_eq!(utf16le.as_deref(), Some("Hi"));

        let utf16be = decode_bom(&[0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
        assert_eq!(utf16be.as_deref(), Some("Hi"));

        assert_eq!(decode_bom(&[0x41, 0x42]), None);
    }

    #[test]
    fn parse_set_def_labels_maps_levels_to_file_names() {
        let single = parse_set_def_labels("#L1LABEL Beginner\n#L1FILE Song.dtx\n");
        assert_eq!(single.get("song.dtx"), Some(&"Beginner".to_string()));

        let multi = parse_set_def_labels(
            "#L1LABEL A\n#L1FILE a.dtx\n#L5LABEL E\n#L5FILE e.dtx\n#L9LABEL I\n#L9FILE i.dtx\n",
        );
        assert_eq!(multi.len(), 3);
        assert_eq!(multi.get("a.dtx"), Some(&"A".to_string()));
        assert_eq!(multi.get("e.dtx"), Some(&"E".to_string()));
        assert_eq!(multi.get("i.dtx"), Some(&"I".to_string()));

        let without_label = parse_set_def_labels("#L1FILE main.dtx\n");
        assert!(without_label.is_empty());

        let empty = parse_set_def_labels("");
        assert!(empty.is_empty());
    }

    #[test]
    fn parse_number_handles_integers_floats_and_invalid_input() {
        assert_eq!(parse_number("142"), Some(142.0));
        assert_eq!(parse_number("142.5"), Some(142.5));
        assert_eq!(parse_number("7"), Some(7.0));
        assert_eq!(parse_number("abc"), None);
        assert_eq!(parse_number("-5"), Some(-5.0));
        assert_eq!(parse_number(" 42 "), Some(42.0));
    }

    #[test]
    fn has_acceptable_null_ratio_flags_binary_content() {
        assert!(has_acceptable_null_ratio("normal text content"));
        assert!(!has_acceptable_null_ratio(""));
        assert!(!has_acceptable_null_ratio("ab\0\0"));
    }

    #[test]
    fn fallback_level_label_uppercases_file_stem() {
        assert_eq!(fallback_level_label("song.dtx"), "SONG");
        assert_eq!(fallback_level_label("advanced.dtx"), "ADVANCED");
        assert_eq!(fallback_level_label("noext"), "NOEXT");
    }

    #[test]
    fn generate_set_def_content_includes_title_and_level_directives() {
        let content = generate_set_def_content("My Song");
        assert!(content.contains("#TITLE My Song"));
        assert!(content.contains("#L1LABEL BASIC"));
        assert!(content.contains("#L1FILE bas.dtx"));
        assert!(content.contains("#L5LABEL REAL"));
        assert!(content.contains("#L5FILE real.dtx"));

        let empty = generate_set_def_content("");
        assert!(!empty.contains("#TITLE"));
        assert!(empty.contains("#L1FILE bas.dtx"));
        assert!(empty.contains("#L5FILE real.dtx"));
    }

    #[test]
    fn is_reserved_windows_file_name_detects_dos_device_names() {
        for name in ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"] {
            assert!(is_reserved_windows_file_name(name), "{name} should be reserved");
        }
        assert!(!is_reserved_windows_file_name("normal"));
        assert!(is_reserved_windows_file_name("con.txt"));
    }

    #[test]
    fn is_reserved_windows_numbered_name_only_matches_single_digits_one_to_nine() {
        assert!(is_reserved_windows_numbered_name("COM1", "COM"));
        assert!(is_reserved_windows_numbered_name("LPT9", "LPT"));
        assert!(!is_reserved_windows_numbered_name("COM0", "COM"));
        assert!(!is_reserved_windows_numbered_name("COM10", "COM"));
        assert!(!is_reserved_windows_numbered_name("LPT0", "LPT"));
    }

    #[test]
    fn is_valid_export_file_name_filters_by_extension_whitelist() {
        assert!(is_valid_export_file_name("song.dtx"));
        assert!(!is_valid_export_file_name("README"));
        assert!(is_valid_export_file_name("kick.wav"));
        assert!(!is_valid_export_file_name("notes.txt"));
    }

    #[tokio::test]
    async fn copy_template_recursively_copies_nested_files_and_directories() {
        let root = tempdir().expect("tempdir");
        let template = root.path().join("Template");
        let sub = template.join("sub");
        fs::create_dir_all(&sub).await.expect("sub dir");
        fs::write(template.join("top.dtx"), "top content")
            .await
            .expect("top file");
        fs::write(sub.join("nested.wav"), "nested content")
            .await
            .expect("nested file");

        let destination = root.path().join("Song");
        copy_template_recursively(&template, &destination)
            .await
            .expect("copy template");

        let top = fs::read_to_string(destination.join("top.dtx"))
            .await
            .expect("read top");
        assert_eq!(top, "top content");
        let nested = fs::read_to_string(destination.join("sub").join("nested.wav"))
            .await
            .expect("read nested");
        assert_eq!(nested, "nested content");
    }

    #[test]
    fn resolve_export_directory_expands_tilde_and_defaults_to_downloads() {
        let temp = tempdir().expect("tempdir");
        let saved_home = std::env::var_os("HOME");
        std::env::set_var("HOME", temp.path());

        assert_eq!(resolve_export_directory(None), temp.path().join("Downloads"));
        assert_eq!(
            resolve_export_directory(Some("~/Downloads")),
            temp.path().join("Downloads")
        );
        assert_eq!(
            resolve_export_directory(Some("~/Songs")),
            temp.path().join("Songs")
        );
        assert_eq!(
            resolve_export_directory(Some("/explicit/path")),
            PathBuf::from("/explicit/path")
        );

        match saved_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }

    #[tokio::test]
    async fn ensure_song_folder_does_not_exist_rejects_existing_folder() {
        let root = tempdir().expect("tempdir");
        let song_folder = root.path().join("Existing");
        fs::create_dir_all(&song_folder)
            .await
            .expect("pre-create folder");

        let error = ensure_song_folder_does_not_exist(&song_folder, "Existing")
            .await
            .expect_err("existing folder should error");

        assert!(error.to_string().contains("already exists"));
    }

    fn assert_zip_entries(zip_path: &str, expected: &[&str]) {
        let mut file = File::open(zip_path).expect("zip file");
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).expect("read zip");
        let cursor = std::io::Cursor::new(buffer);
        let mut archive = ZipArchive::new(cursor).expect("zip archive");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            names.push(archive.by_index(index).expect("entry").name().to_string());
        }
        names.sort();
        let expected = expected
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        assert_eq!(names, expected);
    }
