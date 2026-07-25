# DTX Desktop Google Drive Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement HPA-311 so DTX Desktop can create or replace a song ZIP in a user-selected public Google Drive folder and atomically publish the stable Drive file identity and browser download link to Drumery.

**Architecture:** Tauri/Rust owns OAuth, secure credentials, Drive folder settings, fresh cloud metadata, ZIP/upload state, crash recovery, progress, and the dedicated metadata mutation. The Svelte renderer performs the primary Drumery save first and then invokes one narrow native Drive transaction. `dtx-api` stores an owner-only Drive file ID and a public download URL. Deterministic fake native providers and the prerequisite relaunch harness provide full desktop E2E coverage without Google credentials.

**Tech Stack:** Tauri 2, Rust 1.77, Tokio, Reqwest, Keyring 3.6.3, Svelte 5, TypeScript, Vitest, Cloudflare D1, Drizzle ORM, Pothos GraphQL, WebdriverIO 9.

## Global Constraints

- This plan starts only after `docs/superpowers/plans/2026-07-25-dtx-desktop-trusted-workspace-prerequisite.md` is implemented and green. Rebase onto that result rather than reintroducing a renderer root.
- Treat current source and `docs/superpowers/specs/2026-07-22-dtx-desktop-google-drive-upload-design.md` as authoritative. HPA-311's older Electron-era paths and renderer-supplied `drumeryUserId`, `workspaceRoot`, `folderId`, `songTitle`, and `existingFileId` examples are explicitly superseded.
- Use only the `drive.file` scope. Do not add profile, full-Drive, permission-write, or server-side token storage.
- Store refresh tokens only in the OS credential store under service `com.hapadona.drumery` and account `google-drive:<drumery-user-id>`.
- Derive the Drumery user from `AuthState`, workspace from `WorkspaceRootState`, destination folder from native settings, existing file ID/title from a fresh owner-authorized API query, and final URL from Drive response metadata.
- Never expose or log refresh/access tokens, authorization codes, PKCE verifier, OAuth state, resumable-session URIs, raw Google bodies, raw credential errors, local paths, folder IDs, Drive IDs, or Google request IDs in renderer progress events.
- `downloadUrl` is a browser-facing `webContentLink`, not a guaranteed direct byte stream.
- Never automatically replace a missing or inaccessible existing Drive file. Preserve its old ID/URL and require the explicit replacement action.
- A Drumery save/publish succeeds independently of Drive. No failed Drive step may roll back the primary save or clear old cloud fields.
- Keep Drive code out of the web application UI. Web changes are limited to shared GraphQL schema/operations/generated types.
- Follow test-driven development task by task and commit each independently reviewable layer.
- Do not run development servers, web Playwright E2E, broad monorepo builds, or unrelated deploys.

## Source Map

### Build and native dependencies

- Modify: `packages/dtx-desktop/src-tauri/Cargo.toml`
- Modify: `packages/dtx-desktop/src-tauri/Cargo.lock`
- Modify: `packages/dtx-desktop/src-tauri/build.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/build_config.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/e2e-desktop/package.json`
- Modify: `.github/workflows/desktop-build-deploy.yml`
- Modify: `.github/workflows/desktop-e2e-test.yml`

### D1, shared data access, and GraphQL

- Create: `packages/dtx-api/d1-migrations/0006_google_drive_file_id.sql`
- Modify: `packages/common/src/lib/server/db/schema.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/server/db.ts`
- Modify: `packages/common/src/lib/server.ts`
- Modify: `packages/common/src/lib/server/db.test.ts`
- Modify: `packages/common/src/lib/server/db.integration.test.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`
- Modify: `packages/dtx-api/dist/schema.graphql`
- Modify: `packages/dtx-web/src/lib/api/operations/chart.graphql`
- Modify: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Modify: `packages/dtx-web/src/lib/api/chart.ts`
- Modify: `packages/dtx-web/src/lib/api/chart.test.ts`

### Native Drive implementation

- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/songs.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/mod.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/commands.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/oauth.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/credential_store.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/settings.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/pending_bindings.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/drive_client.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/upload.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/fake.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_build_config_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_credential_store_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_settings_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_pending_bindings_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_oauth_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_client_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_upload_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/songs_tests.rs`

### Renderer

- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Create: `packages/dtx-desktop/src/renderer/src/services/googleDriveService.ts`
- Create: `packages/dtx-desktop/src/renderer/src/services/googleDriveService.test.ts`
- Create: `packages/dtx-desktop/src/renderer/src/stores/googleDriveStore.ts`
- Create: `packages/dtx-desktop/src/renderer/src/stores/googleDriveStore.test.ts`
- Create: `packages/dtx-desktop/src/renderer/src/components/GoogleDriveSettings.svelte`
- Create: `packages/dtx-desktop/src/renderer/src/components/GoogleDriveSettings.test.ts`
- Create: `packages/dtx-desktop/src/renderer/src/components/GoogleDriveUploadStatus.svelte`
- Create: `packages/dtx-desktop/src/renderer/src/components/GoogleDriveUploadStatus.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Settings.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Settings.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/authService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/App.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/i18n/locales/en.json`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/i18n/locales/jp.json`

### Native E2E

- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/support/native.ts`
- Modify: `packages/e2e-desktop/support/generated/native-types.ts`
- Create: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Create: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`

Each new Rust module owns its listed test file through a
`#[cfg(test)] #[path = "../tests/<file>.rs"] mod tests;` declaration, so the exact module-qualified
test filters below run the intended file rather than accidentally matching zero tests.

---

### Task 1: Add guarded Drive build configuration

**Files:**

- Modify the Build and native dependencies files listed above.
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/build_config.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_build_config_tests.rs`

- [ ] **Step 1: Write failing build-config parser tests**

Define:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopBuildEnvironment {
    Production,
    Preproduction,
    Local,
    E2e,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveBuildMode {
    Disabled,
    Real {
        environment: DesktopBuildEnvironment,
        oauth_client_id: String,
    },
    FakeE2e,
}
```

Test enabled/disabled combinations, all four enum spellings, blank IDs, missing IDs, a client-environment marker that does not equal `DTX_DESKTOP_BUILD_ENV`, `e2e` without the E2E feature, `e2e` without debug assertions, a production client in a non-production declaration, and a real client in `e2e`.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::build_config::tests::
```

- [ ] **Step 3: Implement one parser shared by `build.rs` and the library**

Keep `build_config.rs` pure-`std` so `build.rs` can include it with:

```rust
#[path = "src/google_drive/build_config.rs"]
mod google_drive_build_config;
```

`build.rs` reads:

- `CARGO_FEATURE_GOOGLE_DRIVE`;
- `CARGO_FEATURE_E2E`;
- `PROFILE`;
- `DTX_DESKTOP_BUILD_ENV`;
- `GOOGLE_DRIVE_OAUTH_CLIENT_ID`;
- `GOOGLE_DRIVE_OAUTH_CLIENT_ENV`.

It emits `cargo:rerun-if-env-changed` for each and fails with a diagnostic naming
`GOOGLE_DRIVE_OAUTH_CLIENT_ID` when a real Drive build lacks a valid mapping. It accepts `FakeE2e`
only when the E2E feature is enabled, the declared environment is `e2e`, no OAuth client is
present, and the profile has debug assertions.

- [ ] **Step 4: Add feature/dependency gates**

In `Cargo.toml`:

```toml
[features]
default = ["google-drive"]
google-drive = ["dep:keyring"]
e2e = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]
```

Add Rust-1.77-compatible direct dependencies used by the later tasks:

```toml
async-trait = "0.1"
futures-util = "0.3"
httpdate = "1"
rand = "0.8"
sha2 = "0.10"
subtle = "2"
tokio-util = { version = "0.7", features = ["rt"] }
uuid = { version = "1", features = ["serde", "v4"] }
zeroize = "1"
```

Pin target-specific optional keyring backends:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["apple-native"], optional = true }

[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["windows-native"], optional = true }

[target.'cfg(target_os = "linux")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["sync-secret-service", "crypto-rust"], optional = true }
```

- [ ] **Step 5: Wire local, E2E, and CI environment declarations**

- local desktop scripts set `DTX_DESKTOP_BUILD_ENV=local` and
  `GOOGLE_DRIVE_OAUTH_CLIENT_ENV=local`; the ID still comes from the developer `.env`;
- E2E build sets `DTX_DESKTOP_BUILD_ENV=e2e`, uses `--no-default-features --features e2e`, and
  supplies no client ID;
- production workflow jobs map repository variable
  `GOOGLE_DRIVE_OAUTH_CLIENT_ID_PRODUCTION` into `GOOGLE_DRIVE_OAUTH_CLIENT_ID` and set both
  environment markers to `production`;
- preview/PR jobs map the distinct
  `GOOGLE_DRIVE_OAUTH_CLIENT_ID_PREPRODUCTION` variable and set both markers to
  `preproduction`.

Never add either OAuth client ID to source, Tauri JSON, artifacts, secrets, or test fixtures.

- [ ] **Step 6: Run parser tests and lockfile check**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::build_config::tests::
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --no-default-features
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop packages/e2e-desktop .github/workflows/desktop-build-deploy.yml .github/workflows/desktop-e2e-test.yml
git commit -m "build(desktop): guard Google Drive client configuration"
```

---

### Task 2: Add the D1 column and atomic common data helper

**Files:**

- Create: `packages/dtx-api/d1-migrations/0006_google_drive_file_id.sql`
- Modify all Common files in the D1 source map.

- [ ] **Step 1: Write failing common DB tests**

Add tests for:

- `getSimfile` maps nullable `google_drive_file_id`;
- owner list shapes carry it, while published-only shapes do not select it;
- `updateSimfileDriveFile` changes the ID and URL in one statement;
- the helper constrains by both simfile ID and owner ID;
- wrong owner and missing row return a not-found/forbidden-neutral failure without partial update;
- general `updateSimfile` still cannot update the Drive ID.

Define:

```ts
export const updateSimfileDriveFile = async (
    db: D1Database,
    id: number,
    ownerUserId: string,
    data: { googleDriveFileId: string; downloadUrl: string }
): Promise<SimfileRow>;
```

- [ ] **Step 2: Run focused tests and observe failure**

```bash
bun run --filter=@dtx/common test -- src/lib/server/db.test.ts src/lib/server/db.integration.test.ts
```

- [ ] **Step 3: Add migration `0006`**

The entire migration is:

```sql
ALTER TABLE simfiles ADD COLUMN google_drive_file_id TEXT;
```

Do not edit `0001`, add `IF NOT EXISTS`, or replay the statement outside Wrangler's migration ledger.

- [ ] **Step 4: Update shared schema and types**

Add `googleDriveFileId: text('google_drive_file_id')` to the test/type Drizzle schema and
`google_drive_file_id: string | null` to `SimfileRow` plus read mappings. Make the API-facing joined type
permit omission for published-only list rows:

```ts
google_drive_file_id?: string | null;
```

Do not add this property to general `SimfileInsert` or `SimfileUpdate`.

- [ ] **Step 5: Implement the owner-constrained atomic update**

Use one statement:

```sql
UPDATE simfiles
SET google_drive_file_id = ?, download_url = ?, updated_at = ?
WHERE id = ? AND user_id = ?
RETURNING *
```

Export the helper through `packages/common/src/lib/server.ts`.

- [ ] **Step 6: Make the real-D1 test apply every numbered migration in order**

Replace its hard-coded `0001`–`0003` list with sorted `*.sql` discovery. Add an assertion that:

- a fresh database applies `0001` through `0006` once;
- the new column starts `NULL`;
- the dedicated helper persists both fields;
- a second attempted application of `0006` fails, documenting why the Wrangler ledger is required.

- [ ] **Step 7: Run common tests and required shared build**

```bash
bun run --filter=@dtx/common test -- src/lib/server/db.test.ts src/lib/server/db.integration.test.ts
bun run --filter=@dtx/common check
bun run --filter=@dtx/common build
```

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-api/d1-migrations packages/common
git commit -m "feat(api): store Google Drive file metadata"
```

---

### Task 3: Add the owner-only field and dedicated GraphQL mutation

**Files:**

- Modify all DTX API and web GraphQL files in the source map.

- [ ] **Step 1: Write failing schema tests**

Cover:

- owner receives `googleDriveFileId`;
- anonymous, cross-user, and staff-as-non-owner receive `null`;
- published users still receive `downloadUrl`;
- unauthenticated and cross-user mutation attempts fail;
- the resolver immediately re-reads ownership after the auth scope;
- Drive ID trims, rejects blank, and has a maximum of 256 characters;
- URL trims, rejects blank/non-HTTPS/over-2048/R2-bucket values, and preserves the original
  trimmed query, resource key, and fragment;
- validation or update failure leaves both old fields unchanged;
- the general create/update inputs contain no Drive ID.

- [ ] **Step 2: Run schema tests and observe failure**

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
```

- [ ] **Step 3: Add the owner-only field resolver**

On the shared `Simfile` object:

```ts
googleDriveFileId: t.string({
	nullable: true,
	resolve: (simfile, _args, ctx) =>
		ctx.user?.id === simfile.user_id ? (simfile.google_drive_file_id ?? null) : null
});
```

Do not authorize by selection-set discipline or staff role.

- [ ] **Step 4: Add the dedicated mutation**

Implement exactly:

```graphql
updateSimfileDriveFile(
    id: ID!
    googleDriveFileId: String!
    downloadUrl: String!
): Simfile!
```

Use the existing owner auth scope, parse a safe integer ID, fetch the row immediately, require
`existing.user_id === ctx.user.id`, validate both values, call `updateSimfileDriveFile`, and
re-read the joined result. Map validation to `BAD_USER_INPUT`, missing to `NOT_FOUND`, and
ownership mismatch to `FORBIDDEN`.

- [ ] **Step 5: Add operations and regenerate tracked outputs**

Add `googleDriveFileId` to `SimfileFull` and add:

```graphql
mutation UpdateSimfileDriveFile($id: ID!, $googleDriveFileId: String!, $downloadUrl: String!) {
	updateSimfileDriveFile(
		id: $id
		googleDriveFileId: $googleDriveFileId
		downloadUrl: $downloadUrl
	) {
		id
		googleDriveFileId
		downloadUrl
	}
}
```

Run:

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
```

Update `chart.ts`/tests so existing adapters preserve the new nullable field and the generated
operation preserves Drive URL query parameters exactly.

- [ ] **Step 6: Run API/web verification**

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
bun run --filter=dtx-api check
bun run --filter=dtx-web test -- src/lib/api/chart.test.ts
bun run --filter=dtx-web check
bun run --filter=dtx-web lint:codegen
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-api packages/dtx-web
git commit -m "feat(api): expose owner-only Drive binding mutation"
```

---

### Task 4: Add native owner-metadata query and patch client

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/mod.rs`

- [ ] **Step 1: Write failing wiremock tests**

Cover an authenticated fresh query returning:

```rust
pub(crate) struct OwnerDriveSimfile {
    pub id: String,
    pub title: String,
    pub google_drive_file_id: Option<String>,
    pub download_url: Option<String>,
}
```

Also cover:

- missing/unowned/null response maps to `SIMFILE_UNAVAILABLE`;
- GraphQL auth error is sanitized;
- the patch operation sends only ID, Drive ID, and URL;
- the response requires exact ID/Drive ID/URL consistency;
- no title, BPM, publication, or renderer form values enter the patch.

- [ ] **Step 2: Run focused native API tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib api::tests::google_drive_
```

- [ ] **Step 3: Implement a mockable metadata client**

In `google_drive/mod.rs`:

```rust
#[async_trait]
pub(crate) trait DriveMetadataClient: Send + Sync {
    async fn fetch_owner_simfile(
        &self,
        auth: &AuthState,
        simfile_id: &str,
    ) -> Result<OwnerDriveSimfile>;

    async fn update_drive_file(
        &self,
        auth: &AuthState,
        simfile_id: &str,
        drive_file_id: &str,
        download_url: &str,
    ) -> Result<OwnerDriveSimfile>;
}
```

Production implementation delegates to narrow functions in `api.rs` using a dedicated owner query
and the dedicated mutation. Add `googleDriveFileId` to the existing desktop mapping without making
it writable through `update_simfile_record`.

- [ ] **Step 4: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib api::tests::google_drive_
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib api::tests::
```

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs packages/dtx-desktop/src-tauri/src/google_drive packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "feat(desktop): add Drive metadata API client"
```

---

### Task 5: Extract reusable ZIP helpers and Drive name sanitization

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/songs.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/songs_tests.rs`
- Create: `packages/dtx-desktop/src-tauri/src/google_drive/upload.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_upload_tests.rs`

- [ ] **Step 1: Add failing ZIP parity and sanitizer tests**

Cover:

- manual export and Drive collection return the same top-level supported files in deterministic
  order;
- directories, nested files, unsupported extensions, and escaping symlinks are excluded/rejected
  exactly as today;
- empty input maps to `NO_VALID_SONG_FILES`;
- a partial archive is removed on an injected out-of-space write;
- `AC/DC` becomes `AC-DC.zip`;
- `Song: Reprise` remains `Song: Reprise.zip`;
- control/separator runs collapse to `-`;
- all-whitespace/control titles fall back to `simfile-<id>.zip`;
- the cloud filename is never used as a local path component.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib songs::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::upload::tests::drive_name_
```

- [ ] **Step 3: Extract internal helpers**

Use:

```rust
pub(crate) async fn collect_valid_song_files(
    song_path: &Path,
    workspace_root: &Path,
) -> Result<Vec<PathBuf>>;

pub(crate) fn write_song_zip(
    output_path: &Path,
    files: &[PathBuf],
) -> Result<usize>;

pub(crate) fn sanitize_drive_zip_name(title: &str, simfile_id: &str) -> String;
```

Manual export retains its rejecting local filename validator. Drive sanitization is a separate
metadata-only helper and may preserve printable characters such as `:`.

- [ ] **Step 4: Add cache-namespace lifecycle helpers**

Create random temp directories only below:

```text
<app-cache>/google-drive-uploads/<native-random-id>/upload.zip
```

The renderer operation ID and cloud title never enter local paths. Add best-effort startup cleanup
that validates descendants of only this namespace and cleanup guards for success, failure, and
cancellation.

- [ ] **Step 5: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib songs::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::upload::tests::
```

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/songs.rs packages/dtx-desktop/src-tauri/src/google_drive/upload.rs packages/dtx-desktop/src-tauri/src/tests
git commit -m "refactor(desktop): share ZIP creation with Drive uploads"
```

---

### Task 6: Add authenticated user lookup, credential storage, and native settings

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`
- Create credential/settings modules and tests from the native source map.

- [ ] **Step 1: Write failing auth, credential, and settings tests**

Cover:

- `AuthState::current_user_id()` extracts only a non-blank `session.user.id`;
- absent/malformed user is unauthenticated;
- in-memory credential fake is isolated by Drumery user;
- platform adapter uses the exact service/account names;
- missing credential is disconnected;
- locked keychain, Linux Secret Service/D-Bus failure, and other backend errors sanitize to
  `CREDENTIAL_STORE`;
- blocking keyring calls execute via `spawn_blocking` and serialize per credential;
- folder settings are isolated by user, malformed JSON becomes an empty map, and full
  read-modify-write is locked;
- no token appears in settings serialization or command results.

- [ ] **Step 2: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib auth::tests::current_user_id_
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::credential_store::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::settings::tests::
```

- [ ] **Step 3: Implement the credential abstraction**

Use the approved synchronous boundary:

```rust
pub(crate) trait GoogleDriveCredentialStore: Send + Sync {
    fn get_refresh_token(&self, user_id: &str)
        -> Result<Option<String>, CredentialStoreError>;
    fn set_refresh_token(&self, user_id: &str, token: &str)
        -> Result<(), CredentialStoreError>;
    fn delete_refresh_token(&self, user_id: &str)
        -> Result<(), CredentialStoreError>;
}
```

The production adapter constructs:

```rust
keyring::Entry::new(
    "com.hapadona.drumery",
    &format!("google-drive:{user_id}"),
)
```

Wrap working token copies in `Zeroizing<String>`.

- [ ] **Step 4: Implement native folder settings**

Persist:

```rust
#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct GoogleDriveSettings {
    google_drive_folders_by_user: HashMap<String, GoogleDriveFolderSetting>,
}
```

at `<data_dir>/dtxweb/google-drive-settings.json` through `native_persistence`.

- [ ] **Step 5: Add the shared native Drive state container**

`GoogleDriveState` owns injected `Arc` trait implementations, per-user access-token cache, folder
validation cache, active Picker attempt, settings/pending stores, and the operation manager added
later. Production constructs keyring/HTTP/API adapters. E2E constructs in-memory/fake adapters.

- [ ] **Step 6: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib auth::tests::current_user_id_
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::credential_store::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::settings::tests::
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri
git commit -m "feat(desktop): persist secure per-user Drive connection"
```

---

### Task 7: Implement the exact OAuth and Picker attempt protocol

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/google_drive/oauth.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_oauth_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/commands.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/mod.rs`

- [ ] **Step 1: Write protocol tests before networking**

Cover:

- random verifier/state/attempt ID and S256 challenge;
- loopback binds only `127.0.0.1` on a random port and listener starts before browser open;
- authorization query always contains:
  `trigger_onepick=true`, `allow_folder_selection=true`, `prompt=consent`,
  `access_type=offline`, `response_type=code`, and scope exactly `drive.file`;
- exact callback path, constant-time state match, one `picked_file_ids`, and exactly one of
  `code`/`error`;
- duplicate/missing params, wrong path, replay, timeout, and user switch reject;
- cancel/access-denied maps to sanitized `CANCELED`;
- token response requires a non-blank refresh token and returned scope containing `drive.file`;
- minimal callback HTML contains no code/state/folder/error;
- first-connect persistence rollback and change-folder two-resource rollback preserve prior state;
- every successful Picker launch replaces the refresh token.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::oauth::tests::
```

- [ ] **Step 3: Implement `PickerAttempt`**

Use one Rust-owned in-memory attempt:

```rust
struct PickerAttempt {
    attempt_id: Uuid,
    user_id: String,
    pkce_verifier: Zeroizing<String>,
    oauth_state: Zeroizing<String>,
    callback_addr: SocketAddrV4,
    callback_path: String,
    deadline: Instant,
}
```

Allow only one active attempt. Bound reads/headers, consume the attempt once, and zeroize/discard
all sensitive working values on every exit path.

- [ ] **Step 4: Implement token exchange, refresh, and revoke**

- exchange only after callback validation;
- cache access token and expiry in Rust memory;
- refresh shortly before expiry and retry one request after token-expiry auth failure;
- set reconnect only for revoked/invalid refresh tokens;
- map credential backend failure separately;
- disconnect attempts revoke, deletes local credential regardless of revoke outcome, clears folder
  and caches, and retains pending bindings.

- [ ] **Step 5: Add narrow commands**

```rust
get_google_drive_connection_state();
connect_google_drive_and_choose_folder();
change_google_drive_folder();
disconnect_google_drive();
```

They accept no user ID and return no auth artifact.

- [ ] **Step 6: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::oauth::tests::
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/google_drive packages/dtx-desktop/src-tauri/src/tests/google_drive_oauth_tests.rs
git commit -m "feat(desktop): add secure Google Drive Picker flow"
```

---

### Task 8: Implement Drive item and public-sharing validation

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/google_drive/drive_client.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_client_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/oauth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/commands.rs`

- [ ] **Step 1: Write wiremock validation/error tests**

Cover:

- folder `files.get` requests
  `id,name,mimeType,trashed,capabilities(canAddChildren)` with `supportsAllDrives=true`;
- reject non-folder, trashed, inaccessible, or `canAddChildren=false`;
- paginate `permissions.list` with
  `permissions(id,type,role,view,allowFileDiscovery),nextPageToken`;
- accept effective `type=anyone`, unrestricted view, and reader/commenter/writer roles;
- reject domain/group/named-user/target-audience/private ACL as `DOWNLOAD_NOT_PUBLIC`;
- map permission-list `403` to `SHARING_CHECK_UNAVAILABLE`, never “private”;
- map folder `404` to `FOLDER_UNAVAILABLE`;
- distinguish existing-file `FILE_NOT_FOUND` and `FILE_PERMISSION_DENIED`;
- re-check selected folder before create and existing file before update;
- `recheck_google_drive_sharing` updates sanitized connection state only.

- [ ] **Step 2: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::drive_client::tests::
```

- [ ] **Step 3: Implement typed validation results**

Use:

```rust
enum PublicPermissionStatus {
    Public,
    NotPublic,
    CheckUnavailable,
}

struct ValidatedFolder {
    id: String,
    name: String,
}
```

Never call permission create/update/delete endpoints.

- [ ] **Step 4: Validate before persistence**

The Picker success path stores the replacement refresh token/folder only after the chosen folder
passes all item/capability/public-ACL checks. Apply the rollback rules from Task 7.

- [ ] **Step 5: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::drive_client::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::oauth::tests::
```

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/google_drive packages/dtx-desktop/src-tauri/src/tests
git commit -m "feat(desktop): validate public Drive destinations"
```

---

### Task 9: Implement generated IDs and resumable uploads

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/drive_client.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/upload.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/google_drive_client_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/google_drive_upload_tests.rs`

- [ ] **Step 1: Write upload-engine tests**

Cover:

- `files.generateIds` returns exactly one usable ID;
- create metadata uses that ID, selected parent, sanitized name, and `application/zip`;
- update uses the existing ID, requires update access, renames from fresh cloud title, and never
  changes parents;
- production chunk constant is `8 * 1024 * 1024` and is divisible by 256 KiB;
- progress emits only after accepted chunks;
- uncertain failure probes session status and resumes from confirmed byte;
- valid `Retry-After` seconds/date and bounded exponential backoff;
- transient `rateLimitExceeded`/`userRateLimitExceeded` versus permanent quota;
- one retry after access-token expiry;
- final `files.get` requests
  `id,name,mimeType,webContentLink,capabilities(canDownload)`, then requires matching ID, ZIP MIME,
  `canDownload=true`, public ACL, and bounded HTTPS non-blank `webContentLink`;
- temporarily missing link receives bounded retries;
- no synthesized fallback URL;
- new-file post-upload validation failure compensates with delete;
- existing-file failure never deletes or clears prior metadata;
- session URI lives only in the operation and is discarded on every outcome.

- [ ] **Step 2: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::drive_client::tests::resumable_
```

- [ ] **Step 3: Implement the async Drive API trait**

Expose mockable operations for:

```rust
generate_id
get_file
validate_folder
validate_public_permission
start_resumable_create
start_resumable_update
upload_chunk
query_session_status
delete_file
```

Production uses Reqwest with sanitized errors. Tests inject a deterministic endpoint/clock/sleeper
and a small test-only chunk size.

- [ ] **Step 4: Implement final metadata validation and compensation**

Return Drive's original trimmed `webContentLink`. For a new unbound object, retain pending state
until deletion or not-found is confirmed. For replacement of an existing object, preserve the old
cloud fields on all failures.

- [ ] **Step 5: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::drive_client::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::upload::tests::
```

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/google_drive packages/dtx-desktop/src-tauri/src/tests
git commit -m "feat(desktop): add resumable Drive upload engine"
```

---

### Task 10: Add keyed pending bindings and crash reconciliation

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/google_drive/pending_bindings.rs`
- Create: `packages/dtx-desktop/src-tauri/src/tests/google_drive_pending_bindings_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/upload.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/google_drive_upload_tests.rs`

- [ ] **Step 1: Write pending-store tests**

Persist exactly at
`<data_dir>/dtxweb/google-drive-pending-bindings.json`:

```rust
struct PendingGoogleDriveBinding {
    user_id: String,
    simfile_id: String,
    drive_file_id: String,
    kind: PendingBindingKind,
    created_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum PendingBindingKind {
    FirstUpload,
    ExplicitReplacement,
}

struct GoogleDrivePendingBindings {
    schema_version: u8,
    bindings_by_user:
        HashMap<String, HashMap<String, PendingGoogleDriveBinding>>,
}
```

Cover redundant-key validation, malformed IDs, schema version, atomic keyed replacement, at most
one binding per user/simfile, concurrent read-modify-write, and absence of tokens/session
URIs/paths/folder names/URLs.

- [ ] **Step 2: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::pending_bindings::tests::
```

- [ ] **Step 3: Implement create/replacement binding order**

For first upload or explicit replacement:

1. generate ID;
2. atomically persist the keyed binding;
3. only then contact `files.create`;
4. patch metadata after final validation;
5. remove the binding only after the patch commits.

Map local persistence failure to `LOCAL_STATE`, or `INSUFFICIENT_DISK_SPACE` for disk-full.

- [ ] **Step 4: Implement reconciliation**

Before another create for the same simfile and best-effort after auth restoration:

- fresh-fetch ownership;
- `files.get` the stored ID;
- bind an existing valid public ZIP;
- reuse an ID confirmed never created;
- retain while compensation is unconfirmed;
- if create reports definitive invalid generated ID, call `files.get`;
- replace with one fresh ID only after definitive `404`, atomically rewriting the same keyed entry;
- never rotate on `403`, network, ambiguous, or indeterminate create;
- if simfile no longer exists/is owned, compensate but never bind;
- never expire by age alone.

- [ ] **Step 5: Test every crash boundary**

Inject failures:

- after binding persist, before create;
- after create request/ambiguous response;
- after create completion, before metadata patch;
- during patch retry;
- during compensation delete;
- after patch success, before binding removal.

Assert no duplicate identity and no lost recoverable binding.

- [ ] **Step 6: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::pending_bindings::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::upload::tests::reconciliation_
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/google_drive packages/dtx-desktop/src-tauri/src/tests
git commit -m "feat(desktop): reconcile crash-safe Drive bindings"
```

---

### Task 11: Add the native operation manager, IPC commands, progress, and cancellation

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/commands.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/upload.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/mod.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/auth.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/google_drive_upload_tests.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/auth_tests.rs`

- [ ] **Step 1: Write state-machine and sanitized-event tests**

Cover:

- UUIDv4 operation ID validation;
- normalized workspace-relative path only: reject absolute, empty, `.`, `..`, Windows prefixes,
  and alternate separators before join;
- canonical managed-root/symlink containment;
- user/folder/file ID/title all derived natively;
- same-song duplicate returns `UPLOAD_IN_PROGRESS`;
- FIFO global semaphore admits at most two ZIP/upload resource users;
- queued work allocates no temp directory/session/chunk buffer;
- queued/preparing/transferring cancellation releases locks and cleans up;
- cancellation after Drive finalization is refused while patch/compensation completes;
- progress contains only operation ID, simfile ID, stage, counts/percentage, sanitized code;
- patch retries once transiently;
- automatic existing-file failure preserves fields;
- explicit replacement is the only create-after-existing-ID path;
- logout clears access tokens/visible renderer state but retains credential/folder/pending binding.

- [ ] **Step 2: Run focused tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::commands::tests::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::upload::tests::
```

- [ ] **Step 3: Define the narrow wire contract**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSongZipToGoogleDriveInput {
    operation_id: Uuid,
    simfile_id: String,
    song_relative_path: String,
    force_create_replacement: Option<bool>,
}
```

Return:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveUploadResult {
    pub success: bool,
    pub file_id: Option<String>,
    pub download_url: Option<String>,
    pub file_name: Option<String>,
    pub replaced_existing_file: Option<bool>,
    pub error_code: Option<GoogleDriveErrorCode>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GoogleDriveErrorCode {
    WorkspaceRequired,
    NotConnected,
    ReconnectRequired,
    FolderRequired,
    FolderUnavailable,
    SharingCheckUnavailable,
    DownloadNotPublic,
    SimfileUnavailable,
    FileNotFound,
    FilePermissionDenied,
    UploadInProgress,
    Canceled,
    NoValidSongFiles,
    InsufficientDiskSpace,
    LocalState,
    MetadataSyncFailed,
    RateLimited,
    QuotaExceeded,
    Network,
    CredentialStore,
    InvalidResponse,
    Unknown,
}
```

Emit
`google-drive-upload-progress` with a serialized `GoogleDriveUploadProgress`. Do not accept user,
root, absolute path, folder ID, title, Drive ID, or URL.

The stage enum maps only to:

```text
waiting-for-upload-slot
preparing-zip
connecting-to-google-drive
uploading
finalizing
synchronizing-download-metadata
upload-complete
upload-failed-save-succeeded
```

The progress payload has only:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveUploadProgress {
    pub operation_id: Uuid,
    pub simfile_id: String,
    pub stage: GoogleDriveUploadStage,
    pub bytes_uploaded: Option<u64>,
    pub total_bytes: Option<u64>,
    pub percentage: Option<u8>,
    pub error_code: Option<GoogleDriveErrorCode>,
}
```

- [ ] **Step 4: Register commands and initialize state**

Register:

```text
get_google_drive_connection_state
connect_google_drive_and_choose_folder
change_google_drive_folder
recheck_google_drive_sharing
disconnect_google_drive
upload_song_zip_to_google_drive
cancel_google_drive_upload
```

Initialize `GoogleDriveState` once and run namespace-limited temp cleanup at startup. Trigger
best-effort current-user reconciliation after session restoration; do not block app startup.

- [ ] **Step 5: Integrate native logout**

`logout_session` clears Drive access-token and folder-validation memory before/while clearing
Supabase session, but does not revoke/delete the refresh token, folder setting, Drive file, cloud
metadata, or pending binding.

- [ ] **Step 6: Run focused and full Rust tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib google_drive::
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --lib auth::tests::
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri
git commit -m "feat(desktop): expose Drive upload transaction"
```

---

### Task 12: Add localized renderer connection and progress components

**Files:**

- Modify/create all Renderer files except `SongDetails.svelte` and its test, which are Task 13.

- [ ] **Step 1: Write failing host/service/store tests**

Add typed wrappers:

```ts
getGoogleDriveConnectionState();
connectGoogleDriveAndChooseFolder();
changeGoogleDriveFolder();
recheckGoogleDriveSharing();
disconnectGoogleDrive();
uploadSongZipToGoogleDrive(input);
cancelGoogleDriveUpload(operationId);
```

Test that no wrapper accepts/serializes user ID, workspace root, absolute path, folder ID, title,
existing Drive ID, URL, or credential.

Test the store ignores stale/unrelated progress and contains only sanitized connection,
folder-display, progress, and error state.

Use the exact renderer-visible connection shape:

```ts
type GoogleDriveConnectionState = {
	connected: boolean;
	folder?: { id: string; name: string };
	requiresReconnect?: boolean;
	requiresPublicSharing?: boolean;
	sharingCheckUnavailable?: boolean;
	credentialStoreUnavailable?: boolean;
};
```

- [ ] **Step 2: Run focused tests**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts src/renderer/src/services/googleDriveService.test.ts src/renderer/src/stores/googleDriveStore.test.ts
```

- [ ] **Step 3: Implement the service boundary**

`googleDriveService.ts`:

- creates `crypto.randomUUID()` before subscribing/invoking;
- converts the native-hydrated absolute workspace/song display paths into a normalized `/`-joined
  relative song path;
- invokes one native upload transaction;
- subscribes/unsubscribes to operation-scoped progress;
- never calls GraphQL metadata mutation or Drive HTTP directly.

Define:

```ts
type SongSaveOutcome = {
	simfileSave: { success: boolean; error?: string };
	driveUpload: {
		status: 'success' | 'failed' | 'skipped';
		fileId?: string;
		downloadUrl?: string;
		errorCode?: string;
		error?: string;
	};
};
```

- [ ] **Step 4: Implement Settings UI**

Add `GoogleDriveSettings.svelte` beneath Export Settings. Cover disconnected, connected, verified
public folder, reconnect, credential-store unavailable, private sharing, sharing-check unavailable,
re-check, change folder, cancel, and disconnect-revoke-warning states. Do not claim a Google email
identity. State that an existing linked file can be replaced only when the connected Google
account and OAuth app are authorized for it; another installation may need reconnect or explicit
replacement. Changing the default folder must not imply that existing files move.

- [ ] **Step 5: Implement upload status UI**

Add queued/progress/cancel/success/retry/permanent-file-access/explicit-replacement states.
Describe `downloadUrl` as a Google Drive browser link that may redirect or show an interstitial.
Provide no unlink/delete action.

- [ ] **Step 6: Add and verify both locales**

Put every new label, stage, action, warning, and sanitized error under one `googleDrive` namespace
in both `en.json` and `jp.json`. Tests render each component with each locale and fail on raw
translation keys or hard-coded English.

- [ ] **Step 7: Restore/reset renderer state at auth boundaries**

After successful session restoration, refresh connection state and request best-effort
reconciliation. On Drumery logout, immediately hide/reset renderer Drive state; native logout
retains the installation-local connection for that user.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts src/renderer/src/services/googleDriveService.test.ts src/renderer/src/stores/googleDriveStore.test.ts src/renderer/src/components/GoogleDriveSettings.test.ts src/renderer/src/components/GoogleDriveUploadStatus.test.ts src/renderer/src/components/Settings.test.ts src/renderer/src/services/authService.test.ts src/renderer/src/App.test.ts
bun run --filter=dtx-desktop typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/dtx-desktop/src/renderer
git commit -m "feat(desktop): add localized Drive connection UI"
```

---

### Task 13: Integrate save/publish, manual re-upload, and explicit replacement

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/googleDriveService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/googleDriveService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts`

- [ ] **Step 1: Write orchestration tests first**

Cover:

- create/update failure stops before Drive;
- successful draft or publish then attempts Drive only when connected;
- Drive failure preserves successful primary result and old ID/URL;
- Drive success merges only returned Drive fields into local linked state;
- new song uses the ID returned by successful create;
- existing song upload happens after successful metadata update;
- fresh cloud title, not unsaved renderer title, determines native Drive rename;
- duplicate save/publish stays disabled until upload/cancel ends;
- cancel releases the UI lock without rolling back save;
- component unmount does not corrupt the native operation;
- manual upload performs no metadata save;
- missing/inaccessible existing file exposes reconnect and explicit replacement;
- explicit replacement sets only `forceCreateReplacement: true`;
- manual URL edit/clear warns but never clears Drive ID;
- disconnect/deletion exposes no Drive-delete behavior.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/googleDriveService.test.ts src/renderer/src/components/SongDetails.test.ts src/renderer/src/stores/workspaceStore.test.ts
```

- [ ] **Step 3: Refactor `SongDetails` to use the service**

Keep the current create/update logic as the primary action. After it succeeds, pass only the saved
simfile ID plus local song/workspace display paths to `googleDriveService`. Render the dual outcome:

```text
Song published successfully.
Google Drive upload failed. Your previous download remains available.
```

Do not move the native upload state machine into the component.

- [ ] **Step 4: Add manual and replacement actions**

Beside Export to ZIP show:

- Upload ZIP to Drive;
- Re-upload ZIP to Drive;
- Uploading to Drive… N%;
- Cancel Upload;
- Create Replacement Drive File only after permanent existing-file access failure.

Manual actions invoke the native transaction directly and never call existing create/update
metadata methods.

- [ ] **Step 5: Preserve linked state semantics**

On native success, update only `google_drive_file_id` and `download_url` in the local linked
simfile/store cache. A failure leaves the cached fields untouched. Manual URL changes and clearing
leave the Drive ID intact and show the overwrite-on-next-upload warning.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/googleDriveService.test.ts src/renderer/src/components/SongDetails.test.ts src/renderer/src/stores/workspaceStore.test.ts
bun run --filter=dtx-desktop typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src/renderer
git commit -m "feat(desktop): upload Drive ZIPs after successful saves"
```

---

### Task 14: Add the deterministic native Drive E2E provider and scenarios

**Files:**

- Create: `packages/dtx-desktop/src-tauri/src/google_drive/fake.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/google_drive/mod.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/models.rs`
- Modify: `packages/e2e-desktop/wdio.conf.ts`
- Modify: `packages/e2e-desktop/support/native.ts`
- Modify: `packages/e2e-desktop/support/generated/native-types.ts`
- Create: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Create: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`
- Modify: `packages/e2e-desktop/package.json`

- [ ] **Step 1: Implement debug/E2E-only dependency injection**

Under `#[cfg(all(feature = "e2e", debug_assertions))]` only:

- seed `AuthState` from `DTX_E2E_DRUMERY_USER_ID`;
- use in-memory credentials;
- use a deterministic fake Drive API and fake metadata API;
- persist fake Drive object state only beneath `DTX_E2E_DATA_DIR`;
- expose narrow E2E control/snapshot commands for scenario injection and call assertions.

Keep the existing compile error for release+E2E. Add a compile/config test proving the fake cannot
be selected in a release or real Drive build.

- [ ] **Step 2: Seed connection and folder state in `wdio.conf.ts`**

Alongside trusted `workspace.json`, seed:

```text
google-drive-settings.json
```

for the fixed E2E user and set only `DTX_E2E_DATA_DIR`/`DTX_E2E_DRUMERY_USER_ID` in the fake app
environment. No OAuth client or OS keyring is used.

- [ ] **Step 3: Add normal-session Drive E2E scenarios**

In `google-drive-upload.e2e.ts`, use the real Tauri IPC/renderer UI to prove:

1. fixture ZIP contents and ordered operation-scoped progress;
2. deterministic first ID and browser URL;
3. same-simfile re-upload preserves identity;
4. permanent existing-file failure preserves metadata and does not create;
5. explicit replacement creates one new identity;
6. private folder rejection, public `type=anyone` acceptance, and later sharing removal;
7. cloud-title replacement rename ignores a different unsaved renderer title;
8. fake metadata API recorded only the dedicated patch mutation.

- [ ] **Step 4: Add process-termination crash recovery**

Use `support/standalone-session.ts` from the prerequisite plan:

1. start the E2E binary against one fixed data directory;
2. configure termination after fake Drive create but before metadata patch;
3. invoke upload and observe process exit;
4. relaunch the same binary/data directory;
5. wait for/retry current-user reconciliation;
6. assert the same pre-generated ID is bound;
7. assert exactly one create and no duplicate.

The fake persists only simulated Drive object state needed for this restart scenario.

- [ ] **Step 5: Add the crash script to the package contract**

Extend `e2e:run` after normal WDIO specs and prerequisite relaunch smoke:

```json
"e2e:drive-crash": "bun run scripts/google-drive-crash-recovery.ts"
```

so root `bun run e2e:desktop` covers all three phases with one debug/E2E build.

- [ ] **Step 6: Regenerate native E2E types and run typecheck**

```bash
bun run gen:native-types
bun run --filter=dtx-e2e-desktop check
```

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri packages/e2e-desktop
git commit -m "test(desktop): cover Drive upload and crash recovery"
```

---

### Task 15: Run targeted verification and the production smoke gate

**Files:**

- Verify all task-owned files; fix only issues found.

- [ ] **Step 1: Run migration/common/API/generated verification**

```bash
bun run --filter=@dtx/common test
bun run --filter=@dtx/common check
bun run --filter=@dtx/common build
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-web test -- src/lib/api/chart.test.ts
bun run --filter=dtx-web check
```

- [ ] **Step 2: Run Rust verification**

```bash
cargo fmt --check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --no-default-features
```

- [ ] **Step 3: Run renderer and static verification**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-desktop check
bunx eslint packages/dtx-desktop/src/renderer/src packages/dtx-api/src packages/common/src packages/e2e-desktop
bunx prettier --check packages/dtx-desktop packages/dtx-api packages/common packages/dtx-web/src/lib/api packages/e2e-desktop .github/workflows
```

- [ ] **Step 4: Run security scans over the implementation**

```bash
rg -n "workspaceRoot|drumeryUserId|refresh.?token|access.?token|authorization.?code|session.?uri|folderId|existingFileId" packages/dtx-desktop/src/renderer/src
rg -n "drive\\.google\\.com|uc\\?export=download|permissions\\.(create|update|delete)|auth/drive(\\s|$)" packages/dtx-desktop/src-tauri/src/google_drive
rg -n "googleDriveFileId" packages/dtx-api/src/schema/simfile.ts packages/common/src/lib/types/d1.types.ts
```

Expected:

- renderer contains no secret/root/user/folder/file authority payload;
- no synthesized Drive link, permission mutation, or broader scope exists;
- Drive ID is absent from general create/update inputs and present only in the field resolver,
  dedicated mutation, owner query, and internal models.

- [ ] **Step 5: Run the full native desktop E2E suite**

```bash
bun run e2e:desktop
```

Expected: trusted-root, relaunch sentinel, normal Drive behavior, and post-create crash
reconciliation all pass using the debug/E2E fake.

- [ ] **Step 6: Review generated and migration diffs**

```bash
git diff --check
git status --short
git diff --stat origin/main...
git diff -- packages/dtx-api/d1-migrations packages/dtx-api/dist/schema.graphql packages/dtx-web/src/lib/api/generated/graphql.ts
```

Confirm `0006` is new and unreplayed, generated outputs match operations, and no token/client ID is
tracked.

- [ ] **Step 7: Perform the manual Google release smoke**

This is an operational production-readiness gate and requires the configured production Google
Cloud project plus a dedicated test account:

1. build a production-declared binary with the production Desktop OAuth client;
2. connect and choose a small test folder shared as **Anyone with the link — Viewer**;
3. upload a small fixture;
4. open the stored `webContentLink` in a signed-out private browser;
5. record only pass/fail and sanitized file name/MIME/size;
6. do not capture tokens, codes, state, session URLs, Drive IDs, or raw Google responses.

Do not claim production rollout readiness until this external smoke passes. If credentials or the
production Cloud project are unavailable during implementation, report this single gate as
pending while keeping automated implementation verification honest.

- [ ] **Step 8: Final verification-fix commit if needed**

```bash
git add packages/dtx-desktop packages/e2e-desktop packages/dtx-api packages/dtx-web packages/common .github/workflows
git commit -m "test(desktop): complete Drive upload verification"
```

Do not create an empty commit.

## Completion Gate

HPA-311 is complete only when:

- the HPA-314/relaunch prerequisite is present and green;
- build/client mapping, secure storage, exact Picker/OAuth flow, public ACL validation, resumable
  create/update, keyed crash recovery, dedicated metadata mutation, and renderer orchestration all
  match the approved design;
- automatic and manual failures preserve the successful Drumery save plus old Drive metadata;
- explicit replacement is the only duplicate-identity path;
- targeted common/API/generated/Rust/renderer checks pass;
- full native desktop E2E passes, including real process termination and same-ID reconciliation;
- the manual signed-out `webContentLink` smoke has passed before production rollout.
