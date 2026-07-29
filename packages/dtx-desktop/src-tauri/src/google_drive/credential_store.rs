use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;
use zeroize::Zeroizing;

pub(crate) const GOOGLE_DRIVE_CREDENTIAL_SERVICE: &str = "com.hapadona.drumery";

pub(crate) trait GoogleDriveCredentialStore: Send + Sync {
    fn get_refresh_token(
        &self,
        user_id: &str,
    ) -> std::result::Result<Option<String>, CredentialStoreError>;
    fn set_refresh_token(
        &self,
        user_id: &str,
        token: &str,
    ) -> std::result::Result<(), CredentialStoreError>;
    fn delete_refresh_token(&self, user_id: &str) -> std::result::Result<(), CredentialStoreError>;
}

/// All platform secure-storage failures deliberately share one renderer-safe
/// code. Keychain/Secret Service details can reveal local machine state and
/// must never cross the native boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum CredentialStoreError {
    #[error("CREDENTIAL_STORE")]
    CredentialStore,
}

pub(crate) fn credential_account(user_id: &str) -> String {
    format!("google-drive:{user_id}")
}

pub(crate) trait KeyringEntry: Send + Sync {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError>;
    fn set_password(&self, token: &str) -> std::result::Result<(), KeyringOperationError>;
    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError>;
}

pub(crate) trait KeyringEntryFactory: Send + Sync {
    fn entry(
        &self,
        service: &str,
        account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeyringOperationError {
    Missing,
    Backend,
}

pub(crate) struct KeyringGoogleDriveCredentialStore<F> {
    factory: Arc<F>,
}

impl<F> KeyringGoogleDriveCredentialStore<F>
where
    F: KeyringEntryFactory,
{
    pub(crate) fn with_factory(factory: Arc<F>) -> Self {
        Self { factory }
    }

    fn entry_for_user(
        &self,
        user_id: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, CredentialStoreError> {
        self.factory
            .entry(
                GOOGLE_DRIVE_CREDENTIAL_SERVICE,
                &credential_account(user_id),
            )
            .map_err(|_| CredentialStoreError::CredentialStore)
    }
}

impl<F> GoogleDriveCredentialStore for KeyringGoogleDriveCredentialStore<F>
where
    F: KeyringEntryFactory,
{
    fn get_refresh_token(
        &self,
        user_id: &str,
    ) -> std::result::Result<Option<String>, CredentialStoreError> {
        match self.entry_for_user(user_id)?.get_password() {
            Ok(token) => {
                let token = Zeroizing::new(token);
                if token.trim().is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(token.to_string()))
                }
            }
            Err(KeyringOperationError::Missing) => Ok(None),
            Err(KeyringOperationError::Backend) => Err(CredentialStoreError::CredentialStore),
        }
    }

    fn set_refresh_token(
        &self,
        user_id: &str,
        token: &str,
    ) -> std::result::Result<(), CredentialStoreError> {
        let token = Zeroizing::new(token.to_string());
        self.entry_for_user(user_id)?
            .set_password(&token)
            .map_err(|_| CredentialStoreError::CredentialStore)
    }

    fn delete_refresh_token(&self, user_id: &str) -> std::result::Result<(), CredentialStoreError> {
        match self.entry_for_user(user_id)?.delete_password() {
            Ok(()) | Err(KeyringOperationError::Missing) => Ok(()),
            Err(KeyringOperationError::Backend) => Err(CredentialStoreError::CredentialStore),
        }
    }
}

#[cfg(feature = "google-drive")]
pub(crate) struct PlatformKeyringEntryFactory;

#[cfg(feature = "google-drive")]
impl KeyringEntryFactory for PlatformKeyringEntryFactory {
    fn entry(
        &self,
        service: &str,
        account: &str,
    ) -> std::result::Result<Box<dyn KeyringEntry>, KeyringOperationError> {
        keyring::Entry::new(service, account)
            .map(|entry| Box::new(PlatformKeyringEntry(entry)) as Box<dyn KeyringEntry>)
            .map_err(map_keyring_error)
    }
}

#[cfg(feature = "google-drive")]
struct PlatformKeyringEntry(keyring::Entry);

#[cfg(feature = "google-drive")]
impl KeyringEntry for PlatformKeyringEntry {
    fn get_password(&self) -> std::result::Result<String, KeyringOperationError> {
        self.0.get_password().map_err(map_keyring_error)
    }

    fn set_password(&self, token: &str) -> std::result::Result<(), KeyringOperationError> {
        self.0.set_password(token).map_err(map_keyring_error)
    }

    fn delete_password(&self) -> std::result::Result<(), KeyringOperationError> {
        self.0.delete_credential().map_err(map_keyring_error)
    }
}

#[cfg(feature = "google-drive")]
fn map_keyring_error(error: keyring::Error) -> KeyringOperationError {
    match error {
        keyring::Error::NoEntry => KeyringOperationError::Missing,
        _ => KeyringOperationError::Backend,
    }
}

/// E2E and native tests use this injected fake rather than touching a real
/// platform credential manager. Values are kept zeroized while stored.
#[derive(Default)]
pub(crate) struct InMemoryGoogleDriveCredentialStore {
    tokens: Mutex<HashMap<String, Zeroizing<String>>>,
}

impl GoogleDriveCredentialStore for InMemoryGoogleDriveCredentialStore {
    fn get_refresh_token(
        &self,
        user_id: &str,
    ) -> std::result::Result<Option<String>, CredentialStoreError> {
        Ok(self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(user_id)
            .map(|token| token.to_string()))
    }

    fn set_refresh_token(
        &self,
        user_id: &str,
        token: &str,
    ) -> std::result::Result<(), CredentialStoreError> {
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(user_id.to_string(), Zeroizing::new(token.to_string()));
        Ok(())
    }

    fn delete_refresh_token(&self, user_id: &str) -> std::result::Result<(), CredentialStoreError> {
        self.tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(user_id);
        Ok(())
    }
}

/// Async boundary for the synchronous keyring API. Each user credential gets
/// one mutex, preventing unsafe concurrent keyring/DBus operations while
/// allowing unrelated Drumery accounts to proceed independently.
///
/// Locks are held as `Weak` references and GC'd via `retain` on each lookup,
/// mirroring the pattern in `pending_bindings::BindingTransactionLockRegistry`
/// — without this, one `AsyncMutex` per distinct user accumulates unboundedly
/// over the process lifetime.
#[derive(Clone)]
pub(crate) struct GoogleDriveCredentialAccess {
    store: Arc<dyn GoogleDriveCredentialStore>,
    credential_locks: Arc<Mutex<HashMap<String, Weak<AsyncMutex<()>>>>>,
}

impl GoogleDriveCredentialAccess {
    pub(crate) fn new(store: Arc<dyn GoogleDriveCredentialStore>) -> Self {
        Self {
            store,
            credential_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn get_refresh_token(
        &self,
        user_id: &str,
    ) -> std::result::Result<Option<Zeroizing<String>>, CredentialStoreError> {
        let lock = self.lock_for_user(user_id);
        let _guard = lock.lock().await;
        let store = self.store.clone();
        let user_id = user_id.to_string();
        tokio::task::spawn_blocking(move || {
            store
                .get_refresh_token(&user_id)
                .map(|token| token.map(Zeroizing::new))
        })
        .await
        .map_err(|_| CredentialStoreError::CredentialStore)?
    }

    pub(crate) async fn set_refresh_token(
        &self,
        user_id: &str,
        token: Zeroizing<String>,
    ) -> std::result::Result<(), CredentialStoreError> {
        let lock = self.lock_for_user(user_id);
        let _guard = lock.lock().await;
        let store = self.store.clone();
        let user_id = user_id.to_string();
        tokio::task::spawn_blocking(move || store.set_refresh_token(&user_id, &token))
            .await
            .map_err(|_| CredentialStoreError::CredentialStore)?
    }

    pub(crate) async fn delete_refresh_token(
        &self,
        user_id: &str,
    ) -> std::result::Result<(), CredentialStoreError> {
        let lock = self.lock_for_user(user_id);
        let _guard = lock.lock().await;
        let store = self.store.clone();
        let user_id = user_id.to_string();
        tokio::task::spawn_blocking(move || store.delete_refresh_token(&user_id))
            .await
            .map_err(|_| CredentialStoreError::CredentialStore)?
    }

    fn lock_for_user(&self, user_id: &str) -> Arc<AsyncMutex<()>> {
        let key = credential_account(user_id);
        let mut locks = self
            .credential_locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            return lock;
        }
        // GC: drop entries whose last strong reference was released, so the
        // registry does not grow unboundedly as distinct users log in.
        locks.retain(|_, lock| lock.strong_count() > 0);
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        lock
    }
}

#[cfg(test)]
#[path = "../tests/google_drive_credential_store_tests.rs"]
mod tests;
