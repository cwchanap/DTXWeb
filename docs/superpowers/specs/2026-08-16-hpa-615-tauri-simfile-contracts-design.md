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

This remains a narrow vertical slice. It does not introduce a new RPC framework, generic DTO layer, runtime schema validation, Rust GraphQL client generator, or an `api.rs`/`SongDetails` refactor.

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

Callers supply their own result shape, so the command name is typed while its payload is not.

That produces duplicated declarations:

- `simFileService.ts` owns `MainProcessSimFileResult`.
- `SongDetails.svelte` owns `CreateSimfileResult` and `UpdateSimfileResult`.
- `scoreTypes.ts` owns `FetchCloudSongResult`.

`getNextDisplayId()` is already concrete as `Promise<number>` and should stay that way.

### Rust boundary

`packages/dtx-desktop/src-tauri/src/api.rs` still uses `serde_json::Value` at the selected structured command boundaries and assembles response envelopes with `json!()`.

HPA-614 already added the correct normalization seam:

```rust
fn number_id(value: &Value) -> Result<i64>
pub fn simfile_model_from_graphql(simfile: &Value) -> Result<Value>
```

That mapper is important because GraphQL `ID!` values arrive as strings while the renderer contract uses numeric simfile/chart ids. HPA-615 should type this mapper's output, not bypass it with `serde_json::from_value`.

HPA-614 also added:

`packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

The fixture already defines the canonical desktop full-simfile JSON shape and is asserted against GraphQL input containing string ids. HPA-615 should keep that file as the contract oracle rather than introduce another expected blob.

### Existing generation

`ts-rs` is already a direct Rust dependency. Existing structs in `src-tauri/src/models.rs` derive `TS` and export to:

`packages/e2e-desktop/support/generated/native-types.ts`

The root `gen:native-types` script already drives Rust export tests, and Tauri CI verifies generated output is tracked and in sync. HPA-615 extends those seams rather than adding another generator.

### GraphQL documents

The selected GraphQL operations are embedded as Rust string constants in `api.rs`:

- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

After HPA-614, `LIST_SIMFILES_QUERY` duplicates the same full simfile field set as `SIMFILE_FULL_FRAGMENT`. Preserving both lists would make every future full-simfile field change require two edits.

The API schema is already generated and checked in at `packages/dtx-api/dist/schema.graphql`. The web package already owns GraphQL Codegen and verifies generated-client drift in CI, so desktop operation validation can reuse that toolchain without adding another GraphQL dependency.

## Goals

- Make Rust authoritative for the selected production IPC wire shapes.
- Generate production TypeScript contracts from those Rust types.
- Preserve the exact HPA-614 `SimfileModel` JSON shape, including present nullable keys.
- Reuse `number_id`, the existing GraphQL mapper, and `simfile_model.json` as the normalization/contract seam.
- Remove caller-supplied generic result types from the selected `desktopHost` methods.
- Remove duplicate renderer interfaces for the migrated commands.
- Keep `SimfileModel` as the shared application model rather than creating another domain model.
- Make selected desktop GraphQL documents schema-validated and share one full-simfile fragment.
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
- No direct deserialization of GraphQL simfile JSON into `NativeSimfile`.

## Reuse decisions

| Proposed work | Existing seam to extend |
| --- | --- |
| `NativeSimfile` / `NativeSimfileDtxFile` | `@dtx/common` `SimfileModel`, `api.rs` `simfile_model_from_graphql`, and `tests/fixtures/simfile_model.json` |
| Typed GraphQL conversion | `api.rs` `number_id` + existing mapper; no second deserializer |
| Production `ts-rs` output | Existing `models.rs` `#[derive(TS)]`/`export_to` pattern and root `gen:native-types` |
| Named command envelopes/inputs | Existing handwritten `MainProcessSimFileResult`, `CreateSimfileResult`, `UpdateSimfileResult`, `FetchCloudSongResult` contracts |
| `.graphql` + `include_str!` | Existing `graphql_document` composition plus web `operations/*.graphql` convention |
| Desktop GraphQL validation | Existing `packages/dtx-web/codegen.ts`, `lint:codegen`, and lint workflow |
| Generated drift CI | Existing `gen:native-types` and `tauri-rust-ci.yml` generated-file check |

## Chosen architecture

### 1. Add a narrow native contract module

Create:

`packages/dtx-desktop/src-tauri/src/api_contracts.rs`

It owns only the wire types needed by the migrated simfile commands. It is not a generic DTO module for the rest of the application.

The core full-simfile contract follows the HPA-614 renderer JSON shape:

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

The desktop full GraphQL fragment requests each nested DTX id, so the native wire makes it required. Missing or invalid nested ids fail conversion; there is no positional fallback.

`DtxFile.level` and simfile `bpm` are GraphQL floats, so their Rust wire types are `f64`.

The explicit TypeScript overrides on 64-bit ids are required because the renderer's established contract is `number`, not `bigint`. This follows the repository's existing generated-native pattern that overrides large Rust integers where JavaScript uses numbers.

#### Nullable full-model fields are present, not optional

`NativeSimfile` must preserve HPA-614's distinction between a present GraphQL null and an omitted request field.

For full-model nullable fields such as:

- `displayId`
- `userId`
- `googleDriveFileId`
- `downloadUrl`
- `previewUrl`
- `videoPreviewUrl`

use ordinary Rust `Option<T>` **without** `serde(skip_serializing_if = "Option::is_none")` and **without** `#[ts(optional)]`.

They serialize as explicit JSON `null` and generate required TypeScript properties with `T | null`. For example:

```ts
displayId: number | null;
googleDriveFileId: string | null;
```

They must never become:

```ts
displayId?: number | null;
googleDriveFileId?: string | null;
```

because that is not assignable to HPA-614's `SimfileModel` and would change runtime JSON.

Omission annotations are used only where omission is part of the existing request/envelope contract, never on `NativeSimfile`.

### 2. Type only the structured command contracts

#### `fetch_user_simfiles`

Return a named `FetchUserSimfilesResult` preserving current fields:

- `success`
- `data: Vec<NativeSimfile>`
- `fromCache`
- `error` only on failure

The native implementation currently reports `fromCache: false`; retain it because `simFileService` already exposes that field and removing it is unrelated behavior churn.

If the result struct uses `Option<String>` for `error`, omission annotations are appropriate there because the current success JSON omits `error`. That envelope-level omission is different from a nullable full-model property.

#### `fetch_cloud_song`

Make the native command id concrete as `String` instead of `serde_json::Value`.

The real renderer callers can use a string id, so simplify `desktopHost.fetchCloudSong` to:

```ts
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
```

The wrapper sends `{ cloudSongId }` to Tauri. Delete the current object-or-primitive convenience overload instead of preserving an internal compatibility shape.

Keep the existing response field name `cloudSongData`; renaming it is not necessary to establish generated contracts.

#### `create_simfile_record`

Add a generated `CreateSimfileRecordInput` covering only current renderer-owned create fields:

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

`displayId` may be `null` on create to preserve current auto-allocation behavior. Its generated TypeScript representation remains `number | null`, not `bigint | null`.

The result retains current semantics:

- `success`
- success-only `simfileId`
- success-only `data: NativeSimfile`
- failure `error`
- optional `warnings`

Result-envelope fields that are genuinely absent in a runtime branch may use omission annotations. That rule does not apply to fields inside `NativeSimfile`.

Preview upload failures remain warnings when record creation succeeds.

#### `update_simfile_record`

Add a generated `UpdateSimfileRecordInput` for current mutable simfile fields and make `desktopHost` accept:

```ts
updateSimfileRecord(simfileId: string, updateData: UpdateSimfileRecordInput)
```

Use optional fields for partial updates. Every Rust `Option<T>` that means **not supplied** must include `skip_serializing_if = "Option::is_none"`; serializing `None` as GraphQL `null` would change update semantics by clearing nullable fields instead of omitting them.

For generated TypeScript, those request fields use `#[ts(optional)]`. Any 64-bit numeric optional field also needs an explicit `number`-based TypeScript representation.

This omission rule is deliberately limited to partial request semantics. It must not be copied onto `NativeSimfile`.

`googleDriveFileId` is absent from the type. HPA-614 had to strip it from a generic map; after HPA-615 it becomes unrepresentable in the general update request, so that defensive removal can disappear.

The success result contains a full `NativeSimfile`, matching current Rust behavior. Delete the weaker handwritten `Partial<SimfileModel>` assumption in `SongDetails`.

#### `get_next_display_id`

Keep the command primitive:

```text
Rust: i64
TypeScript wrapper: number
```

No generated wrapper type is needed. The renderer already validates the returned value with `Number.isSafeInteger`, so this ticket does not introduce `bigint` into the method.

### 3. Type the existing GraphQL normalization mapper; do not deserialize into the wire type

Keep the single HPA-614 normalization seam in `api.rs` and change its output from `Value` to `NativeSimfile`.

Rename/refocus it to:

```rust
fn native_simfile_from_graphql(simfile: &Value) -> Result<NativeSimfile>
```

The implementation explicitly constructs the struct from GraphQL fields and keeps `number_id` for both:

- `Simfile.id`
- every `DtxFile.id`

Do **not** use:

```rust
serde_json::from_value::<NativeSimfile>(...)
```

GraphQL IDs are JSON strings while the native/application wire uses numbers. Direct deserialization would either fail on valid GraphQL responses or establish a second shape.

The nested DTX id is required for the desktop full fragment. Conversion should call `number_id` on it and fail loudly if it is missing/null/invalid.

Lock the typed mapper to the existing HPA-614 fixture:

```rust
let native = native_simfile_from_graphql(&graphql_value).expect("mapped");
let actual = serde_json::to_value(&native).expect("serializes");
let expected: Value = serde_json::from_str(include_str!(
    "../../tests/fixtures/simfile_model.json"
)).expect("fixture parses");
assert_eq!(actual, expected);
```

Do not create a second expected JSON blob for HPA-615.

### 4. Generate one production TypeScript contract file

Generate the migrated production types into:

`packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

The file is checked in, generated by `ts-rs`, and never edited manually.

Use one aggregate file for this slice, matching the repository's existing single-file E2E generation pattern.

Do not generate into `@dtx/common`; these are desktop transport contracts, not shared domain contracts.

Application-facing services may explicitly return/assign `SimfileModel` where useful, but renderer typechecking is a secondary guard. The Rust fixture assertion is the load-bearing proof that native serialization still matches HPA-614's application JSON contract.

### 5. Keep E2E-only contracts separate

The existing E2E generated file mixes general native and E2E-only control/snapshot types. HPA-615 does not need to reorganize all of it.

For new simfile production contracts:

- generate the authoritative definition only into the production renderer file;
- if desktop E2E needs one of those types, import or thinly re-export it from the production generated path;
- continue generating E2E-only controls/snapshots into `packages/e2e-desktop/support/generated/native-types.ts`.

Do not move E2E-only types into production code and do not create a second Rust mirror of `NativeSimfile` just for tests.

### 6. Move selected GraphQL documents to files and share one full fragment

Create:

`packages/dtx-desktop/src-tauri/graphql/simfiles/`

with documents for:

- one desktop full simfile fragment
- list simfiles
- get simfile
- create simfile
- update simfile
- next display id

Rust loads them with `include_str!`.

List/get/create/update all reference the same desktop full fragment. The list operation should select:

```graphql
data {
  ...DesktopSimfileFull
}
```

rather than maintain a second copy of the full field list.

Keep the existing simple composition pattern: load the fragment and operation separately and concatenate them before the request. No GraphQL document-loader abstraction is needed.

Delete the old test assertion that `LIST_SIMFILES_QUERY` must not contain `...SimfileFull`; that policy is stale after HPA-614 made the list projection equal to the full current model.

Retain behavior assertions that the composed list document contains the required full-model fields/timestamps, preferably through the shared fragment rather than duplicated literal checks.

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

The generated validation artifact is ignored, not committed, and not imported. Its purpose is to make GraphQL Codegen parse and validate desktop documents against the checked-in schema.

Extend the existing `lint:codegen` script so it validates both committed web generated-client drift and desktop operations.

This keeps GraphQL tooling where the dependency already exists instead of adding Codegen packages to the Rust crate or repository root.

### 8. Make selected `desktopHost` methods concrete

`desktopHost.ts` imports generated contracts and exposes concrete methods:

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
- remove the local `isSimfileModel` runtime guard once fetch/create results carry `NativeSimfile` through generated typing.

Do not leave deprecated aliases. There are no compatibility requirements for these internal contracts.

## Data flow after HPA-615

### Fetch user simfiles

```text
Desktop list .graphql + DesktopSimfileFull fragment
  -> GraphQL JSON (string IDs)
  -> native_simfile_from_graphql() + number_id()
  -> NativeSimfile
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
  -> desktop get-simfile .graphql + shared fragment
  -> GraphQL JSON
  -> native_simfile_from_graphql() + number_id()
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
  -> native_simfile_from_graphql()
  -> generated typed result
  -> SongDetails/workspace SimfileModel
```

No extra renderer mapper is added when generated native JSON matches the existing HPA-614 `SimfileModel` fixture exactly.

## Error and compatibility behavior

Keep current runtime behavior unless typing makes an invalid state impossible.

- GraphQL/network failures remain `{ success: false, error }` results where commands currently return envelopes.
- Native configuration/workspace errors that currently reject the Tauri command continue to reject it.
- `fetch_user_simfiles` keeps already-fetched partial data if a later page fails.
- Create preview upload failures remain warnings after a successful create.
- `fetch_cloud_song` keeps `cloudSongData` and current not-found failure behavior.
- `get_next_display_id` continues to reject invalid/missing API values.
- General update requests cannot represent `googleDriveFileId`.
- Nullable `NativeSimfile` keys remain present with JSON `null`.
- Partial update keys remain omitted when not supplied.
- No backward-compatibility interfaces, aliases, or old generic signatures are retained.
- No TypeScript runtime validation is added; Rust-generated typing plus the existing fixture own the boundary.

## Generation workflow

Keep the existing root command:

`bun run gen:native-types`

Extend existing Rust export tests so the same command also emits the production generated file.

Do not add a custom Rust codegen binary unless the current test-driven `ts-rs` export mechanism proves technically insufficient.

Tauri CI explicitly verifies both generated outputs after Rust tests/codegen:

- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- `packages/e2e-desktop/support/generated/native-types.ts`

Use `git ls-files --error-unmatch` for the production output before the diff check so a missing generated file cannot pass silently.

## Testing strategy

### Rust: load-bearing wire contract

Extend existing API/model tests rather than building a contract-test framework.

The primary wire assertion is the HPA-614 fixture test:

- GraphQL fixture uses string simfile/DTX ids.
- `native_simfile_from_graphql` parses those ids through `number_id`.
- `serde_json::to_value(&native)` equals `tests/fixtures/simfile_model.json` exactly.
- nullable model fields remain present as JSON `null`.
- nested DTX id is required and invalid/missing ids fail conversion.

Also cover:

- `DtxFile.level`/`bpm` Float conversion;
- explicit TypeScript `number` representation for 64-bit ids in generated output;
- `fetch_user_simfiles` success and later-page-failure envelopes;
- `fetch_cloud_song` success/not-found behavior;
- create success plus optional preview warnings;
- update success returning a full simfile;
- update omission semantics for optional fields;
- inability of the typed update request to carry Drive-owned state;
- existing GraphQL/wiremock request expectations after typed input conversion.

Do not add a second expected full-simfile blob.

### Generated binding drift

Run:

`bun run gen:native-types`

and require a clean diff for both generated files.

This proves committed TypeScript mirrors still match Rust exports. It is complementary to the JSON fixture: generation drift proves type output; the fixture proves runtime wire output.

### Renderer

Run existing focused tests for:

- `desktopHost`
- `simFileService`
- `SongDetails`
- `Scores` if its explicit fetch-result annotation changes

Run:

`bun run --filter=dtx-desktop typecheck`

Treat this as supplementary verification, not the primary wire gate. `tsconfig.web.json` has `strict: false` and excludes `*.test.ts`/`*.spec.ts`, so it cannot replace the Rust fixture assertion or generated-file drift checks.

Use repository grep as a completion gate for removed handwritten IPC types/generic call sites because excluded test TypeScript is not covered by renderer typecheck.

### E2E typecheck

Run:

`bun run --filter=dtx-e2e-desktop check`

This catches broken production-type imports/re-exports from E2E support.

### GraphQL validation

Run:

`bun run --filter=dtx-web lint:codegen`

A desktop document containing an invalid field or variable type must fail this command.

### Desktop E2E and draft-state rule

Use existing chart/song-detail flows rather than adding a scenario solely for typing. Update E2E fixtures/imports only where generated contract ownership changes.

The implementation PR must **leave draft state and be marked ready for review** before final verification. The Tauri Rust CI, lint/format, and desktop E2E jobs all skip draft pull requests and include `ready_for_review` as a trigger, so keeping the implementation PR draft would prevent these gates from running.

The planning-only PR may remain draft.

## Expected file scope

Likely production files:

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs` — new narrow contract module
- `packages/dtx-desktop/src-tauri/src/lib.rs` — register module
- `packages/dtx-desktop/src-tauri/src/api.rs` — typed mapper/selected commands and document includes
- `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql` — shared fragment + selected documents
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

- `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- existing Rust export/model tests
- `desktopHost.test.ts`
- `simFileService.test.ts`
- `SongDetails.test.ts`
- directly affected score/E2E support tests if imports change

Existing fixture reused unchanged:

- `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

This is a scope inventory, not a requirement to touch every file if repository search proves a smaller implementation is sufficient.

## Implementation order

1. Introduce Rust wire structs and change the existing mapper to return `NativeSimfile`, preserving `number_id` conversion and exact `simfile_model.json` serialization.
2. Add focused failure coverage for missing/invalid nested DTX ids and update-input omission semantics.
3. Generate the production TypeScript contract file and extend drift verification.
4. Move list/get/create/update/next-display-id documents to files; make list/get/create/update share the desktop full fragment and remove the stale anti-fragment test.
5. Schema-validate desktop GraphQL documents through existing `dtx-web` Codegen tooling.
6. Convert selected Rust command boundaries to named types.
7. Make selected `desktopHost` methods concrete.
8. Delete handwritten renderer result interfaces and generic call-site arguments.
9. Reuse/re-export generated production types from E2E only where needed.
10. Run fixture, Rust, generation, GraphQL, renderer, grep, and E2E checks; mark the implementation PR ready so draft-skipping CI runs.

## Risks and constraints

### Full-model nullability can accidentally become omission

This would break HPA-614's `SimfileModel` contract and runtime JSON.

Mitigation: no `skip_serializing_if` or `#[ts(optional)]` on `NativeSimfile` nullable fields; the existing fixture must still compare equal after `serde_json::to_value`.

### GraphQL IDs cannot be deserialized directly into numeric native ids

GraphQL returns `ID!` as strings while the application/native wire uses numbers.

Mitigation: preserve `number_id` and explicit typed construction in `native_simfile_from_graphql`; prohibit `serde_json::from_value::<NativeSimfile>` for this conversion.

### Optional update fields can accidentally become `null`

This is a separate meaning from full-model nullability.

Mitigation: use `skip_serializing_if = "Option::is_none"` + `#[ts(optional)]` only for partial request fields (and genuine envelope omissions), then assert actual GraphQL variables with existing wiremock tests.

### Full simfile GraphQL field lists can drift

After HPA-614 the list projection and full fragment are equivalent.

Mitigation: list/get/create/update all reference one desktop full fragment; remove the old no-fragment assertion.

### 64-bit Rust ids can accidentally become TypeScript `bigint`

The application contract already uses numeric ids and existing native bindings explicitly map large Rust integers to `number` where required.

Mitigation: annotate each migrated 64-bit id/display-id field with an explicit `number`/`number | null` TypeScript representation and include the generated output in the drift check.

### Renderer typecheck is not a full contract proof

`tsconfig.web.json` has `strict: false` and excludes test files.

Mitigation: treat the Rust fixture equality test and generated-file drift check as load-bearing, and use grep to prove handwritten contract declarations/generic calls are removed. Renderer typecheck remains useful extra coverage.

### GraphQL Codegen lives under the web package

That package currently owns the dependency even though the new documents are desktop-owned.

Accept this small tooling asymmetry rather than creating a shared scripts package for one validation command. HPA-617 can revisit tooling ownership later if repository-wide evidence justifies it.

### `api.rs` stays large

Typed contracts add imports/conversion code to an existing orchestration hotspot.

That is intentional. HPA-616 owns extracting natural seams after this ticket makes the boundary concrete; combining the refactor here would make review and rollback harder.

## Completion criteria

HPA-615 is complete when:

- selected structured simfile commands use named Rust result types and concrete structured inputs instead of `serde_json::Value` at the Tauri boundary;
- `native_simfile_from_graphql` still performs string-to-number id normalization through `number_id` and serializes exactly to the existing HPA-614 `simfile_model.json` fixture;
- nullable `NativeSimfile` fields are required TypeScript properties with `T | null` and serialize as present JSON nulls;
- nested desktop DTX ids are required and missing/invalid ids fail conversion;
- production TypeScript contracts are generated by `ts-rs` into the renderer and committed;
- 64-bit Rust simfile/display ids still generate the established TypeScript `number` contract rather than `bigint`;
- `fetchUserSimfiles`, `fetchCloudSong`, `createSimfileRecord`, and `updateSimfileRecord` no longer expose caller-supplied generic result types;
- `fetchCloudSong` accepts one string id form;
- `getNextDisplayId` remains a concrete primitive number contract;
- `simFileService`, `SongDetails`, `Scores`, and related migrated consumers no longer maintain duplicate IPC result interfaces/generic arguments;
- optional update fields preserve omission semantics rather than serializing absent values as GraphQL `null`;
- list/get/create/update share one desktop full-simfile fragment and selected desktop operations live in `.graphql` files loaded by Rust;
- existing GraphQL Codegen tooling rejects schema-invalid desktop documents;
- E2E does not maintain a second independent simfile contract where it consumes production simfile types;
- fixture equality, Rust tests, generated-binding drift checks, renderer tests/typecheck, grep gates, desktop GraphQL validation, E2E typecheck, and ready-for-review CI pass;
- existing Tauri command names and runtime UX remain unchanged;
- untouched commands remain outside the migration.
