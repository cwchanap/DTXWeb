# DTX Desktop Google Drive Upload Design

**Date:** 2026-07-22  
**Last amended:** 2026-07-25  
**Status:** Amended design approved; three review passes incorporated; awaiting implementation planning

## Goal

Allow an authenticated DTX Desktop user to package a local song folder as a ZIP file, upload it directly to a user-selected Google Drive folder, and automatically populate the simfile download URL.

The feature supports both automatic upload after saving or publishing and a separate manual re-upload action. Re-uploading updates the same Drive object so the file identity and download URL remain stable.

Google Drive is a best-effort secondary operation. A Drive failure must never prevent the Drumery simfile from being saved or published, and it must never clear a previously working Drive file ID or download URL.

## Approved Product Decisions

- Google Drive authorization is local to each DTX Desktop installation.
- `drive.file` access follows Google's authorization for the requesting app, account, and file. A
  second installation must connect Drive locally; an existing file remains replaceable only when
  that connected account/app is authorized for it.
- Refresh tokens are stored only in the operating system credential store.
- Access tokens remain in Rust memory and are never exposed to the renderer.
- Each authenticated Drumery user selects one default Drive folder per installation.
- A selected folder must allow anonymous reading through an effective `type=anyone` permission;
  uploaded ZIPs inherit that public policy.
- DTX Desktop does not create, change, or remove per-file sharing permissions.
- Drumery stores both public `downloadUrl` and stable `googleDriveFileId` metadata on each simfile.
- The first upload creates a file in the configured folder.
- Later uploads update the same file.
- Saving or publishing automatically attempts Drive upload.
- Linked songs also expose **Upload ZIP to Drive** or **Re-upload ZIP to Drive**.
- Drive failure does not block draft save or publishing.
- Failed replacement preserves the previous Drive file ID and URL.
- Pre-generated IDs plus a small native pending binding prevent crash-window duplicate creates.
- `downloadUrl` is a browser-facing Google Drive link, not a guaranteed direct byte stream.
- Changing the default folder affects newly created or explicitly replaced files only; existing files are not moved.
- Disconnecting Google Drive or deleting a Drumery simfile does not delete Drive files.

## Current Context

DTX Desktop is a Tauri application with a Svelte renderer and Rust command layer. The current song-details flow already provides cloud simfile create/update operations, a bound `downloadUrl`, local ZIP export, authenticated owner-only mutations, a symlink-safe containment helper, and status UI for export and cloud operations.

The existing D1 `simfiles` table stores `download_url` but no stable external-file identifier. A Drive file ID is required to update the same Drive object after restart or from another authorized installation.

The desktop settings store currently persists `exportDirectory` in local storage. OAuth credentials and trusted native paths must not enter that store.

The source audit for this amendment found two post-design changes that alter the implementation boundary:

- `packages/e2e-desktop` now owns Tauri/WebDriver integration coverage and must verify the native Drive flow.
- The existing containment helper is correct only relative to its `workspaceRoot`, but that root is currently supplied by the renderer. HPA-314 therefore becomes Phase 0 of this effort: workspace ownership moves into Rust before Drive upload is added.

DeepWiki is not an implementation source for this design. Current repository source, tests, migrations, and generated contracts are authoritative.

## Architecture

```text
DTX Desktop
 ├─ Svelte renderer
 │   ├─ Drive settings and connection status
 │   ├─ save/publish orchestration
 │   ├─ manual re-upload action
 │   └─ progress, warning, and retry UI
 │
 ├─ Tauri Rust layer
 │   ├─ trusted workspace state and persistence
 │   ├─ installed-app OAuth with PKCE
 │   ├─ loopback callback listener
 │   ├─ OS credential-store access
 │   ├─ native non-secret Drive settings
 │   ├─ crash-safe pending file bindings
 │   ├─ read-only public-sharing validation
 │   ├─ Drive REST client
 │   ├─ ZIP creation using existing export rules
 │   ├─ direct resumable upload to Google Drive
 │   └─ Drive metadata synchronization through dtx-api
 │
 └─ DTX API / D1
     ├─ downloadUrl
     └─ googleDriveFileId
```

ZIP content travels directly from DTX Desktop to Google Drive. It does not pass through `dtx-api`. The API owns only Drumery metadata and authorization checks; it never stores Google credentials.

## Phase 0: Trusted Workspace Root

Before Drive work, replace the renderer-supplied workspace-root contract tracked by HPA-314.

Add a Rust-owned `WorkspaceRootState` and atomically persisted `workspace.json` under
`<data_dir>/dtxweb/`, the namespace already used by `preferences.rs`. Load and canonicalize the
saved root during Tauri startup. A missing, malformed, or inaccessible saved path produces an empty
state instead of falling back to a renderer value.

Extract and harden the existing native JSON persistence behavior from `preferences.rs` instead of
adding a parallel implementation. The shared primitive preserves its process-local
`OnceLock<Mutex<()>>` read-modify-write serialization and `DTX_E2E_DATA_DIR` resolution under the
existing `feature = "e2e"` gate, and is reused by preferences, workspace state, Drive settings,
and pending bindings.

On Unix, create the shared `<data_dir>/dtxweb/` directory with mode `0700` when absent. If the
already-shared directory exists with broader permissions, narrow that exact validated directory
without recursively changing existing children; migration coverage must prove existing
`preferences.json` survives. Write each destination through a uniquely named sibling temporary
file with mode `0600`, flush and sync it, atomically replace the destination, then sync the parent
directory where the platform supports it. Windows uses the platform's atomic replacement
semantics and the current user's app-data ACLs. Never fall back to a cross-directory move.

The native folder dialog is the only operation that may establish or replace the trusted root. Expose narrow commands to read and clear the root. Remove `workspaceRoot` from every existing IPC command that currently accepts it; filesystem, parsing, export, preview-upload, and Drive-upload commands read the managed state instead. Target paths may still cross IPC, but Rust canonicalizes them against the managed root before use.

Stop persisting `workspace_path` in renderer `localStorage`. Hydrate `workspaceStore` from Rust on startup. The old renderer value cannot be silently imported because trusting it once would preserve the vulnerability; existing installations require one native folder re-selection after upgrading. Canceling the dialog retains an already trusted root but establishes nothing on a first run.

The E2E-only `DTX_E2E_DATA_DIR` may contain a pre-seeded `dtxweb/workspace.json` so native tests can
verify startup restoration and spoofed-path rejection without automating an operating-system
dialog.

## Google Cloud Deployment Prerequisites

A Google Cloud project must be configured for the desktop integration before production builds can use the feature:

- enable the Google Drive API and the Google Picker capability used by the desktop folder-selection flow;
- configure the OAuth consent screen and application identity;
- create an OAuth client of type **Desktop app**;
- request only `https://www.googleapis.com/auth/drive.file` in the initial release;
- register test users while the consent configuration remains in testing, where applicable;
- complete any Google verification or publication steps required for the production consent configuration;
- configure application name, support contact, privacy-policy URL, and other required consent-screen metadata with the production Drumery values.

The desktop OAuth client ID is public configuration, not a secret. It may be embedded at build time through an explicitly named configuration value such as `GOOGLE_DRIVE_OAUTH_CLIENT_ID`. No desktop OAuth client secret is relied on for confidentiality.

Production uses a Desktop OAuth client from the verified production Google Cloud project and consent
screen. Pre-production uses a different Desktop client in an isolated testing project/consent
screen. Local debug builds use that non-production testing client from the developer's local
environment by default, or a developer-specific Desktop client in the same testing project. E2E
fake-provider builds use no OAuth client. A production binary must never use a testing client, and a
non-production binary must never use the production client.

Declare the mapping with an explicit build-time `DTX_DESKTOP_BUILD_ENV` enum
(`production`, `preproduction`, `local`, or `e2e`) plus
`GOOGLE_DRIVE_OAUTH_CLIENT_ID`; never infer the OAuth environment from an API URL. The `e2e` value
is accepted only with both the E2E feature and debug assertions.

CI must fail clearly when a release build enables Drive integration without the client ID mapped to
its declared environment. Tokens, authorization codes, and refresh tokens must never be placed in
GitHub Actions variables, build artifacts, source files, or Tauri configuration.

Configuration coverage consists of a parser unit test for
enabled/disabled/environment/client-ID combinations and a CI/release guard that fails with a named
`GOOGLE_DRIVE_OAUTH_CLIENT_ID` diagnostic when Drive is enabled without the correct environment
mapping. Debug and E2E fake-provider builds remain independently gated.

## Data Ownership and Persistence

### Local secret data

Store the Google refresh token in the operating system credential store under a key scoped to the authenticated Drumery user.

```text
Service: com.hapadona.drumery
Account: google-drive:<drumery-user-id>
Secret: <google-refresh-token>
```

Use `keyring` 3.6.3, whose Rust 1.75 minimum is compatible with the desktop crate's Rust 1.77
baseline; pin 3.6.3 because `keyring` 4.x requires Rust 1.88. Disable default features and select
the platform backend explicitly: `apple-native` on macOS, `windows-native` on Windows, and
`sync-secret-service` plus `crypto-rust` on Linux.

Keep the crate behind a narrow, mockable interface:

```rust
trait GoogleDriveCredentialStore {
    fn get_refresh_token(&self, user_id: &str) -> Result<Option<String>, CredentialStoreError>;
    fn set_refresh_token(&self, user_id: &str, token: &str) -> Result<(), CredentialStoreError>;
    fn delete_refresh_token(&self, user_id: &str) -> Result<(), CredentialStoreError>;
}
```

Production uses the platform keyring implementation and tests inject an in-memory implementation.
Run blocking keyring calls on a dedicated blocking worker and serialize access to each credential.
Treat a missing entry as disconnected; map a locked/unavailable keychain, missing Linux Secret
Service daemon, D-Bus failure, or other backend failure to sanitized `CREDENTIAL_STORE` state.
Headless CI and native E2E use the in-memory fake rather than silently disabling secure storage.

The refresh token must never be stored in renderer local storage, workspace metadata, D1, application logs, plaintext configuration, Svelte state, or Tauri IPC responses.

Access tokens are cached only in Rust memory with their expiry time. Clear them on application exit, Drumery logout, Google disconnect, or terminal refresh failure.

Drive commands derive the Drumery user ID from Rust `AuthState`. They do not accept a renderer-supplied user ID for credential lookup or local settings selection.

### Local non-secret data

Store the selected folder per Drumery user in
`<data_dir>/dtxweb/google-drive-settings.json`:

```ts
interface GoogleDriveFolderSetting {
	folderId: string;
	folderName: string;
}

interface GoogleDriveSettings {
	googleDriveFoldersByUser: Record<string, GoogleDriveFolderSetting>;
}
```

Write this file with the native atomic persistence primitive defined for `workspace.json`. Missing
or malformed Drive configuration becomes an empty map. The renderer settings store may display a
sanitized copy, but Rust is the source of truth and upload commands do not accept a folder ID from
the renderer.

Folder metadata is installation-local because it is paired with the Google account authorized on that installation. A second computer must connect Drive once before uploading, although cloud simfile metadata is already synchronized.

Persist non-secret crash-recovery state separately in
`<data_dir>/dtxweb/google-drive-pending-bindings.json`:

```ts
interface PendingGoogleDriveBinding {
	userId: string;
	simfileId: string;
	driveFileId: string;
	kind: 'first-upload' | 'explicit-replacement';
	createdAt: string;
}

interface GoogleDrivePendingBindings {
	schemaVersion: 1;
	bindingsByUser: Record<string, Record<string, PendingGoogleDriveBinding>>;
}
```

The outer and inner keys are the Drumery user ID and simfile ID respectively; validate that each
element's redundant `userId` and `simfileId` match those keys. Mutations hold the store lock across
the complete read-modify-write and atomically replace one keyed entry, enforcing at most one
pending binding per user and simfile. It contains no token, resumable-session URI, local path,
folder name, or browser URL. Treat it as untrusted input on read and validate all IDs before
reconciliation. `createdAt` is for diagnostics and test assertions only; age alone must never
cause Rust to forget a possibly created Drive object or delete it without reconciliation.

### Cloud simfile data

Add a nullable D1 column:

```sql
ALTER TABLE simfiles ADD COLUMN google_drive_file_id TEXT;
```

Add this as the next numbered `packages/dtx-api/d1-migrations/` migration and let Wrangler's
migration ledger apply it once. SQLite has no idempotent `ALTER TABLE ... ADD COLUMN` form here:
do not edit or replay `0001_initial_schema.sql`, and do not attempt an ad hoc `IF NOT EXISTS`.
Fresh-DB integration tests run the numbered migrations in order; a manually altered database whose
ledger disagrees must be reconciled operationally rather than by replaying this statement.

Expose it as `googleDriveFileId` in server and desktop models.

Visibility rules:

- `downloadUrl` remains publicly readable for published simfiles.
- `googleDriveFileId` is returned only to the authenticated owner.
- Anonymous users and non-owners receive `null` for `googleDriveFileId`.
- Only owner-authorized mutations may set or replace it.
- Staff/admin visibility or mutation bypass is out of scope for the first release; staff receive
  the same non-owner result unless a separate policy is designed later.

Implement `googleDriveFileId` as a nullable field-level resolver on the shared `Simfile` object. It
returns the stored value only when `ctx.user?.id === simfile.user_id`; otherwise it returns `null`,
including for anonymous callers and non-owner staff/admin callers. The desktop's fresh owner-detail operation
requests the field only with the current authenticated Drumery session. Do not expose it through a
public-only database shape or rely only on client selection-set discipline.

## Google Authorization and Folder Selection

### OAuth flow

Use Google's installed-application authorization-code flow with:

- PKCE method `S256`;
- cryptographically random verifier, challenge, and `state`;
- temporary loopback redirect bound to `127.0.0.1` on a random available port;
- `access_type=offline`;
- `prompt=consent` on every Picker launch, as required by Google's desktop/mobile Picker flow;
- scope limited to `https://www.googleapis.com/auth/drive.file`.

Rust owns one in-memory `PickerAttempt` for the combined authorization-and-folder-pick flow. It
contains a random attempt ID, the current Drumery user ID, PKCE verifier, OAuth state, exact
loopback address/path, and a five-minute deadline. Start the listener before opening the system
browser and use an exact redirect such as
`http://127.0.0.1:<random-port>/google-drive/oauth/callback`.

The listener accepts one `GET` on that path. Require an exact constant-time state match, exactly one
`picked_file_ids` value containing one folder ID, and either `code` or `error`, never both. Bind the
attempt to the same still-authenticated Drumery user through token exchange and folder validation,
and require the returned scope set to contain `drive.file`.
Reject wrong paths, missing/duplicate parameters, replayed callbacks, user changes, and callbacks
after the deadline. `error=access_denied`, a Picker cancel response, browser close followed by
timeout, or missing selection maps to sanitized cancellation. The callback response is a minimal
local HTML page that contains no code, state, picked ID, or raw error.

Exchange the code only after callback validation and require a non-blank refresh token, then
validate the picked folder with the resulting access token. Every successful Picker flow replaces
the stored refresh token because `prompt=consent` is unconditional. Persist the new token and
folder only after all validation succeeds. On first connection, a persistence failure removes the
new credential. On folder change, keep the prior token and folder available until validation
finishes; if either credential or settings persistence fails, restore the prior credential and
leave the prior folder setting unchanged. A missing refresh token is `INVALID_RESPONSE`, not a
reason to reuse an older token for the newly picked folder.

Close the listener and zeroize/discard the PKCE verifier, code, refresh token working copy, and
attempt state after success, failure, or timeout. A custom URL scheme is not used for this flow.

The installed desktop client is a public OAuth client. Its client identifier may be bundled; no bundled client secret is considered confidential.

Refresh-token storage is installation-local, but `drive.file` file authorization is not inherently
device-scoped. A second installation using the same Google account and OAuth app/project can access
files already authorized for that app; a different account or app configuration may not. Always
handle Google not-found/permission responses through the explicit existing-file failure UX instead
of assuming either cross-install success or failure.

### Folder picker

Settings exposes **Connect Google Drive and Choose Folder**. The system browser opens the supported Google desktop Picker flow configured for folder selection. Validate the returned folder through the Drive API before persistence.

Use the current desktop Picker authorization parameters:

- `trigger_onepick=true`;
- `allow_folder_selection=true`;
- `prompt=consent`;
- `access_type=offline`;
- `response_type=code`;
- scope exactly `https://www.googleapis.com/auth/drive.file`.

On first connection, persist the refresh token and native folder setting only after token exchange
and folder validation both succeed. Failure or cancellation stores neither. Changing a folder
launches the same consent prompt and replaces the stored refresh token on success; leave the
current credential and folder untouched unless the replacement token and selection both validate.

Validate the selected item with `files.get`, requesting
`id,name,mimeType,trashed,capabilities(canAddChildren)` and setting
`supportsAllDrives=true`, then paginate `permissions.list` with fields
`permissions(id,type,role,view,allowFileDiscovery),nextPageToken`. The selected item must:

- exist and be accessible to the connected account;
- have MIME type `application/vnd.google-apps.folder`;
- not be trashed;
- be capable of accepting child files;
- have an effective permission with `type=anyone`, no restricted `view`, and `role` equal to
  `reader`, `commenter`, or `writer`.

`supportsAllDrives=true` declares that the caller handles shared-drive semantics; it does not grant
access or guarantee that a shared-drive role can upload. `capabilities.canAddChildren` is the
authoritative per-user check.

The `type=anyone` permission is the anonymous catalog-download precondition; both discoverable
public sharing and “anyone with the link” qualify. Domain, group, target-audience, and named-user
permissions do not. DTX Desktop reads permissions but never creates, changes, or deletes them. If
the folder is private, reject selection and instruct the user to set **Anyone with the link —
Viewer** in Google Drive, then retry. Re-check the folder before every first upload or explicit
replacement, and check the existing file's effective `type=anyone` permission before replacement.
If sharing was removed, skip Drive upload, preserve existing metadata, and return
`DOWNLOAD_NOT_PUBLIC`.

A successful `permissions.list` response without a qualifying permission proves the item is not
public and maps to `DOWNLOAD_NOT_PUBLIC`. A `403` from `permissions.list` does not prove privacy:
fail closed with `SHARING_CHECK_UNAVAILABLE`, preserve the current connection and cloud metadata,
and explain that Drumery cannot verify anonymous access for that folder or file. A `404` or failed
`files.get` accessibility check remains `FOLDER_UNAVAILABLE` for a selected folder or
`FILE_NOT_FOUND`/`FILE_PERMISSION_DENIED` for an existing file. Network failures retain their
normal retry and `NETWORK` handling.

The first release requests only `drive.file`, not broad Drive or profile scopes. The UI says **Google Drive connected** rather than claiming a Google email address it did not request permission to read.

The selected folder is the sharing boundary. New ZIP files use that folder ID in `parents` and
inherit its sharing policy. DTX Desktop never calls Drive permission-mutation APIs for individual
ZIP files.

### Renderer-visible connection state

Rust exposes only sanitized state:

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

Tokens, authorization codes, PKCE verifier, raw Google errors, and resumable-session URIs never reach the renderer.

Connection-state, connect, change-folder, and disconnect commands take no Drumery user ID. Rust resolves the current authenticated user before reading credentials or native folder settings.

### Token refresh

Before a Drive request, Rust reads the refresh token, reuses a valid in-memory access token,
otherwise refreshes it, and refreshes shortly before expiry. Retry one request after a token-expiry
authorization failure. Mark `requiresReconnect` only when Google reports a revoked or invalid
refresh token. Mark `credentialStoreUnavailable` for secure-store backend failures; reconnecting
OAuth is not presented as the fix for a locked or unavailable credential store.

A credential-store failure is a Drive-connection error. The UI keeps save/publish available,
explains that secure credential storage is unavailable, and offers retry after the OS keychain or
Linux Secret Service is unlocked/started. Do not silently disable Drive or fall back to plaintext.

## Settings UX and Lifecycle

Add a **Google Drive** card beneath Export Settings.

Disconnected:

```text
Google Drive
Not connected
[Connect Google Drive and Choose Folder]
```

Connected:

```text
Google Drive
Connected
Destination folder: Public DTX Downloads
Public download verified: Anyone with the link can view.
Existing Drive files can be replaced only when this Google account has access to them.
[Change Folder] [Disconnect]
```

If a later permission re-check fails, replace the verified line with:

```text
Public download unavailable. Share this folder as “Anyone with the link — Viewer” in Google Drive.
[Re-check Sharing] [Change Folder]
```

### Change Folder

Launch the Picker again with `prompt=consent`. The settings UI states that Google will ask for
consent again so Drumery can receive a fresh offline token. Replace the stored refresh token and
local folder setting only after successful validation. Cancellation or failure leaves the current
credential and folder unchanged.

Changing the folder does not move existing files:

- existing simfiles update their current file by ID;
- new files use the new folder;
- explicit replacement files use the current folder.

### Drumery logout

Logging out clears in-memory Google access tokens and hides Drive actions, but does not revoke authorization or delete the per-user refresh token/folder setting. Restore the same local connection when that Drumery user logs in again.

### Disconnect

Disconnecting:

1. attempts to revoke the refresh token;
2. deletes the local credential even if revocation cannot be confirmed;
3. clears that Drumery user's folder setting;
4. clears in-memory token and folder-validation state;
5. leaves Drive files and cloud simfile Drive metadata unchanged;
6. retains any pending crash-recovery binding until the same user reconnects and it can be safely
   reconciled or compensated.

When revocation cannot be confirmed, explain that the local credential was removed and the user may still revoke access in Google Account permissions.

## ZIP Creation

Reuse the current ZIP export implementation. Refactor it into reusable internal functions conceptually equivalent to:

```rust
collect_valid_song_files(song_path, workspace_state)
write_song_zip(output_path, files)
```

Manual export and Drive upload use the same supported extensions, top-level selection behavior,
deterministic ordering, canonical workspace containment, and symlink-safe paths. The existing
rejecting filesystem-component validator remains in the manual export path; it is not used for
Drive metadata names.

If collection finds no supported files, return `NO_VALID_SONG_FILES` before contacting Google.
Map filesystem out-of-space failures during ZIP creation to `INSUFFICIENT_DISK_SPACE`, remove the
partial archive, and preserve the successful Drumery save. The global upload semaphore limits
active Drive temp directories to two; queued operations create no directory.

Manual export continues writing to the configured export directory. Drive upload writes beneath
the Tauri application cache directory at
`<app-cache>/google-drive-uploads/<native-random-id>/`. Rust generates that directory identifier;
the renderer operation ID and saved cloud title are never used as filesystem path components. The
archive inside the random directory may use a fixed native name such as `upload.zip`.

Remove temporary archives after success, failure, cancellation, or unrecoverable metadata-sync
failure. At startup, perform best-effort cleanup only of validated descendants of the fixed
`<app-cache>/google-drive-uploads/` namespace; never scan or delete other cache or operating-system
temporary paths.

## Drive Upload Behavior

Use resumable uploads for creation and replacement. Production uses an 8 MiB chunk size
(`8 * 1024 * 1024`), which is a multiple of Drive's required 256 KiB unit. Keep the value as one
Rust constant with a test-only override for boundary and retry tests, not a user-facing runtime
setting. Report progress after each accepted chunk.

The Drive client supports resumable `files.create`, resumable `files.update`, session-status reconciliation after uncertain failures, continuation from the confirmed byte, final `id`/`webContentLink` retrieval, and stable error classification.

Set `supportsAllDrives=true` on current Drive v3 folder and file methods that accept it. This lets
one implementation handle My Drive and shared-drive resources, but actual access remains governed
by the connected account's scope, file authorization, and role capabilities.

### First upload

When no `googleDriveFileId` exists:

1. require a connected account and a destination folder whose anonymous-read permission still
   validates;
2. build the temporary ZIP;
3. request one ID from `files.generateIds`;
4. atomically persist the pending first-upload binding before any create request;
5. create the ZIP with that ID in the configured folder as `application/zip`;
6. retrieve and validate final metadata and effective public-read permission;
7. patch the cloud simfile only after upload succeeds;
8. remove the pending binding only after the metadata patch commits.

Derive the Drive filename from the saved title returned by the fresh owner-authorized cloud query
with a Drive-specific sanitizer, then append `.zip`. Trim outer Unicode whitespace, replace each
run of control characters or `/`/`\` separators with `-`, trim the result again, and fall back to
`simfile-<simfileId>` when nothing remains. Preserve other printable characters that the existing
filesystem validator rejects, including `:`; therefore `AC/DC` becomes `AC-DC.zip` and
`Song: Reprise` remains `Song: Reprise.zip`. The helper sanitizes rather than rejects a legitimate
cloud title and never feeds the result into a local path.

Never use an unsaved renderer form title for a Drive create or rename. Manual ZIP export retains
its current local/renderer title behavior and rejecting filesystem-component validation.

Google Drive permits duplicate names. Do not list the folder or invent collision-avoidance suffixes;
stable replacement is based exclusively on `googleDriveFileId`.

The pre-generated ID makes uncertain create retries idempotent: after an indeterminate server
result, retrying the same create cannot create a second object.

### Replacement

When `googleDriveFileId` exists:

1. verify the existing file remains publicly readable and writable by the connected app/account;
2. build a fresh ZIP;
3. initiate resumable `files.update` for that ID;
4. replace content and set the Drive filename to the latest Drive-sanitized saved cloud title plus
   `.zip`, without changing identity or parent;
5. retrieve and validate final metadata;
6. patch the URL only after Drive success.

The file remains in its current Drive folder. The default folder is not applied and the app does not move it.

### Download URL

Store Drive's `webContentLink` as `downloadUrl` for ZIP files. Updating the same object preserves identity and normally preserves the public link; still write the returned link so Drumery reflects Drive's authoritative metadata.

This is intentionally a browser-facing Drive download link, not a direct byte-stream contract.
Google may redirect it, show a large-file virus-scan warning/interstitial, or block flagged content.
`files.get?alt=media` requires an authorized API request and therefore cannot serve as a public
stored URL without adding a Drumery download proxy or exposing credentials; both are out of scope.
The UI and public API must not describe `downloadUrl` as a direct-download endpoint.

After upload completion, call `files.get` for
`id,name,mimeType,webContentLink,capabilities(canDownload)` and retry a temporarily missing
`webContentLink` with short bounded backoff. Require the returned ID to match the intended ID, MIME
type to be `application/zip`, `capabilities.canDownload=true`, a valid effective anonymous-read
permission, and a non-blank HTTPS `webContentLink`.

Do not synthesize `drive.google.com` or `uc?export=download` fallback URLs: constructed links can
miss Drive resource keys or future host/query requirements. If validation still fails, return
`INVALID_RESPONSE` only for malformed/mismatched metadata, a non-downloadable file, or a missing or
invalid `webContentLink`.

If a successful post-upload ACL read finds no effective anonymous permission, return
`DOWNLOAD_NOT_PUBLIC` and show the existing sharing/re-check UX. If the ACL read itself is denied,
return `SHARING_CHECK_UNAVAILABLE` instead. For either failure after a new create, compensate by
deleting the unbound file and retain the pending record until deletion/not-found is confirmed. For
an existing-file replacement, never delete or clear the file or its prior Drumery metadata.

### Crash-safe create binding

Use the pending native binding for both first upload and explicit replacement, the only flows that
create a new Drive identity. If the pending record cannot be committed, return `LOCAL_STATE`
(`INSUFFICIENT_DISK_SPACE` for an out-of-space cause) before contacting Drive.

After Drumery authentication/session restoration and before any later create for that simfile,
reconcile the current user's pending binding:

1. fetch the fresh owner-authorized simfile and verify the current user still owns it;
2. query Drive for the pre-generated ID;
3. if the file exists, validate its ZIP metadata and public permission, fetch its authoritative
   `webContentLink`, and retry the dedicated metadata mutation;
4. if Drive confirms the ID was never created, reuse that same ID for the create instead of
   generating another;
5. if compensation deletion is required, retain the pending record until Drive confirms deletion
   or not-found;
6. clear the pending record only after metadata binding succeeds or the unbound Drive object is
   confirmed absent.

Google documents how to generate an ID but no lifetime for an unused generated ID. If a later
create with the stored ID fails with a definitive invalid/expired/consumed-ID response, first call
`files.get` for that ID. If the file exists, reconcile it; if Drive returns a definitive `404`,
request a fresh generated ID and atomically replace the keyed pending record before attempting
create. Do not replace the pending ID on a `403`, network failure, ambiguous response, or
indeterminate create result, because an inaccessible or already-created object may exist. Bound
fresh-ID attempts so a bad response cannot loop indefinitely.

If the simfile no longer exists or is no longer owned, never bind the file; attempt compensation
deletion and retain the record until deletion/not-found is confirmed. If Drumery auth, Drive auth,
or secure credential storage is temporarily unavailable, leave the record unchanged and resume
reconciliation when that user's prerequisites return.

Reconciliation is best-effort for unrelated songs and never blocks application startup. It is
mandatory before another create/replacement for the same simfile, preventing a crash or power loss
between Drive completion and D1 patch from producing a duplicate file. No resumable-session URI is
persisted.

### Missing or inaccessible file

On permanent not-found or permission failure:

- preserve the stored ID and URL;
- explain that the connected Google account/app is not authorized to update that existing file and
  that this can occur after connecting a different account or differently configured build;
- offer **Reconnect Google Drive**;
- offer **Create Replacement Drive File**.

Never create a replacement automatically. When the user explicitly chooses replacement, require a
valid publicly readable current folder, pre-generate an ID, atomically persist an
`explicit-replacement` pending binding, create the new file there, patch both fields only after
success, and leave the old file untouched. It follows the same crash reconciliation and pending
record removal rules as first upload.

## Save and Publish Orchestration

Drive upload and Drumery save are independent outcomes.

The renderer owns the primary Drumery action: save or publish first, then invoke Drive only after success. The native Drive command owns the complete secondary transaction: fresh owner-metadata fetch, trusted path validation, temporary ZIP creation, Drive upload, dedicated metadata mutation, compensation when applicable, and temporary cleanup.

### New song

```text
Create or publish Drumery simfile
    ├─ failure: stop; do not upload
    └─ success
         ↓
Attempt Drive upload
    ├─ failure: retain successful simfile and show retry warning
    └─ success
         ↓
Patch googleDriveFileId and downloadUrl
```

Creating the simfile first avoids leaving an untracked Drive ZIP after an API failure. Drive failure never rolls back a successful draft or publication.

### Existing song

```text
Save or publish metadata
    ↓
Attempt Drive upload independently
    ├─ failure: preserve previous Drive metadata
    └─ success: patch Drive metadata
```

The UI presents both results clearly:

```text
Song published successfully.
Google Drive upload failed. Your previous download remains available.
[Retry Upload]
```

### Dedicated metadata mutation

Add an owner-only mutation that changes only the two Drive fields:

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

This prevents a long upload from replaying stale title, BPM, publication, or form values.

The resolver uses the existing owner auth scope and immediately re-reads the simfile before update,
requiring `ctx.user.id === simfile.user_id`. The database helper updates both fields in one
statement constrained by simfile ID and owner ID.

The dedicated mutation applies the existing `filterDownloadUrl` R2-bucket exclusion and then
stronger Drive-specific validation:

- trim and require a non-blank opaque Drive file ID with a maximum length of 256 characters;
- trim and require a `downloadUrl` of at most 2,048 characters;
- parse the URL and require `https:`; plain HTTP is rejected;
- reject any value the existing bucket filter would convert to `null`;
- store the trimmed original URL string without reconstructing it, preserving Drive query
  parameters, resource keys, and fragments exactly.

Any validation or authorization failure leaves both existing fields unchanged and returns a
sanitized GraphQL error. Do not silently write `null`.

Do not add `googleDriveFileId` to the general create/update inputs. The owner-visible field and dedicated mutation are the only cloud contract needed by this feature.

### Drive success followed by patch failure

Retry the dedicated metadata patch once for a transient failure.

If it still fails:

- for a newly created Drive file, attempt best-effort deletion to avoid an untracked duplicate and
  retain its pending binding until deletion or not-found is confirmed;
- for an update to an existing Drive file, never delete or roll back the file;
- show a metadata-sync warning;
- preserve current cloud fields until a later successful retry.

For an existing Drive file, a later upload retries synchronization using a fresh owner-metadata read. Do not persist credentials or resumable-session data in the renderer.

## Manual Re-upload

Linked songs expose a separate action beside **Export to ZIP**:

- **Upload ZIP to Drive** when no file ID exists;
- **Re-upload ZIP to Drive** when an ID exists;
- **Uploading to Drive… 42%** while active;
- **Cancel Upload** while queued, preparing, or transferring;
- **Create Replacement Drive File** after a permanent existing-file access error.

Manual re-upload does not save unrelated form data. It builds the ZIP, creates or updates the Drive file, patches only Drive metadata after success, and leaves the cloud simfile unchanged after failure.

The action remains available after automatic failure so the user can retry without saving or publishing again.

## Concurrency and Progress

Only one Drive upload may run for a song at a time. A process-wide semaphore permits at most two
Drive upload operations across all songs. Acquire it before ZIP creation or resumable-session
initiation, so queued work holds neither a ZIP, session URI, nor chunk buffer. Additional songs
queue first-in/first-out and report **Waiting for upload slot**; another operation for the same song
returns `UPLOAD_IN_PROGRESS`.

Give each operation a unique ID. Rust progress events contain only `operationId`, `simfileId`,
sanitized stage, byte counts/percentage, and optional sanitized error code. They never include a
song title, relative or absolute path, temp path, folder ID, Drive file ID, Google request ID,
session URI, or raw error. The renderer ignores stale or unrelated events.

Stages include:

- Waiting for upload slot
- Preparing ZIP
- Connecting to Google Drive
- Uploading — percentage
- Finalizing
- Synchronizing download metadata
- Upload complete
- Upload failed; Drumery save succeeded

While automatic upload belongs to a save/publish orchestration, duplicate save/publish actions for
that song remain disabled until orchestration ends. The status UI exposes **Cancel Upload** while
the operation is queued, preparing, or transferring, which releases that lock without rolling back
the successful Drumery save. Cancellation uses a Rust cancellation token, abandons the in-memory
session, removes temporary files, and leaves existing cloud Drive metadata unchanged. Once Drive
has finalized the file, cancellation is no longer accepted; metadata synchronization and any
required compensation complete as one native transaction.

Unrelated navigation remains available. Closing Song Details must not corrupt the Rust task; the
store may receive completion while the component is unmounted. Shutdown paths follow the same
cleanup rules as cancellation.

## Renderer Boundaries

Do not implement the Drive state machine directly inside the already-large `SongDetails.svelte`.

Add:

```text
src/renderer/src/services/googleDriveService.ts
src/renderer/src/stores/googleDriveStore.ts
src/renderer/src/components/GoogleDriveSettings.svelte
src/renderer/src/components/GoogleDriveUploadStatus.svelte
```

Representative outcome:

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

`googleDriveService.ts` coordinates the primary simfile save/publish outcome, then calls the native Drive transaction. It does not implement resumable upload, call the metadata mutation directly, or perform compensation.

`googleDriveStore.ts` contains only non-secret state: connection/folder status, reconnect requirement, active progress, and sanitized errors.

`GoogleDriveSettings.svelte` renders settings actions. `GoogleDriveUploadStatus.svelte` renders
queued/progress state, cancel, success, retryable failure, permanent file-access failure, and
replacement actions.

Route all new labels, actions, progress stages, warnings, and sanitized error messages through the
existing `svelte-i18n` setup. Add matching keys to
`src/renderer/src/lib/i18n/locales/en.json` and `jp.json`, and test that every Drive UI state
resolves a translation instead of hardcoding English in the new components.

Extend `desktopHost.ts` with typed wrappers:

```ts
getGoogleDriveConnectionState();
connectGoogleDriveAndChooseFolder();
changeGoogleDriveFolder();
disconnectGoogleDrive();
uploadSongZipToGoogleDrive(params);
cancelGoogleDriveUpload(operationId);
```

Expose no generic token or arbitrary HTTP command.

## Rust Boundaries

Add:

```text
src-tauri/src/workspace.rs
src-tauri/src/native_persistence.rs
src-tauri/src/google_drive/
├── mod.rs
├── commands.rs
├── oauth.rs
├── credential_store.rs
├── settings.rs
├── pending_bindings.rs
├── drive_client.rs
└── upload.rs
```

- `native_persistence.rs`: the extracted `preferences.rs` directory resolution, locking, atomic
  JSON write, file-mode, and E2E-data-directory primitives reused by all native JSON stores.
- `workspace.rs`: Rust-owned workspace state, startup hydration, native selection, and trusted
  containment access through the shared persistence module.
- `commands.rs`: narrow Tauri commands, parameter validation, local user namespace, and sanitized error mapping.
- `oauth.rs`: single-attempt Picker/OAuth protocol, PKCE, loopback callback, state/user/deadline
  validation, exchange, refresh, and revocation.
- `credential_store.rs`: `GoogleDriveCredentialStore`; `keyring` 3.6.3 production adapter and
  in-memory test fake.
- `settings.rs`: atomic non-secret folder settings keyed by the Rust-authenticated Drumery user.
- `pending_bindings.rs`: atomic crash-recovery bindings, owner-scoped reconciliation, and removal.
- `drive_client.rs`: folder/public-permission validation, ID generation, create/update,
  compensation delete, resumable session/status, final metadata, and error classification.
- `upload.rs`: global semaphore, cancellation, temporary ZIP, chunk streaming, progress,
  retry/resume, metadata synchronization, compensation, cleanup, and operation state machine.

Register the commands in the centralized Tauri invoke handler.

Representative input:

```ts
type UploadSongZipToGoogleDriveInput = {
	operationId: string;
	simfileId: string;
	songRelativePath: string;
	forceCreateReplacement?: boolean;
};
```

`operationId` must parse as a UUIDv4 and is used only for event correlation, cancellation, and
same-song operation tracking. It is never treated as a path, URL, credential key, or authorization
value. Cancellation derives the current Drumery user from `AuthState` and refuses an operation
owned by another authenticated user. The renderer generates it before invoking the long-running
command so it can subscribe and cancel immediately; moving generation into Rust would require a
separate start/result protocol without improving the validated, user-bound authorization boundary.

Representative result:

```ts
type GoogleDriveUploadResult = {
	success: boolean;
	fileId?: string;
	downloadUrl?: string;
	fileName?: string;
	replacedExistingFile?: boolean;
	errorCode?:
		| 'WORKSPACE_REQUIRED'
		| 'NOT_CONNECTED'
		| 'RECONNECT_REQUIRED'
		| 'FOLDER_REQUIRED'
		| 'FOLDER_UNAVAILABLE'
		| 'SHARING_CHECK_UNAVAILABLE'
		| 'DOWNLOAD_NOT_PUBLIC'
		| 'SIMFILE_UNAVAILABLE'
		| 'FILE_NOT_FOUND'
		| 'FILE_PERMISSION_DENIED'
		| 'UPLOAD_IN_PROGRESS'
		| 'CANCELED'
		| 'NO_VALID_SONG_FILES'
		| 'INSUFFICIENT_DISK_SPACE'
		| 'LOCAL_STATE'
		| 'METADATA_SYNC_FAILED'
		| 'RATE_LIMITED'
		| 'QUOTA_EXCEEDED'
		| 'NETWORK'
		| 'CREDENTIAL_STORE'
		| 'INVALID_RESPONSE'
		| 'UNKNOWN';
	error?: string;
};
```

`songRelativePath` must be a normalized workspace-relative path. Reject absolute paths, empty
components, `.`/`..` traversal, platform prefixes, and alternate separators before joining it to
the managed root. Rust then canonicalizes the joined target and verifies containment and symlink
safety before reading files. The renderer cannot supply a root or absolute target. Rust cannot
derive the local folder from `simfileId` alone because that cloud record does not own a local
workspace mapping.

Rust derives the trusted workspace root from `WorkspaceRootState`, the Drumery user from
`AuthState`, the destination folder from native Drive settings, and the existing file ID plus saved
title from a fresh owner-authorized API query.

## DTX API and GraphQL

Update the numbered D1 migrations, the test/type Drizzle schema at
`packages/common/src/lib/server/db/schema.ts`, database types and mappings, the field-level owner
resolver on the `Simfile` object, the dedicated mutation and atomic DB helper, owner-detail
selection, desktop GraphQL fragments/Rust mappings, and generated web types. `dtx-api` owns the D1
migration and production query path; it does not own a separate Drizzle schema.

The dedicated mutation uses the existing defense-in-depth owner pattern: authorization scope plus an immediate ownership re-read before D1 update.

Public list/detail queries continue exposing `downloadUrl` but never another user's file ID.

## Error Handling

### Authorization

- OAuth or Picker cancellation preserves current connection/folder.
- State mismatch rejects and discards the attempt.
- Token exchange failure stores no credential.
- Revoked refresh token marks `requiresReconnect`; save/publish continues.
- Credential-store failure never falls back to plaintext.

### Folder

Before creating a file, validate the folder when it has not been validated this session or when Google rejects an operation involving it.

When unavailable, skip Drive upload, continue save/publish, preserve Drive metadata, and show **Google Drive folder is unavailable. Choose another folder.**

When the folder or existing file lacks effective anonymous-read permission, return
`DOWNLOAD_NOT_PUBLIC`, continue save/publish, preserve Drive metadata, and show the sharing/re-check
action. Do not upload first and warn afterward.

When `permissions.list` returns `403`, return `SHARING_CHECK_UNAVAILABLE` instead of inferring that
the item is private. Continue save/publish, preserve Drive metadata, and show **Drumery cannot
verify public sharing for this Google Drive item. Choose a folder whose sharing settings Drumery
can inspect, or retry with sufficient access.**

### Upload

Retry temporary network/session errors and Drive `rateLimitExceeded`/`userRateLimitExceeded`
responses with bounded exponential backoff, status reconciliation, and a valid `Retry-After` value
when present. Exhausted transient throttling returns `RATE_LIMITED` and offers retry. Storage,
daily, or other non-transient quota exhaustion returns `QUOTA_EXCEEDED` without automatic retry.
Stop on permanent authorization, validation, permission, or unsupported-response errors and return
a sanitized code.

Never log or return raw Google bodies, tokens, authorization codes, resumable-session URIs, or credential-store internals.

### Existing link preservation

No failed Drive operation writes null, blank, or replacement values to cloud Drive fields. The previous URL remains usable until upload and metadata patch both succeed.

## Manual Download URL Editing

Keep `downloadUrl` editable. Editing it does not clear `googleDriveFileId`. For a Drive-linked song, warn:

> This song is linked to a Google Drive file. The next successful Drive upload will replace the download URL with Google's current download link.

Clearing the URL does not delete the Drive file or ID.

The first release has no **Unlink Google Drive file** action and no mutation that clears
`googleDriveFileId`. A song remains Drive-linked after disconnect or manual URL replacement, and
the UI keeps the warning that the next successful Drive upload will overwrite the URL. Implementers
must not add an ad hoc clear path to the general update mutation.

## Deletion Semantics

Deleting a Drumery simfile does not delete its Drive ZIP in the first release. The user may still want the shared file, the local Google account may not own it, and accidental external deletion is more harmful than an orphan.

A future explicit **Delete associated Drive file** flow is separate scope. Disconnecting also leaves files and links untouched.

## Security Guardrails

- Use only `drive.file`.
- Use PKCE and random OAuth state.
- Bind callbacks to `127.0.0.1`, not all interfaces.
- Accept only the active attempt and expected path.
- Derive the Drumery user from Rust `AuthState`; never accept it as a Drive IPC namespace.
- Derive the workspace root from Rust `WorkspaceRootState`; never accept it as a filesystem or Drive IPC argument.
- Keep selected Drive folders in native settings; never accept a destination folder in upload IPC.
- Fetch the existing Drive file ID from fresh owner-authorized cloud metadata; never accept it in upload IPC.
- Store refresh tokens only in the OS credential store.
- Keep access tokens in Rust memory only.
- Keep each resumable-session URI only in Rust memory for one operation. Never persist it; abandon
  it after success, failure, cancellation, or shutdown.
- Persist only the pre-generated file ID and owner/simfile binding needed for crash reconciliation;
  validate the record and current ownership before use.
- Never expose tokens or raw authorization artifacts over IPC.
- Never log tokens, codes, session URIs, or raw credential errors.
- Never put filesystem paths, Drive IDs, folder IDs, Google request IDs, or raw errors in progress
  events.
- Validate selected folders before persistence.
- Reuse canonical workspace containment.
- Use permissions APIs only for read-only ACL validation; never create, update, or delete a Drive
  permission.
- Never silently broaden scopes.
- Never automatically create replacement duplicates.
- Keep cloud ownership enforcement in `dtx-api`.

## Testing Plan

### Rust

Use an in-memory credential-store fake and mocked Google endpoints. Cover workspace-state atomic
persistence/permissions and malformed-path fallback, migration of existing preferences through the
extracted `<data_dir>/dtxweb/` persistence primitive, native Drive-settings atomic persistence and
per-user isolation, keyed pending-binding uniqueness/atomic replacement/malformed-record
rejection, PKCE/state, exact callback path/parameter validation, unconditional Picker consent,
refresh-token replacement and rollback, single-use replay rejection, timeout/cancel/user-switch
handling, token exchange/refresh/revocation, locked/unavailable credential-store mapping,
`canAddChildren` folder validation, paginated public/private permission validation, distinct
permission-list `403` handling, create/update including Drive-title sanitization and cloud-title
replacement rename, generated-ID idempotency and confirmed-404 fresh-ID replacement, missing
`webContentLink` handling, post-upload private-ACL `DOWNLOAD_NOT_PUBLIC` handling, crash
reconciliation at each create/patch boundary, final metadata parsing, operation IDs, the
two-operation global bound and queue, cancellation, no-valid-files and disk-full mapping, 8 MiB
compliant chunks, in-memory session lifecycle, resumable reconciliation, `Retry-After` and bounded
retry, rate-limit versus hard-quota classification, explicit replacement, relative-path/symlink
rejection, export filtering, namespace-limited temporary cleanup, compensation deletion for new
files only, and path/Drive-ID-free IPC events and logs.

### Renderer

Extend existing Settings, desktop-host, auth-service, workspace-store, and SongDetails tests. Cover
native workspace hydration and clearing, connect/change/cancel/disconnect, logout persistence,
automatic upload only after save success, publish success despite Drive failure, preservation of old
fields, manual re-upload isolation, explicit replacement, queue/progress and same-song concurrency,
user cancellation releasing the save lock, stale-event rejection, manual-URL warning, browser-link
caveat, public-sharing validation/re-check, credential-store-unavailable UX, no-unlink behavior,
localized strings in both desktop locales, and reconnect/folder-unavailable/file-authorization
actions.

### API

Cover migration compatibility, nullable column persistence, owner-only ID visibility including
staff-as-non-owner field-resolution behavior, public URL visibility, dedicated owner-constrained
atomic Drive metadata mutation, R2-bucket URL exclusion, HTTPS/length/blank validation, exact
query/fragment preservation, unauthenticated/cross-user rejection, immediate ownership re-check,
null compatibility, generated-client mappings, and clean application through the Wrangler
migration ledger without replaying the non-idempotent `ALTER TABLE`.

### Native Tauri E2E

Add focused specs under `packages/e2e-desktop`; do not put desktop coverage in the web Playwright package.

The native E2E build uses deterministic test implementations gated by both `feature = "e2e"` and `debug_assertions`, matching the existing WebDriver plugin guard. A release build cannot contain the fake provider. Native E2E never contacts Google, uses the real OS credential store, or requires production credentials; real HTTP and credential behavior remain covered by Rust integration tests.

Before the Drive crash-recovery spec, extend the current one-process
`@wdio/tauri-service` harness with a supported controlled terminate-and-relaunch primitive that
reuses the same binary and fixed `DTX_E2E_DATA_DIR`. Add a harness smoke test that persists a
native sentinel, terminates the app, relaunches it, and reads the sentinel. This infrastructure is
an explicit implementation task, not an assumption hidden inside the Drive spec.

Cover:

1. restore a pre-seeded native workspace root from `DTX_E2E_DATA_DIR`, execute
   `localStorage.setItem('workspace_path', JSON.stringify('/'))`, and prove
   absolute/traversing upload paths plus reads and ZIP operations outside the Rust root remain
   rejected;
2. upload a fixture song through Tauri IPC and assert ZIP contents, ordered operation-scoped progress, and deterministic file ID/download URL;
3. upload the same simfile again and prove replacement keeps the file identity;
4. inject a permanent existing-file failure and prove no automatic replacement or metadata clearing occurs;
5. explicitly create a replacement and prove a new identity appears only after that action;
6. reject a private folder, accept a folder with effective `type=anyone` read permission, and reject
   upload after the fake removes that permission;
7. inject process termination after create but before metadata patch, restart against the persisted
   pending binding, and prove reconciliation binds the same generated ID without a duplicate;
8. change the cloud title, leave a different unsaved renderer title, and prove replacement uses the
   cloud title.

The E2E fake records create/update/metadata-patch calls so the suite can verify the dedicated mutation path without starting external Google or production API services.
For the crash-recovery case only, it persists simulated Drive file state beneath
`DTX_E2E_DATA_DIR` so a restarted debug/E2E process observes the same generated file ID.

### Verification scope

The implementation plan must list targeted renderer, Rust, API, common, migration, generated-code,
type-check, formatting, and package-scoped lint commands, plus the full `bun run e2e:desktop` suite.
Do not run broad development servers, the web E2E suite, or unrelated full builds.

Before production rollout, perform one manual Google smoke test with a dedicated test account:
select an **Anyone with the link — Viewer** folder, upload a small fixture, then open the returned
`webContentLink` in a signed-out private browser session. Record only pass/fail and sanitized file
metadata; do not capture tokens or session URLs.

## Acceptance Criteria

1. Workspace restoration and containment use only the Rust-owned root; spoofing renderer local storage or IPC arguments cannot broaden access.
2. Existing installations re-select the workspace once instead of importing the untrusted renderer path.
3. The combined OAuth/Picker callback is accepted only for one active, unexpired, same-user Rust
   attempt with matching path/state and exactly one picked folder; every launch uses
   `prompt=consent`, and every successful launch replaces the stored refresh token.
4. An authenticated user can connect Drive locally and select one default folder only when it can
   accept children and a readable ACL proves effective anonymous-read permission; an ACL `403`
   produces `SHARING_CHECK_UNAVAILABLE`, not a claim that the folder is private.
5. Drive commands derive the current Drumery user from Rust auth state.
6. Refresh tokens remain in the OS credential store and never appear in renderer storage or logs;
   an unavailable secure store returns actionable `CREDENTIAL_STORE` UX without plaintext fallback.
7. The UI verifies **Anyone with the link** access, detects later sharing removal, and prevents a
   Drive upload that would produce a private catalog link.
8. Draft save and publishing automatically attempt Drive upload after the Drumery save succeeds.
9. Draft save and publishing remain successful when Drive fails or is unavailable.
10. First upload pre-generates and persists its intended ID, creates one ZIP in the configured
    folder with a sanitized cloud-metadata name that never becomes a local path, and atomically
    populates both cloud fields.
11. A crash after Drive create but before metadata patch reconciles the same pending ID after
    restart and cannot create a duplicate; a definitively invalid unused ID is replaced only after
    `files.get` confirms `404` and the keyed pending record is atomically rewritten.
12. Missing or invalid final `webContentLink` returns `INVALID_RESPONSE`; a readable ACL without
    anonymous access returns `DOWNLOAD_NOT_PUBLIC`, and an unreadable ACL returns
    `SHARING_CHECK_UNAVAILABLE`. A new unbound file is compensated and existing Drive metadata
    remains unchanged.
13. Later upload updates the same file, retains its Drive identity/parent, renames from the fresh
    saved cloud title, and stores Drive's latest returned browser link.
14. Linked songs have a separate re-upload action that saves no unrelated metadata.
15. Failed replacement preserves the previous ID and URL.
16. Missing/inaccessible existing files require explicit replacement, which uses the same pending
    binding and crash-reconciliation rules.
17. Changing the default folder does not move existing files.
18. Another installation can replace an existing file after connecting an account/app that Google
    authorizes for that file; the UI explains the limitation and requires explicit replacement
    otherwise.
19. Public users can read `downloadUrl`, while the field-level resolver returns
    `googleDriveFileId` only to the authenticated owner.
20. A release smoke test opens a newly stored `webContentLink` in a signed-out private browser
    without requiring Google account access.
21. Disconnect and simfile deletion leave Drive files and links untouched.
22. Manual URL editing, clearing, and Drive disconnect do not unlink `googleDriveFileId`; the next
    successful Drive upload overwrites the URL.
23. ZIP contents match manual export rules; empty sets and disk exhaustion return specific
    sanitized errors; temporary files are namespace-limited and cleaned up.
24. Progress and warnings distinguish Drumery save success from Drive failure and never disclose
    paths, Drive IDs, Google request IDs, or raw errors.
25. At most two Drive operations allocate ZIP/upload resources at once; same-song duplicates are
    rejected and other songs queue without allocating those resources.
26. A queued or transferring upload can be canceled without rolling back the successful Drumery
    save or clearing prior Drive metadata.
27. The upload IPC accepts only a validated workspace-relative song path, never a renderer root or
    absolute path.
28. Public `downloadUrl` is documented as a Drive browser link that may redirect or show Google's
    interstitial, not a guaranteed byte stream.
29. The dedicated metadata mutation re-checks ownership, atomically updates both fields, excludes
    R2 bucket URLs, accepts only bounded HTTPS links, and preserves Drive query/fragment data.
30. Production and non-production builds use their declared OAuth client mapping, and the release
    guard rejects a missing or mismatched `GOOGLE_DRIVE_OAUTH_CLIENT_ID`.
31. Rate limits retry separately from permanent quota errors.
32. Every new Drive UI state uses the existing `svelte-i18n` locale path.
33. Targeted security, renderer, Rust, API, common, migration, generated-code, and configuration
    tests pass.
34. The full native `packages/e2e-desktop` Tauri/WebDriver suite proves trusted-root enforcement,
    public/private folder behavior, create/re-upload/failure/explicit replacement, cloud-title
    rename, and post-create crash reconciliation through an explicitly implemented
    terminate-and-relaunch harness.

## Out of Scope

- Server-side Google token storage.
- Proxying ZIPs through `dtx-api`.
- Syncing Google authorization across computers.
- Per-song folder overrides.
- Moving existing files on folder change.
- Per-file sharing changes.
- Broad Drive scopes or displaying Google email.
- Staff/admin access to owner-only `googleDriveFileId`.
- A Drumery proxy that converts Drive API media responses into public direct downloads.
- Unlinking or clearing a cloud `googleDriveFileId`.
- Deleting Drive files on disconnect or simfile deletion.
- Automatic background synchronization of all songs.
- Uploading arbitrary ZIPs outside the active workspace song folder.
- Google Drive integration in the web application.

## Implementation Sequence Recommendation

Phase 0 is a separately reviewable and shippable PR/milestone. Its targeted Rust/renderer tests and
native containment E2E must be green and the workspace-root contract merged before any Google Drive
code is merged. Do not hide the filesystem IPC migration inside a combined Drive mega-PR.

1. HPA-314 trusted workspace state, extraction of the existing `preferences.rs` native-persistence
   primitive, renderer migration, and native containment E2E.
2. Desktop E2E controlled terminate/relaunch harness with a persisted-native-sentinel smoke test.
3. Google Cloud/CI configuration validation.
4. D1 migration, server types, field-level owner resolver, URL policy, and dedicated metadata
   mutation.
5. Desktop GraphQL mapping and fresh owner-metadata fetch.
6. ZIP helper extraction plus Drive-specific cloud-name sanitization with regression tests.
7. Credential-store abstraction, native Drive settings, and exact OAuth/Picker attempt protocol.
8. Public-folder ACL validation, generated IDs, and resumable Drive client.
9. Pending bindings, crash reconciliation, Tauri commands, native metadata synchronization, and
   sanitized progress events.
10. Localized renderer settings/store components.
11. Automatic save/publish orchestration.
12. Manual re-upload and replacement UX.
13. Failure handling, cleanup, native Drive E2E, and targeted verification.

This order removes the unsafe workspace contract first, then establishes configuration, cloud compatibility, and reusable ZIP behavior before OAuth and UI integration.
