# HPA-615 Tauri Simfile Contracts Design

## Summary

Make Rust the source of truth for the first production Tauri IPC contract slice: the simfile commands used by desktop chart/song-details flows.

The implementation keeps the current Tauri command names and behavior, keeps `@dtx/common`'s `SimfileModel` as the shared application model established by HPA-614, and reuses the repository's existing `ts-rs` dependency to generate TypeScript wire contracts into the production desktop renderer.

Only five commands are in scope:

- `fetch_user_simfiles`
- `fetch_cloud_song`
- `create_simfile_record`
- `update_simfile_record`
- `get_next_display_id`

The first four gain named Rust result types and concrete request types where they accept structured input. `get_next_display_id` remains a primitive `i64 -> number` contract because wrapping it in an object would add ceremony without improving correctness.

The selected desktop GraphQL operations move from Rust string constants to checked-in `.graphql` files loaded with `include_str!`. The existing GraphQL Codegen toolchain validates those documents against `packages/dtx-api/dist/schema.graphql`.

This is deliberately a narrow vertical slice. It does not introduce a new RPC framework, generic DTO layer, runtime schema validation, Rust GraphQL client generator, or an `api.rs`/`SongDetails` refactor.

Linear: HPA-615

## Why this is the next slice

HPA-614 is complete and merged into `main`. That removes HPA-615's only blocker and leaves a stable current renderer model (`SimfileModel`) for this ticket to type across the Tauri boundary.

HPA-615 blocks HPA-616 and HPA-617. Completing the production contract seam first prevents those later tickets from extracting or documenting handwritten IPC shapes that are about to disappear.

HPA-613 is also medium priority, but it is independent CI optimization work. HPA-615 has stronger sequencing value because completing it unlocks two follow-up architecture tasks.

## Current problem

### Renderer boundary

`packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` still exposes generic methods for the selected structured commands:

- `fetchUserSimfiles<T>()`
- `fetchCloudSong<T>()`
- `createSimfileRecord<T>()`
- `updateSimfileRecord<T>()`

Callers supply their own result shape, so the command name is typed while its payload is not.

That produces duplicated declarations:

- `simFileService.ts` owns `MainProcessSimFileResult`.
- `SongDetails.svelte` owns `CreateSimfileResult` and `UpdateSimfileResult`.
- `scoreTypes.ts` owns `FetchCloudSongResult`.

`getNextDisplayId()` is already concrete as `Promise<number>` and should stay that way.

### Rust boundary

`packages/dtx-desktop/src-tauri/src/api.rs` still uses `serde_json::Value` at the selected structured command boundaries and assembles response envelopes with `json!()`.

HPA-614 already normalized full GraphQL simfiles into the current camelCase application shape through `simfile_model_from_graphql`, but that mapper still returns `Value`. The native wire shape is therefore enforced by convention instead of a Rust type.

### Existing generation

`ts-rs` is already a direct Rust dependency. Several structs in `src-tauri/src/models.rs` derive `TS`, but generated contracts currently target only:

`packages/e2e-desktop/support/generated/native-types.ts`

The root `gen:native-types` script already drives Rust export tests, and Tauri CI already verifies generated output is tracked and in sync. HPA-615 should extend those seams rather than add another generator.

### GraphQL documents

The selected GraphQL operations are embedded as Rust string constants in `api.rs`:

- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

The API schema is already generated and checked in at `packages/dtx-api/dist/schema.graphql`. The web package already owns GraphQL Codegen and verifies generated-client drift in CI, so desktop operation validation can reuse that toolchain without adding another GraphQL dependency.

## Goals

- Make Rust authoritative for the selected production IPC wire shapes.
- Generate production TypeScript contracts from those Rust types.
- Remove caller-supplied generic result types from the selected `desktopHost` methods.
- Remove duplicate renderer interfaces for the migrated commands.
- Keep `SimfileModel` as the shared application model rather than creating another domain model.
- Make the selected desktop GraphQL documents schema-validated.
- Reuse current `ts-rs`, GraphQL Codegen, Rust test, and CI seams.
- Establish a repeatable pattern without forcing untouched commands to migrate.

## Non-goals

- No migration of every Tauri command.
- No new RPC/binding framework.
- No `specta`, `tauri-specta`, protobuf, JSON Schema, Zod, or runtime validation layer.
- No generic request/response registry.
- No full Rust GraphQL client/codegen stack.
- No GraphQL or D1 schema redesign.
- No Tauri command renaming.
- No `api.rs` extraction; HPA-616 owns that.
- No `SongDetails` extraction; HPA-616 owns that.
- No broad E2E generated-contract cleanup.
- No compatibility aliases for the deleted handwritten renderer types.

## Approaches considered

### A. Typed vertical slice using existing `ts-rs`

Add named Rust wire structs for the selected commands, generate their TypeScript mirrors into the production renderer, and migrate only the selected `desktopHost` methods/consumers.

Keep generic GraphQL transport helpers and unrelated Tauri commands untouched.

**Chosen.** It removes the current duplication with the least machinery and creates the concrete seam HPA-616 can later extract.

### B. Generate TypeScript mirrors while commands still return `Value`

Create `ts-rs` structs only for code generation/tests while leaving native command signatures and `json!()` envelopes unchanged.

Rejected because Rust would not actually be authoritative: the runtime response could drift from the generated mirror and still compile.

### C. Replace the whole native API with a binding framework

Adopt a framework that derives commands and frontend clients across every Tauri command.

Rejected as unnecessary infrastructure for a five-command slice. Existing `ts-rs` already solves the current need.

## Chosen architecture

### 1. Add a narrow native contract module

Create:

`packages/dtx-desktop/src-tauri/src/api_contracts.rs`

It owns only the wire types needed by the migrated simfile commands. It is not a generic DTO module for the rest of the application.

The core full-simfile contract should follow this shape:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeSimfileDtxFile {
    #[ts(type = "number")]
    pub id: i64,
    pub label: String,
    pub level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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

The desktop full GraphQL fragment requests each nested DTX id, so the native wire contract makes it required. `DtxFile.level` and simfile `bpm` are GraphQL floats, so their Rust wire types are `f64`.

The explicit TypeScript overrides on 64-bit ids are required because the renderer's established application contract is `number`, not `bigint`. This follows the existing native-generation pattern that already overrides large Rust integers to `number` where the TypeScript runtime contract is numeric.

`NativeSimfile` is the desktop wire representation of the existing application model. It does not replace `@dtx/common`'s `SimfileModel` and must not escape the desktop package.

### 2. Type only the structured command contracts

#### `fetch_user_simfiles`

Return a named `FetchUserSimfilesResult` preserving the current fields:

- `success`
- `data: Vec<NativeSimfile>`
- `fromCache`
- optional `error`

The current native implementation always reports `fromCache: false`; retain it because `simFileService` already exposes that field and removing it is unrelated behavior churn.

Optional response fields use `serde(skip_serializing_if = "Option::is_none")` and `#[ts(optional)]` so generated TypeScript matches runtime omission instead of requiring a property Rust does not serialize.

#### `fetch_cloud_song`

Make the native command id concrete as `String` instead of `serde_json::Value`.

The real renderer callers can use a string id, so simplify `desktopHost.fetchCloudSong` to one form:

```ts
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
```

The wrapper sends `{ cloudSongId }` to Tauri. Delete the current object-or-primitive convenience overload rather than preserving an internal compatibility shape.

Keep the existing response field name `cloudSongData`; renaming that field is not necessary to establish generated contracts.

#### `create_simfile_record`

Add a generated `CreateSimfileRecordInput` covering only the current renderer-owned create fields:

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

`levels[].level` is `f64` because it becomes GraphQL `DtxFileInput.level: Float!`.

Keep `songPath` as command-local input used for preview uploads; it is not part of GraphQL `CreateSimfileInput` or `NativeSimfile`.

`displayId` may be `null` on create to preserve the existing auto-allocation behavior. Its generated TypeScript representation must remain `number | null`, not `bigint | null`.

The result retains current semantics:

- `success`
- optional `simfileId`
- optional `data: NativeSimfile`
- optional `error`
- optional `warnings`

Preview upload failures remain warnings when record creation succeeds.

#### `update_simfile_record`

Add a generated `UpdateSimfileRecordInput` for the current mutable simfile fields and make `desktopHost` accept:

```ts
updateSimfileRecord(simfileId: string, updateData: UpdateSimfileRecordInput)
```

Use optional fields for partial updates. Every optional Rust field that means "not supplied" must include `skip_serializing_if = "Option::is_none"`; serializing `None` as GraphQL `null` would change update semantics by clearing nullable fields instead of omitting them.

For generated TypeScript, optional fields should use `#[ts(optional)]`; any 64-bit numeric optional field also needs an explicit `number`-based TypeScript representation.

`googleDriveFileId` is intentionally absent from the type. HPA-614 had to strip it from a generic map; after HPA-615 it becomes unrepresentable in the general update request, so that defensive removal can disappear.

The success result contains a full `NativeSimfile`, matching current Rust behavior. Delete the weaker handwritten `Partial<SimfileModel>` assumption in `SongDetails`.

#### `get_next_display_id`

Keep the command primitive:

```text
Rust: i64
TypeScript wrapper: number
```

No generated wrapper type is needed. The renderer already validates the returned value with `Number.isSafeInteger`, so this ticket does not introduce `bigint` into the method.

### 3. Convert the existing GraphQL-to-renderer mapper to a typed mapper

Keep the current single normalization seam in `api.rs`, but change it from returning `Value` to returning `NativeSimfile`.

Do not add a mapper framework or generic deserialization abstraction. A focused `native_simfile_from_graphql(&Value) -> Result<NativeSimfile>` function is enough.

This keeps the GraphQL HTTP layer dynamic while making the Tauri boundary typed. HPA-615 does not need a generated Rust GraphQL client to achieve its goal.

### 4. Generate one production TypeScript contract file

Generate the migrated production types into:

`packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

The file is checked in, generated by `ts-rs`, and never edited manually.

Use one aggregate file for this slice, matching the repository's existing single-file E2E generation pattern.

Do not generate into `@dtx/common`; these are desktop transport contracts, not shared domain contracts.

Application-facing services explicitly return/assign `SimfileModel` where appropriate. TypeScript structural checking then proves the generated `NativeSimfile` still satisfies the shared model without introducing a copy-only adapter.

### 5. Keep E2E-only contracts separate

The existing E2E generated file mixes general native and E2E-only control/snapshot types. HPA-615 does not need to reorganize all of it.

For new simfile production contracts:

- generate the authoritative definition only into the production renderer file;
- if desktop E2E needs one of those types, import or thinly re-export it from the production generated path;
- continue generating E2E-only controls/snapshots into `packages/e2e-desktop/support/generated/native-types.ts`.

Do not move E2E-only types into production code and do not create a second Rust mirror of `NativeSimfile` just for tests.

### 6. Move only selected GraphQL documents to files

Create:

`packages/dtx-desktop/src-tauri/graphql/simfiles/`

with documents for:

- the desktop full simfile fragment
- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

Rust loads them with `include_str!`.

For operations that reference the shared fragment, keep the existing simple composition idea: load the fragment and operation separately and concatenate them before the request. No GraphQL document-loader abstraction is needed.

Use desktop-prefixed operation/fragment names to avoid collisions when Codegen validates the desktop documents together.

Leave unrelated operations embedded in `api.rs` for now, including search, score upload, Drive metadata, chart-only projections, and asset-file projections.

### 7. Validate desktop GraphQL with existing Codegen tooling

Do not add `graphql-inspector` or a custom validator.

Add:

`packages/dtx-web/codegen.desktop.ts`

The validation-only config:

- reads `../dtx-api/dist/schema.graphql`;
- reads `../dtx-desktop/src-tauri/graphql/**/*.graphql`;
- generates disposable TypeScript into `packages/dtx-web/.svelte-kit/dtx-desktop-graphql-validation.ts`.

The generated validation artifact is ignored, not committed, and not imported. Its only purpose is to make GraphQL Codegen parse and validate the desktop documents against the checked-in schema.

Extend the existing `lint:codegen` script so it validates both the committed web generated-client drift and desktop operations.

This keeps GraphQL tooling where the dependency already exists instead of adding Codegen packages to the Rust crate or repository root.

### 8. Make selected `desktopHost` methods concrete

`desktopHost.ts` imports the generated contracts and exposes concrete methods:

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

Keep low-level `DesktopHostRuntime.invoke<T>()` and private `invokeHost<T>()` generic. HPA-615 types named application-facing commands, not Tauri's generic invocation primitive.

Untouched command methods remain generic until deliberately migrated.

### 9. Delete renderer duplicates instead of aliasing them

After generated types are in use:

- delete `MainProcessSimFileResult` from `simFileService.ts`;
- delete `CreateSimfileResult` and `UpdateSimfileResult` from `SongDetails.svelte`;
- delete handwritten `FetchCloudSongResult` from `scoreTypes.ts` and import the generated result only where an explicit annotation is still useful;
- remove generic type arguments from migrated `desktopHost` call sites;
- remove the local `isSimfileModel` runtime guard once `fetchCloudSong`/create results carry `NativeSimfile` through generated typing.

Do not leave deprecated aliases. There are no compatibility requirements for these internal contracts.

## Data flow after HPA-615

### Fetch user simfiles

```text
Desktop .graphql document
  -> GraphQL JSON
  -> native_simfile_from_graphql()
  -> FetchUserSimfilesResult
  -> Tauri JSON serialization
  -> generated TypeScript contract
  -> desktopHost.fetchUserSimfiles()
  -> simFileService
  -> SimfileModel application state/cache
```

### Fetch one cloud simfile

```text
renderer string cloudSongId
  -> typed Tauri argument
  -> desktop get-simfile .graphql document
  -> NativeSimfile
  -> FetchCloudSongResult
  -> desktopHost.fetchCloudSong()
  -> SongDetails/Scores
```

### Create/update simfile

```text
SongDetails values
  -> generated typed request
  -> Tauri command
  -> GraphQL variables
  -> GraphQL simfile response
  -> NativeSimfile
  -> generated typed result
  -> SongDetails/workspace SimfileModel
```

No extra renderer mapper is added when the generated wire type is structurally compatible with `SimfileModel`.

## Error and compatibility behavior

Keep current runtime behavior unless typing makes an invalid state impossible.

- GraphQL/network failures remain `{ success: false, error }` results where those commands currently return envelopes.
- Native configuration/workspace errors that currently reject the Tauri command continue to reject it.
- `fetch_user_simfiles` keeps already-fetched partial data if a later page fails.
- Create preview upload failures remain warnings after a successful create.
- `fetch_cloud_song` keeps `cloudSongData` and current not-found failure behavior.
- `get_next_display_id` continues to reject invalid/missing API values.
- General update requests cannot represent `googleDriveFileId`.
- No backward-compatibility interfaces, aliases, or old generic signatures are retained.
- No TypeScript runtime validation is added; the native backend is trusted application code and compile-time generation is the ticket's boundary.

## Generation workflow

Keep the existing root command:

`bun run gen:native-types`

Extend the existing Rust export tests so the same command also emits the production generated file.

Do not add a custom Rust codegen binary unless the current test-driven `ts-rs` export mechanism proves technically insufficient.

Tauri CI explicitly verifies both generated outputs after Rust tests/codegen:

- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- `packages/e2e-desktop/support/generated/native-types.ts`

Use `git ls-files --error-unmatch` for the production output before the diff check so a missing generated file cannot pass silently.

## Testing strategy

### Rust

Extend existing API/model tests rather than building a contract-test framework.

Cover at least:

- complete GraphQL simfile -> `NativeSimfile` conversion;
- required nested DTX ids and Float levels;
- explicit TypeScript `number` representation for 64-bit ids in generated output;
- nullable metadata and camelCase serialization;
- `fetch_user_simfiles` success and later-page-failure envelopes;
- `fetch_cloud_song` success/not-found behavior;
- create success plus optional preview warnings;
- update success returning a full simfile;
- update omission semantics for optional fields;
- inability of the typed update request to carry Drive-owned state;
- existing GraphQL/wiremock request expectations still matching after typed input conversion.

### Generated binding drift

Run:

`bun run gen:native-types`

and require a clean diff for both generated files.

### Renderer

Run existing focused tests for:

- `desktopHost`
- `simFileService`
- `SongDetails`
- `Scores` if its explicit fetch-result annotation changes

No standalone generated-type test suite is needed; renderer compilation is the useful gate.

Run:

`bun run --filter=dtx-desktop typecheck`

### E2E typecheck

Run:

`bun run --filter=dtx-e2e-desktop check`

This catches broken production-type imports/re-exports from E2E support.

### GraphQL validation

Run:

`bun run --filter=dtx-web lint:codegen`

A desktop document containing an invalid field or variable type must fail this command.

### Desktop E2E

Use existing chart/song-detail flows rather than adding a new scenario solely for typing. Update E2E fixtures/imports only where generated contract ownership changes.

The later implementation PR must be marked ready for review so the repository's draft-skipping desktop E2E workflow actually runs before merge.

## Expected file scope

Likely production files:

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs` — new narrow contract module
- `packages/dtx-desktop/src-tauri/src/lib.rs` — register module
- `packages/dtx-desktop/src-tauri/src/api.rs` — typed selected commands and document includes
- `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql` — selected documents
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` — generated
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` — concrete methods
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts` — remove fetch result duplicate
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte` — remove duplicate command result types
- `packages/dtx-desktop/src/renderer/src/components/Scores.svelte` — use concrete fetch result without generic call
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts` — remove handwritten full-simfile result
- `packages/dtx-web/codegen.desktop.ts` — validation-only desktop document config
- `packages/dtx-web/package.json` — add desktop operation validation to `lint:codegen`
- `.github/workflows/tauri-rust-ci.yml` — verify production generated output

Likely test files:

- existing Rust API/model tests
- `desktopHost.test.ts`
- `simFileService.test.ts`
- `SongDetails.test.ts`
- directly affected score/E2E support tests if imports change

This is a scope inventory, not a requirement to touch every file if repository search proves a smaller implementation is sufficient.

## Implementation order

1. Introduce Rust wire structs and focused serialization/conversion tests while preserving current JSON behavior.
2. Generate the production TypeScript contract file and extend drift verification.
3. Move and schema-validate only the selected GraphQL documents.
4. Convert the selected Rust command boundaries to named types.
5. Make the selected `desktopHost` methods concrete.
6. Delete handwritten renderer result interfaces and generic call-site arguments.
7. Reuse/re-export generated production types from E2E only where needed.
8. Run Rust, generation, GraphQL, renderer, and E2E checks.

## Risks and constraints

### Shared model and native wire type can drift

Do not make `@dtx/common` import desktop-generated code; that would reverse package ownership.

Mitigation: application-facing renderer services explicitly return/assign `SimfileModel`, so TypeScript structural checking catches incompatible changes at the desktop usage seam.

### Optional update fields can accidentally become `null`

This is the main serialization risk when replacing `Value` with typed Rust input.

Mitigation: use `skip_serializing_if = "Option::is_none"` for partial update fields and test the actual GraphQL variables sent by existing wiremock tests.

### 64-bit Rust ids can accidentally become TypeScript `bigint`

`ts-rs` 12 treats large integer types separately from ordinary JS numbers. The application contract already uses numeric ids and existing native bindings explicitly map large Rust integers to `number` where required.

Mitigation: annotate each migrated 64-bit id/display-id field with an explicit `number`/`number | null` TypeScript representation and cover generated output in the drift check.

### GraphQL Codegen lives under the web package

That package currently owns the dependency even though the new documents are desktop-owned.

Accept this small tooling asymmetry rather than creating a shared scripts package for one validation command. HPA-617 can revisit tooling ownership later if repository-wide evidence justifies it.

### `api.rs` stays large

Typed contracts add imports/conversion code to an existing orchestration hotspot.

That is intentional. HPA-616 owns extracting natural seams after this ticket makes the boundary concrete; combining the refactor here would make review and rollback harder.

## Completion criteria

HPA-615 is complete when:

- the selected structured simfile commands use named Rust result types and concrete structured inputs instead of `serde_json::Value` at the Tauri boundary;
- production TypeScript contracts are generated by `ts-rs` into the renderer and committed;
- 64-bit Rust simfile/display ids still generate the established TypeScript `number` contract rather than `bigint`;
- `fetchUserSimfiles`, `fetchCloudSong`, `createSimfileRecord`, and `updateSimfileRecord` no longer expose caller-supplied generic result types;
- `getNextDisplayId` remains a concrete primitive number contract;
- `simFileService`, `SongDetails`, `Scores`, and related migrated consumers no longer maintain duplicate IPC result interfaces/generic arguments;
- optional update fields preserve omission semantics rather than serializing absent values as GraphQL `null`;
- selected desktop GraphQL operations live in `.graphql` files loaded by Rust;
- existing GraphQL Codegen tooling rejects schema-invalid desktop documents;
- E2E does not maintain a second independent simfile contract where it consumes production simfile types;
- Rust tests, generated-binding drift checks, desktop renderer tests/typecheck, desktop GraphQL validation, and E2E typecheck pass;
- existing Tauri command names and runtime UX remain unchanged;
- untouched commands remain outside the migration.
