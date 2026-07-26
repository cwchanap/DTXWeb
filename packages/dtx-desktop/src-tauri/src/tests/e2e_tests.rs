use std::sync::{Mutex, OnceLock};

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct EnvVarGuard {
    saved: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn replace(value: &str) -> Self {
        let saved = std::env::var_os("DTX_E2E_SESSION_NONCE");
        std::env::set_var("DTX_E2E_SESSION_NONCE", value);
        Self { saved }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.saved.take() {
            Some(value) => std::env::set_var("DTX_E2E_SESSION_NONCE", value),
            None => std::env::remove_var("DTX_E2E_SESSION_NONCE"),
        }
    }
}

#[test]
fn readiness_nonce_returns_the_e2e_launch_nonce() {
    let _lock = env_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _env = EnvVarGuard::replace("trusted-harness-nonce");

    assert_eq!(
        crate::e2e::read_e2e_session_nonce()
            .expect("e2e nonce command should read the launch nonce"),
        "trusted-harness-nonce"
    );
}
