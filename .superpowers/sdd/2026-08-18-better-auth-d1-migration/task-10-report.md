# Task 10 report: replace native Supabase auth with Device Authorization

## Scope

Task 10 only: replace the native desktop Supabase callback/refresh/JWT
machinery with the pinned Better Auth Device Authorization protocol, preserve
the native session/Drive epoch seam, and retarget the debug e2e seed. Renderer
Task 11 and deployment work were not included.

## Source and API evidence

- Read the Task 10 brief, repository instructions, the Task 1 pinned Better
  Auth interfaces, the installed Better Auth 1.6.30 device route source, and
  the test-driven-development skill.
- CodeGraph was run once for the native auth, API bearer-token, e2e seed, and
  generated-contract call paths before edits. The resulting paths identified
  `AuthState`, native API token callers, the startup seed, and ts-rs contracts.
- The protocol module is Tauri-free and uses the pinned Better Auth routes:
  `POST /api/auth/device/code`, `POST /api/auth/device/token`, and
  `GET /api/auth/get-session`.

## RED

WireMock tests were added before the protocol implementation. The focused
command failed at the missing module boundary:

```text
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml device_auth_tests -- --nocapture
error[E0432]: unresolved imports `super::device_auth::DeviceAuthClient`,
`super::device_auth::DeviceAuthError`, `super::device_auth::DevicePollResult`
```

## Implementation

- Added protocol-only `device_auth.rs` with exact device-code and token wire
  fields, RFC3339 expiry, typed pending/slow-down/denial/expiry/grant errors,
  30-second request timeout, and sanitized network/timeout/server errors.
- Kept `device_code` private to the flow; the IPC attempt contains only
  `userCode`, `verificationUri`, `verificationUriComplete`, and `expiresAt`.
  Device-flow and typed-session `Debug` output redacts secrets, and wire error
  descriptions are never returned to the renderer.
- Added Better Auth-shaped `DesktopAuthUser`, `DesktopAuthSession`, and
  `DeviceAuthorizationAttempt` contracts and regenerated the native renderer
  contract.
- Rewrote `AuthState` around typed opaque `sessionToken` state while retaining
  session generation, `AuthSessionEpoch`, authenticated user ownership, and a
  single pending device flow. Added begin/poll/cancel commands and preserved
  validation, current-session, logout, and external-URL command names.
- Retargeted debug+e2e-only seeding and validation to require the configured
  user ID plus one non-empty opaque session token. Production refresh, JWT,
  Supabase callback, loopback, and auth-event paths were removed after their
  callers were migrated. The single-instance focus behavior remains; the
  unused deep-link plugin/config/capability was removed.
- Existing API callers now use `current_session_token()` and continue sending
  `Authorization: Bearer <opaque-session-token>`.

## GREEN and validation

- Focused protocol WireMock tests: 9 passed, including exact request bodies,
  display-safe responses, pending/slow-down/error mappings, null sessions,
  malformed bodies, redaction, and timeout/network handling.
- Focused auth tests: 77 passed; debug+e2e auth tests: 31 passed.
- Full default Rust suite: 920 passed, 2 ignored, 0 failed.
- `cargo fmt` and `cargo fmt --check`: passed.
- Default clippy (`--all-targets -D warnings`): passed.
- Supported e2e clippy (`--no-default-features --features e2e --all-targets
  -D warnings`): passed.
- `bun run gen:native-types`: passed; 42 native export tests passed. The
  generated renderer contract contains the three new auth DTOs, and the
  unrelated e2e generated type file was restored after ts-rs feature-mode
  output clobbered its existing Drive-only exports.
- `git diff --check` and auth machinery/search gates: passed. No production
  native auth callback, refresh, JWT, or deep-link path remains.

The exact requested `cargo clippy --all-targets --all-features -- -D
warnings` combination cannot run in this checkout: the existing
`src/google_drive/build_config.rs` guard rejects simultaneous `google_drive`
and `e2e` features before compilation with:

```text
Invalid Google Drive configuration: the e2e build must use --no-default-features --features e2e
```

This is a repository build-policy guard rather than a Task 10 lint failure;
both supported feature-mode clippy gates pass.

No renderer Task 11, development server, build, or deployment work was
performed.
