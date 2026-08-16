# HPA-615 Tauri Simfile Contracts Design

## Summary

Make Rust the source of truth for the first production Tauri IPC contract slice: the simfile commands used by desktop chart/song-details flows.

Keep `@dtx/common`'s `SimfileModel` as the shared application model established by HPA-614. Reuse the repository's existing `ts-rs`, GraphQL Codegen, `simfile_model_from_graphql` normalization seam, and `simfile_model.json` cross-language fixture instead of introducing a second wire model or generator.

Only five commands are in scope:

- `fetch_user_simfiles`
- `fetch_cloud_song`
- `create_simfile_record`
- `update_simfile_record`
- `get_next_display_id`

The first four gain named Rust result types and concrete request types where they accept structured input. `get_next_display_id` remains a primitive `i64 -> number` contract.

The selected desktop GraphQL operations move from Rust string constants to checked-in `.graphql` files loaded with `include_str!`. List/get/create/update share one desktop full-simfile fragment. The existing GraphQL Codegen toolchain validates those documents against `packages/dtx-api/dist/schema.graphql`.

This is deliberately a narrow vertical slice. It does not introduce a new RPC framework, generic DTO layer, runtime schema validation, Rust GraphQL client generator, or an `api.rs`/`SongDetails` refactor.

Linear: HPA-615

## Why this is the next slice

HPA-614 is complete and merged into `main`. That removes HPA-615's only blocker and leaves a stable renderer model (`SimfileModel`) plus an existing Rust normalization seam and fixture for this ticket to type across the Tauri boundary.

HPA-615 blocks HPA-616 and HPA-617. Completing the production contract seam first prevents those later tickets from extracting or documenting handwritten IPC shapes that are about to disappear.

HPA-613 is also medium priority, but it is independent CI optimization work. HPA-615 has stronger sequencing value because completing it unlocks two follow-up architecture tasks.

## Current problem

### Renderer boundary

`packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` still exposes generic methods for the selected structured commands:

- `fetchUserSimfiles<T>()`
- `fetchCloudSong<T>()`
- `createSimfileRecord<T>()`
- `updateSimfileRecord<T>()`

Callers supply their own result shape. That produces duplicate contracts in:

- `simFileService.ts` (`MainProcessSimFileResult`)
- `SongDetails.svelte` (`CreateSimfileResult`, `UpdateSimfileResult`)
- `scoreTypes.ts` (`FetchCloudSongResult`)

`getNextDisplayId()` is already concrete as `Promise<number>` and should stay that way.

### Rust boundary

`packages/dtx-desktop/src-tauri/src/api.rs` still uses `serde_json::Value` at the selected structured command boundaries and assembles response envelopes with `json!()`.

HPA-614 already added the correct normalization seam:

```rust
fn number_id(value: &Value) -> Result<i64>
pub fn simfile_model_from_graphql(simfile: &Value) -> Result<Value>
```

That mapper is load-bearing because GraphQL `ID!` values arrive as strings while the renderer/application contract uses numbers.

HPA-614 also added:

`packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

The existing fixture test feeds string GraphQL ids through the mapper and asserts the numeric/camelCase output exactly. HPA-615 should type that existing output instead of adding a second conversion or expected blob.

### Existing generation

`ts-rs` is already a direct Rust dependency. Existing structs in `src-tauri/src/models.rs` derive `TS` and export to:

`packages/e2e-desktop/support/generated/native-types.ts`

The root `gen:native-types` command already drives `ts-rs` export tests, and Tauri CI verifies generated output. HPA-615 extends those seams rather than adding another generator.

### GraphQL documents

The selected GraphQL operations are embedded as Rust string constants in `api.rs`.

After HPA-614, `LIST_SIMFILES_QUERY` duplicates the same full simfile fields as `SIMFILE_FULL_FRAGMENT`. Keeping both field lists would make every future current-model field change require two edits.

`GET_SIMFILE_WITH_FILES_QUERY` remains outside the five-command migration because it belongs to asset loading, but it also spreads the shared full fragment. If the fragment is renamed while moving it to a file, this embedded query's spread name must change too.

The API schema is already generated and checked in at `packages/dtx-api/dist/schema.graphql`. The web package already owns GraphQL Codegen and generated-client drift checks, so desktop operation validation can reuse that toolchain.

## Reuse decisions

| Proposed work | Existing seam to extend |
| --- | --- |
| `NativeSimfile` / `NativeSimfileDtxFile` | `@dtx/common` `SimfileModel`, `api.rs` mapper, `tests/fixtures/simfile_model.json` |
| Typed GraphQL conversion | `number_id` + existing mapper; no full-object deserializer |
| Production `ts-rs` output | Existing `#[derive(TS)]` / `export_to` pattern and root `gen:native-types` |
| Named command envelopes/inputs | Existing renderer handwritten contracts |
| `.graphql` + `include_str!` | Existing `graphql_document(fragment + operation)` pattern and web `.graphql` convention |
| Desktop GraphQL validation | Existing `packages/dtx-web/codegen.ts` and `lint:codegen` workflow |
| Generated drift CI | Existing Tauri Rust CI generated-TypeScript verification |

## Goals

- Make Rust authoritative for the selected production IPC wire shapes.
- Preserve the exact HPA-614 `SimfileModel` JSON shape, including present nullable keys.
- Reuse `number_id`, the existing GraphQL mapper, and `simfile_model.json` as the normalization/contract seam.
- Generate production TypeScript contracts from Rust with existing `ts-rs`.
- Remove caller-supplied generic result types and duplicate renderer interfaces for the selected commands.
- Keep `SimfileModel` as the shared application model rather than creating another domain model.
- Make selected desktop GraphQL documents schema-validated and share one full-simfile fragment.
- Establish a repeatable pattern without forcing untouched commands to migrate.

## Non-goals

- No migration of every Tauri command.
- No new RPC/binding framework.
- No Specta, protobuf, JSON Schema, Zod, or runtime validation layer.
- No generic request/response registry.
- No full Rust GraphQL client/codegen stack.
- No GraphQL or D1 schema redesign.
- No Tauri command renaming.
- No `api.rs` extraction; HPA-616 owns that.
- No `SongDetails` extraction; HPA-616 owns that.
- No broad E2E generated-contract cleanup.
- No compatibility aliases for deleted handwritten renderer types.
- No direct deserialization of GraphQL simfile JSON into `NativeSimfile`.

## Chosen architecture

### 1. Add a narrow native contract module

Create:

`packages/dtx-desktop/src-tauri/src/api_contracts.rs`

It owns only the wire types needed by the migrated simfile commands.

`NativeSimfile` is outbound native/application wire data, so derive `Serialize + TS` rather than `Deserialize`. Tauri result values need serialization; GraphQL input is normalized manually through the existing mapper.

```rust
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeSimfileDtxFile {
    #[ts(type = "number")]
    pub id: i64,
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
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

The desktop full fragment requests each nested DTX id, so the native wire makes it required. Missing/null/invalid nested ids fail conversion; there is no positional fallback.

`DtxFile.level` and simfile `bpm` are GraphQL floats, so their Rust wire types are `f64`.

64-bit ids/display ids explicitly generate TypeScript `number`/`number | null`, not `bigint`, matching the established renderer contract and existing native-generation conventions.

### 2. Keep full-model nulls present; use omission only where omission is semantic

HPA-614's `SimfileModel` requires keys such as:

```ts
displayId: number | null;
userId: string | null;
googleDriveFileId: string | null;
downloadUrl: string | null;
previewUrl: string | null;
videoPreviewUrl: string | null;
```

For corresponding `NativeSimfile` `Option<T>` fields:

- do **not** use `serde(skip_serializing_if = "Option::is_none")`;
- do **not** use `#[ts(optional)]`.

`None` serializes as an explicit JSON `null`, and TypeScript receives a required `T | null` property.

Omission annotations belong only at boundaries whose existing contract genuinely distinguishes absent from null:

- `UpdateSimfileRecordInput` partial fields;
- result-envelope fields that are not present in one success/failure branch.

Create input is concrete. `displayId` may be null for current auto-allocation behavior, but the key is present.

### 3. Type the existing mapper; never deserialize the full GraphQL object into `NativeSimfile`

Rename/refocus the current mapper to:

```rust
fn native_simfile_from_graphql(simfile: &Value) -> Result<NativeSimfile>
```

It explicitly constructs `NativeSimfile` and preserves `number_id` for:

- `Simfile.id`
- every `DtxFile.id`

Do not use:

```rust
serde_json::from_value::<NativeSimfile>(...)
```

GraphQL ids are JSON strings while the native/application wire uses numeric ids. Direct full-object deserialization would either fail on valid GraphQL responses or establish another shape.

The conversion test reuses the existing HPA-614 fixture:

```rust
let native = native_simfile_from_graphql(&graphql_value).expect("mapped");
let actual = serde_json::to_value(native).expect("serializes");
let expected: Value = serde_json::from_str(include_str!(
    "../../tests/fixtures/simfile_model.json"
)).expect("fixture parses");
assert_eq!(actual, expected);
```

Do not add another expected full-simfile blob.

### 4. Type only the four structured command envelopes/inputs

#### `fetch_user_simfiles`

Return a named result preserving:

- `success`
- `data: Vec<NativeSimfile>`
- `fromCache`
- failure `error`

Keep `fromCache: false`; removing it is unrelated behavior churn.

#### `fetch_cloud_song`

Make the Rust command id a `String` and simplify renderer API to:

```ts
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
```

Delete the object/number convenience overload. Keep response field `cloudSongData`.

#### `create_simfile_record`

Add a concrete request for current renderer-owned fields:

- title
- artist
- bpm
- displayId
- isPublished
- publishDate
- downloadUrl
- videoPreviewUrl
- levels
- songPath

`levels[].level` is `f64`. `displayId` is `Option<i64>` without omission annotations because null is a real create value. `songPath` stays command-local and is not sent to GraphQL.

Result keeps current success data/simfile id and optional preview warnings/failure error.

#### `update_simfile_record`

Add a partial `UpdateSimfileRecordInput`. Every `Option<T>` means **not supplied**, so use:

```rust
#[serde(skip_serializing_if = "Option::is_none")]
#[ts(optional)]
```

`googleDriveFileId` is absent from the type, making the general update path unable to mutate Drive-owned state. The HPA-614 defensive map removal can disappear.

Success returns a full `NativeSimfile`, not `Partial<SimfileModel>`.

#### `get_next_display_id`

Keep Rust `i64` and renderer `Promise<number>` with no wrapper type.

### 5. Generate one production TypeScript file with the existing generator

Generate migrated production types into:

`packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

Use normal `#[ts(export, export_to = ...)]` declarations so existing `bun run gen:native-types` / autogenerated export tests produce the file.

Do not generate into `@dtx/common`.

Do not generate `NativeSimfile` into the E2E native file. E2E-only controls/snapshots stay there; if E2E ever needs a production simfile type, it imports/re-exports the production generated type instead of defining another Rust mirror.

### 6. Move selected GraphQL operations to files and share one fragment

Create:

`packages/dtx-desktop/src-tauri/graphql/simfiles/`

with:

- `simfile-full.graphql`
- `list-simfiles.graphql`
- `get-simfile.graphql`
- `create-simfile.graphql`
- `update-simfile.graphql`
- `next-display-id.graphql`

Use one fragment, for example `DesktopSimfileFull`, containing the full current model fields.

List/get/create/update all spread it. In particular, list becomes:

```graphql
data {
  ...DesktopSimfileFull
}
```

Rust loads fragment and operation strings with `include_str!` and reuses the current `graphql_document(fragment + operation)` composition. No document-loader abstraction is needed.

Delete the stale list test asserting the list must not use a fragment.

`GET_SIMFILE_WITH_FILES_QUERY` stays embedded because asset loading is outside HPA-615, but update its spread from `...SimfileFull` to `...DesktopSimfileFull` so it still composes with the moved shared fragment. No other asset-loading behavior changes.

Leave search, score upload, Drive metadata, chart-only projections, and asset-file projection bodies embedded otherwise.

### 7. Validate desktop GraphQL with existing web Codegen tooling

Add:

`packages/dtx-web/codegen.desktop.ts`

It reads:

- `../dtx-api/dist/schema.graphql`
- `../dtx-desktop/src-tauri/graphql/**/*.graphql`

and generates disposable validation output under `packages/dtx-web/.svelte-kit/`.

Extend existing `lint:codegen` so it runs both web generated-client drift and desktop document validation.

Do not add another GraphQL validator dependency or shared scripts package for this one command.

### 8. Make selected `desktopHost` methods concrete and delete duplicate renderer contracts

Target API:

```ts
fetchUserSimfiles(): Promise<FetchUserSimfilesResult>
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
createSimfileRecord(input: CreateSimfileRecordInput): Promise<CreateSimfileRecordResult>
updateSimfileRecord(
  simfileId: string,
  updateData: UpdateSimfileRecordInput
): Promise<UpdateSimfileRecordResult>
getNextDisplayId(): Promise<number>
```

Keep low-level `DesktopHostRuntime.invoke<T>()` and `invokeHost<T>()` generic. Untouched named commands remain as-is.

Delete rather than alias:

- `MainProcessSimFileResult`
- `CreateSimfileResult`
- `UpdateSimfileResult`
- handwritten `FetchCloudSongResult`

Remove selected generic call-site arguments and the local `isSimfileModel` guard once fetch/create results are generated from the Rust contract.

## Error and compatibility behavior

Keep current runtime behavior unless typing makes an invalid state impossible.

- GraphQL/network failures remain failure envelopes where commands currently return them.
- Native configuration/workspace errors continue to reject Tauri commands.
- `fetch_user_simfiles` keeps already-fetched partial data if a later page fails.
- Create preview upload failures remain warnings after successful record creation.
- `fetch_cloud_song` keeps `cloudSongData` and current not-found behavior.
- `get_next_display_id` continues to reject invalid/missing API values.
- General update requests cannot represent `googleDriveFileId`.
- Nullable `NativeSimfile` keys remain present with JSON `null`.
- Partial update keys remain omitted when not supplied.
- No old generic signatures, compatibility aliases, or TypeScript runtime schema are added.

## Testing strategy

### Load-bearing Rust wire fixture

The primary runtime wire test reuses `tests/fixtures/simfile_model.json`:

- GraphQL fixture uses string simfile/DTX ids.
- `native_simfile_from_graphql` parses them through `number_id`.
- `serde_json::to_value(native)` equals the existing fixture exactly.
- nullable model fields remain present as JSON `null`.
- missing/null/invalid nested DTX ids fail conversion.

Add a `TS::decl()` assertion proving nullable native fields generate required `T | null` properties rather than optional properties.

### Typed request/envelope tests

- Update `None` fields serialize by omission.
- Create `displayId: None` serializes as a present JSON null.
- Existing wiremock request tests prove typed GraphQL variables preserve behavior.
- General update type cannot carry Drive-owned state.

### GraphQL document tests

- List operation uses the shared fragment.
- Composed list document includes current full-model fields/timestamps.
- Codegen rejects schema-invalid desktop documents.
- Embedded `GET_SIMFILE_WITH_FILES_QUERY` continues to reference the moved fragment name.

### Generated binding drift

Run `bun run gen:native-types` and require a clean diff for:

- production `native-api-contracts.ts`
- existing E2E `native-types.ts`

Tauri CI uses `git ls-files --error-unmatch` so a missing committed production output cannot pass silently.

### Renderer

Run existing focused tests plus:

`bun run --filter=dtx-desktop typecheck`

Typecheck is supplementary, not the primary wire gate. `tsconfig.web.json` has `strict: false` and excludes `*.test.ts`/`*.spec.ts`.

Use repository grep as a load-bearing completion check for deleted handwritten contract declarations and selected generic calls.

### E2E

Run:

`bun run --filter=dtx-e2e-desktop check`

Do not add a new E2E scenario solely for typing. Current E2E generated native types remain control/snapshot types and must not gain a duplicate production simfile contract.

### Draft-state rule

The implementation PR must **leave draft state / be marked ready for review** before final CI verification. Tauri Rust CI, lint/format, and desktop E2E all explicitly skip draft pull requests and include `ready_for_review` as a trigger.

The planning PR may remain draft.

## Expected file scope

New:

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql`
- `packages/dtx-web/codegen.desktop.ts`
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

Modify:

- `packages/dtx-desktop/src-tauri/src/lib.rs`
- `packages/dtx-desktop/src-tauri/src/api.rs`
- `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- directly affected renderer tests
- `packages/dtx-web/package.json`
- `.github/workflows/tauri-rust-ci.yml`

Reuse unchanged:

- `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`
- `packages/e2e-desktop/support/generated/native-types.ts` structure/ownership; its contents continue to be generated only for existing E2E/general-native types, not the new production simfile contracts.

## Implementation order

1. Add `NativeSimfile`/DTX Rust wire structs and change the existing mapper to return them while preserving `number_id` and exact fixture serialization.
2. Add missing/invalid nested-id coverage, `TS::decl()` nullability coverage, and typed create/update/envelope contracts.
3. Convert the four structured Rust commands to named inputs/results; keep next-display-id primitive.
4. Move selected GraphQL documents to files, share one full fragment, update the embedded asset query's spread name, and remove the stale anti-fragment test.
5. Validate desktop GraphQL through existing `dtx-web` Codegen.
6. Generate the production TypeScript file and extend existing CI drift verification.
7. Make selected `desktopHost` methods concrete and delete handwritten renderer contract copies/generic call arguments.
8. Run Rust, fixture, generation, GraphQL, renderer, grep, and E2E checks; mark the implementation PR ready so draft-skipping CI runs.

## Risks and mitigations

### Full-model nullability accidentally becomes omission

Mitigation: no `skip_serializing_if` or `#[ts(optional)]` on `NativeSimfile`; fixture equality and `TS::decl()` assertions are load-bearing.

### GraphQL string IDs accidentally bypass `number_id`

Mitigation: `NativeSimfile` is outbound-only (`Serialize + TS`, no `Deserialize`), and the typed mapper explicitly constructs ids through `number_id`. Full-object `serde_json::from_value::<NativeSimfile>` is out of scope and prohibited by the spec.

### Update omission accidentally becomes GraphQL null

Mitigation: partial update `Option<T>` fields use `skip_serializing_if` + `#[ts(optional)]`, with exact wiremock GraphQL-variable assertions.

### Full GraphQL field lists drift

Mitigation: list/get/create/update share one full fragment. The still-embedded asset query only updates its spread name to remain compatible with the moved fragment.

### 64-bit Rust ids become TypeScript bigint

Mitigation: explicit `#[ts(type = "number")]` / `number | null` overrides and generated-file drift checks.

### Renderer typecheck misses contract errors

Mitigation: Rust fixture equality and generated-file drift are primary; grep covers removed types/generic calls; renderer typecheck remains extra coverage.

### `api.rs` remains large

Intentional. HPA-616 owns extraction after this ticket establishes concrete boundaries.

## Completion criteria

HPA-615 is complete when:

- selected structured commands use named Rust result types and concrete structured inputs instead of `serde_json::Value` at the Tauri boundary;
- `native_simfile_from_graphql` uses `number_id` for simfile and nested DTX ids and serializes exactly to the existing HPA-614 fixture;
- `NativeSimfile` does not derive `Deserialize`, nullable fields are required `T | null` TypeScript properties, and runtime null keys stay present;
- nested DTX ids are required and invalid/missing ids fail conversion;
- production TypeScript contracts are generated by the existing `ts-rs` path and committed;
- 64-bit Rust ids remain TypeScript `number` rather than `bigint`;
- `fetchCloudSong` accepts only a string id;
- selected `desktopHost` methods no longer expose caller-supplied generic result types;
- handwritten migrated renderer IPC result types are deleted rather than aliased;
- optional update fields preserve omission semantics and cannot represent `googleDriveFileId`;
- list/get/create/update share one desktop full-simfile fragment;
- the embedded asset query still composes with that fragment after the rename;
- existing GraphQL Codegen tooling rejects schema-invalid desktop documents;
- E2E generated types do not duplicate the production simfile contract;
- fixture equality, Rust tests, generated-binding drift, renderer tests/typecheck, grep gates, desktop GraphQL validation, E2E typecheck, and ready-for-review CI pass;
- command names and runtime UX remain unchanged;
- untouched commands remain outside the migration.
