# HPA-614 Current Simfile Model Design

## Summary

Replace the Supabase/REST-era simfile compatibility shapes that still leak through shared UI, web, desktop renderer code, and desktop test fixtures with one current camelCase `SimfileModel` owned by `@dtx/common`.

D1 row types remain snake_case at the server persistence boundary. The web GraphQL client and desktop Rust GraphQL boundary each perform one explicit conversion into the current model. Shared components, web application code, desktop renderer stores/services/components, and renderer caches use the current model.

This is an intentional breaking internal migration. There is no compatibility reader for old renderer payloads or localStorage entries.

Linear: HPA-614

## Why this is the next slice

HPA-614 is unblocked and is the dependency root for HPA-615, HPA-616, and HPA-617. Finishing the model boundary first gives HPA-615 one stable renderer-facing contract to generate toward and avoids extracting compatibility code in HPA-616/617 that is about to be deleted.

## Current problem

The same simfile currently has several overlapping representations:

- `SimfileRow` / `DtxFileRow`: D1 persistence rows with snake_case fields and SQLite boolean representation.
- `SimfileWithDtxFiles`: a server/API-facing D1-derived aggregate.
- `SimfileWithDtx`: a desktop-compatible shape explicitly modeled after the old Supabase contract.
- `LegacySimfile`: a web-only GraphQL adapter that converts current GraphQL camelCase fields back into snake_case.
- Rust `renderer_simfile_from_graphql`: another adapter that converts current GraphQL camelCase fields back into the same old renderer snake_case contract.
- Shared `ChartDetail.svelte`: imports the D1-derived type and therefore requires snake_case fields.
- Desktop renderer stores/services and utility consumers still import `SimfileWithDtx`, including `simFileStore`, `workspaceStore`, `simFileService`, `linkageCacheService`, `linkingService`, `App.svelte`, `SongDetails`, `CloudSongDetail`, `SimFileList`, and `CommandPalette`.
- Desktop E2E helpers seed the old linkage-cache key with the old snake_case shape, so a cache-key bump without updating them would make Drive tests open an unlinked song.

This creates avoidable round trips. GraphQL returns `isPublished`, web maps it to `is_published`, and shared UI reads `is_published`. Desktop does the same in Rust, then maps `display_id` back to `displayId` before sending an update to GraphQL.

The web chart-detail page also casts its `LegacySimfile` into `SimfileWithDtxFiles` to satisfy `ChartDetail`, which is evidence that the shared boundary does not describe the application model.

## Approaches considered

### A. Introduce only `ChartDetailModel`

Change `ChartDetail` to accept a small camelCase view model while leaving `LegacySimfile`, `SimfileWithDtx`, desktop caches, and native renderer payloads unchanged.

This is the smallest immediate diff, but it adds another adapter without removing the obsolete contracts. It would leave HPA-615 and HPA-616 working around the same migration residue. Rejected.

### B. One shared current model with explicit edge adapters

Add one neutral `SimfileModel` in `@dtx/common`, use it throughout shared/web/desktop application code, and keep translation only where data crosses a real boundary:

- D1 persistence stays snake_case on the server.
- Web generated GraphQL results are normalized once in `packages/dtx-web/src/lib/api/chart.ts`.
- Desktop GraphQL results are normalized once in Rust before crossing Tauri IPC.
- Desktop renderer update payloads use explicit camelCase GraphQL input fields.
- Old localStorage cache keys are replaced with versioned keys.
- Desktop E2E cache seeds move to the same versioned key and camelCase shape as the renderer.

This removes compatibility shapes without adding a mapper framework or pulling HPA-615 forward. **Chosen.**

### C. Generate the Tauri contracts in this ticket

Replace Rust `serde_json::Value` command envelopes and the renderer's handwritten result types at the same time.

That is the eventual direction, but it is HPA-615's scope and would combine two independently reviewable migrations. It also makes this ticket depend on production Rust-to-TypeScript generation before the renderer contract is stable. Rejected.

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

`SimfileDtxFile.id` stays optional because the web `SimfileFull`/list projections do not all request chart ids, while desktop already does. Code that uploads scores has a narrower requirement for real chart ids and continues to enforce it at that feature boundary.

Nullable metadata uses `null`, not empty-string sentinels. Transport adapters convert omitted projection fields to `null` or `[]` so application consumers see a stable shape.

`ChartDetail` accepts `Partial<SimfileModel> | null` because the desktop also renders an unlinked local song before a cloud simfile id and remote metadata exist. `Partial` represents an incomplete local draft, not a second compatibility contract.

## Migration ordering

The application model is introduced before the old application-barrel exports are removed.

Task ordering must avoid a workspace-wide transient compile break:

1. add/export `SimfileModel` and migrate `ChartDetail` while the old D1/compatibility exports remain temporarily available;
2. migrate web and native transport boundaries;
3. migrate every renderer and desktop-E2E consumer;
4. only then delete `SimfileWithDtx`, remove D1/compatibility exports from the main `@dtx/common` barrel, and update barrel tests.

Renderer code must never be "fixed" by importing persistence types from `@dtx/common/server`.

## Boundary ownership

### D1 / API server

`SimfileRow`, `DtxFileRow`, `SimfileWithDtxFiles`, and D1 conversion helpers remain in the server/D1 area. They may stay exported from `@dtx/common/server` until HPA-617 moves API-only infrastructure into `dtx-api`.

They stop being exported from the main `@dtx/common` application barrel only after all application consumers have migrated. `packages/common/src/lib/constants.test.ts` is updated in that final cleanup step because it currently asserts `toSimfileWithDtx` on the main barrel.

Delete `SimfileWithDtx` after its renderer consumers move; its sole purpose is the old desktop-compatible contract.

No D1 migration or GraphQL schema change is required.

### Web GraphQL boundary

Replace `LegacySimfile` and `adaptSimfile` with one `toSimfileModel` adapter in `packages/dtx-web/src/lib/api/chart.ts`.

The adapter:

- converts GraphQL `ID` strings to finite numeric ids exactly as today;
- preserves GraphQL camelCase names instead of converting back to snake_case;
- converts absent nullable projection fields to `null`;
- maps `dtxFiles` without inventing D1-only fields;
- preserves optional `files` and `hasUploadedFiles` for detail/list consumers.

`listSimfiles`, `getSimfile`, and `updateSimfile` return `SimfileModel`. `updateSimfileDriveFile` returns `{ id, googleDriveFileId, downloadUrl }` rather than another snake_case mini-contract.

Web chart list/detail components and helpers move mechanically from names such as `is_published`, `display_id`, `download_url`, `dtx_files`, and `has_uploaded_files` to the camelCase model.

`PreviewSimfile` stays separate. It is a purpose-specific preview projection, not an old compatibility shape.

### Shared ChartDetail

`ChartDetail.svelte` imports only `SimfileModel` from the neutral shared type module. Its props and internal bindings use camelCase fields.

The component's emitted save event already uses camelCase names, so this removes the impedance mismatch instead of changing its event contract.

The migration does not change unrelated behavior. In particular, keep the existing `dayjs().format('YYYY-MM-DD')` fallback for `publishDate`; do not replace it with `new Date().toISOString()` during the field rename.

### Desktop native boundary

Keep `serde_json::Value` command plumbing until HPA-615, but stop using it to preserve an obsolete renderer schema.

Rename/refocus `renderer_simfile_from_graphql` to `simfile_model_from_graphql`. It should:

- keep current numeric-id validation;
- return the same camelCase fields as `SimfileModel`;
- normalize nested `dtxFiles` without `simfile_id`;
- stop synthesizing compatibility-only fields for old cached records.

Delete the general snake_case-to-camelCase `update_input_from_renderer` mapper once the renderer sends camelCase update payloads, but preserve its real ownership rule: general simfile updates must not carry `googleDriveFileId`.

`update_simfile_record_impl` therefore performs only the narrow Drive-id omission before sending the object to `UpdateSimfileInput`. It does not become a generic mapper or accept a spread `SimfileModel` as an update payload.

Renderer update objects are explicit picks of fields owned by `UpdateSimfileInput`, for example `displayId`, `publishDate`, `isPublished`, `downloadUrl`, `videoPreviewUrl`, `bpm`, `artist`, and `title`. They are never built as `{ ...simfile }`.

Keep/update the native test that proves `googleDriveFileId` is excluded from the general update mutation.

`search_cloud_songs_impl` returns `isPublished` so search results do not retain a separate snake_case mini-contract.

### Desktop renderer

Migrate all current `SimfileWithDtx` consumers to `SimfileModel`, including:

- `simFileStore`
- `simFileService`
- `workspaceStore`
- `linkageCacheService`
- `linkingService`
- `App.svelte`
- `SongDetails`
- `CloudSongDetail`
- `SimFileList`
- `CommandPalette`
- score-page cloud projections that currently reuse the old contract
- directly affected tests such as `linkingService.test.ts`, `CommandPalette.test.ts`, and `Workspace.test.ts`

Delete `normalizeSimfile` and old positional/cache compatibility comments once native responses already match `SimfileModel`.

Local draft data assembled in `SongDetails` uses camelCase and `Partial<SimfileModel>` directly. Update payloads to Rust are explicit camelCase GraphQL-input picks, not application-model spreads.

The persisted score-link map remains `Record<string, string>`. It is a separate persistence boundary and keeps explicit numeric↔string conversion rather than forcing `SimfileModel.id` back to a string.

### Desktop E2E fixtures

Two desktop-E2E helpers currently seed `dtx_linkage_cache` with the old snake_case cloud-song shape:

- `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`

Both must seed `dtx_linkage_cache_v2` and a camelCase `SimfileModel`-compatible `cloudSongData`, including `isPublished`, `publishDate`, `displayId`, `downloadUrl`, `googleDriveFileId`, `previewUrl`, `videoPreviewUrl`, and `dtxFiles`.

This is part of the migration, not compatibility support. Without it, the renderer correctly ignores the old key and the Drive E2E setup no longer links the song.

## Cache invalidation

Do not parse or migrate previous cached simfile shapes.

Change renderer cache keys to:

- `simfiles_cache_v2`
- `simfiles_cache_timestamp_v2`
- `dtx_linkage_cache_v2`

The old keys are no longer read. A user with stale data gets a normal refetch/relink-cache rebuild through existing behavior. No cache-version registry or migration framework is added.

Tests prove current reads/writes use only the `*_v2` keys and desktop-E2E seeds use the same current key/shape.

## Supabase auth type and `gen-types`

HPA-614's cleanup clause is conditional on the type having no current consumer. That condition is not met on current `main`:

- `packages/dtx-web/src/app.d.ts` uses `SupabaseClient<Database>`.
- `packages/dtx-web/src/hooks.server.ts` creates `createServerClient<Database>`.

Therefore this ticket does **not** delete `packages/common/src/lib/types/supabase.types.ts`, the `Database` export, or the root `gen-types` script. They are type-only auth plumbing, not the application simfile contract.

## Error and compatibility behavior

- Invalid top-level GraphQL simfile ids continue to fail immediately rather than leaking `NaN` into application state.
- Existing corrupt-cache handling remains: parse failures clear the current cache and refetch.
- Old cache entries are unsupported and ignored through the key version bump.
- General simfile updates cannot send `googleDriveFileId`; Drive binding remains owned by its dedicated mutation.
- No aliases, deprecated snake_case properties, proxy accessors, runtime schema library, or generic mapper abstraction are introduced.
- No backwards compatibility is provided for old internal renderer payloads.

## Testing strategy

### Common

- Add camelCase model fixtures.
- Update `ChartDetail.test.ts` to render camelCase fields and `dtxFiles` while retaining existing date-default behavior.
- Keep D1 conversion tests under the persistence boundary.
- Update `constants.test.ts` only when final application-barrel cleanup happens.

### Web

- Update `chart.test.ts` to assert the GraphQL adapter returns camelCase `SimfileModel`, nullable fields, nested levels, assets, and numeric-id validation.
- Update chart-list helper/component tests to assert `isPublished` / `hasUploadedFiles` behavior.
- Update the chart-detail page test to prove no cast/legacy type is required.

### Desktop renderer

- Update store/service/component fixtures to `SimfileModel`.
- Add/adjust cache tests for `*_v2` keys and confirm old keys are ignored.
- Run the direct consumer suites, including `linkingService.test.ts`, `CommandPalette.test.ts`, `Workspace.test.ts`, stores/services, `SongDetails`, list/detail, autocomplete, and scores.
- Preserve action concurrency, stale-selection, auto-link, Drive upload, and score-link behavior while changing field names only.

### Desktop E2E

- Change both linkage-cache seed helpers to `dtx_linkage_cache_v2` + camelCase model data.
- Keep the existing Google Drive upload/crash-recovery flows as regression coverage for restored linkage.

### Rust

- Update API tests to assert camelCase output from `simfile_model_from_graphql` and cloud search.
- Update create/fetch/update tests to assert Tauri envelopes contain the current model.
- Add an update test proving camelCase renderer input reaches GraphQL unchanged except for the deliberate `googleDriveFileId` omission.
- Preserve the Drive-id ownership test when removing the general mapper.

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

1. `SimfileModel` is the only simfile application model imported by shared UI, web application code, desktop renderer code, and current desktop-E2E linkage fixtures.
2. `ChartDetail` no longer imports D1 types, reads only camelCase fields, and keeps its existing date-default behavior.
3. `LegacySimfile` and `SimfileWithDtx` are deleted after all consumers migrate.
4. D1/compatibility exports are removed from the main `@dtx/common` application barrel only in final cleanup; `@dtx/common/server` keeps persistence ownership.
5. The web detail-page cast is deleted.
6. Rust no longer converts current GraphQL payloads into the old snake_case renderer shape, and general renderer updates no longer require `update_input_from_renderer` while still excluding `googleDriveFileId`.
7. Browser/application code contains no compatibility-only snake_case simfile fields; snake_case remains confined to D1/server persistence code and the separately retained Supabase auth `Database` type definition.
8. Desktop simfile/linkage caches and desktop-E2E linkage seeds use the new versioned keys and do not read/seed old entries.
9. The score-link `Record<string, string>` and `PreviewSimfile` remain purpose-specific boundaries rather than being folded into `SimfileModel`.
10. Common, web, desktop renderer, Rust API, and affected desktop-E2E validation covering this seam pass.
