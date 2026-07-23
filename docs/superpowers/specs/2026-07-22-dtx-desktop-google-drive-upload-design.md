# DTX Desktop Google Drive Upload Design

**Date:** 2026-07-22  
**Status:** Approved design; awaiting implementation planning

## Goal

Allow an authenticated DTX Desktop user to package a local song folder as a ZIP file, upload it directly to a user-selected Google Drive folder, and automatically populate the simfile download URL.

The feature supports both automatic upload after saving or publishing and a separate manual re-upload action. Re-uploading updates the same Drive object so the file identity and download URL remain stable.

Google Drive is a best-effort secondary operation. A Drive failure must never prevent the Drumery simfile from being saved or published, and it must never clear a previously working Drive file ID or download URL.

## Approved Product Decisions

- Google Drive authorization is local to each DTX Desktop installation.
- Refresh tokens are stored only in the operating system credential store.
- Access tokens remain in Rust memory and are never exposed to the renderer.
- Each authenticated Drumery user selects one default Drive folder per installation.
- Uploaded ZIPs inherit that folder's sharing policy.
- DTX Desktop does not create, change, or remove per-file sharing permissions.
- Drumery stores both public `downloadUrl` and stable `googleDriveFileId` metadata on each simfile.
- The first upload creates a file in the configured folder.
- Later uploads update the same file.
- Saving or publishing automatically attempts Drive upload.
- Linked songs also expose **Upload ZIP to Drive** or **Re-upload ZIP to Drive**.
- Drive failure does not block draft save or publishing.
- Failed replacement preserves the previous Drive file ID and URL.
- Changing the default folder affects newly created or explicitly replaced files only; existing files are not moved.
- Disconnecting Google Drive or deleting a Drumery simfile does not delete Drive files.

## Current Context

DTX Desktop is a Tauri application with a Svelte renderer and Rust command layer. The current song-details flow already provides cloud simfile create/update operations, a bound `downloadUrl`, local ZIP export, authenticated owner-only mutations, workspace-containment checks, and status UI for export and cloud operations.

The existing D1 `simfiles` table stores `download_url` but no stable external-file identifier. A Drive file ID is required to update the same Drive object after restart or from another authorized installation.

The desktop settings store currently persists `exportDirectory` in local storage. It can be extended with non-secret, per-Drumery-user folder metadata. OAuth credentials must not enter the settings store.

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
 │   ├─ installed-app OAuth with PKCE
 │   ├─ loopback callback listener
 │   ├─ OS credential-store access
 │   ├─ Drive REST client
 │   ├─ ZIP creation using existing export rules
 │   └─ direct resumable upload to Google Drive
 │
 └─ DTX API / D1
     ├─ downloadUrl
     └─ googleDriveFileId
```

ZIP content travels directly from DTX Desktop to Google Drive. It does not pass through `dtx-api`. The API owns only Drumery metadata and authorization checks; it never stores Google credentials.

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

Production, pre-production, and local development builds must use intentionally configured client IDs and callback behavior. CI must fail clearly when a release build enables Drive integration without a client ID. Tokens, authorization codes, and refresh tokens must never be placed in GitHub Actions variables, build artifacts, source files, or Tauri configuration.

## Data Ownership and Persistence

### Local secret data

Store the Google refresh token in the operating system credential store under a key scoped to the authenticated Drumery user.

```text
Service: com.hapadona.dtx-desktop.google-drive
Account: <drumery-user-id>
Secret: <google-refresh-token>
```

Use a maintained Rust credential-store abstraction backed by the platform's secure facility, such as macOS Keychain, Windows Credential Manager, and the supported Linux secret service where applicable.

The refresh token must never be stored in renderer local storage, workspace metadata, D1, application logs, plaintext configuration, Svelte state, or Tauri IPC responses.

Access tokens are cached only in Rust memory with their expiry time. Clear them on application exit, Drumery logout, Google disconnect, or terminal refresh failure.

### Local non-secret data

Store the selected folder per Drumery user in desktop settings:

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

The loader must migrate safely from old settings payloads. Missing or malformed Drive configuration becomes an empty map without changing `exportDirectory`.

Folder metadata is installation-local because it is paired with the Google account authorized on that installation. A second computer must connect Drive once before uploading, although cloud simfile metadata is already synchronized.

### Cloud simfile data

Add a nullable D1 column:

```sql
ALTER TABLE simfiles ADD COLUMN google_drive_file_id TEXT;
```

Expose it as `googleDriveFileId` in server and desktop models.

Visibility rules:

- `downloadUrl` remains publicly readable for published simfiles.
- `googleDriveFileId` is returned only to the authenticated owner.
- Anonymous users and non-owners receive `null` for `googleDriveFileId`.
- Only owner-authorized mutations may set or replace it.

## Google Authorization and Folder Selection

### OAuth flow

Use Google's installed-application authorization-code flow with:

- PKCE method `S256`;
- cryptographically random verifier, challenge, and `state`;
- temporary loopback redirect bound to `127.0.0.1` on a random available port;
- `access_type=offline`;
- explicit consent when a new refresh token is required;
- scope limited to `https://www.googleapis.com/auth/drive.file`.

Validate that the callback belongs to the active loopback listener, the state matches exactly, and the response contains either a valid authorization result or a sanitized cancellation/error. Persist no partial credential when token exchange fails.

The installed desktop client is a public OAuth client. Its client identifier may be bundled; no bundled client secret is considered confidential.

### Folder picker

Settings exposes **Connect Google Drive and Choose Folder**. The system browser opens the supported Google desktop Picker flow configured for folder selection. Validate the returned folder through the Drive API before persistence.

The selected item must:

- exist and be accessible to the connected account;
- have MIME type `application/vnd.google-apps.folder`;
- not be trashed;
- be capable of accepting child files.

The first release requests only `drive.file`, not broad Drive or profile scopes. The UI says **Google Drive connected** rather than claiming a Google email address it did not request permission to read.

The selected folder is the sharing boundary. New ZIP files use that folder ID in `parents` and inherit its sharing policy. DTX Desktop never calls Drive permissions APIs for individual ZIP files.

### Renderer-visible connection state

Rust exposes only sanitized state:

```ts
type GoogleDriveConnectionState = {
  connected: boolean;
  folder?: { id: string; name: string };
  requiresReconnect?: boolean;
};
```

Tokens, authorization codes, PKCE verifier, raw Google errors, and resumable-session URIs never reach the renderer.

### Token refresh

Before a Drive request, Rust reads the refresh token, reuses a valid in-memory access token, otherwise refreshes it, and refreshes shortly before expiry. Retry one request after a token-expiry authorization failure. Mark `requiresReconnect` when Google reports a revoked or invalid refresh token.

A credential-store failure is a Drive-connection error. Do not fall back to plaintext.

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
Uploads inherit this folder's sharing settings.
[Change Folder] [Disconnect]
```

### Change Folder

Launch the Picker again and replace the local setting only after successful validation. Cancellation leaves the current connection and folder unchanged.

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
5. leaves Drive files and cloud simfile Drive metadata unchanged.

When revocation cannot be confirmed, explain that the local credential was removed and the user may still revoke access in Google Account permissions.

## ZIP Creation

Reuse the current ZIP export implementation. Refactor it into reusable internal functions conceptually equivalent to:

```rust
collect_valid_song_files(song_path, workspace_root)
write_song_zip(output_path, files)
```

Manual export and Drive upload use the same supported extensions, top-level selection behavior, deterministic ordering, safe filename rules, canonical workspace containment, and symlink-safe paths.

Manual export continues writing to the configured export directory. Drive upload writes to a unique application temporary path.

Remove temporary archives after success, failure, cancellation, or unrecoverable metadata-sync failure. At startup, perform best-effort cleanup only within the application's own Drive-upload temporary namespace.

## Drive Upload Behavior

Use resumable uploads for creation and replacement. Upload chunks must comply with Drive requirements and report progress after each accepted chunk.

The Drive client supports resumable `files.create`, resumable `files.update`, session-status reconciliation after uncertain failures, continuation from the confirmed byte, final `id`/`webContentLink` retrieval, and stable error classification.

### First upload

When no `googleDriveFileId` exists:

1. require a connected account and valid destination folder;
2. build the temporary ZIP;
3. create it in the configured folder as `application/zip`;
4. request final fields including `id` and `webContentLink`;
5. patch the cloud simfile only after upload succeeds.

Derive the filename from the song title using existing safe filename rules and append `.zip`.

Where supported, pre-generate a Drive file ID to make uncertain create retries idempotent. Otherwise, treat the active resumable session URI as the idempotency boundary for that operation.

### Replacement

When `googleDriveFileId` exists:

1. build a fresh ZIP;
2. initiate resumable `files.update` for that ID;
3. replace content without changing identity;
4. retrieve final metadata;
5. patch the URL only after Drive success.

The file remains in its current Drive folder. The default folder is not applied and the app does not move it.

### Download URL

Store Drive's `webContentLink` as `downloadUrl` for ZIP files. Updating the same object preserves identity and normally preserves the public link; still write the returned link so Drumery reflects Drive's authoritative metadata.

### Missing or inaccessible file

On permanent not-found or permission failure:

- preserve the stored ID and URL;
- explain that the connected account cannot update the file;
- offer **Reconnect Google Drive**;
- offer **Create Replacement Drive File**.

Never create a replacement automatically. When the user explicitly chooses replacement, require a valid current folder, create a new file there, patch both fields only after success, and leave the old file untouched.

## Save and Publish Orchestration

Drive upload and Drumery save are independent outcomes.

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

This prevents a long upload from replaying stale title, BPM, publication, or form values.

The resolver requires authentication, re-verifies ownership immediately before update, updates both fields together, rejects blank IDs or blank/non-HTTP(S) URLs, and leaves existing values unchanged after validation or authorization failure.

### Drive success followed by patch failure

Retry the dedicated metadata patch once for a transient failure.

If it still fails:

- for a newly created Drive file, attempt best-effort deletion to avoid an untracked duplicate;
- for an update to an existing Drive file, never delete or roll back the file;
- show a metadata-sync warning;
- preserve current cloud fields until a later successful retry.

The current UI session may retain the sanitized upload result for retrying the mutation. It must not persist credentials or resumable-session data.

## Manual Re-upload

Linked songs expose a separate action beside **Export to ZIP**:

- **Upload ZIP to Drive** when no file ID exists;
- **Re-upload ZIP to Drive** when an ID exists;
- **Uploading to Drive… 42%** while active;
- **Create Replacement Drive File** after a permanent existing-file access error.

Manual re-upload does not save unrelated form data. It builds the ZIP, creates or updates the Drive file, patches only Drive metadata after success, and leaves the cloud simfile unchanged after failure.

The action remains available after automatic failure so the user can retry without saving or publishing again.

## Concurrency and Progress

Only one Drive upload may run for a song at a time. Give each operation a unique ID. Rust progress events include that operation ID and song/simfile identity; the renderer ignores stale or unrelated events.

Stages include:

- Preparing ZIP
- Connecting to Google Drive
- Uploading — percentage
- Finalizing
- Synchronizing download metadata
- Upload complete
- Upload failed; Drumery save succeeded

While automatic upload belongs to a save/publish orchestration, duplicate save/publish actions for that song remain disabled until orchestration ends. Unrelated navigation remains available. Closing Song Details must not corrupt the Rust task; the store may receive completion while the component is unmounted.

The first version does not require a user-facing cancel button. Internal abort and shutdown paths must still clean up temporary archives.

## Renderer Boundaries

Do not implement the Drive state machine directly inside the already-large `SongDetails.svelte`.

Add:

```text
src/renderer/src/services/googleDriveService.ts
src/renderer/src/stores/googleDriveStore.ts
src/renderer/src/components/GoogleDriveSettings.svelte
src/renderer/src/components/GoogleDriveUploadStatus.svelte
```

`googleDriveService.ts` coordinates Tauri commands, simfile save/update, Drive metadata patch, retry policy, and explicit replacement.

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

`googleDriveStore.ts` contains only non-secret state: connection/folder status, reconnect requirement, active progress, sanitized errors, and a recent successful upload awaiting metadata synchronization.

`GoogleDriveSettings.svelte` renders settings actions. `GoogleDriveUploadStatus.svelte` renders progress, success, retryable failure, permanent file-access failure, and replacement actions.

Extend `desktopHost.ts` with typed wrappers:

```ts
getGoogleDriveConnectionState(drumeryUserId)
connectGoogleDriveAndChooseFolder(drumeryUserId)
changeGoogleDriveFolder(drumeryUserId)
disconnectGoogleDrive(drumeryUserId)
uploadSongZipToGoogleDrive(params)
```

Expose no generic token or arbitrary HTTP command.

## Rust Boundaries

Add:

```text
src-tauri/src/google_drive/
├── mod.rs
├── commands.rs
├── oauth.rs
├── credential_store.rs
├── drive_client.rs
└── upload.rs
```

- `commands.rs`: narrow Tauri commands, parameter validation, local user namespace, and sanitized error mapping.
- `oauth.rs`: PKCE, authorization URL, loopback callback, state validation, exchange, refresh, and revocation.
- `credential_store.rs`: small trait; production OS store and in-memory test fake.
- `drive_client.rs`: folder validation, create/update, compensation delete, resumable session/status, final metadata, and error classification.
- `upload.rs`: temporary ZIP, chunk streaming, progress, retry/resume, cleanup, and operation state machine.

Register the commands in the centralized Tauri invoke handler.

Representative input:

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

Rust must canonically verify `songPath` is inside `workspaceRoot` before reading files. The renderer-provided Drumery user ID is only a credential/settings namespace; cloud metadata authorization remains independently enforced by the authenticated API mutation.

## DTX API and GraphQL

Update D1 migrations, Drizzle schema, database types and mappings, the `Simfile` object, create/update inputs for compatibility, the dedicated mutation, desktop GraphQL fragments/Rust mappings, and generated web types.

General owner create/update inputs may accept `googleDriveFileId` for compatibility, but desktop uploads use the dedicated mutation after success.

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

### Upload

Retry temporary network/session errors with bounded exponential backoff and status reconciliation. Stop on permanent quota, authorization, validation, permission, or unsupported-response errors and return a sanitized code.

Never log or return raw Google bodies, tokens, authorization codes, resumable-session URIs, or credential-store internals.

### Existing link preservation

No failed Drive operation writes null, blank, or replacement values to cloud Drive fields. The previous URL remains usable until upload and metadata patch both succeed.

## Manual Download URL Editing

Keep `downloadUrl` editable. Editing it does not clear `googleDriveFileId`. For a Drive-linked song, warn:

> This song is linked to a Google Drive file. The next successful Drive upload will replace the download URL with Google's current download link.

Clearing the URL does not delete the Drive file or ID.

## Deletion Semantics

Deleting a Drumery simfile does not delete its Drive ZIP in the first release. The user may still want the shared file, the local Google account may not own it, and accidental external deletion is more harmful than an orphan.

A future explicit **Delete associated Drive file** flow is separate scope. Disconnecting also leaves files and links untouched.

## Security Guardrails

- Use only `drive.file`.
- Use PKCE and random OAuth state.
- Bind callbacks to `127.0.0.1`, not all interfaces.
- Accept only the active attempt and expected path.
- Store refresh tokens only in the OS credential store.
- Keep access tokens in Rust memory only.
- Never expose tokens or raw authorization artifacts over IPC.
- Never log tokens, codes, session URIs, or raw credential errors.
- Validate selected folders before persistence.
- Reuse canonical workspace containment.
- Never call per-file permissions APIs.
- Never silently broaden scopes.
- Never automatically create replacement duplicates.
- Keep cloud ownership enforcement in `dtx-api`.

## Testing Plan

### Rust

Use an in-memory credential-store fake and mocked Google endpoints. Cover PKCE/state, callback cancellation/malformed data, token exchange/refresh/revocation, credential-store failure, folder validation, create/update, final metadata parsing, progress IDs, compliant chunks, resumable reconciliation, bounded retry, permanent error classification, explicit replacement, path/symlink rejection, export filtering, temporary cleanup, compensation deletion for new files only, and sanitized IPC/logging.

### Renderer

Extend existing settings-store, Settings, desktop-host, and SongDetails tests. Cover old-settings migration, per-user isolation, connect/change/cancel/disconnect, logout persistence, automatic upload only after save success, publish success despite Drive failure, dedicated metadata patch, preservation of old fields, manual re-upload isolation, explicit replacement, concurrency prevention, stale-event rejection, manual-URL warning, and reconnect/folder-unavailable actions.

### API

Cover migration compatibility, create/update persistence, owner-only ID visibility, public URL visibility, dedicated atomic Drive metadata mutation, blank/invalid input rejection, unauthenticated/cross-user rejection, immediate ownership re-check, null compatibility, and generated-client mappings.

### Verification scope

The implementation plan must list targeted renderer, Rust, API, migration, type-check, formatting, and lint commands. Do not run broad development servers or unrelated full builds unless the implementation requires them.

## Acceptance Criteria

1. An authenticated user can connect Drive locally and select one default folder.
2. Refresh tokens remain in the OS credential store and never appear in renderer storage or logs.
3. The UI explains that ZIPs inherit folder sharing.
4. Draft save and publishing automatically attempt Drive upload after the Drumery save succeeds.
5. Draft save and publishing remain successful when Drive fails or is unavailable.
6. First upload creates a ZIP in the configured folder and populates both cloud fields.
7. Later upload updates the same file and retains a stable URL.
8. Linked songs have a separate re-upload action that saves no unrelated metadata.
9. Failed replacement preserves the previous ID and URL.
10. Missing/inaccessible existing files require explicit replacement.
11. Changing the default folder does not move existing files.
12. Another installation can replace a file after locally authorizing an account with edit access.
13. Public users can read `downloadUrl` but not `googleDriveFileId`.
14. Disconnect and simfile deletion leave Drive files and links untouched.
15. ZIP contents match manual export rules and temporary files are cleaned up.
16. Progress and warnings distinguish Drumery save success from Drive failure.
17. Targeted security, renderer, Rust, API, migration, and configuration tests pass.

## Out of Scope

- Server-side Google token storage.
- Proxying ZIPs through `dtx-api`.
- Syncing Google authorization across computers.
- Per-song folder overrides.
- Moving existing files on folder change.
- Per-file sharing changes.
- Broad Drive scopes or displaying Google email.
- Deleting Drive files on disconnect or simfile deletion.
- Automatic background synchronization of all songs.
- Uploading arbitrary ZIPs outside the active workspace song folder.
- Google Drive integration in the web application.

## Implementation Sequence Recommendation

1. Google Cloud/CI configuration validation.
2. D1 migration, server types, owner-visible field, and dedicated metadata mutation.
3. Desktop GraphQL mapping.
4. ZIP helper extraction with regression tests.
5. Credential-store abstraction and OAuth flow.
6. Folder validation and resumable Drive client.
7. Tauri commands and progress events.
8. Renderer settings/store components.
9. Automatic save/publish orchestration.
10. Manual re-upload and replacement UX.
11. Failure handling, cleanup, and targeted verification.

This order establishes configuration, cloud compatibility, and reusable ZIP behavior before OAuth and UI integration.