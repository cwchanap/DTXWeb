# HPA-614 Current Simfile Model Design

## Summary

Replace the Supabase/REST-era simfile compatibility shapes that still leak through shared UI, web, and desktop code with one current camelCase `SimfileModel` owned by `@dtx/common`.

D1 row types remain snake_case at the server persistence boundary. The web GraphQL client and the desktop Rust GraphQL boundary each perform one explicit conversion into the current model. Shared components, web application code, desktop renderer stores/services, and local caches use only the current model.

This is an intentional breaking internal migration. There is no compatibility reader for old renderer payloads or localStorage entries.

Linear: HPA-614

## Why this is the next slice

HPA-614 is currently unblocked and is the dependency root for HPA-615, HPA-616, and HPA-617. Finishing the model boundary first gives the generated Tauri contract work in HPA-615 one stable renderer-facing contract to generate toward, and avoids extracting/refactoring compatibility code in HPA-616/617 that is about to be deleted.

## Current problem

The same simfile currently has several overlapping representations:

- `SimfileRow` / `DtxFileRow`: D1 persistence rows with snake_case fields and SQLite boolean representation.
- `SimfileWithDtxFiles`: a server/API-facing D1-derived aggregate.
- `SimfileWithDtx`: a desktop-compatible shape explicitly modeled after the old Supabase contract.
- `LegacySimfile`: a web-only GraphQL adapter that converts current GraphQL camelCase fields back into snake_case.
- Rust `renderer_simfile_from_graphql`: another adapter that converts current GraphQL camelCase fields back into the same old renderer snake_case contract.
- Shared `ChartDetail.svelte`: imports the D1-derived type and therefore requires snake_case fields.

This creates avoidable round trips. For example, GraphQL returns `isPublished`, web maps it to `is_published`, and shared UI reads `is_published`. Desktop does the same in Rust, then maps `display_id` back to `displayId` before sending an update to GraphQL.

The web chart-detail page also has to cast its `LegacySimfile` into `SimfileWithDtxFiles` to satisfy `ChartDetail`, which is evidence that the shared boundary is not describing the actual application model.

## Approaches considered

### A. Introduce only `ChartDetailModel`

Change `ChartDetail` to accept a small camelCase view model while leaving `LegacySimfile`, `SimfileWithDtx`, desktop caches, and native renderer payloads unchanged.

This is the smallest immediate diff, but it adds another adapter without removing the obsolete contracts. It would leave HPA-615 and HPA-616 working around the same migration residue. Rejected.

### B. One shared current model with explicit edge adapters

Add one neutral `SimfileModel` in `@dtx/common`, use it throughout shared/web/desktop application code, and keep translation only where data crosses a real boundary:

- D1 persistence stays snake_case on the server.
- Web generated GraphQL results are normalized once in `packages/dtx-web/src/lib/api/chart.ts`.
- Desktop GraphQL results are normalized once in Rust before crossing Tauri IPC.
- Desktop renderer update payloads use camelCase directly.
- Old localStorage cache keys are replaced with versioned keys.

This removes compatibility shapes without adding a mapper framework or pulling HPA-615 forward. **Chosen.**

### C. Generate the Tauri contracts in this ticket

Replace Rust `serde_json::Value` command envelopes and the renderer's handwritten result types at the same time.

That is the eventual direction, but it is HPA-615's scope and would combine two independently reviewable migrations. It also makes this ticket depend on production `ts-rs`/codegen machinery before the renderer contract is stable. Rejected.

## Current model

Create `packages/common/src/lib/types/simfile.ts`:

```ts
export interface SimfileDtxFile {
	id?: number;
	label: string;
	level: number;
}

export interface SimfileAssetFile {
	key: string;
	size: number;
	uploaded: string;
}

export interface SimfileModel {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	displayId: number | null;
	userId: string | null;
	googleDriveFileId: string | null;
	isPublished: boolean;
	downloadUrl: string | null;
	previewUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	dtxFiles: SimfileDtxFile[];
	files?: SimfileAssetFile[];
	hasUploadedFiles?: boolean;
}
```

`SimfileDtxFile.id` stays optional because list/detail projections do not all need or currently request the chart id. Code that uploads scores already has a narrower requirement for real chart ids and must continue to enforce it at that feature boundary.

Nullable metadata uses `null`, not empty-string sentinels. The transport adapters are responsible for converting omitted projection fields to `null` or `[]` so application consumers see a stable shape.

`ChartDetail` accepts `Partial<SimfileModel> | null` because the desktop also uses it to render an unlinked local song before a cloud simfile id and remote metadata exist. This remains one named application model; `Partial` only represents an incomplete local draft, not a second compatibility contract.

## Boundary ownership

### D1 / API server

`SimfileRow`, `DtxFileRow`, `SimfileWithDtxFiles`, and D1 conversion helpers remain in the server/D1 area for now. They may stay exported from `@dtx/common/server` until HPA-617 moves API-only infrastructure into `dtx-api`.

They stop being exported from the main `@dtx/common` browser/application barrel. Shared UI and renderer code must not import them.

Delete `SimfileWithDtx` after its renderer consumers move; its sole purpose is the old desktop-compatible contract.

No D1 migration or GraphQL schema change is required.

### Web GraphQL boundary

Replace `LegacySimfile` and `adaptSimfile` with a single `toSimfileModel` adapter in `packages/dtx-web/src/lib/api/chart.ts`.

The adapter:

- converts the GraphQL `ID` string to a finite numeric `id` exactly as today;
- preserves GraphQL camelCase names instead of converting back to snake_case;
- converts absent nullable projection fields to `null`;
- maps `dtxFiles` to `dtxFiles` without inventing D1-only fields;
- preserves optional `files` and `hasUploadedFiles` for detail/list consumers.

`listSimfiles`, `getSimfile`, and `updateSimfile` return `SimfileModel`. `updateSimfileDriveFile` returns `{ id, googleDriveFileId, downloadUrl }` rather than another snake_case mini-contract.

Web chart list/detail components and helpers move mechanically from names such as `is_published`, `display_id`, `download_url`, `dtx_files`, and `has_uploaded_files` to the camelCase model.

### Shared ChartDetail

`ChartDetail.svelte` imports only `SimfileModel` from the neutral shared type module. Its props and internal bindings use:

- `displayId`
- `publishDate`
- `isPublished`
- `downloadUrl`
- `videoPreviewUrl`
- `dtxFiles`

The component's emitted save event already uses camelCase names, so this removes the current impedance mismatch instead of changing its outward event contract.

### Desktop native boundary

Keep `serde_json::Value` command plumbing until HPA-615, but stop using it to preserve an obsolete renderer schema.

Rename/refocus `renderer_simfile_from_graphql` to `simfile_model_from_graphql`. It should:

- keep the current numeric-id validation;
- return the same camelCase fields as `SimfileModel`;
- normalize nested `dtxFiles` without `simfile_id`;
- stop synthesizing compatibility-only fields for old cached records.

`update_simfile_record_impl` sends the renderer's camelCase update object directly as the GraphQL input. Delete `update_input_from_renderer`; the renderer no longer sends `display_id`, `publish_date`, `is_published`, `download_url`, or `video_preview_url`.

`search_cloud_songs_impl` also returns `isPublished` so the search result does not retain a separate snake_case mini-contract.

### Desktop renderer

Migrate the renderer's cloud-simfile ownership to `SimfileModel`:

- `simFileStore`
- `simFileService`
- `workspaceStore`
- `linkageCacheService`
- `SongDetails`
- `CloudSongDetail`
- `SimFileList`
- `CloudSongAutocomplete`
- directly affected tests/services

Delete `normalizeSimfile` and the old positional/cache compatibility comments once all current native responses already match `SimfileModel`.

Local draft data assembled in `SongDetails` should use camelCase and `Partial<SimfileModel>` directly. Update payloads to Rust use the GraphQL-style input names (`displayId`, `publishDate`, `isPublished`, `downloadUrl`, `videoPreviewUrl`) so native no longer has to translate them.

## Cache invalidation

Do not parse or migrate the previous cached simfile shape.

Change the renderer cache keys to:

- `simfiles_cache_v2`
- `simfiles_cache_timestamp_v2`
- `dtx_linkage_cache_v2`

The old keys are simply no longer read. A user with stale data gets a normal refetch/relink-cache rebuild through existing behavior. No cache-version registry or migration framework is added.

Tests must prove that current reads/writes use only the `*_v2` keys.

## Supabase auth type and `gen-types`

HPA-614's cleanup clause is conditional on the type having no current consumer. That condition is not met on current `main`:

- `packages/dtx-web/src/app.d.ts` uses `SupabaseClient<Database>`.
- `packages/dtx-web/src/hooks.server.ts` creates `createServerClient<Database>`.

Therefore this ticket does **not** delete `packages/common/src/lib/types/supabase.types.ts`, the `Database` export, or the root `gen-types` script. They are type-only auth plumbing, not the application simfile contract. Removing or replacing them belongs with later migration cleanup once their consumers are changed deliberately.

## Error and compatibility behavior

- Invalid top-level GraphQL simfile ids continue to fail immediately rather than leaking `NaN` into application state.
- Existing corrupt-cache handling remains: parse failures clear the current cache and refetch.
- Old cache entries are unsupported by design and ignored through the key version bump.
- No aliases, deprecated snake_case properties, proxy accessors, runtime schema library, or generic mapper abstraction are introduced.
- No backwards compatibility is provided for old internal renderer payloads.

## Testing strategy

### Common

- Add direct type/model fixtures using camelCase.
- Update `ChartDetail.test.ts` to render camelCase fields and `dtxFiles`.
- Keep D1 conversion tests under the server/persistence boundary.

### Web

- Update `chart.test.ts` to assert the GraphQL adapter returns camelCase `SimfileModel`, nullable fields, nested levels, assets, and numeric-id validation.
- Update chart-list helper/component tests to assert `isPublished` / `hasUploadedFiles` behavior.
- Update the chart-detail page test to prove no cast/legacy type is required.

### Desktop renderer

- Update store/service/component fixtures to `SimfileModel`.
- Add/adjust cache tests for the new `*_v2` keys and confirm old keys are ignored.
- Preserve action concurrency, stale-selection, Drive upload, and link behavior while changing field names only.

### Rust

- Update API tests to assert camelCase output from `simfile_model_from_graphql` and cloud search.
- Update create/fetch/update tests to assert Tauri envelopes contain the current model.
- Add an update test proving camelCase renderer input is sent to GraphQL unchanged.

## Non-goals

- No GraphQL schema or D1 schema changes.
- No database migration.
- No production TypeScript generation from Rust; that remains HPA-615.
- No extraction of `api.rs` or `SongDetails`; that remains HPA-616.
- No broad `@dtx/common/server` ownership cleanup; that remains HPA-617.
- No UI redesign or behavioral change.
- No generic DTO, mapper, repository, DI, validation, or cache-migration framework.

## Completion criteria

HPA-614 is complete when:

1. `SimfileModel` is the only simfile application model imported by shared UI, web application code, and desktop renderer code.
2. `ChartDetail` no longer imports D1 types and reads only camelCase fields.
3. `LegacySimfile` and `SimfileWithDtx` are deleted.
4. The web detail-page cast is deleted.
5. Rust no longer converts current GraphQL payloads into the old snake_case renderer shape, and renderer updates no longer require `update_input_from_renderer`.
6. Browser/application code contains no compatibility-only snake_case simfile fields; snake_case remains confined to D1/server persistence code and the separately retained Supabase auth `Database` type definition.
7. Desktop simfile/linkage caches use the new versioned keys and do not read old entries.
8. Common, web, desktop renderer, and Rust API tests/type checks covering this seam pass.
