## Task 11: Rewire desktop renderer and every existing desktop E2E session seed

**Files:**

- Rewrite: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Rename/rewrite: `packages/dtx-desktop/src/renderer/src/services/supabaseService.ts` → `sessionStorage.ts`
- Rename/rewrite matching test
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/App.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/authService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/env.d.ts`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/dtx-desktop/src-tauri/tauri.conf.json`
- Modify: `packages/dtx-desktop/src-tauri/tauri.dev.conf.json`
- Modify: root `package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/support/standalone-session.ts`
- Modify: `packages/e2e-desktop/support/standalone-session.test.mjs`
- Modify: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs`

- [ ] **Step 1: Add renderer lifecycle tests.**

Cover start, displayed code, browser open, poll success, persistence, restore valid, restore invalid cleanup, restore not-configured preserving storage, logout cleanup, cancellation/retry, and browser-open fallback.

- [ ] **Step 2: Replace renderer persistence.**

Store one neutral object:

```ts
{
  sessionToken: string;
  user: DesktopAuthUser;
}
```

Delete old `auth_access_token`, `auth_refresh_token`, and `auth_user_data` values when encountered; do not migrate them.

- [ ] **Step 3: Rewrite renderer auth service.**

After `beginDeviceAuthorization`, call existing `openExternalUrl(verificationUriComplete)`, show manual URI/code fallback, and poll. Remove magic-link/session-refreshed listeners.

- [ ] **Step 4: Keep tri-state restore behavior.**

`not-configured` preserves stored Better Auth session and surfaces build/config error. `invalid` clears it.

- [ ] **Step 5: Retarget WDIO/standalone E2E injection.**

Keep `DTX_E2E_DRUMERY_USER_ID`; it still identifies the debug-only seeded user.

Update renderer/localStorage setup in `google-drive-upload.e2e.ts` and `google-drive-crash-recovery.ts` to write the new neutral session object instead of Supabase access/refresh keys.

Update `standalone-session.test.mjs` and `google-drive-crash-recovery.test.mjs` where they assert the old auth storage/env shape.

Do not add an API test-auth endpoint; reuse the native e2e/debug seed path from Task 10.

- [ ] **Step 6: Remove callback/deep-link configuration.**

Remove:

```text
DTX_DESKTOP_AUTH_CALLBACK_PORT
VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT
PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL
```

Simplify dev scripts/topology tests. Remove auth URI schemes only after no non-auth use remains.

- [ ] **Step 7: Verify and commit.**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop check
bun run --filter=dtx-e2e-desktop check
bun test packages/e2e-desktop/support/standalone-session.test.mjs \
  packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-features
bun run gen:native-types
```

---

