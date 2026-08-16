# HPA-615 Tauri Simfile Contracts Design

## Summary

Make Rust the source of truth for the first production Tauri IPC contract slice used by desktop chart/song-details flows.

Keep `@dtx/common`'s `SimfileModel` as the application model established by HPA-614. Reuse the existing `ts-rs` generator, GraphQL Codegen config, `number_id` normalization, `simfile_model_from_graphql` mapper, and `simfile_model.json` fixture rather than adding another contract system.

Scope is exactly five commands:

- `fetch_user_simfiles`
- `fetch_cloud_song`
- `create_simfile_record`
- `update_simfile_record`
- `get_next_display_id`

The first four gain concrete Rust request/result types where useful. `get_next_display_id` remains `i64 -> number`. List/get/create/update share one desktop full-simfile GraphQL fragment loaded with `include_str!` and validated by the existing web GraphQL Codegen invocation.

Linear: HPA-615

## Current problem

### Rust and renderer both describe the same wire shape

`api.rs` currently normalizes GraphQL simfiles into camelCase `serde_json::Value`, while renderer callers supply their own generic result types:

- `simFileService.ts`: `MainProcessSimFileResult`
- `SongDetails.svelte`: `CreateSimfileResult`, `UpdateSimfileResult`
- `scoreTypes.ts`: `FetchCloudSongResult`

`desktopHost.ts` therefore knows command names but not the selected commands' actual payload contracts.

### The HPA-614 mapper is already the correct normalization seam

GraphQL `ID!` values arrive as strings, while the renderer/application model uses numbers. HPA-614 already handles that through:

```rust
fn number_id(value: &Value) -> Result<i64>
pub fn simfile_model_from_graphql(simfile: &Value) -> Result<Value>
```

It also added `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`, with a Rust test that feeds string GraphQL ids through the mapper and asserts the numeric/camelCase output exactly.

HPA-615 should type that mapper, not deserialize GraphQL JSON directly into the new Rust wire type.

### GraphQL list fields are duplicated

After HPA-614, `LIST_SIMFILES_QUERY` repeats the same full simfile fields as `SIMFILE_FULL_FRAGMENT`. That creates one-edit-per-field drift.

`GET_SIMFILE_WITH_FILES_QUERY` stays embedded because asset loading is out of scope, but it also spreads the same full fragment and must keep using the fragment after it moves to a file.

### Generated contracts need two repository seams

The production `ts-rs` output needs:

1. a Prettier exclusion so formatting tools do not rewrite generated output and break the generation drift gate; and
2. a typechecked bridge proving generated `NativeSimfile` remains assignable to `@dtx/common` `SimfileModel`.

The existing JSON fixture remains necessary because desktop TypeScript is non-strict and the fixture test is excluded from production typechecking.

## Reuse decisions

| Proposed work                            | Existing seam                                                      |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `NativeSimfile` / `NativeSimfileDtxFile` | `SimfileModel`, `simfile_model_from_graphql`, `simfile_model.json` |
| Typed GraphQL conversion                 | `number_id` + existing mapper                                      |
| Production TypeScript generation         | existing `#[derive(TS)]`, `export_to`, root `gen:native-types`     |
| Four result envelopes                    | current renderer handwritten envelopes                             |
| `.graphql` + `include_str!`              | existing `graphql_document(fragment + operation)`                  |
| Desktop GraphQL validation               | existing `packages/dtx-web/codegen.ts` + `lint:codegen`            |
| Generated drift                          | existing Tauri Rust CI generated-type verification                 |
| Application/wire compile-time link       | new small non-test renderer assertion file                         |

`api_contracts.rs` is the only new Rust ownership seam. `models.rs` is currently centered on filesystem/E2E native types, so keeping production simfile API contracts separate is clearer than extending that file.

## Goals

- Make Rust authoritative for the selected production IPC wire shapes.
- Preserve the exact HPA-614 full-simfile JSON contract, including present nullable keys.
- Keep GraphQL string-id normalization in `number_id`.
- Generate production TypeScript contracts through existing `ts-rs` machinery.
- Add a compile-time link from generated `NativeSimfile` to `SimfileModel`.
- Remove selected generic `desktopHost<T>()` usage and duplicate renderer result interfaces.
- Share one full-simfile GraphQL fragment across list/get/create/update.
- Validate desktop GraphQL documents through the existing Codegen config.

## Non-goals

- No migration of every Tauri command.
- No Specta, protobuf, JSON Schema, Zod, runtime validation, or new RPC framework.
- No generic request/response registry.
- No Rust GraphQL client/codegen stack.
- No GraphQL or D1 schema redesign.
- No command renaming.
- No `api.rs` or `SongDetails` extraction; HPA-616 owns those refactors.
- No broad E2E generated-contract cleanup.
- No compatibility aliases for deleted handwritten renderer contracts.
- No direct full-object GraphQL deserialization into `NativeSimfile`.

## Chosen architecture

### 1. Add a narrow Rust contract module

Create:

`packages/dtx-desktop/src-tauri/src/api_contracts.rs`

`NativeSimfile` is outbound wire data, so derive `Serialize + TS`, not `Deserialize`:

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

The desktop full GraphQL fragment selects every nested DTX id. Those ids are required on the native wire; missing/null/invalid ids fail conversion rather than being silently dropped.

GraphQL `bpm` and DTX `level` are floats, so use `f64`. Explicit `ts-rs` overrides keep 64-bit ids/display ids as TypeScript `number` rather than `bigint`.

### 2. Preserve nulls on the full model; omit only partial inputs/envelope extras

`SimfileModel` requires nullable fields as present keys:

```ts
displayId: number | null;
userId: string | null;
googleDriveFileId: string | null;
downloadUrl: string | null;
previewUrl: string | null;
videoPreviewUrl: string | null;
```

Therefore `NativeSimfile` `Option<T>` fields do **not** use `skip_serializing_if` or `#[ts(optional)]`. `None` serializes to explicit JSON `null` and generates required `T | null` properties.

Omission annotations are limited to places where absence is semantic:

- partial `UpdateSimfileRecordInput` fields;
- result-envelope fields omitted on the opposite success/failure branch.

Create `displayId: None` is a real null value and stays present.

### 3. Type the existing mapper instead of deserializing GraphQL JSON

Rename/refocus the current mapper to:

```rust
fn native_simfile_from_graphql(simfile: &Value) -> Result<NativeSimfile>
```

It explicitly constructs `NativeSimfile` and calls `number_id` for both `Simfile.id` and every `DtxFile.id`.

Do not use `serde_json::from_value::<NativeSimfile>(...)`. `NativeSimfile` intentionally lacks `Deserialize`, making that bypass unavailable.

The existing fixture remains the wire oracle:

```rust
let native = native_simfile_from_graphql(&graphql_value).expect("mapped");
let actual = serde_json::to_value(native).expect("serializes");
let expected: Value = serde_json::from_str(include_str!(
    "../../tests/fixtures/simfile_model.json"
)).expect("fixture parses");
assert_eq!(actual, expected);
```

The typed mapper intentionally tightens malformed-response behavior. Fields that the GraphQL schema marks non-null (`title`, `artist`, `bpm`, `publishDate`, `createdAt`, `updatedAt`, and required nested ids) now cause a conversion error if missing or invalid instead of being propagated as `Value::Null`. Valid schema-conforming responses keep their current behavior.

### 4. Type only the four structured command contracts

#### `fetch_user_simfiles`

Return a named result with:

- `success`
- `data: Vec<NativeSimfile>`
- `fromCache`
- failure `error`

Keep `fromCache: false` from native responses; renderer cache hits still set it to true locally.

#### `fetch_cloud_song`

Make the Rust command id a `String` and simplify renderer API to:

```ts
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
```

Delete the object/number convenience overload. Keep `cloudSongData` as the response field.

#### `create_simfile_record`

Use a concrete input for current renderer-owned fields: title, artist, bpm, displayId, isPublished, publishDate, downloadUrl, videoPreviewUrl, levels, and songPath.

`songPath` remains command-local for preview uploads. `displayId` may be null but is not omitted.

#### `update_simfile_record`

Use a partial `UpdateSimfileRecordInput`. Optional fields use:

```rust
#[serde(skip_serializing_if = "Option::is_none")]
#[ts(optional)]
```

`googleDriveFileId` does not exist on this type, making general updates unable to mutate Drive-owned state.

Keep the existing renderer params-object convention:

```ts
updateSimfileRecord(params: {
  simfileId: string;
  updateData: UpdateSimfileRecordInput;
}): Promise<UpdateSimfileRecordResult>
```

The success envelope carries a full `NativeSimfile`, not `Partial<SimfileModel>`.

#### `get_next_display_id`

Keep Rust `i64` and renderer `Promise<number>` with no wrapper type.

### 5. Generate one production TypeScript file and protect it from formatting

Generate:

`packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`

through existing `#[ts(export, export_to = ...)]` + `bun run gen:native-types` machinery.

Add:

`packages/dtx-desktop/src/renderer/src/lib/generated/`

to `.prettierignore`. Generated output must be compared byte-for-byte after regeneration; formatting tools must not rewrite it.

Do not generate these production simfile contracts into `@dtx/common` or `packages/e2e-desktop/support/generated/native-types.ts`.

### 6. Add a typechecked bridge to `SimfileModel`

Create:

`packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts`

```ts
import type { SimfileModel } from '@dtx/common';
import type { NativeSimfile } from './generated/native-api-contracts';

type NativeSimfileMatchesModel = NativeSimfile extends SimfileModel ? true : never;
export const nativeSimfileMatchesModel: NativeSimfileMatchesModel = true;
```

This lives in production renderer source, so `svelte-check` typechecks it. It catches missing/renamed required application fields that the runtime JSON fixture cannot detect because the fixture's TypeScript test reads JSON as `any`.

Desktop TypeScript has `strict: false`, so this does not replace the Rust fixture/nullability tests. The two gates cover different failure modes:

- fixture equality: runtime field names, values, numeric id normalization, explicit nulls;
- type bridge: generated wire remains structurally assignable to `SimfileModel`.

### 7. Move selected GraphQL documents to files and share one fragment

Create `packages/dtx-desktop/src-tauri/graphql/simfiles/` containing one `DesktopSimfileFull` fragment plus list/get/create/update/next-display-id operations.

List/get/create/update all spread `DesktopSimfileFull` and Rust composes fragment + operation using the existing `graphql_document` helper.

`GET_SIMFILE_WITH_FILES_QUERY` stays embedded because asset loading is outside HPA-615, but change its spread from `...SimfileFull` to `...DesktopSimfileFull` so it still composes with the moved fragment.

Delete the stale test that forbids list from using the full fragment.

### 8. Validate desktop GraphQL in the existing Codegen config

Do not create `codegen.desktop.ts` or another npm script.

Extend `packages/dtx-web/codegen.ts` with a second output:

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

GraphQL Code Generator supports output-specific `documents`; the existing root `documents` continues to feed the committed web client, while the second output validates only desktop documents.

Existing `bun run codegen` and `lint:codegen` need no script changes. The disposable desktop output is under ignored `.svelte-kit/`, while the existing drift check still targets only `src/lib/api/generated/`.

### 9. Make selected renderer methods concrete and delete duplicates

Target renderer API:

```ts
fetchUserSimfiles(): Promise<FetchUserSimfilesResult>
fetchCloudSong(cloudSongId: string): Promise<FetchCloudSongResult>
createSimfileRecord(input: CreateSimfileRecordInput): Promise<CreateSimfileRecordResult>
updateSimfileRecord(params: {
  simfileId: string;
  updateData: UpdateSimfileRecordInput;
}): Promise<UpdateSimfileRecordResult>
getNextDisplayId(): Promise<number>
```

Keep low-level `DesktopHostRuntime.invoke<T>()` and `invokeHost<T>()` generic.

Delete rather than alias:

- `MainProcessSimFileResult`
- `CreateSimfileResult`
- `UpdateSimfileResult`
- handwritten `FetchCloudSongResult`
- `isSimfileModel`

## Testing and verification

### Load-bearing Rust wire fixture

Reuse `tests/fixtures/simfile_model.json` unchanged. The typed mapper test must prove:

- GraphQL string ids become numeric wire ids through `number_id`;
- `serde_json::to_value(NativeSimfile)` equals the fixture exactly;
- nullable model fields remain present as JSON null;
- missing/null/invalid nested DTX ids fail conversion.

Add a `TS::decl()` assertion that nullable native fields generate required `T | null`, not optional properties.

### Compile-time application model bridge

`bun run --filter=dtx-desktop typecheck` must typecheck `nativeContract.ts`. This is load-bearing for missing/renamed application fields; it is supplementary for nullability because desktop TypeScript is non-strict.

### Typed request/envelope tests

- Update `None` fields serialize by omission.
- Create `displayId: None` serializes as a present null.
- Existing wiremock tests assert exact GraphQL variables.
- General update type cannot carry `googleDriveFileId`.

### GraphQL document validation

- List uses `DesktopSimfileFull`.
- Composed list contains the full current model fields.
- Embedded asset query uses the moved fragment name.
- Existing `bun run --filter=dtx-web lint:codegen` validates desktop documents through the second output in `codegen.ts`.

### Generated binding drift

Run `bun run gen:native-types`, then require a clean diff for production `native-api-contracts.ts` and existing E2E `native-types.ts`.

`.prettierignore` must cover the production generated directory so lint-staged / repository formatting cannot mutate the generated file between generation and drift verification.

### Renderer and grep gates

Run existing focused renderer tests and production typecheck. Grep must find no selected handwritten result declarations or generic selected-command calls.

### E2E and PR state

Do not add a new E2E scenario solely for typing. Keep E2E-only generated types separate.

The implementation PR must be marked ready for review before final CI verification because Tauri Rust CI, lint/format, and desktop E2E skip draft PR jobs.

## Expected file scope

New:

- `packages/dtx-desktop/src-tauri/src/api_contracts.rs`
- `packages/dtx-desktop/src-tauri/graphql/simfiles/*.graphql`
- `packages/dtx-desktop/src/renderer/src/lib/generated/native-api-contracts.ts`
- `packages/dtx-desktop/src/renderer/src/lib/nativeContract.ts`

Modify:

- `.prettierignore`
- `packages/dtx-desktop/src-tauri/src/lib.rs`
- `packages/dtx-desktop/src-tauri/src/api.rs`
- `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`
- `packages/dtx-desktop/src/renderer/src/services/desktopHost.ts`
- `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- directly affected renderer tests
- `packages/dtx-web/codegen.ts`
- `.github/workflows/tauri-rust-ci.yml`

Reuse unchanged:

- `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`
- E2E generated-type ownership; do not add production simfile contracts there.

## Risks

- **Full-model nulls become omission:** prevented by Rust fixture + `TS::decl()` tests.
- **GraphQL string IDs bypass `number_id`:** `NativeSimfile` has no `Deserialize`; typed mapper constructs ids explicitly.
- **Wire/application model drift:** fixture covers runtime JSON; `nativeContract.ts` covers structural assignability to `SimfileModel`.
- **Generated file gets reformatted:** production generated directory is ignored by Prettier; CI compares regenerated bytes.
- **Update omission becomes null:** typed update serialization + wiremock variable assertions.
- **Full GraphQL field lists drift:** one shared fragment.
- **`api.rs` remains large:** intentional; HPA-616 owns extraction.

## Completion criteria

HPA-615 is complete when:

- selected structured Tauri commands use named Rust result/input types;
- `native_simfile_from_graphql` preserves `number_id` and serializes exactly to the existing fixture;
- schema-impossible malformed required simfile fields now fail conversion deliberately;
- `NativeSimfile` does not derive `Deserialize`, keeps nullable properties required, and requires nested DTX ids;
- generated `NativeSimfile` is structurally assignable to `SimfileModel` through the typechecked bridge;
- production `ts-rs` output is committed, ignored by Prettier, and clean after regeneration;
- selected `desktopHost` methods are concrete; `fetchCloudSong` is string-only and `updateSimfileRecord` keeps its params-object convention;
- handwritten migrated result types and `isSimfileModel` are removed;
- partial update fields preserve omission and cannot represent `googleDriveFileId`;
- list/get/create/update share `DesktopSimfileFull`, and the embedded asset query still composes with it;
- the existing `codegen.ts` / `lint:codegen` invocation rejects invalid desktop GraphQL documents without an extra config or script;
- E2E generated types do not duplicate the production simfile contract;
- Rust fixture/tests, generated drift, type bridge/typecheck, renderer tests, grep gates, GraphQL validation, E2E typecheck, and ready-for-review CI pass.
