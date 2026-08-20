## Task 10: Replace native Supabase auth with Device Authorization and retarget native E2E auth

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/device_auth.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/device_auth_tests.rs`
- Rewrite: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/e2e.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/e2e_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Regenerate: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

**Interfaces:**

- `device_auth.rs` is HTTP protocol only and WireMock-testable.
- `auth.rs` retains `AuthState`, session generation/epoch, existing command names, and e2e/debug seed path.
- `SessionData` becomes Better Auth-shaped `{ sessionToken, user }`.

- [ ] **Step 1: Add WireMock protocol tests.**

Cover code request, display-safe response, pending, slow-down, approval, denial, expiry, invalid grant, malformed body, timeout, and network failure. Confirm `device_code` never crosses Tauri IPC.

- [ ] **Step 2: Implement protocol-only module.**

Use exact wire fields of the Task-1 pinned Better Auth patch. Centralize API base URL construction and never log device/session tokens.

- [ ] **Step 3: Define native DTOs.**

Add `DesktopAuthUser`, `DesktopAuthSession`, `DeviceAuthorizationAttempt` in `api_contracts.rs` with existing `ts-rs` export target.

Attempt exposes only:

```text
userCode
verificationUri
verificationUriComplete
expiresAt
```

- [ ] **Step 4: Preserve `AuthState`/Drive epoch semantics.**

Keep authenticated user ID, generation counter, and `AuthSessionEpoch`. Replace Supabase JSON/refresh state with typed opaque session state and one pending native device code.

- [ ] **Step 5: Retarget `SessionData` and native E2E validation.**

Replace:

```text
access_token
refresh_token
user
```

with:

```text
sessionToken
user
```

Update `e2e_session_matches_user()` to require the expected user ID and a non-empty session token only.

Update `AuthState::for_e2e_user()` and `src/tests/e2e_tests.rs` so no fake Supabase refresh token remains.

Keep this path gated by `feature = "e2e"` + `debug_assertions`; it must remain impossible in release binaries.

- [ ] **Step 6: Add/retarget commands.**

Add:

```text
begin_device_authorization
poll_device_authorization
cancel_device_authorization
```

Retarget without renaming:

```text
validate_session
get_current_session
logout_session
open_external_url
```

`validate_session` retains `Valid | Invalid | NotConfigured`.

- [ ] **Step 7: Replace API token access.**

Rename `ensure_valid_access_token` to `current_session_token`. Remove JWT expiry parsing, refresh calls, refresh lock, and refresh events. Existing API calls continue `Authorization: Bearer <opaque-session-token>`.

- [ ] **Step 8: Remove production callback machinery.**

Delete auth deep-link handlers/queues, loopback server, magic-link parsing, callback validation, Supabase verify/refresh/logout code, JWT decoder, auth events. Keep single-instance behavior; remove deep-link plugin only if no non-auth use remains.

- [ ] **Step 9: Verify and commit.**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
bun run gen:native-types
```

Commit native/generated changes together.

---

