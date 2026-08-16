# HPA-615 Tauri Simfile Contracts Design

## Summary

Make Rust the source of truth for the first production Tauri IPC contract slice: the simfile commands used by desktop chart/song-details flows.

The implementation keeps the current Tauri command names and behavior, keeps `@dtx/common`'s `SimfileModel` as the shared application model established by HPA-614, and uses the repository's existing `ts-rs` dependency to generate TypeScript wire contracts into the production desktop renderer.

Only five commands are in scope:

- `fetch_user_simfiles`
- `fetch_cloud_song`
- `create_simfile_record`
- `update_simfile_record`
- `get_next_display_id`

The first four gain named Rust request/result structs where a structured envelope exists. `get_next_display_id` remains a primitive `i64 -> number` contract because adding an object wrapper would create ceremony without improving correctness.

The selected desktop GraphQL operations move from Rust string constants to checked-in `.graphql` files loaded with `include_str!`, and the existing GraphQL Codegen toolchain validates those documents against `packages/dtx-api/dist/schema.graphql`.

This is a deliberately narrow vertical slice. It does not introduce a new RPC framework, a generic DTO layer, runtime schema validation, a Rust GraphQL client generator, or an `api.rs`/`SongDetails` refactor.

Linear: HPA-615

## Why this is the next slice

HPA-614 is complete and its implementation is merged into `main`. That removes HPA-615's only blocker and leaves a stable current renderer model (`SimfileModel`) for this ticket to type across the Tauri boundary.

HPA-615 also blocks HPA-616 and HPA-617. Completing the production contract seam before extracting `SongDetails`/desktop API orchestration or deleting migration infrastructure prevents those later tickets from preserving handwritten IPC shapes that are about to disappear.

HPA-613 is also medium priority, but it is independent CI optimization work. HPA-615 has stronger sequencing value because it unlocks two follow-up architecture tasks.

## Current problem

The repository already has the pieces required for generated native contracts, but they stop short of production renderer code.

### Renderer boundary

`packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` still exposes generic methods for the selected structured commands:

- `fetchUserSimfiles<T>()`
- `fetchCloudSong<T>()`
- `createSimfileRecord<T>()`
- `updateSimfileRecord<T>()`

Callers supply their own result shape, so the native command name is typed but its payload is not.

This produces duplicated renderer declarations:

- `simFileService.ts` owns `MainProcessSimFileResult`.
- `SongDetails.svelte` owns `CreateSimfileResult` and `UpdateSimfileResult`.
- `scoreTypes.ts` owns `FetchCloudSongResult`.

Those declarations can drift from Rust independently while renderer tests still pass.

`getNextDisplayId()` is already concrete as `Promise<number>` and should stay that way.

### Rust boundary

`packages/dtx-desktop/src-tauri/src/api.rs` uses `serde_json::Value` for the selected structured command inputs/results and builds response envelopes with `json!()`.

HPA-614 already normalized full GraphQL simfiles into the current camelCase application shape through `simfile_model_from_graphql`, but that mapper still returns `Value`. The shape is therefore documented by convention rather than by a Rust type.

### Existing generation

`ts-rs` is already a direct Rust dependency. Several structs in `src-tauri/src/models.rs` derive `TS`, but their export target is currently only:

`packages/e2e-desktop/support/generated/native-types.ts`

The existing root `gen:native-types` script drives the Rust tests that emit these files, and Tauri CI already verifies generated output is committed and in sync.

The missing seam is production renderer ownership, not generation technology.

### GraphQL documents

The selected GraphQL operations are embedded as Rust string constants in `api.rs`:

- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

The API GraphQL schema is already generated and checked in at `packages/dtx-api/dist/schema.graphql`. The web package already owns GraphQL Codegen and verifies its generated client in CI, so HPA-615 can reuse that toolchain for validation rather than adding a second GraphQL validation dependency.

## Goals

- Make Rust authoritative for the selected production IPC wire shapes.
- Generate production TypeScript contracts from those Rust types.
- Remove generic result parameters from the selected `desktopHost` methods.
- Remove duplicated renderer result interfaces for the migrated commands.
- Keep `SimfileModel` as the shared application model rather than creating a second domain model.
- Make the selected GraphQL operation documents independently schema-validated.
- Reuse the current `ts-rs`, GraphQL Codegen, Rust test, and CI seams.
- Establish a repeatable pattern without forcing untouched commands to migrate.

## Non-goals

- No migration of every Tauri command.
- No new RPC/binding framework.
- No `specta`, `tauri-specta`, protobuf, JSON Schema, Zod, or runtime validation layer.
- No generic request/response registry.
- No full Rust GraphQL client/codegen stack.
- No GraphQL schema redesign.
- No D1 or persistence changes.
- No Tauri command renaming.
- No `api.rs` extraction; HPA-616 owns desktop API seam extraction.
- No `SongDetails` extraction; HPA-616 owns that refactor.
- No broad generated E2E contract cleanup beyond reusing the same generated production types where useful.
- No compatibility layer for old handwritten renderer types.

## Approaches considered

### A. Typed vertical slice using existing `ts-rs`

Add named Rust wire structs for the selected commands, generate their TypeScript mirrors into the production renderer, and migrate only the selected `desktopHost` methods/consumers.

Keep generic GraphQL transport helpers and unrelated Tauri commands untouched.

**Chosen.** It removes the real duplication with the least machinery and provides the exact seam HPA-616 can later extract.

### B. Generate TypeScript aliases while Rust commands still return `Value`

Create `ts-rs` mirror structs only for code generation/tests while leaving command signatures and `json!()` envelopes unchanged.

Rejected because Rust would not actually be authoritative. A command response could drift from the generated mirror and compile successfully.

### C. Introduce a comprehensive Tauri binding framework

Adopt a framework that derives commands and frontend clients for the whole native API.

Rejected as unnecessary infrastructure for a five-command slice. It expands dependency and migration scope without solving a current requirement that existing `ts-rs` cannot solve.

## Chosen architecture

### 1. Add a small native simfile contract module

Create:

`packages/dtx-desktop/src-tauri/src/api_contracts.rs`

This module owns only the wire types needed by the migrated simfile commands. It is not a generic DTO layer and should not become a dumping ground for unrelated desktop types.

The module should contain the minimum useful types, approximately:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeSimfileDtxFile {
    pub id: Option<i64>,
    pub label: String,
    pub level: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NativeSimfile {
    pub id: i64,
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

Exact numeric Rust types should follow the current GraphQL/runtime values already accepted by HPA-614 tests. Do not change user-visible behavior to satisfy a preferred Rust number type.

`NativeSimfile` is the Tauri wire representation of the already-established application model. It is not a replacement for `@dtx/common`'s `SimfileModel` and must not be imported outside the desktop package.

### 2. Type only the real structured command envelopes

Use named Rust result types for the first four commands.

#### `fetch_user_simfiles`

Use a discriminated result shape matching current behavior:

```text
success: true  -> data + fromCache
success: false -> error + partial/empty data + fromCache
```

The current native implementation always reports `fromCache: false`; keep the field because it is part of the existing renderer service contract. Removing it is unrelated behavior churn.

#### `fetch_cloud_song`

Keep the existing envelope field name `cloudSongData` so HPA-615 does not combine typing with a renderer behavior rename.

The input should become a concrete simfile id type accepted by current callers rather than `serde_json::Value`. The current renderer passes string/number ids through one `cloudSongId` field; normalize this at the `desktopHost` wrapper if needed so the Rust command has one concrete parameter type.

Prefer `String` at the Rust command boundary because GraphQL IDs are strings and the linked-song renderer path already persists ids as strings.

#### `create_simfile_record`

Introduce a concrete request struct for the renderer-owned create fields:

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

Keep preview upload behavior unchanged.

The result retains current fields:

- `success`
- `simfileId`
- `data`
- optional `error`
- optional `warnings`

Do not make preview warnings part of the simfile domain model.

#### `update_simfile_record`

Introduce a concrete update request type for the current editable fields instead of `Record<string, unknown>` / `Value`.

The type should preserve the existing ownership rule from HPA-614: `googleDriveFileId` is not a general update field and remains owned by the guarded Drive mutation.

Use optional fields for the partial update payload rather than a generic map.

The result contains the full current simfile on success because the Rust command already returns `simfile_model_from_graphql(updateSimfile)`. The current renderer declaration as `Partial<SimfileModel>` is weaker than reality and should be removed.

#### `get_next_display_id`

Keep:

```text
Rust: i64
TypeScript: number
```

Do not wrap the primitive in `{ value }` solely to generate another interface.

### 3. Generate one production TypeScript contract file

Generate the migrated production types into:

`packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

The file is checked in and generated by `ts-rs`; it is never edited by hand.

Use a single production output file for this slice instead of one generated file per struct. The repository already uses one `native-types.ts` aggregate for E2E, and a single production aggregate keeps imports simple.

Do not generate into `@dtx/common`. These are desktop transport contracts, not shared domain contracts.

The production renderer may use structural assignability with `SimfileModel` rather than adding an adapter whose only purpose is copying identically named fields.

Where a public renderer service promises `SimfileModel`, annotate that promise explicitly so a later Rust field change must still satisfy the application contract.

### 4. Reuse generated types from E2E where they overlap

The current E2E generated file contains E2E-only control/snapshot types plus several general native contracts.

HPA-615 does not need to redesign that file. For the newly migrated simfile types, avoid generating a second semantically independent definition.

Preferred shape:

- production simfile contract types export to the production generated file;
- E2E code that needs those production simfile types imports them from the production generated path;
- E2E-only types continue generating to `packages/e2e-desktop/support/generated/native-types.ts`.

If `ts-rs` export constraints make one struct awkward to target from both test contexts, use a thin TypeScript re-export from E2E rather than duplicating a second Rust mirror.

Do not move E2E-only control types into production code.

### 5. Move only selected GraphQL documents to files

Create a focused directory such as:

`packages/dtx-desktop/src-tauri/graphql/simfiles/`

with files for:

- shared full simfile fragment
- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

Use operation/fragment names prefixed for desktop ownership when necessary to avoid accidental name collisions during validation.

Rust loads them with `include_str!`.

Leave these existing operations embedded in `api.rs` for now:

- search cloud songs
- simfile chart projection
- score upload
- Drive metadata/guarded Drive updates
- asset-file projection

They are not required to type the selected command vertical slice.

### 6. Validate desktop GraphQL documents with existing Codegen tooling

Do not add `graphql-inspector` or a custom parser.

Add a small GraphQL Codegen config under `packages/dtx-web` (or an equivalent minimal extension of the existing config) that:

- reads `../dtx-api/dist/schema.graphql`;
- reads `../dtx-desktop/src-tauri/graphql/**/*.graphql`;
- generates validation-only TypeScript into an ignored path under `packages/dtx-web/.svelte-kit/`.

The generated validation artifact is not committed or imported. Its purpose is to make GraphQL Codegen parse and validate the desktop operations against the checked-in schema.

Wire this command into the existing `lint:codegen` workflow so CI validates both web generated-client drift and desktop operation validity after the API schema is regenerated.

This keeps GraphQL tooling ownership in the package that already depends on `@graphql-codegen/*` rather than adding those dependencies to the Rust package or repository root.

### 7. Make `desktopHost` concrete for the selected commands

`desktopHost.ts` imports the generated native contracts and exposes concrete methods.

Examples of the desired direction:

```ts
fetchUserSimfiles(): Promise<FetchUserSimfilesResult>
fetchCloudSong(params: FetchCloudSongInput): Promise<FetchCloudSongResult>
createSimfileRecord(input: CreateSimfileRecordInput): Promise<CreateSimfileRecordResult>
updateSimfileRecord(input: UpdateSimfileRecordInput): Promise<UpdateSimfileRecordResult>
getNextDisplayId(): Promise<number>
```

The low-level `DesktopHostRuntime.invoke<T>()` and private `invokeHost<T>()` remain generic. HPA-615 is typing named application-facing commands, not replacing Tauri's generic invocation primitive.

Untouched command methods may remain generic until migrated deliberately.

### 8. Delete renderer duplicates instead of aliasing them

Once the generated types are in use:

- delete `MainProcessSimFileResult` from `simFileService.ts`;
- delete `CreateSimfileResult` and `UpdateSimfileResult` from `SongDetails.svelte`;
- delete the full-simfile `FetchCloudSongResult` declaration from `scoreTypes.ts` if no remaining score-specific consumer needs it;
- remove generic type arguments at migrated `desktopHost` call sites.

Do not leave deprecated aliases or compatibility interfaces. There are no production consumers requiring them.

The `SongDetails` `isSimfileModel` guard may be removed once the command returns a named Rust `NativeSimfile`/generated result. Keeping a hand-written runtime shape check after making Rust authoritative would reintroduce a second contract definition.

### 9. Keep domain and transport ownership separate

`SimfileModel` remains the model consumed by shared UI and application stores.

Generated `NativeSimfile` is allowed to be structurally identical, but its ownership is different:

- `@dtx/common`: application/domain-facing model used by shared/web/desktop code.
- `dtx-desktop/src-tauri`: authoritative native IPC serialization.
- generated renderer file: compile-time mirror of that IPC serialization.

Do not make common import generated desktop types, and do not move general application behavior into the native contract module.

## Data flow after HPA-615

### Fetch user simfiles

```text
GraphQL .graphql document
  -> Rust GraphQL JSON response
  -> typed Rust NativeSimfile conversion
  -> FetchUserSimfilesResult
  -> Tauri serialization
  -> generated TypeScript contract
  -> desktopHost.fetchUserSimfiles()
  -> simFileService
  -> SimfileModel application state/cache
```

### Fetch one cloud simfile

```text
renderer cloudSongId
  -> typed Tauri input
  -> GraphQL get simfile document
  -> NativeSimfile
  -> FetchCloudSongResult
  -> desktopHost.fetchCloudSong()
  -> SongDetails/workspace SimfileModel
```

### Create/update simfile

```text
SongDetails form values
  -> generated typed request
  -> Tauri command
  -> GraphQL mutation input
  -> GraphQL simfile result
  -> NativeSimfile
  -> generated typed response
  -> SongDetails/workspace SimfileModel
```

No additional mapping layer is inserted between the generated TypeScript wire type and `SimfileModel` when their field shapes match.

## Error behavior

Keep current command behavior unless typing makes an invalid state impossible.

- GraphQL/network failures remain command result failures where the command currently returns `{ success: false, error }`.
- Native configuration/workspace errors that currently reject the Tauri command continue to reject it.
- `fetch_user_simfiles` keeps any already-fetched partial data on a later-page failure.
- Create preview upload failures remain warnings when the simfile record itself succeeded.
- `fetch_cloud_song` keeps the existing `cloudSongData` field and current not-found failure behavior.
- `get_next_display_id` continues to reject invalid/missing API values.
- General update input cannot carry `googleDriveFileId`.

Do not add runtime TypeScript validation. The native side is trusted application code, and compile-time generation is the scope of this ticket.

## Generation workflow

Keep the existing root command:

`bun run gen:native-types`

Extend the Rust export tests invoked by that command so they also emit the production file.

The generation flow remains test-driven because that is already how this repository triggers `ts-rs` output.

Do not add a second custom Rust binary just for codegen unless the existing test export path proves technically unable to generate the production file.

Tauri CI should verify both generated paths are clean after Rust tests/codegen:

- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- `packages/e2e-desktop/support/generated/native-types.ts`

The production file must be explicitly tracked so a missing generated file fails CI rather than silently passing an empty diff check.

## Testing strategy

### Rust contract tests

Add focused tests for each migrated structured command contract.

At minimum:

- `simfile_model_from_graphql` (or its typed replacement) produces the expected `NativeSimfile` from a complete GraphQL payload.
- nullable metadata serializes to the expected camelCase JSON fields.
- `fetch_user_simfiles` success and later-page failure envelopes serialize correctly.
- `fetch_cloud_song` success serializes `cloudSongData` with the current model shape.
- create success includes `simfileId`, `data`, and optional warnings without changing preview behavior.
- update success returns a full simfile and rejects/excludes Drive-owned mutation state as today.
- request structs serialize to the GraphQL variable shapes expected by existing wiremock tests.

Prefer extending the current `api_tests.rs`/model contract tests rather than creating an abstract contract-test framework.

### Generated binding drift

Run `bun run gen:native-types` and prove there is no git diff.

Tauri CI continues to be the load-bearing drift check.

### Renderer unit tests

Update existing service/component tests so mocks use the generated result/input types naturally through `desktopHost`.

No new standalone test suite is needed solely to prove TypeScript types compile; production renderer `svelte-check` is the relevant compile-time gate.

### Renderer typecheck

Run:

`bun run --filter=dtx-desktop typecheck`

This should catch remaining generic call patterns and incompatible use of generated response shapes in production renderer code.

### E2E typecheck

Run:

`bun run --filter=dtx-e2e-desktop check`

This catches invalid imports/re-exports after E2E starts consuming any shared production generated contracts.

### GraphQL validation

Run the existing web codegen/lint command after adding the desktop validation step:

`bun run --filter=dtx-web lint:codegen`

A selected desktop operation with a nonexistent field or invalid variable type must fail this command.

### Desktop E2E

Run focused desktop E2E relevant to chart/song-details flows when locally available, and rely on the existing non-draft desktop E2E CI before merging the later implementation PR.

HPA-615 does not need new E2E scenarios if existing create/link/update flows already exercise the migrated commands. Update fixtures/types only as required by the generated contract changes.

## Expected file scope

Likely production files:

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs` — new narrow contract module
- `packages/dtx-desktop/src-tauri/src/lib.rs` — register module
- `packages/dtx-desktop/src-tauri/src/api.rs` — typed selected commands and `include_str!` documents
- `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql` — selected operation documents
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts` — generated
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts` — concrete selected methods
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts` — remove duplicate fetch result
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte` — remove duplicate create/update/fetch result typing
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts` — remove migrated full-simfile envelope if unused
- `packages/dtx-web/codegen.desktop.ts` (name may vary) — validation-only desktop operation config
- `packages/dtx-web/package.json` — include desktop GraphQL validation in `lint:codegen`
- `.github/workflows/tauri-rust-ci.yml` — verify production generated binding drift

Likely test files:

- current Rust API/model test modules
- `desktopHost.test.ts`
- `simFileService.test.ts`
- directly affected `SongDetails` tests
- E2E support imports only where the new generated production types overlap

Do not treat this list as permission to touch every named file if repository search shows a smaller valid patch.

## Implementation order

1. Introduce Rust wire structs and focused serialization tests while preserving current JSON behavior.
2. Generate the production TypeScript file and extend drift verification.
3. Move/validate only the selected GraphQL documents.
4. Convert the selected Rust command signatures/results to named types.
5. Make the selected `desktopHost` methods concrete.
6. Delete handwritten renderer result interfaces and generic call-site arguments.
7. Reuse/re-export generated production types from E2E only where needed.
8. Run Rust, generation, GraphQL, renderer, and E2E type checks.

Keeping the native type definitions before renderer migration makes each seam reviewable and prevents the renderer from inventing transitional interfaces.

## Risks and constraints

### `SimfileModel` and generated `NativeSimfile` can drift structurally

This ticket intentionally does not make `@dtx/common` consume desktop-generated code because that would reverse package ownership.

Mitigation: renderer services that expose application data explicitly assign/return `SimfileModel`, so TypeScript structural checking catches incompatible production changes at the usage seam.

### `ts-rs` numeric mapping

Rust integer/floating types map to TypeScript `number`, but choosing the wrong Rust type could change deserialization behavior.

Mitigation: preserve the numeric semantics already exercised by current HPA-614 fixtures/API tests; do not convert values just for prettier Rust types.

### GraphQL Codegen location looks web-owned

The web package currently owns GraphQL Codegen dependencies even though the new documents belong to desktop Rust.

This is acceptable for HPA-615 because the validation config is tooling-only and keeps dependency count down. HPA-617 can later reconsider repository tooling ownership if there is enough evidence for a shared scripts package; this ticket should not preempt that work.

### `api.rs` remains large

Typed contracts add imports and conversion code to an already large file.

That is intentional. HPA-616 exists specifically to extract natural seams from the desktop API after HPA-615 makes the boundary concrete. Extracting now would mix two tickets and make review harder.

## Completion criteria

HPA-615 is complete when:

- the selected structured simfile commands use named Rust request/result types instead of `serde_json::Value` at their Tauri command boundary;
- production TypeScript contracts for those types are generated by `ts-rs` into the renderer and committed;
- `fetchUserSimfiles`, `fetchCloudSong`, `createSimfileRecord`, and `updateSimfileRecord` no longer expose caller-supplied generic result types;
- `getNextDisplayId` remains a concrete primitive number contract;
- `simFileService`, `SongDetails`, and related migrated consumers no longer declare duplicate IPC result interfaces;
- selected desktop GraphQL operations live in `.graphql` files loaded by Rust;
- the existing GraphQL Codegen workflow rejects schema-invalid desktop operation documents;
- E2E does not maintain a second independent definition for any production simfile contract it consumes;
- Rust tests, generated-binding drift checks, desktop renderer tests/typecheck, web GraphQL codegen validation, and E2E typecheck pass;
- existing Tauri command names and runtime UX remain unchanged;
- untouched commands remain untouched rather than being swept into a broad contract migration.
