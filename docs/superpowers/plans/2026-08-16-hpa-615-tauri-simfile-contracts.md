# HPA-615 Tauri Simfile Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rust authoritative for the five selected desktop simfile IPC contracts, generate their production TypeScript mirrors, and remove handwritten renderer copies while preserving schema-valid runtime behavior and deliberately rejecting malformed required GraphQL fields.

**Architecture:** Keep GraphQL transport dynamic at the HTTP edge, but type the existing HPA-614 mapper/Tauri seam. `native_simfile_from_graphql` keeps `number_id` normalization and must serialize exactly to the existing `simfile_model.json` fixture; full-model nulls remain present, while partial update fields use omission semantics. One desktop GraphQL fragment feeds list/get/create/update. Existing `ts-rs`, GraphQL Codegen, and CI paths are extended rather than replaced.

**Tech Stack:** Rust 1.95, Tauri 2, serde/serde_json, ts-rs 12, TypeScript/Svelte 5, Vitest, GraphQL Code Generator, Bun 1.3.9, GitHub Actions.

## Global Constraints

- Scope is exactly `fetch_user_simfiles`, `fetch_cloud_song`, `create_simfile_record`, `update_simfile_record`, and `get_next_display_id`.
- Keep `@dtx/common` `SimfileModel` as the application model; generated native contracts stay desktop-owned.
- Do not add Specta, protobuf, Zod, JSON Schema, another RPC framework, a generic DTO registry, or a Rust GraphQL client generator.
- Do not extract `api.rs` or `SongDetails`; HPA-616 owns those refactors.
- `get_next_display_id` stays Rust `i64` -> TypeScript `number` with no wrapper object.
- `NativeSimfile` / `NativeSimfileDtxFile` are outbound types: derive `Serialize + TS`, not `Deserialize`.
- Full-model nullable fields remain present JSON nulls and required TypeScript `T | null` properties; never use `skip_serializing_if` / `#[ts(optional)]` on them.
- Partial `UpdateSimfileRecordInput` absent fields serialize by omission.
- Create `displayId: None` is a real null value and remains a present key.
- Keep `number_id` for GraphQL `ID!`; never deserialize the full GraphQL simfile directly into `NativeSimfile`.
- Reuse `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json` unchanged as the runtime wire oracle.
- Nested DTX ids are required on the desktop full-simfile wire; missing/null/invalid ids fail conversion.
- Explicitly map migrated 64-bit Rust ids/display ids to TypeScript `number`/`number | null`, not `bigint`.
- List/get/create/update share one `DesktopSimfileFull` fragment.
- Keep E2E-only generated types in `packages/e2e-desktop/support/generated/native-types.ts`; do not add `NativeSimfile` there.
- Add the production generated directory to `.prettierignore`; generated drift is byte-for-byte.
- Add a typechecked non-test bridge proving generated `NativeSimfile` extends `SimfileModel`.
- `fetchCloudSong` becomes string-only; `updateSimfileRecord` keeps the existing params-object convention.
- The implementation PR must be marked ready before final CI because Tauri Rust CI, lint/format, and desktop E2E skip draft PRs.

---

## File Map

### New files

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs` — outbound simfile/result types, inbound create/update request types, production `ts-rs` export target.
- `packages/dtx-desktop/src-tauri/graphql/simfiles/simfile-full.graphql`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/list-simfiles.graphql`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/get-simfile.graphql`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/create-simfile.graphql`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/update-simfile.graphql`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/next-display-id.graphql`
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` — generated, committed, never hand-edited.
- `packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts` — typechecked `NativeSimfile` -> `SimfileModel` bridge.

### Modified production/config files

- `.prettierignore`
- `packages/dtx-desktop/src-tauri/src/lib.rs`
- `packages/dtx-desktop/src-tauri/src/api.rs`
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- `packages/dtx-web/codegen.ts`
- `.github/workflows/tauri-rust-ci.yml`

### Modified tests

- `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.test.ts`
- `packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts`
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- directly affected score tests only if imports move.

### Reused unchanged

- `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`
- E2E generated-type ownership; production simfile types do not move into the E2E generated file.

---

### Task 1: Type the Existing HPA-614 Simfile Mapper

**Files:**
- Create: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/lib.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Reuse: `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

**Interfaces:**
- Consumes: `number_id(&Value) -> Result<i64>` and current `simfile_model_from_graphql` behavior.
- Produces: `NativeSimfileDtxFile`, `NativeSimfile`, `native_simfile_from_graphql(&Value) -> Result<NativeSimfile>`.

- [ ] **Step 1: Change the existing fixture test to require typed serialization and add missing-DTX-id coverage**

Add `use ts_rs::TS;` to `api_tests.rs`, then replace the current mapper fixture assertion with:

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
    assert_eq!(serde_json::to_value(native).expect("serializes"), expected);
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

- [ ] **Step 2: Run the new focused tests and verify red**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_from_graphql
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_typescript_keeps_nullable_fields_required
```

Expected: FAIL because the typed contract/mapper do not exist yet.

- [ ] **Step 3: Add outbound Rust wire types**

Create `api_contracts.rs`:

```rust
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct NativeSimfileDtxFile {
    #[ts(type = "number")]
    pub id: i64,
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
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

Do not derive `Deserialize`. Do not add omission annotations to full-model nullable fields.

Register in `lib.rs`:

```rust
mod api_contracts;
```

- [ ] **Step 4: Convert the existing mapper and explicitly preserve its four current call sites**

Replace `simfile_model_from_graphql` with `native_simfile_from_graphql`, constructing each field explicitly and keeping `number_id` for simfile/DTX ids. Small `required_string` / `nullable_string` helpers are fine; do not call `serde_json::from_value::<NativeSimfile>`.

At the current callers:

- `fetch_user_simfiles_impl`: annotate `let mut all_data: Vec<NativeSimfile> = Vec::new();` and push typed mapper results. Existing `json!` failure/success envelopes continue serializing the vector through `Serialize` until Task 2 replaces the envelope.
- `fetch_cloud_song_impl`: keep `json!({ "cloudSongData": native_simfile_from_graphql(simfile)? })` until Task 2.
- `update_simfile_record_impl`: keep the typed mapper result inside the existing `json!` envelope until Task 2.
- `create_simfile_record_impl`: keep the typed mapper result inside the existing `json!` envelope until Task 2.

This keeps Task 1 compile-safe without prematurely changing command envelopes.

Required scalar extraction should fail for missing/invalid schema-non-null fields. This is an intentional tightening from the old `Value::Null` propagation, not a compatibility bug.

- [ ] **Step 5: Run focused tests and compile checks**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_from_graphql
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml native_simfile_typescript_keeps_nullable_fields_required
cargo check --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --locked
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
```

Expected: PASS. Fixture equality proves the valid wire contract is unchanged.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/dtx-desktop/src-tauri/src/api_contracts.rs \
  packages/dtx-desktop/src-tauri/src/lib.rs \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor: type desktop simfile wire model"
```

---

### Task 2: Type the Four Structured Command Contracts

**Files:**
- Modify: `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Test: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

**Interfaces:**
- Consumes: `NativeSimfile` / typed mapper from Task 1.
- Produces: typed create/update inputs, four result envelopes, concrete selected Rust command signatures.

- [ ] **Step 1: Add failing tests for update omission and create-null semantics**

Use a typed update request in the existing wiremock test:

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

Keep the outgoing GraphQL variables exact:

```rust
.and(body_partial_json(json!({
    "variables": {
        "id": "42",
        "input": { "title": "Updated" }
    }
})))
```

Add:

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

- [ ] **Step 2: Run red tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml update_simfile_input_omits_absent_fields
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml create_simfile_input_preserves_null_display_id
```

Expected: FAIL because typed inputs do not exist.

- [ ] **Step 3: Add concrete input and result structs**

Add inbound request structs with `Deserialize + Serialize + TS`:

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

Add outbound `Serialize + TS` result structs:

```rust
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct FetchUserSimfilesResult {
    pub success: bool,
    pub data: Vec<NativeSimfile>,
    pub from_cache: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct FetchCloudSongResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cloud_song_data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct CreateSimfileRecordResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub simfile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/renderer/src/lib/generated/native-api-contracts.ts")]
pub struct UpdateSimfileRecordResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub data: Option<NativeSimfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}
```

- [ ] **Step 4: Convert selected Rust command signatures**

Target:

```rust
pub(crate) async fn fetch_user_simfiles_impl(
    base_url: &str,
    token: &str,
) -> Result<FetchUserSimfilesResult>

pub(crate) async fn fetch_cloud_song_impl(
    base_url: &str,
    token: &str,
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

Mirror those types at the four `#[tauri::command]` functions. Keep `get_next_display_id` unchanged.

Create GraphQL input from the typed create request while excluding command-local `songPath`. Serialize update input directly with `serde_json::to_value(&update_data)`; no Drive-field filtering remains because the field is unrepresentable.

Every full GraphQL simfile result must pass through `native_simfile_from_graphql`.

- [ ] **Step 5: Run focused Rust API tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml update_simfile
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml create_simfile
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml fetch_user_simfiles
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml fetch_cloud_song
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
```

Expected: PASS, including exact wiremock GraphQL-variable assertions.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/dtx-desktop/src-tauri/src/api_contracts.rs \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor: type simfile tauri commands"
```

---

### Task 3: Move Desktop GraphQL Documents and Extend Existing Codegen

**Files:**
- Create: `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- Modify: `packages/dtx-web/codegen.ts`

**Interfaces:**
- Consumes: existing `graphql_document(fragment + operation)`.
- Produces: one `DesktopSimfileFull` fragment shared by list/get/create/update and validated by the existing `bun run codegen` invocation.

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

#[test]
fn asset_file_query_uses_moved_full_simfile_fragment_name() {
    assert!(GET_SIMFILE_WITH_FILES_QUERY.contains("...DesktopSimfileFull"));
}
```

Delete the old assertion that list must not use a full fragment.

- [ ] **Step 2: Run red document tests**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml list_simfiles_query_reuses_full_simfile_fragment
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml asset_file_query_uses_moved_full_simfile_fragment_name
```

Expected: FAIL on current duplicated list/spread name.

- [ ] **Step 3: Create fragment and operation files**

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
query DesktopListSimfiles($scope: SimfileScope!, $search: String, $page: Int, $pageSize: Int) {
  simfiles(scope: $scope, search: $search, page: $page, pageSize: $pageSize) {
    count
    data { ...DesktopSimfileFull }
  }
}
```

`get-simfile.graphql`:

```graphql
query DesktopGetSimfile($id: ID!) {
  simfile(id: $id) { ...DesktopSimfileFull }
}
```

`create-simfile.graphql`:

```graphql
mutation DesktopCreateSimfile($input: CreateSimfileInput!) {
  createSimfile(input: $input) { ...DesktopSimfileFull }
}
```

`update-simfile.graphql`:

```graphql
mutation DesktopUpdateSimfile($id: ID!, $input: UpdateSimfileInput!) {
  updateSimfile(id: $id, input: $input) { ...DesktopSimfileFull }
}
```

`next-display-id.graphql`:

```graphql
query DesktopNextDisplayId { nextDisplayId }
```

- [ ] **Step 4: Load documents with `include_str!` and keep the asset query embedded**

Replace the selected Rust string constants with `include_str!("../graphql/simfiles/<file>.graphql")` constants. Use `graphql_document(...)` for list/get/create/update and keep next-display-id standalone.

Change only this part of the embedded asset query:

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

- [ ] **Step 5: Add desktop document validation to the existing `codegen.ts`**

Keep the existing root `documents` and committed web output. Add this second `generates` entry:

```ts
'.svelte-kit/dtx-desktop-graphql-validation.ts': {
  documents: ['../dtx-desktop/src-tauri/graphql/**/*.graphql'],
  plugins: ['typescript', 'typescript-operations'],
  config: {
    skipTypename: true,
    useTypeImports: true,
    scalars: { ID: 'string' }
  }
}
```

Do not add `codegen.desktop.ts`, `lint:codegen:desktop`, or modify `packages/dtx-web/package.json`. Output-specific `documents` scopes the desktop documents to this disposable output; existing `bun run codegen` covers both.

- [ ] **Step 6: Run document and Codegen checks**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml list_simfiles_query_reuses_full_simfile_fragment
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml asset_file_query_uses_moved_full_simfile_fragment_name
bun run --filter=dtx-web lint:codegen
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  packages/dtx-desktop/src-tauri/graphql/simfiles \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs \
  packages/dtx-web/codegen.ts
git commit -m "refactor: validate desktop simfile graphql"
```

---

### Task 4: Generate Production Contracts, Protect Drift, and Link to `SimfileModel`

**Files:**
- Modify: `.prettierignore`
- Generated: `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- Create: `packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts`
- Modify: `.github/workflows/tauri-rust-ci.yml`

**Interfaces:**
- Consumes: `#[derive(TS)]` contracts from Tasks 1–2.
- Produces: committed generated production types plus a typechecked structural bridge to `SimfileModel`.

- [ ] **Step 1: Protect generated output from Prettier before generation**

Append to `.prettierignore`:

```text
packages/dtx-desktop/src/renderer/src/lib/generated/
```

Do not weaken the generation drift check to tolerate formatting changes.

- [ ] **Step 2: Generate bindings with the existing root command**

```bash
bun run gen:native-types
```

Expected: creates `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` through the existing `ts-rs` export-test path.

- [ ] **Step 3: Inspect generated shapes**

The generated types must be semantically equivalent to:

```ts
export type NativeSimfile = {
  id: number;
  displayId: number | null;
  title: string;
  artist: string;
  bpm: number;
  userId: string | null;
  googleDriveFileId: string | null;
  isPublished: boolean;
  downloadUrl: string | null;
  previewUrl: string | null;
  videoPreviewUrl: string | null;
  publishDate: string;
  createdAt: string;
  updatedAt: string;
  dtxFiles: Array<NativeSimfileDtxFile>;
};
```

Reject `displayId?:`, `googleDriveFileId?:`, or migrated `bigint` ids.

- [ ] **Step 4: Add the non-test compile-time model bridge**

Create `packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts`:

```ts
import type { SimfileModel } from '@dtx/common';
import type { NativeSimfile } from './generated/native-api-contracts';

type NativeSimfileMatchesModel = NativeSimfile extends SimfileModel ? true : never;
export const nativeSimfileMatchesModel: NativeSimfileMatchesModel = true;
```

This is intentionally in production source so `tsconfig.web.json` includes it. It catches missing/renamed required application fields. Keep the Rust fixture because non-strict TypeScript does not fully enforce nullability.

- [ ] **Step 5: Extend Tauri CI generated drift verification**

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

- [ ] **Step 6: Verify generation is stable and the bridge typechecks**

```bash
bun run gen:native-types
git diff --exit-code -- \
  packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
  packages/e2e-desktop/support/generated/native-types.ts
bun run --filter=dtx-desktop typecheck
```

Expected: PASS with no generated diff.

- [ ] **Step 7: Commit**

```bash
git add \
  .prettierignore \
  packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
  packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts \
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
- Consumes: generated contracts + `nativeContract.ts` from Task 4.
- Produces: concrete selected renderer methods and no duplicate migrated result contracts.

- [ ] **Step 1: Update desktopHost tests for the intended call forms**

```ts
await desktopHost.fetchCloudSong('42');
expect(runtime.invoke).toHaveBeenCalledWith('fetch_cloud_song', { cloudSongId: '42' });

await desktopHost.updateSimfileRecord({
  simfileId: '42',
  updateData: { title: 'Updated' }
});
expect(runtime.invoke).toHaveBeenCalledWith('update_simfile_record', {
  simfileId: '42',
  updateData: { title: 'Updated' }
});
```

Keep `getNextDisplayId()` primitive.

- [ ] **Step 2: Run host test red**

```bash
bun run --filter=dtx-desktop test -- src/renderer/src/services/desktopHost.test.ts
```

Expected: FAIL on the new string-only cloud fetch; update remains params-object but its type is still generic.

- [ ] **Step 3: Make only selected methods concrete**

Import generated types and implement:

```ts
fetchUserSimfiles: async (): Promise<FetchUserSimfilesResult> =>
  await invokeHost<FetchUserSimfilesResult>('fetch_user_simfiles'),

fetchCloudSong: async (cloudSongId: string): Promise<FetchCloudSongResult> =>
  await invokeHost<FetchCloudSongResult>('fetch_cloud_song', { cloudSongId }),

createSimfileRecord: async (
  simfileData: CreateSimfileRecordInput
): Promise<CreateSimfileRecordResult> =>
  await invokeHost<CreateSimfileRecordResult>('create_simfile_record', { simfileData }),

updateSimfileRecord: async (params: {
  simfileId: string;
  updateData: UpdateSimfileRecordInput;
}): Promise<UpdateSimfileRecordResult> =>
  await invokeHost<UpdateSimfileRecordResult>('update_simfile_record', params),
```

Keep `DesktopHostRuntime.invoke<T>()` / `invokeHost<T>()` generic and untouched commands unchanged.

- [ ] **Step 4: Remove renderer duplicate result types**

`simFileService.ts`:

- delete `MainProcessSimFileResult`;
- call `desktopHost.fetchUserSimfiles()` without a generic argument;
- keep public `SimFileServiceResult` as `SimfileModel[]`.

`SongDetails.svelte`:

- delete `CreateSimfileResult`, `UpdateSimfileResult`, and `isSimfileModel`;
- type create data as `CreateSimfileRecordInput`;
- type update data as `UpdateSimfileRecordInput`;
- call `desktopHost.createSimfileRecord(simfileData)`;
- call `desktopHost.updateSimfileRecord({ simfileId, updateData })`.

Build create input with the current values:

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
```

`Scores.svelte`:

- call `desktopHost.fetchCloudSong(cloudId)` without a generic argument;
- import `FetchCloudSongResult` from generated production types only where the settled-result annotation still needs it.

`scoreTypes.ts`:

- delete handwritten full-simfile `FetchCloudSongResult`.

- [ ] **Step 5: Run renderer tests and typecheck**

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
```

Expected: PASS. `nativeContract.ts` is part of the typecheck.

- [ ] **Step 6: Run load-bearing grep gates**

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

- [ ] **Step 7: Commit**

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

### Task 6: Verify the Full HPA-615 Contract

**Files:**
- Verify all files changed by Tasks 1–5.
- Verify unchanged ownership: `packages/e2e-desktop/support/generated/native-types.ts`.

**Interfaces:**
- Consumes: completed native/renderer contract slice.
- Produces: final evidence for HPA-615 acceptance.

- [ ] **Step 1: Prove E2E output does not duplicate production simfile contracts**

```bash
rg -n 'NativeSimfile|FetchUserSimfilesResult|FetchCloudSongResult|CreateSimfileRecordResult|UpdateSimfileRecordResult' \
  packages/e2e-desktop/support/generated/native-types.ts
```

Expected: no matches.

- [ ] **Step 2: Run complete Rust checks**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --locked
```

Expected: PASS.

- [ ] **Step 3: Regenerate and prove generated bytes are clean**

```bash
bun run gen:native-types
git diff --exit-code -- \
  packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts \
  packages/e2e-desktop/support/generated/native-types.ts
```

Expected: PASS with no diff. Do not run Prettier over the generated production directory; `.prettierignore` owns that exclusion.

- [ ] **Step 4: Run GraphQL, renderer, and E2E checks**

```bash
bun run --filter=dtx-web lint:codegen
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bun run --filter=dtx-e2e-desktop check
```

Expected: PASS. The renderer typecheck includes `nativeContract.ts`.

- [ ] **Step 5: Re-run grep gates**

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

`NativeSimfile` cannot be passed to `serde_json::from_value` because it does not implement `Deserialize`; no separate grep gate is needed for an operation the type system makes unrepresentable.

- [ ] **Step 6: Review final diff for scope creep**

The implementation diff must not contain unrelated command migrations, `api.rs`/`SongDetails` extraction, a second full-simfile fixture, a new RPC/validation framework, production simfile types in the E2E generated file, or compatibility aliases for deleted renderer types.

- [ ] **Step 7: Mark the implementation PR ready and require CI**

After local verification, mark the implementation PR ready for review and confirm these jobs run before merge:

- Tauri Rust CI
- Lint and Format
- Desktop E2E Test

---

## Final Acceptance Checklist

- [ ] `native_simfile_from_graphql` uses `number_id` for simfile and nested DTX GraphQL IDs.
- [ ] `serde_json::to_value(NativeSimfile)` equals the existing `simfile_model.json` fixture exactly.
- [ ] `NativeSimfile` does not derive `Deserialize`.
- [ ] Nullable `NativeSimfile` fields remain required `T | null` properties and present JSON nulls.
- [ ] Missing/invalid required nested/scalar GraphQL fields fail conversion deliberately.
- [ ] Update absent fields are omitted; `googleDriveFileId` cannot be represented.
- [ ] Create `displayId: null` remains present.
- [ ] List/get/create/update use one `DesktopSimfileFull` fragment.
- [ ] Embedded `GET_SIMFILE_WITH_FILES_QUERY` uses the moved fragment name only.
- [ ] Existing `codegen.ts` validates desktop documents with no extra config/script.
- [ ] Production generated output is ignored by Prettier and clean after regeneration.
- [ ] `nativeContract.ts` proves generated `NativeSimfile` extends `SimfileModel` in production typecheck.
- [ ] `fetchCloudSong` is string-only; `updateSimfileRecord` keeps params-object input.
- [ ] Selected structured `desktopHost` methods have no caller-supplied result generics.
- [ ] Handwritten migrated result types and `isSimfileModel` are deleted, not aliased.
- [ ] `getNextDisplayId` remains `Promise<number>`.
- [ ] E2E generated types do not duplicate the production simfile contract.
- [ ] Rust, GraphQL, generated drift, renderer/type bridge, grep, E2E typecheck, and ready-for-review CI pass.
