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
    let result = parse_dtx_files("/nonexistent/path/that/does/not/exist".to_string()).await;
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
        format!("data:image/png;base64,{}", STANDARD.encode([1u8, 2, 3]))
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
        assert!(
            is_reserved_windows_file_name(name),
            "{name} should be reserved"
        );
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

/// RAII guard that restores the `HOME` environment variable on drop,
/// including when an assertion between construction and the end of scope
/// panics. Without this, a failing assertion leaks the temporary `HOME`
/// into subsequent tests running in the same process.
struct HomeEnvGuard {
    saved: Option<std::ffi::OsString>,
}

impl HomeEnvGuard {
    fn replace(temp_path: &std::path::Path) -> Self {
        let saved = std::env::var_os("HOME");
        std::env::set_var("HOME", temp_path);
        Self { saved }
    }
}

impl Drop for HomeEnvGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
    }
}

#[test]
fn resolve_export_directory_expands_tilde_and_defaults_to_downloads() {
    let temp = tempdir().expect("tempdir");
    // `_guard` restores HOME on drop — even if an assertion below panics.
    let _guard = HomeEnvGuard::replace(temp.path());

    assert_eq!(
        resolve_export_directory(None),
        temp.path().join("Downloads")
    );
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

#[test]
fn parse_dtx_metadata_extracts_bpm_artist_and_level_from_directives() {
    // Direct unit test of the metadata extractor. Goes through the same code
    // path as parse_dtx_folder but isolates the directive parsing from file
    // I/O and set.def label resolution.
    let content = "#TITLE: Song\n#ARTIST: Artist\n#BPM: 180.5\n#DLEVEL: 95\n";

    let metadata = parse_dtx_metadata(content);

    assert_eq!(metadata.bpm, Some(180.5));
    assert_eq!(metadata.artist.as_deref(), Some("Artist"));
    assert_eq!(metadata.level, Some(95.0));
    assert!(metadata.has_metadata);
}

#[test]
fn parse_dtx_metadata_marks_has_metadata_for_title_or_wav_directives() {
    // Even without BPM/ARTIST/DLEVEL, a TITLE or #WAV directive identifies
    // the content as a real DTX file (vs. garbage) so parse_dtx_folder can
    // count it as a parse failure only when truly no metadata is present.
    let title_only = parse_dtx_metadata("#TITLE: Song\n");
    assert!(title_only.has_metadata);
    assert!(title_only.bpm.is_none());
    assert!(title_only.artist.is_none());

    let wav_only = parse_dtx_metadata("#WAV1A foo.wav\n");
    assert!(wav_only.has_metadata);

    let empty = parse_dtx_metadata("just some text\nwith no directives\n");
    assert!(!empty.has_metadata);
}

#[test]
fn parse_dtx_metadata_ignores_blank_artist_value() {
    // The renderer filters on `artist.is_some()`, so a blank `#ARTIST:` must
    // not produce a Some("") that would render as an empty chip.
    let metadata = parse_dtx_metadata("#ARTIST:   \n#BPM: 120\n");

    assert!(metadata.artist.is_none());
    assert_eq!(metadata.bpm, Some(120.0));
    assert!(metadata.has_metadata);
}

#[test]
fn parse_dtx_metadata_keeps_first_value_when_directive_repeats() {
    // DTX charts occasionally repeat directives (e.g. multiple #BPM lines for
    // tempo changes). The metadata summary keeps the first value seen.
    let metadata = parse_dtx_metadata("#BPM: 120\n#BPM: 240\n#ARTIST: A\n#ARTIST: B\n");

    assert_eq!(metadata.bpm, Some(120.0));
    assert_eq!(metadata.artist.as_deref(), Some("A"));
}

#[test]
fn parse_dtx_metadata_ignores_zero_dlevel_value_in_summary() {
    // parse_dtx_folder filters out zero-valued DLEVEL — a missing/zero level
    // means the chart has no difficulty rating and shouldn't appear in the
    // levels list. The summary extractor preserves this contract by passing
    // through the raw parsed value; the zero-filter happens at the call site.
    let metadata = parse_dtx_metadata("#DLEVEL: 0\n#BPM: 100\n");

    assert_eq!(metadata.level, Some(0.0));
    assert_eq!(metadata.bpm, Some(100.0));
}

#[test]
fn is_dtx_content_recognizes_supported_directives() {
    // Used by decode_text_content's encoding fallback validator: content with
    // at least one known DTX directive is treated as decodeable.
    assert!(is_dtx_content("#TITLE: Song\n"));
    assert!(is_dtx_content("#ARTIST: A\n"));
    assert!(is_dtx_content("#BPM: 120\n"));
    assert!(is_dtx_content("#DLEVEL: 50\n"));
    assert!(is_dtx_content("#WAV01 foo.wav\n"));
    assert!(!is_dtx_content("plain text with no directives"));
}

#[test]
fn is_set_def_content_recognizes_dtx_filename_references() {
    // SET.def files reference .dtx paths via #L{n}FILE directives. The
    // validator accepts either standard directives or any line containing a
    // .dtx reference, since homegrown SET.def files sometimes use bare
    // filename references.
    assert!(is_set_def_content("#TITLE: Song\n"));
    assert!(is_set_def_content("#L1FILE basic.dtx\n"));
    assert!(is_set_def_content("basic.DTX\n"));
    assert!(!is_set_def_content("just notes\nwith no dtx reference"));
}

#[test]
fn songs_directive_value_reads_colon_separated_values() {
    // Most DTX directives use `:` as the separator (e.g. `#TITLE:Song`).
    assert_eq!(directive_value("#TITLE: Song", "#TITLE"), Some(" Song"));
    assert_eq!(directive_value("#BPM:120", "#BPM"), Some("120"));
}

#[test]
fn songs_directive_value_reads_whitespace_separated_values() {
    // SET.def files commonly use `#TITLE Song` (whitespace separator). Both
    // separators must be supported so the same content parses regardless of
    // which app produced it.
    assert_eq!(directive_value("#TITLE Song", "#TITLE"), Some("Song"));
}

#[test]
fn songs_directive_value_rejects_unrecognized_directive() {
    assert!(directive_value("#UNKNOWN: value", "#TITLE").is_none());
    // Case-insensitive prefix match, but suffix still must be `:` or whitespace.
    assert_eq!(directive_value("#title:Song", "#TITLE"), Some("Song"));
    // No separator at all — not a valid directive.
    assert!(directive_value("#TITLESONG", "#TITLE").is_none());
}

#[test]
fn songs_directive_value_returns_none_when_line_is_shorter_than_directive() {
    // Short input lines must not panic on slice indexing.
    assert!(directive_value("#T", "#TITLE").is_none());
    assert!(directive_value("", "#TITLE").is_none());
}

#[test]
fn decode_text_content_decodes_utf8_bytes_with_bom_as_utf8() {
    // UTF-8 BOM bytes short-circuit through decode_bom, bypassing the
    // DTX priority list (which starts with SHIFT_JIS). Without the BOM,
    // UTF-8 Japanese content would mojibake-decode as SHIFT_JIS and still
    // pass the #TITLE validator.
    let mut bytes = vec![0xef, 0xbb, 0xbf]; // UTF-8 BOM
    bytes.extend_from_slice(b"#TITLE: \xe3\x83\x86\xe3\x82\xb9\xe3\x83\x88\n"); // "テスト"
    let decoded = decode_text_content(&bytes, &DTX_DECODING_PRIORITY, is_dtx_content);

    assert_eq!(decoded, "#TITLE: テスト\n");
}

#[test]
fn decode_text_content_decodes_ascii_bytes_regardless_of_priority_order() {
    // ASCII is a subset of every supported encoding, so plain-ASCII DTX
    // content decodes identically regardless of which encoding is tried first.
    let bytes = b"#TITLE: Song\n#BPM: 120\n";
    let decoded = decode_text_content(bytes, &DTX_DECODING_PRIORITY, is_dtx_content);

    assert_eq!(decoded, "#TITLE: Song\n#BPM: 120\n");
}

#[test]
fn home_dir_from_env_prefers_userprofile_on_windows() {
    // Windows: USERPROFILE is the canonical home dir; HOMEDRIVE+HOMEPATH is
    // a fallback when USERPROFILE is unset.
    let home = home_dir_from_env(
        HomeDirPlatform::Windows,
        None,
        Some(r"C:\Users\test"),
        Some("D:"),
        Some(r"\Users\test"),
    );
    assert_eq!(
        home.as_deref(),
        Some(std::path::Path::new(r"C:\Users\test"))
    );
}

#[test]
fn home_dir_from_env_combines_homedrive_and_homepath_when_userprofile_unset() {
    let home = home_dir_from_env(
        HomeDirPlatform::Windows,
        None,
        None,
        Some("C:"),
        Some(r"\Users\jane"),
    );
    assert_eq!(
        home.as_deref(),
        Some(std::path::Path::new(r"C:\Users\jane"))
    );
}

#[test]
fn home_dir_from_env_posix_uses_home_then_falls_back_to_windows_vars() {
    // On POSIX, HOME wins. Windows-style env vars are consulted only as a
    // fallback (covers cases where HOME is missing under WSL or mixed envs).
    let home = home_dir_from_env(
        HomeDirPlatform::Posix,
        Some("/home/alice"),
        Some("ignored"),
        None,
        None,
    );
    assert_eq!(home.as_deref(), Some(std::path::Path::new("/home/alice")));

    let fallback = home_dir_from_env(
        HomeDirPlatform::Posix,
        None,
        Some(r"C:\Users\alice"),
        None,
        None,
    );
    assert_eq!(
        fallback.as_deref(),
        Some(std::path::Path::new(r"C:\Users\alice"))
    );
}

#[test]
fn home_dir_from_env_returns_none_when_all_vars_missing() {
    assert_eq!(
        home_dir_from_env(HomeDirPlatform::Posix, None, None, None, None),
        None
    );
    assert_eq!(
        home_dir_from_env(HomeDirPlatform::Windows, None, None, None, None),
        None
    );
}

#[test]
fn non_empty_value_treats_whitespace_only_strings_as_empty() {
    // Trimming is intentional: stray env entries like HOME=" " must not be
    // treated as a real path, or downstream path joins would break.
    assert_eq!(non_empty_value(Some("   ")), None);
    assert_eq!(non_empty_value(Some("")), None);
    assert_eq!(non_empty_value(Some("x")), Some("x"));
    assert_eq!(non_empty_value(None), None);
}

#[test]
fn non_empty_path_wraps_non_empty_value_into_pathbuf() {
    assert_eq!(non_empty_path(Some("/home")), Some(PathBuf::from("/home")));
    assert_eq!(non_empty_path(Some("")), None);
    assert_eq!(non_empty_path(None), None);
}

#[test]
fn has_extension_matches_case_insensitively() {
    // File systems on macOS/Windows are case-insensitive; the matcher must
    // accept any casing on the extension.
    let path = std::path::Path::new("chart.DTX");
    assert!(has_extension(path, ".dtx"));

    let lower = std::path::Path::new("chart.dtx");
    assert!(has_extension(lower, ".dtx"));

    let other = std::path::Path::new("chart.wav");
    assert!(!has_extension(other, ".dtx"));

    let no_ext = std::path::Path::new("chart");
    assert!(!has_extension(no_ext, ".dtx"));
}

#[test]
fn file_name_eq_ignore_ascii_case_matches_set_def_variants() {
    // SET.def is sometimes written SET.DEF or set.def by different editors;
    // the matcher must accept any ASCII casing.
    let path = std::path::Path::new("folder/SET.def");
    assert!(file_name_eq_ignore_ascii_case(path, "SET.def"));
    assert!(file_name_eq_ignore_ascii_case(path, "set.def"));
    assert!(file_name_eq_ignore_ascii_case(path, "SET.DEF"));
    assert!(!file_name_eq_ignore_ascii_case(path, "set.deff"));
}

#[test]
fn validate_safe_file_name_returns_ok_for_simple_name() {
    // A simple alphanumeric name is the happy path; this also exercises the
    // Ok-return branch which most other tests only hit indirectly.
    assert!(validate_safe_file_name("mysong", "song name").is_ok());
    assert!(validate_safe_file_name("mysong.dtx", "file name").is_ok());
}

#[test]
fn windows_home_dir_fallback_combines_drive_and_path_when_userprofile_missing() {
    // When USERPROFILE is unset, Windows falls back to concatenating
    // HOMEDRIVE + HOMEPATH into a usable path.
    let home = windows_home_dir_fallback(None, Some("C:"), Some(r"\Users\jane"));
    assert_eq!(
        home.as_deref(),
        Some(std::path::Path::new(r"C:\Users\jane"))
    );
}

#[test]
fn windows_home_dir_fallback_returns_none_with_only_one_of_drive_or_path() {
    // A partial pair (drive without path, or path without drive) is unusable:
    // "C:" alone or "\Users\jane" alone are not valid absolute paths.
    assert_eq!(windows_home_dir_fallback(None, Some("C:"), None), None);
    assert_eq!(
        windows_home_dir_fallback(None, None, Some(r"\Users\jane")),
        None
    );
}

// ---------------------------------------------------------------------------
// parse_dtx_folder edge cases
// ---------------------------------------------------------------------------

#[tokio::test]
async fn parse_dtx_folder_returns_empty_result_for_folder_without_dtx_files() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("readme.txt"), b"not a dtx file")
        .await
        .unwrap();

    let result = parse_dtx_folder(dir.path()).await.unwrap();

    assert!(result.bpm.is_none());
    assert!(result.artist.is_none());
    assert!(result.levels.is_empty());
    assert!(result.parse_failures.is_none());
}

#[tokio::test]
async fn parse_dtx_folder_counts_unreadable_dtx_as_parse_failure() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("test.dtx");

    // Write a valid .dtx, then remove read permissions so fs::read fails.
    fs::write(&file_path, b"#TITLE: Test\n#BPM: 120")
        .await
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&file_path).await.unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&file_path, perms).await.unwrap();
    }

    let result = parse_dtx_folder(dir.path()).await.unwrap();

    #[cfg(unix)]
    {
        assert_eq!(result.parse_failures, Some(1));
    }
    // On non-unix we can't easily trigger a read failure; just verify it
    // doesn't panic.
    let _ = result;
}

#[tokio::test]
async fn parse_dtx_folder_counts_dtx_without_metadata_as_parse_failure() {
    let dir = tempdir().unwrap();
    // A .dtx file with no recognizable directives and no SET.def label
    fs::write(dir.path().join("noise.dtx"), b"just some garbage text")
        .await
        .unwrap();

    let result = parse_dtx_folder(dir.path()).await.unwrap();

    assert_eq!(result.parse_failures, Some(1));
    assert!(result.levels.is_empty());
}

// ---------------------------------------------------------------------------
// resolve_export_directory
// ---------------------------------------------------------------------------

#[test]
fn resolve_export_directory_uses_explicit_path() {
    let path = resolve_export_directory(Some("/custom/export"));
    assert_eq!(path, PathBuf::from("/custom/export"));
}

#[test]
fn resolve_export_directory_ignores_empty_string() {
    // An empty string should fall through to the ~/Downloads default, not
    // produce a PathBuf of "" (which would be the current directory).
    let path = resolve_export_directory(Some(""));
    assert!(path.ends_with("Downloads") || path == *".");
}

#[test]
fn resolve_export_directory_expands_tilde_prefix() {
    let path = resolve_export_directory(Some("~/Music/exports"));
    // On systems with HOME set, the tilde is expanded. On systems without
    // HOME (rare in tests), the fallback strips the "~/". Either way the
    // result should contain "Music/exports" without the literal "~".
    assert!(path.ends_with("Music/exports"));
    assert!(!path.starts_with("~"));
}

// ---------------------------------------------------------------------------
// data_url_for_asset
// ---------------------------------------------------------------------------

#[test]
fn data_url_for_asset_uses_png_mime_for_png_files() {
    let url = data_url_for_asset("image.png", b"\x89PNG...");
    assert!(url.starts_with("data:image/png;base64,"));
}

#[test]
fn data_url_for_asset_uses_jpeg_mime_for_jpg_files() {
    let url = data_url_for_asset("photo.jpg", b"\xff\xd8...");
    assert!(url.starts_with("data:image/jpeg;base64,"));
}

#[test]
fn data_url_for_asset_uses_jpeg_mime_for_jpeg_extension() {
    let url = data_url_for_asset("photo.jpeg", b"\xff\xd8...");
    assert!(url.starts_with("data:image/jpeg;base64,"));
}

#[test]
fn data_url_for_asset_defaults_to_octet_stream_for_unknown_extensions() {
    let url = data_url_for_asset("file.xyz", b"bytes");
    assert!(url.starts_with("data:application/octet-stream;base64,"));
}

// ---------------------------------------------------------------------------
// valid_export_files skips directories
// ---------------------------------------------------------------------------

#[tokio::test]
async fn valid_export_files_skips_directories_and_invalid_extensions() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("song.dtx"), b"#TITLE: Test")
        .await
        .unwrap();
    fs::write(dir.path().join("notes.txt"), b"notes")
        .await
        .unwrap();
    fs::create_dir(dir.path().join("subfolder")).await.unwrap();

    let files = valid_export_files(dir.path()).await.unwrap();

    // Only .dtx should be included; .txt and the directory should be excluded.
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].0, "song.dtx");
}
