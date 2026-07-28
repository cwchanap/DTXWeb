use super::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{Arc, Barrier, Mutex, OnceLock};
use tempfile::TempDir;

#[derive(Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct TestRecord {
    value: String,
    count: u32,
}

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct EnvVarGuard {
    name: &'static str,
    saved: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn replace(name: &'static str, value: &std::path::Path) -> Self {
        let saved = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, saved }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

fn temp_prefix(file_name: &str) -> String {
    format!(".{file_name}.tmp-")
}

fn sibling_temp_files(path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let prefix = temp_prefix(path.file_name().unwrap().to_str().unwrap());
    fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|entry| {
            entry
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(&prefix)
        })
        .collect()
}

#[test]
fn missing_or_malformed_json_returns_the_record_default() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("record.json");

    assert_eq!(
        read_json_or_default::<TestRecord>(&path, "test record"),
        TestRecord::default()
    );

    fs::write(&path, "{ malformed").unwrap();
    assert_eq!(
        read_json_or_default::<TestRecord>(&path, "test record"),
        TestRecord::default()
    );
}

#[test]
fn partial_json_uses_serde_field_defaults() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("record.json");
    fs::write(&path, r#"{"value":"saved"}"#).unwrap();

    assert_eq!(
        read_json_or_default::<TestRecord>(&path, "test record"),
        TestRecord {
            value: "saved".to_string(),
            count: 0,
        }
    );
}

#[test]
fn write_creates_only_the_exact_dtxweb_data_directory() {
    let dir = TempDir::new().unwrap();
    let path = app_data_file(dir.path(), "record.json");

    write_json_atomic(
        &path,
        &TestRecord {
            value: "saved".to_string(),
            count: 3,
        },
    )
    .unwrap();

    assert_eq!(path, dir.path().join("dtxweb").join("record.json"));
    assert!(path.is_file());
    let entries: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries, vec![std::ffi::OsString::from("dtxweb")]);
}

#[cfg(unix)]
#[test]
fn write_restricts_the_directory_and_file_to_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new().unwrap();
    let path = app_data_file(dir.path(), "record.json");
    write_json_atomic(&path, &TestRecord::default()).unwrap();

    assert_eq!(
        fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(unix)]
#[test]
fn write_narrows_an_existing_dtxweb_directory_without_touching_preferences() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new().unwrap();
    let dtxweb = dir.path().join("dtxweb");
    fs::create_dir(&dtxweb).unwrap();
    fs::set_permissions(&dtxweb, fs::Permissions::from_mode(0o777)).unwrap();
    let preferences = dtxweb.join("preferences.json");
    fs::write(&preferences, r#"{"value":"preserve"}"#).unwrap();

    write_json_atomic(&dtxweb.join("record.json"), &TestRecord::default()).unwrap();

    assert_eq!(
        fs::read_to_string(&preferences).unwrap(),
        r#"{"value":"preserve"}"#
    );
    assert_eq!(
        fs::metadata(&dtxweb).unwrap().permissions().mode() & 0o777,
        0o700
    );
}

#[test]
fn concurrent_writers_leave_a_complete_json_record() {
    let dir = TempDir::new().unwrap();
    let path = Arc::new(app_data_file(dir.path(), "record.json"));
    let barrier = Arc::new(Barrier::new(8));
    let writers: Vec<_> = (0..8)
        .map(|writer| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                for count in 0..50 {
                    write_json_atomic(
                        &path,
                        &TestRecord {
                            value: format!("writer-{writer}"),
                            count,
                        },
                    )
                    .unwrap();
                }
            })
        })
        .collect();

    for writer in writers {
        writer.join().unwrap();
    }

    let record = read_json_or_default::<TestRecord>(&path, "test record");
    assert!(record.value.starts_with("writer-"));
    assert!(record.count < 50);
}

#[test]
fn successful_write_leaves_no_unique_sibling_temporary_file() {
    let dir = TempDir::new().unwrap();
    let path = app_data_file(dir.path(), "record.json");

    write_json_atomic(&path, &TestRecord::default()).unwrap();

    assert!(sibling_temp_files(&path).is_empty());
}

#[test]
fn failed_replacement_removes_only_its_own_temporary_file() {
    let dir = TempDir::new().unwrap();
    let dtxweb = dir.path().join("dtxweb");
    fs::create_dir(&dtxweb).unwrap();
    let path = dtxweb.join("record.json");
    fs::create_dir(&path).unwrap();
    let unrelated = dtxweb.join(".record.json.tmp-unrelated");
    fs::write(&unrelated, "leave me alone").unwrap();

    assert!(write_json_atomic(&path, &TestRecord::default()).is_err());

    assert_eq!(fs::read_to_string(&unrelated).unwrap(), "leave me alone");
    assert!(path.is_dir());
    assert_eq!(sibling_temp_files(&path), vec![unrelated]);
}

#[cfg(feature = "e2e")]
#[test]
fn resolve_dirs_uses_the_e2e_data_directory_when_the_feature_is_enabled() {
    let _lock = env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().unwrap();
    let _env = EnvVarGuard::replace("DTX_E2E_DATA_DIR", dir.path());

    assert_eq!(
        resolve_dirs(),
        (
            Some(dir.path().to_path_buf()),
            Some(dir.path().to_path_buf())
        )
    );
}

#[cfg(not(feature = "e2e"))]
#[test]
fn resolve_dirs_ignores_the_e2e_data_directory_without_the_feature() {
    let _lock = env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = TempDir::new().unwrap();
    let _env = EnvVarGuard::replace("DTX_E2E_DATA_DIR", dir.path());

    assert_ne!(
        resolve_dirs(),
        (
            Some(dir.path().to_path_buf()),
            Some(dir.path().to_path_buf())
        )
    );
}

#[test]
fn read_json_or_default_returns_default_when_read_fails_for_a_non_notfound_reason() {
    // Reading a directory path fails with "Is a directory" (not NotFound), so
    // the generic-IO-error branch must fall back to the default instead of
    // propagating the error.
    let dir = TempDir::new().unwrap();

    assert_eq!(
        read_json_or_default::<TestRecord>(dir.path(), "directory-read test"),
        TestRecord::default()
    );
}

#[cfg(unix)]
#[test]
fn write_json_atomic_errors_when_the_path_has_no_parent_directory() {
    // The root path "/" has no parent (Path::parent returns None), so
    // ensure_private_parent must reject it before any filesystem mutation.
    let root = std::path::Path::new("/");

    let result = write_json_atomic(root, &TestRecord::default());

    let error = result.expect_err("root path should have no parent");
    assert!(
        error
            .to_string()
            .contains("Could not resolve a parent directory"),
        "unexpected error: {error}"
    );
}

#[test]
fn write_json_atomic_errors_when_the_resolved_parent_is_not_a_directory() {
    // A bare relative filename has an empty-string parent. create_dir_all("")
    // is a no-op (Ok), but "" is not a directory, so ensure_private_parent
    // must reject it. No file is written because the check runs before temp
    // file creation.
    let bare = std::path::PathBuf::from("native_persistence_bare_filename_test.json");

    let result = write_json_atomic(&bare, &TestRecord::default());

    let error = result.expect_err("bare filename parent is not a directory");
    assert!(
        error
            .to_string()
            .contains("Persistence parent is not a directory"),
        "unexpected error: {error}"
    );
    assert!(!bare.exists(), "no file should have been written");
}

#[cfg(unix)]
#[test]
fn write_json_atomic_errors_when_the_file_name_is_not_valid_utf8() {
    // write_json_atomic resolves the file name via Path::file_name + to_str.
    // A non-UTF-8 file name (valid on Unix but not convertible to &str)
    // must be rejected at the file-name resolution step, after
    // ensure_private_parent succeeds on the writable parent directory.
    use std::os::unix::ffi::OsStrExt;

    let dir = TempDir::new().unwrap();
    let subdir = dir.path().join("writable_parent");
    fs::create_dir(&subdir).unwrap();
    let non_utf8_name = std::ffi::OsStr::from_bytes(b"\xff\xfe.json");
    let path = subdir.join(non_utf8_name);

    let result = write_json_atomic(&path, &TestRecord::default());

    let error = result.expect_err("non-UTF-8 file name should be rejected");
    assert!(
        error.to_string().contains("Could not resolve a file name"),
        "unexpected error: {error}"
    );
}
