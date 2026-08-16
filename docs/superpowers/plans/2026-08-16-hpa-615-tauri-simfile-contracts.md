# HPA-615 Tauri Simfile Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rust authoritative for the five selected desktop simfile IPC contracts, generate their production TypeScript mirrors, and remove handwritten renderer copies without changing runtime behavior.

**Architecture:** Keep GraphQL transport dynamic at the HTTP edge, but type the existing HPA-614 normalization seam and Tauri command boundary. `native_simfile_from_graphql` keeps parsing GraphQL string IDs through `number_id` and must serialize exactly to the existing `simfile_model.json` fixture; `NativeSimfile` is outbound-only and preserves null keys, while partial update fields use omission semantics. List/get/create/update reuse one desktop full-simfile fragment, and the existing `ts-rs`, GraphQL Codegen, and CI generation paths are extended rather than replaced.

**Tech Stack:** Rust 1.95, Tauri 2, serde/serde_json, ts-rs 12, TypeScript/Svelte 5, Vitest, GraphQL Code Generator, Bun 1.3.9, GitHub Actions.

## Global Constraints

- Scope is exactly `fetch_user_simfiles`, `fetch_cloud_song`, `create_simfile_record`, `update_simfile_record`, and `get_next_display_id`.
- Keep `@dtx/common` `SimfileModel` as the application model; generated native contracts stay desktop-owned.
- Do not add Specta, protobuf, Zod, JSON Schema, a new RPC framework, a generic DTO registry, or a Rust GraphQL client generator.
- Do not extract `api.rs` or `SongDetails`; HPA-616 owns those refactors.
- `get_next_display_id` stays Rust `i64` → TypeScript `number` with no wrapper object.
- `NativeSimfile` / `NativeSimfileDtxFile` are outbound types: derive `Serialize + TS`, not `Deserialize`.
- `NativeSimfile` nullable fields serialize as present JSON `null` and generate required `T | null` properties; never put `skip_serializing_if` or `#[ts(optional)]` on those fields.
- `UpdateSimfileRecordInput` absent fields serialize by omission with `skip_serializing_if = "Option::is_none"` and generate optional TypeScript properties.
- Create `displayId: None` is a real null value and must remain a present key.
- Keep `number_id` for GraphQL `ID!` normalization; do not deserialize a full GraphQL simfile directly into `NativeSimfile`.
- Reuse `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json` unchanged as the full-wire oracle.
- Nested DTX ids are required on the desktop full-simfile wire; missing/null/invalid ids fail conversion.
- Map migrated 64-bit Rust ids/display ids explicitly to TypeScript `number`/`number | null`, not `bigint`.
- List/get/create/update share one desktop full-simfile fragment.
- Keep E2E-only generated types in `packages/e2e-desktop/support/generated/native-types.ts`; do not generate a duplicate `NativeSimfile` there.
- The implementation PR must leave draft state and be marked ready before merge so Tauri Rust CI, lint/format, and desktop E2E draft-skipping jobs run.

---

## File Map

### New files

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs` — outbound native simfile/result types, inbound create/update request types, production `ts-rs` export target.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/simfile-full.graphql` — one shared desktop full-simfile fragment.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/list-simfiles.graphql` — list operation using the shared fragment.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/get-simfile.graphql` — single-simfile operation using the shared fragment.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/create-simfile.graphql` — create mutation using the shared fragment.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/update-simfile.graphql` — update mutation using the shared fragment.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/next-display-id.graphql` — primitive next-display-id query.
- `packages/dtx-web/codegen.desktop.ts` — validation-only GraphQL Codegen config for desktop documents.
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` — committed generated output; never hand edit.

### Modified production files

- `packages/dtx-desktop/src-tauri/src/lib.rs` — register `api_contracts`.
- `packages/dtx-desktop/src-tauri/src/api.rs` — typed mapper/selected commands, `include_str!` documents, embedded asset query spread rename.
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` — concrete selected command signatures.
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts` — consume generated fetch result; delete local duplicate.
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte` — typed create/update/fetch calls; delete local result shapes/runtime guard.
- `packages/dtx-desktop/src/renderer/src/components/Scores.svelte` — use concrete `fetchCloudSong` result without generic call syntax.
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts` — delete handwritten full-simfile fetch envelope.
- `packages/dtx-web/package.json` — run desktop document validation from existing `lint:codegen`.
- `.github/workflows/tauri-rust-ci.yml` — verify production generated bindings are tracked and clean.

### Modified tests

- `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs` — fixture equality, missing DTX id, TS nullability declaration, update omission, create null, shared list fragment, typed envelopes.
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts` — concrete command payload expectations.
- `packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts` — generated fetch envelope behavior.
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts` — typed create/update/fetch behavior.

### Reused unchanged

- `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json` — canonical HPA-614 runtime wire JSON.
- `packages/e2e-desktop/support/generated/native-types.ts` ownership — keep existing E2E/general-native exports only; do not add production simfile contracts.

---

### Task 1: Type the Existing HPA-614 Simfile Mapper

**Files:**
- Create: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Reuse unchanged: `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

**Interfaces:**
- Consumes: existing `number_id(&Value) -> Result<i64>` and HPA-614 `simfile_model_from_graphql` behavior.
- Produces: `NativeSimfileDtxFile`, `NativeSimfile`, and `native_simfile_from_graphql(&Value) -> Result<NativeSimfile>`.

- [ ] **Step 1: Change the existing fixture test to require typed serialization and add failure/type-declaration coverage**

At the top of `api_tests.rs`, add the trait import needed for `TS::decl()`:

```rust
use ts_rs::TS;
```

Keep the existing GraphQL fixture with string ids, but serialize the typed result before comparison:

```rust
#[test]
fn native_simfile_from_graphql_matches_renderer_fixture() {
    let expected: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/simfile_model.json"))
            .expect("fixture parses");
    let graphql_value = json!({
        "id": "42",
        "displayId": 7,
        "title": "Fixture Song",
        "artist": "Fixture Artist",
        "bpm": 123.5,
        "userId": "user-1",
        "googleDriveFileId": null,
        "isPublished": true,
        "downloadUrl": "https://example.test/chart.zip",
        "previewUrl": null,
        "videoPreviewUrl": null,
        "publishDate": "2026-08-15",
        "createdAt": "2026-08-15T00:00:00Z",
        "updatedAt": "2026-08-15T00:00:01Z",
        "dtxFiles": [{ "id": "99", "label": "EXT", "level": 85.0 }]
    });

    let native = native_simfile_from_graphql(&graphql_value).expect("mapped");
    let actual = serde_json::to_value(native).expect("serializes");

    assert_eq!(actual, expected);
}

#[test]
fn native_simfile_from_graphql_rejects_missing_dtx_id() {
    let graphql_value = json!({
        "id": "42",
        "displayId": null,
        "title": "Fixture Song",
        "artist": "Fixture Artist",
        "bpm": 123.5,
        "userId": null,
        "googleDriveFileId": null,
        "isPublished": false,
        "downloadUrl": null,
        "previewUrl": null,
        "videoPreviewUrl": null,
        "publishDate": "2026-08-15",
        "createdAt": "2026-08-15T00:00:00Z",
        "updatedAt": "2026-08-15T00:00:01Z",
        "dtxFiles": [{ "id": null, "label": "EXT", "level": 85.0 }]
    });

    assert!(native_simfile_from_graphql(&graphql_value).is_err());
}

#[test]
fn native_simfile_typescript_keeps_nullable_fields_required() {
    let decl = NativeSimfile::decl();
    assert!(decl.contains("displayId: number | null"));
    assert!(decl.contains("googleDriveFileId: string | null"));
    assert!(!decl.contains("displayId?:"));
    assert!(!decl.contains("googleDriveFileId?:"));
}
```

- [ ] **Step 2: Run the focused tests and verify they fail before the type exists**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_from_graphql
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_typescript_keeps_nullable_fields_required
```

Expected: FAIL because `NativeSimfile` / `native_simfile_from_graphql` are not defined yet.

- [ ] **Step 3: Add outbound Rust wire types with null-preserving semantics**

Create `api_contracts.rs`:

```rust
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct NativeSimfileDtxFile {
    #[ts(type = "number")]
    pub id: i64,
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts"
)]
pub struct NativeSimfile {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number | null")]
    pub display_id: Option<i64>,
    pub title: String,
    pub artist: String,
    pub bpm: f64,
    pub user_id: Option<String>,
    pub google_drive_file_id: Option<String>,
    pub is_published: bool,
    pub download_url: Option<String>,
    pub preview_url: Option<String>,
    pub video_preview_url: Option<String>,
    pub publish_date: String,
    pub created_at: String,
    pub updated_at: String,
    pub dtx_files: Vec<NativeSimfileDtxFile>,
}
```

Do not derive `Deserialize` and do not add `skip_serializing_if` / `#[ts(optional)]` to full-model nullable fields.

Register the module in `lib.rs`:

```rust
mod api_contracts;
```

- [ ] **Step 4: Convert the mapper by constructing `NativeSimfile` explicitly and preserving `number_id`**

In `api.rs`, replace `simfile_model_from_graphql` with `native_simfile_from_graphql`. Keep field extraction local and explicit; never call `serde_json::from_value::<NativeSimfile>`.

Small scalar helpers are fine where they only remove repeated error boilerplate:

```rust
fn required_string(value: &Value, field: &str) -> Result<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| DesktopError::Message(format!("Invalid {field} in simfile response")))
}

fn nullable_string(value: &Value, field: &str) -> Result<Option<String>> {
    match value.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(DesktopError::Message(format!(
            "Invalid {field} in simfile response"
        ))),
    }
}
```

Construct ids through `number_id`:

```rust
pub fn native_simfile_from_graphql(simfile: &Value) -> Result<NativeSimfile> {
    let dtx_files = simfile
        .get("dtxFiles")
        .and_then(Value::as_array)
        .ok_or_else(|| DesktopError::Message("Invalid dtxFiles in simfile response".to_string()))?
        .iter()
        .map(|file| {
            Ok(NativeSimfileDtxFile {
                id: number_id(&file["id"])?,
                label: required_string(file, "label")?,
                level: file
                    .get("level")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| {
                        DesktopError::Message("Invalid level in simfile response".to_string())
                    })?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(NativeSimfile {
        id: number_id(&simfile["id"])?,
        display_id: match simfile.get("displayId") {
            Some(Value::Null) => None,
            Some(value) => Some(number_id(value)?),
            None => return Err(DesktopError::Message("Missing displayId".to_string())),
        },
        title: required_string(simfile, "title")?,
        artist: required_string(simfile, "artist")?,
        bpm: simfile["bpm"]
            .as_f64()
            .ok_or_else(|| DesktopError::Message("Invalid bpm".to_string()))?,
        user_id: nullable_string(simfile, "userId")?,
        google_drive_file_id: nullable_string(simfile, "googleDriveFileId")?,
        is_published: simfile["isPublished"]
            .as_bool()
            .ok_or_else(|| DesktopError::Message("Invalid isPublished".to_string()))?,
        download_url: nullable_string(simfile, "downloadUrl")?,
        preview_url: nullable_string(simfile, "previewUrl")?,
        video_preview_url: nullable_string(simfile, "videoPreviewUrl")?,
        publish_date: required_string(simfile, "publishDate")?,
        created_at: required_string(simfile, "createdAt")?,
        updated_at: required_string(simfile, "updatedAt")?,
        dtx_files,
    })
}
```

- [ ] **Step 5: Run focused Rust tests and format check**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_from_graphql
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_typescript_keeps_nullable_fields_required
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
```

Expected: PASS. Fixture equality proves null keys and numeric ids match HPA-614 exactly.

- [ ] **Step 6: Commit the typed mapper seam**

```bash
git add \
  packages/dtx-desktop/src-tauri/src/api_contracts.rs \
  packages/dtx-desktop/src-tauri/src/lib.rs \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor: type desktop simfile wire model"
```

---

### Task 2: Type the Four Structured Command Inputs and Result Envelopes

**Files:**
- Modify: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

**Interfaces:**
- Consumes: `NativeSimfile` and `native_simfile_from_graphql` from Task 1.
- Produces: generated create/update request types, generated result envelopes, concrete Rust command signatures.

- [ ] **Step 1: Add failing tests for update omission and create-null semantics**

Update the existing wiremock update test to construct the typed request:

```rust
let input = UpdateSimfileRecordInput {
    title: Some("Updated".to_string()),
    ..Default::default()
};

let result = update_simfile_record_impl(
    &server.uri(),
    "token-1",
    "42".to_string(),
    input,
)
.await
.expect("result");
```

Keep the outgoing variables exact:

```rust
.and(body_partial_json(json!({
    "variables": {
        "id": "42",
        "input": { "title": "Updated" }
    }
})))
```

Add direct serialization tests:

```rust
#[test]
fn update_simfile_input_omits_absent_fields() {
    let input = UpdateSimfileRecordInput {
        title: Some("Updated".to_string()),
        ..Default::default()
    };

    assert_eq!(
        serde_json::to_value(input).expect("serializes"),
        json!({ "title": "Updated" })
    );
}

#[test]
fn create_simfile_input_preserves_null_display_id() {
    let input = create_input_fixture_with_display_id(None);
    let value = serde_json::to_value(input).expect("serializes");
    assert!(value.get("displayId").is_some());
    assert!(value["displayId"].is_null());
}
```

- [ ] **Step 2: Run the new tests and verify they fail before the types exist**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml update_simfile_input_omits_absent_fields
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml create_simfile_input_preserves_null_display_id
```

Expected: FAIL because typed inputs are not defined yet.

- [ ] **Step 3: Add the minimum request and result types**

Request structs are inbound Tauri data and also serialize into GraphQL variables, so derive `Deserialize + Serialize + TS`.

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct CreateSimfileLevelInput {
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct CreateSimfileRecordInput {
    pub title: String,
    pub artist: String,
    pub bpm: f64,
    #[ts(type = "number | null")]
    pub display_id: Option<i64>,
    pub is_published: bool,
    pub publish_date: String,
    pub download_url: String,
    pub video_preview_url: String,
    pub levels: Vec<CreateSimfileLevelInput>,
    pub song_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct UpdateSimfileRecordInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub display_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_published: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub publish_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub video_preview_url: Option<String>,
}
```

`google_drive_file_id` is intentionally absent.

Result structs are outbound, so derive `Serialize + TS` only. Add:

- `FetchUserSimfilesResult`
- `FetchCloudSongResult`
- `CreateSimfileRecordResult`
- `UpdateSimfileRecordResult`

Use `#[serde(rename_all = "camelCase")]`. Use `skip_serializing_if` / `#[ts(optional)]` only on result fields actually omitted in the opposite branch (`error`, `warnings`, success-only data/id fields as needed). Nested `NativeSimfile` remains null-preserving.

- [ ] **Step 4: Convert the selected Rust implementations and command signatures**

Target signatures:

```rust
pub(crate) async fn fetch_user_simfiles_impl(
    base_url: &str,
    token: &str,
) -> Result<FetchUserSimfilesResult>

#[tauri::command]
pub async fn fetch_user_simfiles(app: AppHandle) -> Result<FetchUserSimfilesResult>

pub(crate) async fn fetch_cloud_song_impl(
    base_url: &str,
    token: &str,
    cloud_song_id: String,
) -> Result<FetchCloudSongResult>

#[tauri::command]
pub async fn fetch_cloud_song(
    app: AppHandle,
    cloud_song_id: String,
) -> Result<FetchCloudSongResult>

pub(crate) async fn create_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_data: CreateSimfileRecordInput,
    workspace_root: &Path,
) -> Result<CreateSimfileRecordResult>

pub(crate) async fn update_simfile_record_impl(
    base_url: &str,
    token: &str,
    simfile_id: String,
    update_data: UpdateSimfileRecordInput,
) -> Result<UpdateSimfileRecordResult>
```

Keep `get_next_display_id` unchanged.

Map create request fields into GraphQL input while leaving `songPath` command-local:

```rust
fn create_input_from_renderer(input: &CreateSimfileRecordInput) -> Value {
    json!({
        "title": input.title,
        "artist": input.artist,
        "bpm": input.bpm,
        "displayId": input.display_id,
        "isPublished": input.is_published,
        "publishDate": input.publish_date,
        "downloadUrl": input.download_url,
        "videoPreviewUrl": input.video_preview_url,
        "dtxFiles": input.levels,
    })
}
```

Serialize update request directly; no Drive-field filtering remains:

```rust
let input = serde_json::to_value(&update_data)
    .map_err(|error| DesktopError::Message(error.to_string()))?;
```

Every full GraphQL simfile result goes through `native_simfile_from_graphql`.

- [ ] **Step 5: Run focused Rust API tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml update_simfile
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml create_simfile
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml fetch_user_simfiles
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml fetch_cloud_song
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
```

Expected: PASS, including exact wiremock GraphQL-variable assertions.

- [ ] **Step 6: Commit the typed Tauri command contracts**

```bash
git add \
  packages/dtx-desktop/src-tauri/src/api_contracts.rs \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor: type simfile tauri commands"
```

---

### Task 3: Move Selected GraphQL Documents to Files and Reuse One Fragment

**Files:**
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/simfile-full.graphql`
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/list-simfiles.graphql`
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/get-simfile.graphql`
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/create-simfile.graphql`
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/update-simfile.graphql`
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/next-display-id.graphql`
- Create: `packages/dtx-web/codegen.desktop.ts`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-web/package.json`

**Interfaces:**
- Consumes: existing `graphql_document(fragment + operation)` request pattern.
- Produces: schema-validated desktop docs where list/get/create/update share `DesktopSimfileFull`.

- [ ] **Step 1: Replace the stale anti-fragment test with shared-fragment expectations**

```rust
#[test]
fn list_simfiles_query_reuses_full_simfile_fragment() {
    assert!(LIST_SIMFILES_QUERY.contains("...DesktopSimfileFull"));

    let document = graphql_document(LIST_SIMFILES_QUERY);
    assert!(document.contains("fragment DesktopSimfileFull on Simfile"));
    assert!(document.contains("googleDriveFileId"));
    assert!(document.contains("createdAt"));
    assert!(document.contains("updatedAt"));
    assert!(document.contains("dtxFiles"));
}
```

Delete the old assertion that list must not contain a full-fragment spread.

Add an assertion for the still-embedded asset operation:

```rust
#[test]
fn asset_file_query_uses_moved_full_simfile_fragment_name() {
    assert!(GET_SIMFILE_WITH_FILES_QUERY.contains("...DesktopSimfileFull"));
}
```

- [ ] **Step 2: Run both tests and verify they fail before document migration**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml list_simfiles_query_reuses_full_simfile_fragment
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml asset_file_query_uses_moved_full_simfile_fragment_name
```

Expected: FAIL because current list duplicates fields and the embedded asset query still spreads `SimfileFull`.

- [ ] **Step 3: Create the shared fragment and selected operation files**

`simfile-full.graphql`:

```graphql
fragment DesktopSimfileFull on Simfile {
  id
  displayId
  title
  artist
  bpm
  userId
  googleDriveFileId
  isPublished
  downloadUrl
  previewUrl
  videoPreviewUrl
  publishDate
  createdAt
  updatedAt
  dtxFiles {
    id
    level
    label
  }
}
```

`list-simfiles.graphql`:

```graphql
query DesktopListSimfiles(
  $scope: SimfileScope!
  $search: String
  $page: Int
  $pageSize: Int
) {
  simfiles(scope: $scope, search: $search, page: $page, pageSize: $pageSize) {
    count
    data {
      ...DesktopSimfileFull
    }
  }
}
```

`get-simfile.graphql`:

```graphql
query DesktopGetSimfile($id: ID!) {
  simfile(id: $id) {
    ...DesktopSimfileFull
  }
}
```

`create-simfile.graphql`:

```graphql
mutation DesktopCreateSimfile($input: CreateSimfileInput!) {
  createSimfile(input: $input) {
    ...DesktopSimfileFull
  }
}
```

`update-simfile.graphql`:

```graphql
mutation DesktopUpdateSimfile($id: ID!, $input: UpdateSimfileInput!) {
  updateSimfile(id: $id, input: $input) {
    ...DesktopSimfileFull
  }
}
```

`next-display-id.graphql`:

```graphql
query DesktopNextDisplayId {
  nextDisplayId
}
```

- [ ] **Step 4: Load documents with `include_str!`, use fragment composition, and update the embedded asset spread**

In `api.rs`:

```rust
const SIMFILE_FULL_FRAGMENT: &str =
    include_str!("../graphql/simfiles/simfile-full.graphql");
const LIST_SIMFILES_QUERY: &str =
    include_str!("../graphql/simfiles/list-simfiles.graphql");
const GET_SIMFILE_QUERY: &str =
    include_str!("../graphql/simfiles/get-simfile.graphql");
const CREATE_SIMFILE_MUTATION: &str =
    include_str!("../graphql/simfiles/create-simfile.graphql");
const UPDATE_SIMFILE_MUTATION: &str =
    include_str!("../graphql/simfiles/update-simfile.graphql");
const NEXT_DISPLAY_ID_QUERY: &str =
    include_str!("../graphql/simfiles/next-display-id.graphql");
```

Use `graphql_document(...)` for list/get/create/update. Keep next-display-id standalone.

Leave `GET_SIMFILE_WITH_FILES_QUERY` embedded, but change only its spread name:

```graphql
query GetSimfileWithFiles($id: ID!) {
  simfile(id: $id) {
    ...DesktopSimfileFull
    files {
      key
      size
      uploaded
    }
  }
}
```

Do not move or otherwise refactor asset loading.

- [ ] **Step 5: Add validation-only desktop Codegen using the existing web dependency**

Create `packages/dtx-web/codegen.desktop.ts`:

```ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../dtx-api/dist/schema.graphql',
  documents: ['../dtx-desktop/src-tauri/graphql/**/*.graphql'],
  generates: {
    '.svelte-kit/dtx-desktop-graphql-validation.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        skipTypename: true,
        useTypeImports: true,
        scalars: { ID: 'string' }
      }
    }
  }
};

export default config;
```

Extend `packages/dtx-web/package.json`:

```json
"lint:codegen:desktop": "graphql-codegen --config codegen.desktop.ts",
"lint:codegen": "bun run codegen && git ls-files --error-unmatch -- src/lib/api/generated/graphql.ts && git diff --exit-code -- src/lib/api/generated/ && bun run lint:codegen:desktop"
```

- [ ] **Step 6: Run Rust document tests and GraphQL validation**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml list_simfiles_query_reuses_full_simfile_fragment
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml asset_file_query_uses_moved_full_simfile_fragment_name
bun run --filter=dtx-web lint:codegen
```

Expected: PASS.

- [ ] **Step 7: Commit the document migration**

```bash
git add \
  packages/dtx-desktop/src-tauri/graphql/simfiles \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs \
  packages/dtx-web/codegen.desktop.ts \
  packages/dtx-web/package.json
git commit -m "refactor: validate desktop simfile graphql"
```

---

### Task 4: Generate Production TypeScript Contracts and Verify Drift in CI

**Files:**
- Generated: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- Modify: `.github/workflows/tauri-rust-ci.yml`

**Interfaces:**
- Consumes: all `#[derive(TS)]` types from Tasks 1–2.
- Produces: one committed production TypeScript contract file consumed by `desktopHost` in Task 5.

- [ ] **Step 1: Generate bindings with the existing root command**

```bash
bun run gen:native-types
```

Expected: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` is created by the same autogenerated `ts-rs` export-test mechanism already used for E2E native types.

- [ ] **Step 2: Inspect the generated null/optional/number shapes**

The generated file must contain the semantic equivalents of:

```ts
export type NativeSimfile = {
  id: number;
  displayId: number | null;
  userId: string | null;
  googleDriveFileId: string | null;
  downloadUrl: string | null;
  previewUrl: string | null;
  videoPreviewUrl: string | null;
  dtxFiles: Array<NativeSimfileDtxFile>;
  // remaining full-model fields are required
};

export type UpdateSimfileRecordInput = {
  title?: string;
  artist?: string;
  bpm?: number;
  displayId?: number;
  isPublished?: boolean;
  publishDate?: string;
  downloadUrl?: string;
  videoPreviewUrl?: string;
};
```

Reject generated `displayId?:`/`googleDriveFileId?:` on `NativeSimfile` or any migrated `bigint` id.

- [ ] **Step 3: Extend the existing Tauri CI generated-type drift step**

```yaml
- name: Verify generated TypeScript types are in sync
  working-directory: ${{ github.workspace }}
  run: |
    git ls-files --error-unmatch -- packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts
    git ls-files --error-unmatch -- packages/e2e-desktop/support/generated/native-types.ts
    git diff --exit-code -- \
      packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
      packages/e2e-desktop/support/generated/native-types.ts
```

Do not add another generation workflow or binary.

- [ ] **Step 4: Re-run generation and the contract-focused Rust tests**

```bash
bun run gen:native-types
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile
```

Expected: PASS and no generated-content changes after the first checked-in generation.

- [ ] **Step 5: Commit generated bindings and CI verification**

```bash
git add \
  packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
  .github/workflows/tauri-rust-ci.yml
git commit -m "ci: verify desktop native contracts"
```

---

### Task 5: Make `desktopHost` Concrete and Delete Renderer Contract Copies

**Files:**
- Modify: `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- Test: `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- Test: `packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts`
- Test: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`

**Interfaces:**
- Consumes: generated `FetchUserSimfilesResult`, `FetchCloudSongResult`, `CreateSimfileRecordInput/Result`, `UpdateSimfileRecordInput/Result` from Task 4.
- Produces: non-generic selected `desktopHost` methods and no duplicate migrated renderer IPC contracts.

- [ ] **Step 1: Update desktopHost tests first for concrete call forms**

```ts
await desktopHost.fetchCloudSong('42');
expect(runtime.invoke).toHaveBeenCalledWith('fetch_cloud_song', { cloudSongId: '42' });

await desktopHost.updateSimfileRecord('42', { title: 'Updated' });
expect(runtime.invoke).toHaveBeenCalledWith('update_simfile_record', {
  simfileId: '42',
  updateData: { title: 'Updated' }
});
```

Keep `getNextDisplayId()` primitive.

- [ ] **Step 2: Run the host test before implementation changes**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts
```

Expected: FAIL for the new string-only fetch/update forms.

- [ ] **Step 3: Import generated contracts and make only selected methods concrete**

```ts
import type {
  CreateSimfileRecordInput,
  CreateSimfileRecordResult,
  FetchCloudSongResult,
  FetchUserSimfilesResult,
  UpdateSimfileRecordInput,
  UpdateSimfileRecordResult
} from '$lib/lib/generated/native-api-contracts';
```

```ts
fetchUserSimfiles: async (): Promise<FetchUserSimfilesResult> =>
  await invokeHost<FetchUserSimfilesResult>('fetch_user_simfiles'),

fetchCloudSong: async (cloudSongId: string): Promise<FetchCloudSongResult> =>
  await invokeHost<FetchCloudSongResult>('fetch_cloud_song', { cloudSongId }),

createSimfileRecord: async (
  simfileData: CreateSimfileRecordInput
): Promise<CreateSimfileRecordResult> =>
  await invokeHost<CreateSimfileRecordResult>('create_simfile_record', { simfileData }),

updateSimfileRecord: async (
  simfileId: string,
  updateData: UpdateSimfileRecordInput
): Promise<UpdateSimfileRecordResult> =>
  await invokeHost<UpdateSimfileRecordResult>('update_simfile_record', {
    simfileId,
    updateData
  }),
```

Keep `DesktopHostRuntime.invoke<T>()` and private `invokeHost<T>()` generic. Untouched commands stay unchanged.

- [ ] **Step 4: Remove the local fetch envelope from `simFileService`**

Delete `MainProcessSimFileResult` and call:

```ts
const result = await desktopHost.fetchUserSimfiles();
```

Keep public `SimFileServiceResult` as application-facing `SimfileModel[]`.

- [ ] **Step 5: Replace SongDetails handwritten request/result types with generated types**

Delete:

- `CreateSimfileResult`
- `UpdateSimfileResult`
- `isSimfileModel`

Import request types:

```ts
import type {
  CreateSimfileRecordInput,
  UpdateSimfileRecordInput
} from '$lib/lib/generated/native-api-contracts';
```

Build a concrete create request:

```ts
const simfileData: CreateSimfileRecordInput = {
  title: String(song.songTitle || song.name || ''),
  artist: String(parsedLocalData.artist || ''),
  bpm: Number(parsedLocalData.bpm || 0),
  displayId: displayIdForCreate,
  isPublished: published,
  publishDate: String(publishDate),
  downloadUrl: String(downloadUrl),
  videoPreviewUrl: String(videoPreviewUrl),
  levels: Array.isArray(parsedLocalData.levels)
    ? parsedLocalData.levels.map((level) => ({
        label: String(level.label || ''),
        level: Number(level.level || 0)
      }))
    : [],
  songPath: String(song.path || '')
};

const result = await desktopHost.createSimfileRecord(simfileData);
```

Build update data as the generated partial:

```ts
const updateData: UpdateSimfileRecordInput = {
  displayId: Number(event.detail.displayId),
  publishDate: String(event.detail.publishDate),
  isPublished: Boolean(event.detail.isPublished),
  videoPreviewUrl: String(event.detail.videoPreviewUrl)
};
```

Conditionally assign `downloadUrl`, `bpm`, `artist`, and `title` exactly as today, then:

```ts
const result = await desktopHost.updateSimfileRecord(simfileId, updateData);
```

Use successful `result.data` directly as the full current model; no duplicate runtime shape guard.

- [ ] **Step 6: Simplify cloud fetch call sites and remove the handwritten score envelope**

`SongDetails.svelte`:

```ts
const result = await desktopHost.fetchCloudSong(selectedSong.id);
```

`Scores.svelte`: remove generic call syntax. Its `PromiseSettledResult` accumulator imports the generated result type:

```ts
import type { FetchCloudSongResult } from '../lib/generated/native-api-contracts';
```

Delete handwritten `FetchCloudSongResult` from `scoreTypes.ts`.

Update any directly affected score tests only for this import/typing move; do not add new score behavior coverage for HPA-615.

- [ ] **Step 7: Run renderer tests and typecheck**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
```

Expected: PASS. Typecheck is supplementary; Rust fixture equality remains the runtime-wire oracle.

- [ ] **Step 8: Run grep gates for removed handwritten contracts and selected generic calls**

```bash
rg -n \
  'type MainProcessSimFileResult|type CreateSimfileResult|type UpdateSimfileResult|interface FetchCloudSongResult' \
  packages/dtx-desktop/src/renderer/src \
  --glob '!lib/generated/native-api-contracts.ts'

rg -n \
  'fetchUserSimfiles<|fetchCloudSong<|createSimfileRecord<|updateSimfileRecord<' \
  packages/dtx-desktop/src/renderer/src
```

Expected: no matches.

- [ ] **Step 9: Commit the renderer migration**

```bash
git add \
  packages/dtx-desktop/src/renderer/src/services/desktopHost.ts \
  packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts \
  packages/dtx-desktop/src/renderer/src/services/simFileService.ts \
  packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts \
  packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte \
  packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts \
  packages/dtx-desktop/src/renderer/src/components/Scores.svelte \
  packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts
git commit -m "refactor: use generated simfile contracts"
```

---

### Task 6: Verify E2E Ownership and the Full HPA-615 Contract

**Files:**
- Verify unchanged ownership: `packages/e2e-desktop/support/generated/native-types.ts`
- Verify: all files changed by Tasks 1–5.

**Interfaces:**
- Consumes: completed native/renderer boundary.
- Produces: evidence that HPA-615 satisfies its contract without duplicating production simfile types in E2E.

- [ ] **Step 1: Prove E2E generated output does not gain production simfile contracts**

Current `main` has no E2E consumer of the new HPA-615 type names, so no E2E source migration is expected.

Run:

```bash
rg -n 'NativeSimfile|FetchUserSimfilesResult|FetchCloudSongResult|CreateSimfileRecordResult|UpdateSimfileRecordResult' \
  packages/e2e-desktop/support/generated/native-types.ts
```

Expected: no matches. If implementation work causes one of these types to be generated into this file, remove that duplicate export and keep the production type only in `native-api-contracts.ts`.

- [ ] **Step 2: Run the complete Rust contract suite**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --locked
```

Expected: PASS.

- [ ] **Step 3: Regenerate native types and prove committed outputs are clean**

```bash
bun run gen:native-types
git diff --exit-code -- \
  packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
  packages/e2e-desktop/support/generated/native-types.ts
```

Expected: PASS with no diff.

- [ ] **Step 4: Run GraphQL, renderer, and E2E type verification**

```bash
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-desktop check
```

Expected: PASS.

- [ ] **Step 5: Re-run load-bearing grep gates**

```bash
rg -n \
  'type MainProcessSimFileResult|type CreateSimfileResult|type UpdateSimfileResult|interface FetchCloudSongResult' \
  packages/dtx-desktop/src/renderer/src \
  --glob '!lib/generated/native-api-contracts.ts'

rg -n \
  'fetchUserSimfiles<|fetchCloudSong<|createSimfileRecord<|updateSimfileRecord<' \
  packages/dtx-desktop/src/renderer/src

rg -n \
  'serde_json::from_value::<NativeSimfile>|serde_json::from_value\([^\n]*NativeSimfile' \
  packages/dtx-desktop/src-tauri/src
```

Expected: no matches.

- [ ] **Step 6: Review the implementation diff for scope creep**

The final implementation diff must not contain:

- unrelated command migrations;
- `api.rs`/`SongDetails` extraction;
- a new RPC/validation/codegen framework;
- a second full-simfile fixture;
- `NativeSimfile` in the E2E generated file;
- compatibility aliases for deleted renderer result types.

- [ ] **Step 7: Commit any verification correction as a focused commit and push**

If a verification command exposed a defect, fix only that defect and commit only its files, for example:

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "fix: align simfile contract serialization"
```

Then push the implementation branch.

- [ ] **Step 8: Mark the implementation PR ready and require draft-skipping CI before merge**

After Tasks 1–7 pass locally, leave draft state / mark the implementation PR ready for review. Confirm these jobs run:

- Tauri Rust CI
- Lint and Format
- Desktop E2E Test

Do not merge while the implementation PR remains draft because those workflows explicitly skip draft PR jobs.

---

## Final Acceptance Checklist

- [ ] `native_simfile_from_graphql` uses `number_id` for simfile and nested DTX GraphQL IDs.
- [ ] `serde_json::to_value(NativeSimfile)` equals the existing `simfile_model.json` fixture exactly.
- [ ] `NativeSimfile` does not derive `Deserialize`.
- [ ] Nullable `NativeSimfile` fields are required `T | null` properties and remain present as JSON null.
- [ ] Missing/invalid nested DTX ids fail conversion.
- [ ] Update input absent fields are omitted from GraphQL variables; `googleDriveFileId` cannot be represented.
- [ ] Create `displayId: null` remains a present key and preserves current auto-allocation behavior.
- [ ] List/get/create/update use one `DesktopSimfileFull` fragment.
- [ ] Embedded `GET_SIMFILE_WITH_FILES_QUERY` uses the moved fragment name without otherwise changing asset-loading scope.
- [ ] Desktop `.graphql` documents pass existing Codegen validation.
- [ ] Production TypeScript contracts are generated by the existing `ts-rs` path and have a clean drift check.
- [ ] `fetchCloudSong` is string-only and selected structured `desktopHost` methods have no caller-supplied generic result types.
- [ ] Handwritten migrated renderer IPC result types are deleted, not aliased.
- [ ] `getNextDisplayId` remains `Promise<number>`.
- [ ] E2E generated native types do not duplicate the production simfile contract.
- [ ] Rust, renderer, GraphQL, generation, grep, E2E typecheck, and ready-for-review CI all pass.
