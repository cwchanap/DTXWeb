use super::*;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::{Arc, Barrier};
use tempfile::tempdir;

fn binding(
    user_id: &str,
    simfile_id: &str,
    drive_file_id: &str,
    kind: PendingBindingKind,
    created_at: &str,
) -> PendingGoogleDriveBinding {
    PendingGoogleDriveBinding {
        user_id: user_id.to_string(),
        simfile_id: simfile_id.to_string(),
        drive_file_id: drive_file_id.to_string(),
        kind,
        created_at: created_at.to_string(),
    }
}

#[test]
fn pending_store_writes_the_exact_private_recovery_schema_at_the_native_data_path() {
    // Break caught: adding a renderer/session/upload field to the durable record,
    // or writing it anywhere except the fixed native data namespace.
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf());
    store
        .replace(binding(
            "user-42",
            "42",
            "generated-file-id",
            PendingBindingKind::FirstUpload,
            "2026-07-26T01:02:03Z",
        ))
        .expect("persist binding");

    let path = data_dir
        .path()
        .join("dtxweb/google-drive-pending-bindings.json");
    let document: Value =
        serde_json::from_slice(&std::fs::read(path).expect("pending document")).expect("JSON");
    assert_eq!(document["schemaVersion"], 1);
    assert_eq!(
        document["bindingsByUser"]["user-42"]["42"],
        serde_json::json!({
            "userId": "user-42",
            "simfileId": "42",
            "driveFileId": "generated-file-id",
            "kind": "first-upload",
            "createdAt": "2026-07-26T01:02:03Z"
        })
    );

    let serialized = serde_json::to_string(&document).expect("serialized document");
    for forbidden in [
        "token",
        "sessionUri",
        "localPath",
        "folderId",
        "folderName",
        "fileName",
        "downloadUrl",
        "webContentLink",
        "operationId",
        "requestId",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "durable recovery data must not contain {forbidden}"
        );
    }
}

#[test]
fn pending_store_rejects_wrong_schema_redundant_keys_and_malformed_ids() {
    // Break caught: trusting attacker-edited redundant fields or accepting a
    // schema/identifier that cannot be safely reconciled.
    let data_dir = tempdir().expect("data dir");
    let path = google_drive_pending_bindings_path(data_dir.path());
    std::fs::create_dir_all(path.parent().expect("parent")).expect("parent");
    let store = GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf());

    for invalid in [
        serde_json::json!({"schemaVersion": 2, "bindingsByUser": {}}),
        serde_json::json!({
            "schemaVersion": 1,
            "bindingsByUser": {
                "user-42": {
                    "42": {
                        "userId": "other-user",
                        "simfileId": "42",
                        "driveFileId": "generated-file-id",
                        "kind": "first-upload",
                        "createdAt": "2026-07-26T01:02:03Z"
                    }
                }
            }
        }),
        serde_json::json!({
            "schemaVersion": 1,
            "bindingsByUser": {
                "user-42": {
                    "42": {
                        "userId": "user-42",
                        "simfileId": "../42",
                        "driveFileId": "generated-file-id",
                        "kind": "first-upload",
                        "createdAt": "2026-07-26T01:02:03Z"
                    }
                }
            }
        }),
        serde_json::json!({
            "schemaVersion": 1,
            "bindingsByUser": {
                "user-42": {
                    "42": {
                        "userId": "user-42",
                        "simfileId": "42",
                        "driveFileId": " ",
                        "kind": "first-upload",
                        "createdAt": "2026-07-26T01:02:03Z"
                    }
                }
            }
        }),
    ] {
        std::fs::write(
            &path,
            serde_json::to_vec(&invalid).expect("invalid document"),
        )
        .expect("seed invalid document");
        // Malformed or unknown-schema documents are quarantined to a .corrupt
        // sibling and the store recovers with an empty default state, so reads
        // return Ok(None) instead of surfacing a LocalState error. The original
        // file is no longer present at the expected path.
        assert_eq!(store.get("user-42", "42"), Ok(None));
        assert!(
            !path.exists(),
            "malformed pending-bindings file should be quarantined, not left in place"
        );
    }
}

#[test]
fn pending_store_atomically_replaces_one_key_without_losing_concurrent_users_or_simfiles() {
    // Break caught: read and write locking only individual I/O calls, which
    // loses one writer's update when concurrent full RMW operations overlap.
    let data_dir = tempdir().expect("data dir");
    let store = Arc::new(GoogleDrivePendingBindingStore::new(
        data_dir.path().to_path_buf(),
    ));
    let barrier = Arc::new(Barrier::new(9));
    let mut threads = Vec::new();

    for index in 0..8 {
        let store = Arc::clone(&store);
        let barrier = Arc::clone(&barrier);
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            store
                .replace(binding(
                    &format!("user-{index}"),
                    &format!("{}", index + 1),
                    &format!("generated-{index}"),
                    PendingBindingKind::FirstUpload,
                    "2026-07-26T01:02:03Z",
                ))
                .expect("concurrent replace");
        }));
    }
    barrier.wait();
    for thread in threads {
        thread.join().expect("writer");
    }

    let all = store.all().expect("all bindings");
    assert_eq!(all.len(), 8);
    assert_eq!(
        all.iter()
            .map(|entry| (&entry.user_id, &entry.simfile_id))
            .collect::<HashSet<_>>()
            .len(),
        8
    );

    store
        .replace(binding(
            "user-0",
            "1",
            "replacement-id",
            PendingBindingKind::ExplicitReplacement,
            "2026-07-26T03:04:05Z",
        ))
        .expect("same-key replacement");
    let all = store.all().expect("replaced bindings");
    assert_eq!(all.len(), 8, "one key may have only one binding");
    assert_eq!(
        store
            .get("user-0", "1")
            .expect("read replacement")
            .expect("binding")
            .drive_file_id,
        "replacement-id"
    );
}

#[test]
fn pending_store_removal_is_identity_guarded() {
    // Break caught: a stale operation deleting a newer same-song pending ID.
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf());
    store
        .replace(binding(
            "user-42",
            "42",
            "new-id",
            PendingBindingKind::FirstUpload,
            "2026-07-26T01:02:03Z",
        ))
        .expect("binding");

    assert!(!store
        .remove_if_matches("user-42", "42", "stale-id")
        .expect("stale removal"));
    assert!(store.get("user-42", "42").expect("read").is_some());
    assert!(store
        .remove_if_matches("user-42", "42", "new-id")
        .expect("matching removal"));
    assert_eq!(store.get("user-42", "42").expect("read"), None);
}

#[tokio::test]
async fn transaction_locks_are_shared_by_clones_and_independent_across_keys() {
    let data_dir = tempdir().expect("data dir");
    let store = GoogleDrivePendingBindingStore::new(data_dir.path().to_path_buf());
    let same_key = store.transaction_lock("user-42", "42");
    let same_key_from_clone = store.clone().transaction_lock("user-42", "42");
    let other_simfile = store.transaction_lock("user-42", "43");

    assert!(Arc::ptr_eq(&same_key, &same_key_from_clone));
    let _same_key_guard = same_key.lock().await;
    assert!(
        same_key_from_clone.try_lock().is_err(),
        "the same user/simfile lifecycle must serialize"
    );
    assert!(
        other_simfile.try_lock().is_ok(),
        "a different lifecycle must remain concurrent"
    );
}

#[test]
fn pending_store_maps_disk_full_separately_from_other_local_failures() {
    // Break caught: collapsing ENOSPC into LOCAL_STATE, which hides the
    // actionable storage-exhaustion outcome from the desktop UX.
    assert_eq!(
        classify_persistence_error(crate::error::DesktopError::Io(
            std::io::Error::from_raw_os_error(28)
        )),
        PendingBindingStoreError::InsufficientDiskSpace
    );
    // 112 = ERROR_DISK_FULL (Windows), 122 = EDQUOT (Linux quota).
    assert_eq!(
        classify_persistence_error(crate::error::DesktopError::Io(
            std::io::Error::from_raw_os_error(112)
        )),
        PendingBindingStoreError::InsufficientDiskSpace
    );
    assert_eq!(
        classify_persistence_error(crate::error::DesktopError::Io(
            std::io::Error::from_raw_os_error(122)
        )),
        PendingBindingStoreError::InsufficientDiskSpace
    );
    assert_eq!(
        classify_persistence_error(crate::error::DesktopError::Io(
            std::io::Error::from_raw_os_error(13)
        )),
        PendingBindingStoreError::LocalState
    );
}
