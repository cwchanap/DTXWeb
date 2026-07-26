use super::*;
use tempfile::tempdir;

#[test]
fn drive_name_sanitizes_metadata_without_using_local_filename_rules() {
    assert_eq!(sanitize_drive_zip_name("AC/DC", "sim-42"), "AC-DC.zip");
    assert_eq!(
        sanitize_drive_zip_name("Song: Reprise", "sim-42"),
        "Song: Reprise.zip"
    );
    assert_eq!(
        sanitize_drive_zip_name("  AC\u{0000}///DC  ", "sim-42"),
        "AC-DC.zip"
    );
    assert_eq!(
        sanitize_drive_zip_name(" \n\t\u{0000} ", "sim-42"),
        "simfile-sim-42.zip"
    );
}

#[test]
fn drive_upload_cache_path_is_native_random_and_never_uses_renderer_metadata() {
    let cache = tempdir().expect("cache");
    let first = create_upload_archive(cache.path()).expect("first archive");
    let second = create_upload_archive(cache.path()).expect("second archive");

    let namespace = cache.path().join("google-drive-uploads");
    assert!(first.zip_path().starts_with(&namespace));
    assert!(second.zip_path().starts_with(&namespace));
    assert_eq!(first.zip_path().file_name().unwrap(), "upload.zip");
    assert_ne!(first.zip_path(), second.zip_path());
    assert_eq!(
        first.zip_path().parent().unwrap().parent().unwrap(),
        namespace
    );
}

#[test]
fn drive_upload_cache_cleanup_is_restricted_to_its_namespace() {
    let cache = tempdir().expect("cache");
    let stale = cache.path().join("google-drive-uploads/stale");
    let sibling = cache.path().join("keep-me");
    std::fs::create_dir_all(&stale).expect("stale");
    std::fs::write(stale.join("upload.zip"), b"partial").expect("partial archive");
    std::fs::create_dir(&sibling).expect("sibling");
    std::fs::write(sibling.join("not-a-drive-upload"), b"keep").expect("sibling file");

    cleanup_stale_upload_archives(cache.path());

    assert!(!stale.exists());
    assert!(sibling.join("not-a-drive-upload").exists());
}

#[test]
fn drive_upload_archive_cleans_up_on_drop_and_explicit_cleanup() {
    let cache = tempdir().expect("cache");
    let zip_path = {
        let archive = create_upload_archive(cache.path()).expect("archive");
        let zip_path = archive.zip_path().to_path_buf();
        std::fs::write(&zip_path, b"archive").expect("archive content");
        zip_path
    };
    assert!(
        !zip_path.exists(),
        "drop must remove the per-upload directory"
    );

    let mut archive = create_upload_archive(cache.path()).expect("archive");
    let zip_path = archive.zip_path().to_path_buf();
    std::fs::write(&zip_path, b"archive").expect("archive content");
    archive.cleanup();
    assert!(
        !zip_path.exists(),
        "explicit cancellation/failure cleanup must remove it"
    );
}
