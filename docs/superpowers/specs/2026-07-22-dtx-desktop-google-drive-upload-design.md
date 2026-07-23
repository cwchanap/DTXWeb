# DTX Desktop Google Drive Upload Design

**Date:** 2026-07-22  
**Status:** Approved design; awaiting implementation planning

## Goal

Allow an authenticated DTX Desktop user to package a local song folder as a ZIP file, upload it directly to a user-selected Google Drive folder, and automatically populate the simfile download URL.

The integration must support both automatic upload after saving or publishing a simfile and an explicit re-upload action. Re-uploading should replace the same Google Drive file so the download URL remains stable.

Google Drive is a best-effort secondary operation. A Drive failure must never prevent the Drumery simfile from being saved or published, and it must never clear a previously working Drive file ID or download URL.

## Product Decisions

The approved behavior is:

- Google Drive authorization is local to each DTX Desktop installation.
- The Google refresh token is stored only in the operating system credential store.
- Access tokens remain in Rust memory and are never exposed to the renderer.
- Each authenticated Drumery user selects one default Google Drive folder on each desktop installation.
- Uploaded ZIP files inherit that folder's sharing policy.
- DTX Desktop does not create, alter, or remove per-file sharing permissions.
- A simfile stores both its public `downloadUrl` and its stable `googleDriveFileId` in Drumery's cloud database.
- The first upload creates a Drive file in the configured folder.
- Later uploads update the same Drive file and preserve its URL.
- Saving or publishing automatically attempts the Drive upload.
- Linked songs also expose a separate **Upload ZIP to Drive** or **Re-upload ZIP to Drive** action.
- Saving and publishing remain successful even when Drive upload fails.
- A failed replacement preserves the previous Drive file ID and download URL.
- Changing the default destination folder affects newly created Drive files only; it does not move existing files.
- Disconnecting Google Drive or deleting a Drumery simfile does not delete Drive files.

## Current Context

DTX Desktop is a Tauri application with a Svelte renderer and Rust command layer.

The current song-details flow already contains:

- create and update operations for cloud simfile metadata;
- a bound `downloadUrl` field;
- local ZIP export through `export_song_to_zip`;
- authenticated owner-only simfile mutations;
- workspace-containment checks for native file operations;
- status UI for export, upload, update, and linking operations.

The existing D1 `simfiles` table stores `download_url` but no stable external-file identifier. A Drive file ID is therefore required to update the same object across application restarts and across desktop installations.

The desktop settings store currently persists only `exportDirectory` in local storage. It can be extended with non-secret, per-Drumery-user Drive folder metadata. OAuth credentials must not enter that settings object.

## Architecture

```text
DTX Desktop
 ├─ Svelte renderer
 │   ├─ Google Drive settings and connection status
 │   ├─ save/publish orchestration
 │   ├─ manual re-upload action
 │   └─ progress and retry UI
 │
 ├─ Tauri Rust layer
 │   ├─ installed-app OAuth with PKCE
 │   ├─ loopback callback listener
 │   ├─ OS credential-store access
 │   ├─ Drive API client
 │   ├─ ZIP creation using existing export rules
 │   └─ direct resumable upload to Google Drive
 │
 └─ DTX API / D1
     ├─ downloadUrl
     └─ googleDriveFileId
```

The ZIP is uploaded directly from DTX Desktop to Google Drive. It does not pass through `dtx-api`, avoiding backend request-size limits, duplicate bandwidth, and server-side storage of Google credentials.

The API remains responsible only for Drumery simfile metadata and ownership checks.

## Data Ownership and Persistence

### Local secret data

The Google refresh token is stored in the operating system credential store under a key scoped to the authenticated Drumery user.

Recommended logical key:

```text
Service: com.hapadona.dtx-desktop.google-drive
Account: <drumery-user-id>
Secret: <google-refresh-token>
```

The credential-store implementation must use a maintained Rust abstraction backed by the platform's secure credential facility, such as macOS Keychain, Windows Credential Manager, and the supported Linux secret service where applicable.

The refresh token must never be stored in:

- renderer local storage;
- workspace metadata;
- D1;
- application logs;
- plaintext configuration files;
- Svelte stores or component state;
- Tauri IPC responses.

Google access tokens are cached only in Rust memory with their expiry time. They are discarded on application exit, Drumery logout, Google disconnect, or a terminal refresh failure.

### Local non-secret data

The selected destination folder is stored per Drumery user in desktop settings:

```ts
interface GoogleDriveFolderSetting {
  folderId: string;
  folderName: string;
}

interface Settings {
  exportDirectory: string;
  googleDriveFoldersByUser: Record<string, GoogleDriveFolderSetting>;
}
```

The settings loader must migrate safely from older settings payloads. Missing, malformed, or non-object Drive configuration is treated as an empty map without affecting `exportDirectory`.

Folder metadata is installation-local because it is paired with the Google account authorized on that installation. A second computer must connect Google Drive once before uploading, even though cloud simfile metadata remains available.

### Cloud simfile data

Add a nullable D1 column:

```sql
ALTER TABLE simfiles ADD COLUMN google_drive_file_id TEXT;
```

Expose the field as `googleDriveFileId` in server and desktop models.

Visibility rules:

- `downloadUrl` remains publicly readable for published simfiles.
- `googleDriveFileId` is returned only to the authenticated owner.
- Non-owners and anonymous public queries receive `null` for `googleDriveFileId`.
- Only owner-authorized mutations may set or replace it.

This keeps the implementation identifier private while preserving public downloads.

## Google Authorization and Folder Selection

### OAuth flow

DTX Desktop uses Google's installed-application OAuth authorization-code flow with PKCE:

- PKCE method: `S256`;
- cryptographically random verifier, challenge, and `state`;
- temporary loopback redirect on `127.0.0.1` with a random available port;
- `access_type=offline`;
- explicit consent when a new refresh token is required;
- Drive scope limited to `https://www.googleapis.com/auth/drive.file`.

The browser authorization flow must validate:

- the callback arrived on the active loopback listener;
- the OAuth `state` exactly matches the pending attempt;
- the callback contains either an authorization result or a sanitized cancellation/error result;
- no partial credential is persisted when token exchange fails.

The desktop OAuth client is a public installed-app client. Its client identifier may be bundled with the application; no bundled desktop client secret is treated as confidential.

### Folder picker

Settings exposes one primary action:

**Connect Google Drive and Choose Folder**

The system browser opens Google's desktop Picker flow configured for folder selection. The returned selection is validated through the Drive API before being persisted.

Validation requires that the selected item:

- exists and is accessible to the connected Google account;
- has MIME type `application/vnd.google-apps.folder`;
- is not trashed;
- can accept child files.

The first version requests only `drive.file`. It does not request broad full-Drive access or identity/profile scopes. The UI therefore says **Google Drive connected** rather than asserting a Google email address that the app did not request permission to read.

The selected folder is the sharing boundary. Every newly created ZIP is uploaded with that folder ID in its `parents` metadata. The file inherits the folder's sharing policy. DTX Desktop never calls the Drive permissions API for individual ZIP files.

### Connection state exposed to the renderer

Rust returns only sanitized connection metadata:

```ts
type GoogleDriveConnectionState = {
  connected: boolean;
  folder?: {
    id: string;
    name: string;
  };
  requiresReconnect?: boolean;
};
```

No access token, refresh token, authorization code, PKCE verifier, or raw Google error reaches the renderer.

### Token refresh

Before a Drive request, Rust:

1. reads the refresh token from the credential store;
2. reuses an unexpired in-memory access token when available;
3. otherwise exchanges the refresh token for a new access token;
4. refreshes shortly before expiry;
5. retries one request after a token-expiry authorization failure;
6. marks the connection as requiring reconnection when Google reports a revoked or invalid refresh token.

A credential-store failure is a hard Drive-connection error. The app must not fall back to plaintext token storage.

## Settings UX

Add a **Google Drive** card beneath the existing export settings.

Disconnected state:

```text
Google Drive

Not connected

[Connect Google Drive and Choose Folder]
```

Connected state:

```text
Google Drive

Connected
Destination folder: Public DTX Downloads
Uploads inherit this folder's sharing settings.

[Change Folder] [Disconnect]
```

### Change Folder

Changing the default folder launches the Picker again and replaces the local folder setting only after successful validation.

Changing the folder does not move existing Drive files:

- existing simfiles continue updating their current Drive file by ID;
- newly created files use the new default folder;
- an explicitly created replacement file uses the current default folder.

Cancelling folder selection leaves the existing connection and folder unchanged.

### Logout

Logging out of Drumery:

- clears in-memory Google access tokens;
- hides Drive actions and folder settings for the logged-out state;
- does not revoke Google authorization;
- does not delete the per-user refresh token or folder setting;
- restores that user's local Drive connection after the same Drumery user logs in again.

### Disconnect

Disconnecting Google Drive:

1. attempts to revoke the Google refresh token;
2. deletes the local credential even when revocation cannot be confirmed;
3. clears that Drumery user's local folder setting;
4. clears in-memory access tokens and cached validation state;
5. leaves all Drive files, `googleDriveFileId` values, and `downloadUrl` values unchanged.

When revocation cannot be confirmed, the UI explains that the local credential was removed and Google Account permissions may still be revoked manually.

## ZIP Creation

The Drive workflow must reuse the current ZIP export rules rather than creating a second archive implementation.

Refactor the existing ZIP implementation into reusable internal functions conceptually equivalent to:

```rust
collect_valid_song_files(song_path, workspace_root)
write_song_zip(output_path, files)
```

Both manual export and Drive upload use:

- the same supported DTX-related file extensions;
- the same top-level file-selection behavior;
- deterministic file ordering;
- the same filename sanitization;
- the same canonical workspace-containment primitive;
- symlink-safe canonical paths.

Manual export continues writing to the configured export directory.

Drive upload writes to a unique application temporary path. Temporary archives must be removed after:

- successful upload;
- failed upload;
- cancellation;
- unrecoverable metadata-sync failure.

The application also performs best-effort cleanup of stale Drive-upload temporary archives at startup. Cleanup is restricted to the application's own temporary namespace.

## Drive Upload Behavior

### Upload API

Use Drive resumable uploads for both creation and replacement.

The implementation uploads in chunks that comply with Drive's resumable-upload requirements and emits progress after each accepted chunk.

The Drive client supports:

- initiating a resumable `files.create` upload;
- initiating a resumable `files.update` upload;
- querying resumable-session status after an uncertain network failure;
- continuing from the last confirmed byte;
- obtaining final file metadata, including `id` and `webContentLink`;
- classifying temporary, authorization, not-found, permission, quota, and validation errors.

### First upload

When a simfile has no `googleDriveFileId`:

1. require a connected Google Drive account and configured destination folder;
2. build the temporary ZIP;
3. create the ZIP in the configured folder;
4. set MIME type `application/zip`;
5. request final fields including `id` and `webContentLink`;
6. patch the cloud simfile only after upload succeeds.

The uploaded filename is derived from the song title using the existing safe filename rules and ends in `.zip`.

Where supported by the Drive API, the implementation may pre-generate a file ID before content upload to make uncertain create retries idempotent. If that mechanism is unavailable for the selected account or endpoint, the resumable session URI itself is the idempotency boundary for that upload operation.

### Replacement upload

When `googleDriveFileId` exists:

1. build a fresh ZIP;
2. initiate resumable `files.update` for that file ID;
3. replace file content without changing its identity;
4. retrieve the final metadata;
5. patch `downloadUrl` only when Drive returns a successful result.

The file remains in its existing Drive folder. The current default folder is not applied to updates and the app does not move the file.

### Stable URL

Store Drive's `webContentLink` as the simfile `downloadUrl` for ZIP files.

Updating the same Drive object preserves its file identity and normally preserves the public download link. The metadata patch still writes the returned link so the cloud record reflects Drive's authoritative value.

### Missing or inaccessible existing file

When update returns a permanent not-found or permission error:

- preserve the stored `googleDriveFileId` and `downloadUrl`;
- show that the existing file cannot be updated with the connected Google account;
- offer **Reconnect Google Drive**;
- offer **Create Replacement Drive File**.

The app must not automatically create a replacement after an update failure. A temporary authorization or account-selection issue must not create duplicate public files.

When the user explicitly chooses **Create Replacement Drive File**:

1. require a valid current default folder;
2. create a new Drive file there;
3. replace the cloud `googleDriveFileId` and `downloadUrl` only after success;
4. leave the old Drive file untouched.

## Save and Publish Orchestration

Drive upload and Drumery metadata save are separate outcomes.

### New unlinked song

The sequence is:

```text
Create or publish the Drumery simfile
    ├─ failure: stop; do not upload to Drive
    └─ success
         ↓
Attempt Drive upload
    ├─ failure: keep successful simfile; show retryable warning
    └─ success
         ↓
Patch googleDriveFileId and downloadUrl
```

Creating the cloud simfile first prevents an API failure from leaving an untracked ZIP in Drive.

A Drive failure never rolls back the successfully created or published simfile.

### Existing linked song

For a normal update or publication-state change:

```text
Save or publish Drumery metadata
    ↓
Attempt Drive upload independently
    ├─ failure: preserve previous Drive fields
    └─ success: patch Drive fields
```

The metadata save is considered successful even when Drive fails.

The UI presents both outcomes distinctly, for example:

```text
Song published successfully.
Google Drive upload failed. Your previous download remains available.
[Retry Upload]
```

### Dedicated Drive metadata mutation

Add an owner-only mutation that changes only Drive-related fields:

```graphql
mutation UpdateSimfileDriveFile(
  $id: ID!
  $googleDriveFileId: String!
  $downloadUrl: String!
) {
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

This prevents a long-running upload from replaying stale title, BPM, publication, or form values over newer changes.

The resolver must:

- require authentication;
- verify simfile ownership immediately before update;
- update both fields together;
- return a sanitized owner-visible simfile result;
- reject blank file IDs or blank/non-HTTP(S) download URLs;
- preserve existing fields when validation or authorization fails.

### Drive success followed by metadata-patch failure

The client automatically retries the dedicated metadata patch once when the failure is transient.

If the patch still fails:

- for a newly created Drive file, attempt best-effort deletion of that newly created file to avoid leaving an untracked duplicate;
- for an existing Drive file update, never delete or roll back the Drive file;
- report a distinct metadata-sync warning;
- preserve the cloud fields until a later successful retry.

The upload result retained in the current UI session may be retried against the metadata mutation while the app remains open. It must not persist access credentials or raw resumable-session data in renderer storage.

## Manual Re-upload

Linked songs expose a separate Drive action beside the existing ZIP export action.

Labels:

- **Upload ZIP to Drive** when no Drive file ID exists;
- **Re-upload ZIP to Drive** when a Drive file ID exists;
- **Uploading to Drive… 42%** while active;
- **Create Replacement Drive File** only after a permanent existing-file access error.

Manual re-upload:

- does not save title, BPM, levels, dates, publication state, preview URLs, or other form data;
- builds a ZIP from the current local song folder;
- updates the existing Drive file when an ID exists;
- creates a new file when no ID exists;
- patches only Drive metadata after success;
- leaves the cloud simfile unchanged after failure.

The manual action remains available after an automatic Drive upload failure so users can retry without saving or publishing again.

## Concurrency, Progress, and Cancellation

Only one Drive upload may run for a song at a time.

Each upload receives a unique operation ID. Rust emits progress events containing that operation ID and the song/simfile identity. The renderer ignores events from stale or unrelated operations.

Progress stages include:

- Preparing ZIP
- Connecting to Google Drive
- Uploading — percentage
- Finalizing
- Synchronizing download metadata
- Upload complete
- Upload failed; Drumery save succeeded

While automatic upload is part of a save or publish action:

- duplicate save/publish actions for that song are disabled until the orchestration completes;
- unrelated application navigation remains available;
- closing Song Details does not corrupt the upload state;
- the background Rust operation may complete and update the relevant stores when the component is remounted.

The first version does not require a user-facing cancel button. The internal upload task must nevertheless clean up temporary archives when the task is aborted during application shutdown or encounters an unrecoverable error.

## Renderer Components and Services

`SongDetails.svelte` already coordinates several responsibilities and should not absorb the full Drive state machine.

Add focused renderer units:

```text
src/renderer/src/services/googleDriveService.ts
src/renderer/src/stores/googleDriveStore.ts
src/renderer/src/components/GoogleDriveSettings.svelte
src/renderer/src/components/GoogleDriveUploadStatus.svelte
```

### `googleDriveService.ts`

Owns orchestration across:

- Tauri Drive commands;
- cloud simfile creation/update;
- dedicated Drive metadata patch;
- independent save and Drive outcomes;
- retry rules;
- explicit replacement creation.

Representative result:

```ts
type SongSaveOutcome = {
  simfileSave: {
    success: boolean;
    error?: string;
  };
  driveUpload: {
    status: 'success' | 'failed' | 'skipped';
    fileId?: string;
    downloadUrl?: string;
    errorCode?: string;
    error?: string;
  };
};
```

### `googleDriveStore.ts`

Tracks only non-secret renderer state:

- current Drumery user's connection status;
- selected folder metadata;
- reconnect requirement;
- active upload operations and progress;
- sanitized upload errors;
- recently completed Drive result awaiting metadata synchronization.

### `GoogleDriveSettings.svelte`

Renders the settings card and invokes connect, change-folder, and disconnect commands.

### `GoogleDriveUploadStatus.svelte`

Renders progress, success, retryable failure, permanent existing-file failure, and replacement actions. It can be reused by automatic and manual upload flows.

### Desktop host IPC

Extend `desktopHost.ts` with typed wrappers for:

```ts
getGoogleDriveConnectionState(drumeryUserId)
connectGoogleDriveAndChooseFolder(drumeryUserId)
changeGoogleDriveFolder(drumeryUserId)
disconnectGoogleDrive(drumeryUserId)
uploadSongZipToGoogleDrive(params)
```

No generic token or raw HTTP command is exposed.

## Rust Component Boundaries

Add a focused module:

```text
src-tauri/src/google_drive/
├── mod.rs
├── commands.rs
├── oauth.rs
├── credential_store.rs
├── drive_client.rs
└── upload.rs
```

### `commands.rs`

Defines the Tauri command surface, validates caller parameters, resolves authenticated-user-local settings, and maps domain errors to sanitized IPC results.

### `oauth.rs`

Owns PKCE, authorization URLs, loopback callback lifecycle, state validation, token exchange, refresh, and revocation.

### `credential_store.rs`

Defines a small credential-store trait. Production uses the OS credential store. Tests use an in-memory fake. The interface does not expose tokens outside Rust.

### `drive_client.rs`

Owns Drive REST calls:

- folder validation;
- file create/update/delete for compensation;
- resumable-session initiation and status queries;
- final metadata retrieval;
- stable error classification.

### `upload.rs`

Owns temporary ZIP creation, chunk streaming, progress emission, retry/resume, cleanup, and the upload operation state machine.

The new commands are registered in the centralized Tauri `invoke_handler` list.

## Tauri IPC Contracts

Representative upload command input:

```ts
type UploadSongZipToGoogleDriveInput = {
  operationId: string;
  drumeryUserId: string;
  simfileId: string;
  songPath: string;
  workspaceRoot: string;
  songTitle: string;
  existingFileId?: string;
  forceCreateReplacement?: boolean;
};
```

Representative result:

```ts
type GoogleDriveUploadResult = {
  success: boolean;
  fileId?: string;
  downloadUrl?: string;
  fileName?: string;
  replacedExistingFile?: boolean;
  errorCode?:
    | 'NOT_CONNECTED'
    | 'RECONNECT_REQUIRED'
    | 'FOLDER_REQUIRED'
    | 'FOLDER_UNAVAILABLE'
    | 'FILE_NOT_FOUND'
    | 'FILE_PERMISSION_DENIED'
    | 'QUOTA_EXCEEDED'
    | 'NETWORK'
    | 'CREDENTIAL_STORE'
    | 'INVALID_RESPONSE'
    | 'UNKNOWN';
  error?: string;
};
```

Rust must verify that `songPath` is canonically contained by `workspaceRoot` before reading or zipping any files. The renderer-provided Drumery user ID is used only as a credential/settings namespace; cloud metadata authorization remains enforced independently by the authenticated API mutation.

## DTX API and GraphQL Changes

Update:

- D1 migrations;
- Drizzle schema;
- database row and joined simfile types;
- create, get, list, search, and update mappings where applicable;
- `Simfile` GraphQL object;
- `CreateSimfileInput` and `UpdateSimfileInput` for compatibility;
- dedicated `updateSimfileDriveFile` mutation;
- desktop GraphQL fragments and Rust renderer mappings;
- generated web GraphQL types and operations.

`googleDriveFileId` should be accepted by general owner create/update inputs for compatibility, but the desktop upload workflow uses the dedicated mutation after successful upload.

The dedicated mutation validates ownership using the same defense-in-depth pattern as existing owner updates: authorization scope plus an immediate row ownership re-read before the D1 update.

Public list and detail queries continue exposing `downloadUrl` but never expose another user's Drive file ID.

## Error Handling

### Authorization errors

- User cancels OAuth or Picker: preserve existing connection and folder.
- OAuth state mismatch: reject the callback and discard the attempt.
- Token exchange failure: store no partial credential.
- Invalid or revoked refresh token: mark `requiresReconnect`; save/publish continues.
- Credential-store failure: report Drive unavailable; never fall back to plaintext.

### Folder errors

Before a new-file upload, validate the configured folder when it has not been validated during the current session or when Google rejects an operation involving it.

When the folder is deleted, trashed, or inaccessible:

- skip Drive upload;
- continue save/publish;
- preserve existing simfile Drive fields;
- show **Google Drive folder is unavailable. Choose another folder.**

### Upload errors

Temporary network and resumable-session errors are retried with bounded exponential backoff and session-status reconciliation.

Permanent quota, authorization, file-access, validation, or unsupported-response errors stop the Drive operation and return a sanitized code.

Raw Google response bodies, tokens, authorization codes, resumable session URIs, and credential-store internals must not be logged or returned to the renderer.

### Existing link preservation

No failed Drive operation may write `null`, an empty string, or a replacement value to either cloud Drive field.

An existing `downloadUrl` remains usable until a later Drive upload and metadata patch both succeed.

## Manual Download URL Editing

The existing `downloadUrl` field remains editable.

Manually changing it does not clear `googleDriveFileId`. The UI should warn:

> This song is linked to a Google Drive file. The next successful Drive upload will replace the download URL with Google's current download link.

Clearing a manually entered URL also does not delete the Drive file or file ID.

## Deletion Semantics

Deleting a Drumery simfile does not delete its Google Drive ZIP in the first version.

Reasons:

- the user may still want the shared file;
- the locally connected Google account may not own the file;
- external storage deletion is materially different from current D1/R2 cleanup;
- accidental cloud deletion is more harmful than an orphaned external file.

A future explicit **Delete associated Drive file** workflow may be designed separately.

Disconnecting Google Drive likewise never deletes files or clears published links.

## Security Guardrails

- Use only the `drive.file` scope.
- Use PKCE and a random OAuth `state`.
- Bind loopback callbacks to `127.0.0.1`, not all interfaces.
- Accept callbacks only for the active authorization attempt and expected path.
- Store refresh tokens only in the OS credential store.
- Keep access tokens in Rust memory only.
- Never expose tokens or raw authorization artifacts through Tauri IPC.
- Never log tokens, authorization codes, resumable session URIs, or raw credential-store errors.
- Validate all selected folders through Drive before persistence.
- Reuse canonical workspace containment before ZIP creation.
- Do not call Drive permissions APIs.
- Do not silently broaden scopes after an authorization failure.
- Do not automatically create duplicate replacement files.
- Keep cloud metadata ownership enforcement in `dtx-api`.

## Testing Plan

### Rust unit and integration tests

Use an in-memory credential-store fake and mocked Google HTTP endpoints.

Cover:

- PKCE verifier and challenge generation;
- OAuth state validation;
- loopback callback cancellation and malformed callbacks;
- token exchange success and failure;
- refresh-token persistence;
- access-token caching and refresh;
- revoked refresh token behavior;
- credential-store failure without plaintext fallback;
- folder validation success, wrong MIME type, trashed folder, and permission loss;
- first upload through `files.create`;
- replacement through `files.update`;
- final `id` and `webContentLink` parsing;
- progress events and operation IDs;
- compliant chunk sizing;
- resumable status reconciliation after uncertain failure;
- bounded retry behavior;
- permanent not-found and permission error classification;
- explicit replacement-file creation;
- workspace traversal and symlink rejection;
- supported export-file filtering;
- temporary ZIP cleanup on success and every failure path;
- compensation deletion after new-file metadata-sync failure;
- no compensation deletion for existing-file updates;
- sanitized IPC errors containing no token or session URI.

### Renderer tests

Extend the existing settings-store, Settings, desktop-host, and SongDetails test suites.

Cover:

- migration from old settings containing only `exportDirectory`;
- per-Drumery-user folder isolation;
- connect, folder-change, cancellation, and disconnect states;
- logout hides but does not remove the user's local configuration;
- automatic upload starts after successful create/update;
- failed cloud save prevents a new Drive upload;
- Drive failure does not convert successful save/publish into failure;
- Drive success invokes only the dedicated Drive metadata mutation;
- existing Drive fields survive failure;
- manual re-upload changes no unrelated metadata;
- first manual upload creates a Drive file;
- existing manual upload replaces the file;
- explicit replacement is required after permanent file-access failure;
- duplicate concurrent uploads are prevented;
- stale progress events are ignored;
- manual URL edit warning appears for Drive-linked songs;
- reconnect-required and unavailable-folder actions are shown correctly.

### API tests

Cover:

- D1 migration with existing rows receiving `NULL`;
- create/update persistence of `google_drive_file_id`;
- owner query returns `googleDriveFileId`;
- public and non-owner query returns `null` for the ID;
- public published query still returns `downloadUrl`;
- dedicated metadata mutation updates both Drive fields together;
- blank or invalid values are rejected;
- unauthenticated and cross-user mutations are rejected;
- ownership is re-verified immediately before update;
- existing simfiles without Drive metadata remain compatible;
- generated GraphQL client mappings include the new field.

### Verification scope

Implementation planning should define targeted commands based on the changed files. Expected suites include:

- focused `dtx-desktop` renderer tests;
- focused Rust tests for the Google Drive module and ZIP refactor;
- focused `dtx-api` schema and service tests;
- package type checks;
- D1 migration validation;
- formatter and lint checks required by repository guidance.

Broad development servers and unrelated full-suite builds are outside the default verification scope unless implementation changes require them.

## Acceptance Criteria

The feature is complete when:

1. An authenticated Drumery user can connect Google Drive from DTX Desktop.
2. The refresh token is stored in the OS credential store and never appears in renderer storage or logs.
3. The user can select one default Drive folder for that Drumery user on the installation.
4. The UI explains that uploaded ZIPs inherit the folder's sharing policy.
5. Saving as draft automatically attempts ZIP upload after the simfile save succeeds.
6. Publishing automatically attempts ZIP upload after the simfile publish succeeds.
7. Save and publish remain successful when Drive is disconnected, unavailable, or fails.
8. The first successful Drive upload creates a ZIP in the configured folder and populates `googleDriveFileId` and `downloadUrl`.
9. Later uploads update the same Drive file and retain a stable download URL.
10. Linked songs provide a separate re-upload action that does not save unrelated metadata.
11. Failed replacement preserves the previous Drive file ID and URL.
12. A missing or inaccessible existing Drive file requires explicit replacement confirmation.
13. Changing the default folder does not move existing Drive files.
14. A second installation can replace an existing file after reconnecting an account that has edit access.
15. Public users can read the download URL but cannot read the Drive file ID.
16. Disconnect and Drumery deletion leave Drive files and existing links untouched.
17. ZIP contents match the existing manual export rules.
18. Temporary ZIP files are cleaned up on success and failure.
19. Progress and retry UI clearly distinguishes Drumery save success from Drive upload failure.
20. All targeted security, renderer, Rust, API, and migration tests pass.

## Out of Scope

- Server-side storage of Google OAuth refresh tokens.
- Proxying ZIP content through `dtx-api`.
- Syncing local Google authorization across computers.
- Per-song destination-folder overrides.
- Moving existing Drive files when the default folder changes.
- Per-file Drive sharing changes.
- Broad full-Drive scopes.
- Displaying the connected Google email address.
- Deleting Drive files when disconnecting or deleting a Drumery simfile.
- Automatic background synchronization of all songs.
- Uploading arbitrary user-selected ZIP files outside the active workspace song folder.
- Google Drive integration in the web application.

## Implementation Sequence Recommendation

The subsequent implementation plan should order work as follows:

1. D1 migration, server types, GraphQL field, and dedicated metadata mutation.
2. Desktop GraphQL mapping for `googleDriveFileId`.
3. ZIP helper extraction with regression tests.
4. Rust credential-store abstraction and OAuth flow.
5. Drive folder validation and resumable upload client.
6. Tauri commands and progress events.
7. Renderer settings/store components.
8. Automatic save/publish orchestration.
9. Manual re-upload and explicit replacement UX.
10. Failure handling, cleanup, and full targeted verification.

This order establishes cloud compatibility and reusable ZIP behavior before integrating OAuth and UI state.