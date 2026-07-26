use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[test]
fn in_memory_credentials_are_isolated_by_drumery_user() {
    let store = InMemoryGoogleDriveCredentialStore::default();
    store
        .set_refresh_token("user-a", "refresh-for-a")
        .expect("store user a token");
    store
        .set_refresh_token("user-b", "refresh-for-b")
        .expect("store user b token");

    assert_eq!(
        store.get_refresh_token("user-a").expect("read user a"),
        Some("refresh-for-a".to_string())
    );
    assert_eq!(
        store.get_refresh_token("user-b").expect("read user b"),
        Some("refresh-for-b".to_string())
    );
}

#[test]
fn keyring_adapter_uses_the_drumery_service_and_user_scoped_account() {
    let factory = Arc::new(CapturingFactory::default());
    let store = KeyringGoogleDriveCredentialStore::with_factory(factory.clone());

    assert_eq!(store.get_refresh_token("user-42"), Ok(None));
    assert_eq!(
        factory.requests.lock().expect("requests").as_slice(),
        [(
            "com.hapadona.drumery".to_string(),
            "google-drive:user-42".to_string()
        )]
    );
}

#[test]
fn missing_keyring_credential_is_a_disconnected_drive_account() {
    let store =
        KeyringGoogleDriveCredentialStore::with_factory(Arc::new(CapturingFactory::default()));

    assert_eq!(store.get_refresh_token("missing-user"), Ok(None));
}

#[test]
fn keyring_backend_failures_are_sanitized_to_credential_store() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(FailingFactory));

    let error = store
        .get_refresh_token("user-42")
        .expect_err("locked keychain must fail");

    assert_eq!(error.to_string(), "CREDENTIAL_STORE");
}

#[test]
fn keyring_adapter_round_trips_a_stored_refresh_token() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(
        SharedInMemoryKeyringFactory::default(),
    ));

    // Initially missing → None.
    assert_eq!(store.get_refresh_token("user-42"), Ok(None));
    // Set a real token → subsequent reads return it.
    store
        .set_refresh_token("user-42", "refresh-token-42")
        .expect("store token");
    assert_eq!(
        store.get_refresh_token("user-42"),
        Ok(Some("refresh-token-42".to_string()))
    );
    // Delete → missing again.
    store.delete_refresh_token("user-42").expect("delete token");
    assert_eq!(store.get_refresh_token("user-42"), Ok(None));
    // Deleting a missing entry is idempotent.
    store
        .delete_refresh_token("user-42")
        .expect("delete missing token is idempotent");
}

#[test]
fn keyring_adapter_treats_a_whitespace_only_token_as_disconnected() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(
        SharedInMemoryKeyringFactory::default(),
    ));
    store
        .set_refresh_token("user-42", "   ")
        .expect("store whitespace token");
    // A blank token is treated as absent so the renderer never sees a
    // "connected" account that cannot actually refresh.
    assert_eq!(store.get_refresh_token("user-42"), Ok(None));
}

#[test]
fn keyring_backend_get_failure_is_sanitized_to_credential_store() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(BackendFailingFactory));
    assert_eq!(
        store
            .get_refresh_token("user-42")
            .expect_err("backend get failure"),
        CredentialStoreError::CredentialStore
    );
}

#[test]
fn keyring_backend_set_failure_is_sanitized_to_credential_store() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(BackendFailingFactory));
    assert_eq!(
        store
            .set_refresh_token("user-42", "token")
            .expect_err("backend set failure"),
        CredentialStoreError::CredentialStore
    );
}

#[test]
fn keyring_backend_delete_failure_is_sanitized_to_credential_store() {
    let store = KeyringGoogleDriveCredentialStore::with_factory(Arc::new(BackendFailingFactory));
    assert_eq!(
        store
            .delete_refresh_token("user-42")
            .expect_err("backend delete failure"),
        CredentialStoreError::CredentialStore
    );
}

#[cfg(feature = "google-drive")]
#[test]
fn locked_keychain_and_secret_service_failures_are_classified_as_backend_errors() {
    let locked_keychain = keyring::Error::NoStorageAccess(Box::new(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "locked keychain",
    )));
    let secret_service_dbus = keyring::Error::PlatformFailure(Box::new(std::io::Error::other(
        "Secret Service D-Bus unavailable",
    )));

    assert_eq!(
        map_keyring_error(locked_keychain),
        KeyringOperationError::Backend
    );
    assert_eq!(
        map_keyring_error(secret_service_dbus),
        KeyringOperationError::Backend
    );
}

#[tokio::test(flavor = "current_thread")]
async fn credential_access_runs_blocking_backend_calls_off_the_runtime_thread_and_serializes_a_credential(
) {
    let caller_thread = thread::current().id();
    let store = Arc::new(BlockingStore::default());
    let access = GoogleDriveCredentialAccess::new(store.clone());

    let (first, second) = tokio::join!(
        access.get_refresh_token("user-42"),
        access.get_refresh_token("user-42")
    );

    assert_eq!(
        first
            .expect("first result")
            .as_ref()
            .map(|token| token.as_str()),
        Some("refresh-token")
    );
    assert_eq!(
        second
            .expect("second result")
            .as_ref()
            .map(|token| token.as_str()),
        Some("refresh-token")
    );
    assert_ne!(
        store
            .first_thread
            .lock()
            .expect("thread")
            .expect("recorded"),
        caller_thread
    );
    assert_eq!(store.max_active.load(Ordering::SeqCst), 1);
}

#[derive(Default)]
struct CapturingFactory {
    requests: Mutex<Vec<(String, String)>>,
}

impl KeyringEntryFactory for CapturingFactory {
    fn entry(
        &self,
        service: &str,
        account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError> {
        self.requests
            .lock()
            .expect("requests")
            .push((service.to_string(), account.to_string()));
        Ok(Box::new(MissingEntry))
    }
}

struct MissingEntry;

impl KeyringEntry for MissingEntry {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError> {
        Err(KeyringOperationError::Missing)
    }

    fn set_password(&self, _token: &str) -> std::result::Result<(), KeyringOperationError> {
        Ok(())
    }

    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError> {
        Ok(())
    }
}

/// A keyring entry backed by a shared cell so the adapter's set/get/delete
/// round-trip can be exercised without touching the platform keychain.
#[derive(Default)]
struct InMemoryKeyringEntry {
    token: Mutex<Option<String>>,
}

impl KeyringEntry for InMemoryKeyringEntry {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError> {
        self.token
            .lock()
            .expect("token lock")
            .clone()
            .ok_or(KeyringOperationError::Missing)
    }

    fn set_password(&self, token: &str) -> std::result::Result<(), KeyringOperationError> {
        *self.token.lock().expect("token lock") = Some(token.to_string());
        Ok(())
    }

    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError> {
        *self.token.lock().expect("token lock") = None;
        Ok(())
    }
}

/// Returns handles that all share one backing cell, mirroring how a real
/// keyring factory hands out distinct handles to the same persisted entry.
#[derive(Default)]
struct SharedInMemoryKeyringFactory {
    entry: std::sync::Arc<InMemoryKeyringEntry>,
}

impl KeyringEntryFactory for SharedInMemoryKeyringFactory {
    fn entry(
        &self,
        _service: &str,
        _account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError> {
        Ok(Box::new(InMemoryKeyringHandle(self.entry.clone())))
    }
}

struct InMemoryKeyringHandle(std::sync::Arc<InMemoryKeyringEntry>);

impl KeyringEntry for InMemoryKeyringHandle {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError> {
        self.0.get_password()
    }
    fn set_password(&self, token: &str) -> std::result::Result<(), KeyringOperationError> {
        self.0.set_password(token)
    }
    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError> {
        self.0.delete_password()
    }
}

/// An entry whose `get_password` always fails with a backend error.
struct BackendFailingEntry;

impl KeyringEntry for BackendFailingEntry {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError> {
        Err(KeyringOperationError::Backend)
    }
    fn set_password(&self, _token: &str) -> std::result::Result<(), KeyringOperationError> {
        Err(KeyringOperationError::Backend)
    }
    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError> {
        Err(KeyringOperationError::Backend)
    }
}

struct BackendFailingFactory;

impl KeyringEntryFactory for BackendFailingFactory {
    fn entry(
        &self,
        _service: &str,
        _account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError> {
        Ok(Box::new(BackendFailingEntry))
    }
}

struct FailingFactory;

impl KeyringEntryFactory for FailingFactory {
    fn entry(
        &self,
        _service: &str,
        _account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError> {
        Err(KeyringOperationError::Backend)
    }
}

#[derive(Default)]
struct BlockingStore {
    active: AtomicUsize,
    max_active: AtomicUsize,
    first_thread: Mutex<Option<thread::ThreadId>>,
}

impl GoogleDriveCredentialStore for BlockingStore {
    fn get_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<Option<String>, CredentialStoreError> {
        *self.first_thread.lock().expect("thread") = Some(thread::current().id());
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active.fetch_max(active, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(25));
        self.active.fetch_sub(1, Ordering::SeqCst);
        Ok(Some("refresh-token".to_string()))
    }

    fn set_refresh_token(
        &self,
        _user_id: &str,
        _token: &str,
    ) -> std::result::Result<(), CredentialStoreError> {
        Ok(())
    }

    fn delete_refresh_token(
        &self,
        _user_id: &str,
    ) -> std::result::Result<(), CredentialStoreError> {
        Ok(())
    }
}
