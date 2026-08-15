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
- Rust `renderer_simfile_from_graphql`: another adapter that converts current GraphQL camelCase fields back into the old renderer contract.
- Shared `ChartDetail.svelte`: consumes that compatibility shape rather than a neutral application model.
- Desktop caches and E2E linkage seeds persist the same obsolete snake_case renderer shape.

This creates avoidable round trips. GraphQL returns `isPublished`, web maps it to `is_published`, and shared UI reads `is_published`. Desktop does the same in Rust, then maps `display_id` back to `displayId` before an update is sent to GraphQL.

The web chart-detail page also casts one representation into another to satisfy `ChartDetail`, which is direct evidence that the shared boundary is not describing the actual application model.

## Approaches considered

### A. Introduce only `ChartDetailModel`

Change `ChartDetail` to accept a small camelCase view model while leaving `LegacySimfile`, `SimfileWithDtx`, desktop caches, and native renderer payloads unchanged.

This is the smallest immediate diff, but it adds another adapter without removing the obsolete contracts. HPA-615 and HPA-616 would still inherit the same migration residue. Rejected.

### B. One shared current model with explicit edge adapters

Add one neutral `SimfileModel` in `@dtx/common`, use it throughout shared/web/desktop application code, and keep translation only where data crosses a real boundary:

- D1 persistence stays snake_case on the server.
- Web generated GraphQL results are normalized once in `packages/dtx-web/src/lib/api/chart.ts`.
- Desktop GraphQL results are normalized once in Rust before crossing Tauri IPC.
- Desktop renderer update payloads use GraphQL/current-model names directly.
- Old localStorage cache keys are replaced with versioned keys.
- Desktop E2E linkage seeds use the same current cache key and current-model field names.

This removes compatibility shapes without adding a mapper framework or pulling HPA-615 forward. **Chosen.**

### C. Generate the Tauri contracts in this ticket

Replace Rust `serde_json::Value` command envelopes and renderer handwritten result types at the same time.

That is the eventual direction, but it is HPA-615 scope and combines two independently reviewable migrations. Rejected.

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
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: SimfileDtxFile[];
	files?: SimfileAssetFile[];
	hasUploadedFiles?: boolean;
}
```

The nullability follows the current GraphQL schema rather than transport omissions:

- `publishDate`, `createdAt`, `updatedAt`, and `isPublished` are non-null GraphQL fields.
- The web `SimfileFull` fragment already selects all three timestamps.
- The desktop full fragment already selects all three timestamps.
- The desktop list query currently omits only `createdAt` / `updatedAt`; HPA-614 adds those two selections so a full `SimfileModel` has one timestamp convention instead of treating "not requested" as `null`.
- `files` / `hasUploadedFiles` remain optional because they are genuinely projection-specific extras rather than required base simfile metadata.

`SimfileDtxFile.id` remains optional because the web `SimfileFull` projection does not request it and the shared detail/list UI does not require it. Score upload chart ids come through dedicated score/chart boundaries rather than relying on this optional UI value.

`ChartDetail` accepts `Partial<SimfileModel> | null` because desktop also uses it to render an unlinked local draft before remote metadata exists. This is the existing behavior with `Partial<SimfileWithDtx>`, not a new compatibility representation.

## Boundary ownership

### D1 / API server

`SimfileRow`, `DtxFileRow`, `SimfileWithDtxFiles`, and D1 conversion helpers remain in the server/D1 area. They may stay exported from `@dtx/common/server` until HPA-617 moves API-only infrastructure deliberately.

Delete `SimfileWithDtx` only after every renderer/application consumer has moved. Its purpose is the old desktop-compatible contract.

The main browser/application barrel temporarily keeps its existing D1/compatibility exports while Tasks 1–4 migrate consumers. Task 5 removes those exports only after the load-bearing repository grep proves no application consumer remains. Renderer code must never be redirected to `@dtx/common/server` as an intermediate fix.

No D1 migration or GraphQL schema change is required.

### Web GraphQL boundary

Replace `LegacySimfile` and `adaptSimfile` with one `toSimfileModel` adapter in `packages/dtx-web/src/lib/api/chart.ts`.

The adapter:

- converts GraphQL `ID` to the numeric application id exactly as today;
- preserves current camelCase names instead of converting back to snake_case;
- preserves schema nullability (`publishDate` / timestamps remain required strings);
- maps `dtxFiles` without inventing D1-only fields;
- preserves optional `files` and `hasUploadedFiles` projection data.

`listSimfiles`, `getSimfile`, and `updateSimfile` return `SimfileModel`. `updateSimfileDriveFile` returns `{ id, googleDriveFileId, downloadUrl }`.

`PreviewSimfile` stays separate. Its query deliberately carries `fileUrl` nullability that should not be added to the base application model.

### Shared `ChartDetail`

`ChartDetail.svelte` imports only `SimfileModel`. Its bindings use `displayId`, `publishDate`, `isPublished`, `downloadUrl`, `videoPreviewUrl`, and `dtxFiles`.

The existing `dayjs().format('YYYY-MM-DD')` local-draft fallback stays unchanged. Replacing it with an ISO-UTC expression would be an unrelated timezone-sensitive behavior change.

### Desktop native boundary

Keep `serde_json::Value` command plumbing until HPA-615, but stop using it to preserve an obsolete renderer schema.

Rename/refocus `renderer_simfile_from_graphql` to `simfile_model_from_graphql`. It should:

- keep numeric-id validation for full simfiles;
- return the same camelCase fields as `SimfileModel`;
- normalize nested `dtxFiles` without `simfile_id`;
- stop synthesizing positional chart ids for old cached records;
- include `createdAt` / `updatedAt` in `LIST_SIMFILES_QUERY` so full model timestamps are always present.

General simfile updates need one native ownership rule even after the snake_case mapper disappears: `googleDriveFileId` is owned by the dedicated Drive mutation and must never enter `UpdateSimfileInput`. `update_simfile_record_impl` therefore removes only `googleDriveFileId` inline before issuing the GraphQL mutation. It does not replace `update_input_from_renderer` with another generic mapper or allowlist.

Renderer update payloads are explicit picks, never `{ ...simfile }`.

### Desktop score projection

The score page keeps its narrow `CloudSong` projection separate from the full current model, just as `PreviewSimfile` remains separate on web.

Keep:

```ts
interface CloudSong {
	id: string;
	title: string;
	artist: string;
	isPublished: boolean;
}
```

Only `is_published` becomes `isPublished`. Keeping `id` as a string matches the persisted `Record<string, string>` score-link map and `desktopHost.fetchCloudSongCharts(cloudSongId: string)`, avoiding conversions that do not advance HPA-614.

A full `fetch_cloud_song` result used by `SongDetails` still becomes `SimfileModel` with numeric `id`; the score-page search/link projection is a smaller purpose-specific boundary.

### Desktop renderer

Migrate all full-cloud-simfile consumers to `SimfileModel`, including:

- `simFileStore`
- `simFileService`
- `workspaceStore`
- `linkageCacheService`
- `linkingService`
- `App.svelte`
- `CommandPalette.svelte`
- `SongDetails`
- `CloudSongDetail`
- `SimFileList`
- directly affected tests/fixtures

Delete `normalizeSimfile` and old positional/cache compatibility comments once current native responses already match `SimfileModel`.

Local draft data assembled in `SongDetails` uses camelCase and `Partial<SimfileModel>`. Update payloads are explicit camelCase picks and continue to omit Drive-owned metadata.

## Cross-language contract fixture

The weakest seam today is that Rust and renderer tests hand-write the expected simfile shape independently. Both can drift while still passing their own suites.

HPA-614 adds one repository fixture:

`packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`

It contains one complete base `SimfileModel` payload with required fields and nested `dtxFiles`.

- Rust API tests deserialize the fixture and assert `simfile_model_from_graphql` produces it exactly.
- A desktop Vitest service/cache test reads the same JSON and uses it as native mock output, proving the renderer behavior consumes the same field names.

This is a behavioral cross-language fixture, not a generated type system. Desktop Vitest files are excluded from `tsconfig.web.json`, so this fixture must not be described as TypeScript compile-time enforcement. No `resolveJsonModule` setting is required: the Vitest test can read the JSON with Node `fs`/`URL` rather than changing production TypeScript config for a test-only import.

HPA-615 remains responsible for generated Rust→TypeScript contracts.

## Cache invalidation

Do not parse or migrate previous cached simfile shapes.

Change renderer cache keys to:

- `simfiles_cache_v2`
- `simfiles_cache_timestamp_v2`
- `dtx_linkage_cache_v2`

Old keys are simply no longer read. Desktop E2E helpers that seed linkage state must use `dtx_linkage_cache_v2` and the same camelCase current-model shape; otherwise they silently stop opening a linked song after the key bump.

No cache-version registry or migration framework is added.

Update `CLAUDE.md` cache-clearing instructions in the same migration so the repository documentation points at the active v2 keys.

## Verification reality

Desktop verification has three distinct layers and the plan must not conflate them:

1. `bun run typecheck` / `svelte-check --tsconfig ./tsconfig.web.json` checks production renderer source, but the config has `strict: false` and explicitly excludes `*.test.ts` / `*.spec.ts`.
2. Vitest executes renderer tests but does not type-check their TypeScript annotations.
3. Repository `rg` gates are therefore load-bearing for proving `LegacySimfile` / `SimfileWithDtx` type-only imports and snake_case test fixtures are actually gone.

Desktop E2E is the only full native→renderer seam proof. The workflow skips draft pull requests. Tasks 3 and 4 must land in the same implementation PR, and that PR must be marked ready for review after both tasks are complete so the desktop-E2E workflow runs before merge. A temporary broken state between commits is acceptable inside that one PR; splitting the boundary and consumer migrations across mergeable PRs is not.

The current planning PR may remain draft because it changes docs only. The non-draft requirement applies to the later implementation PR.

## Grep policy

Completion checks should detect actual compatibility syntax rather than treating every historical word in a comment as a bug.

`packages/dtx-web/src/lib/utils.ts` currently has an application helper parameter named `dtx_files`; HPA-614 renames that parameter to `dtxFiles`.

Two existing documentation comments intentionally refer to the real D1 `dtx_files` column and may remain:

- `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.ts`
- `packages/dtx-web/src/routes/preview/[id]/+page.svelte`

The load-bearing grep therefore checks property/object-key syntax for snake_case application fields and separately performs a broad informational grep whose only allowed active matches are true persistence/documentation references such as those two files.

## Supabase auth type and `gen-types`

HPA-614's cleanup clause is conditional on the type having no current consumer. That condition is not met:

- `packages/dtx-web/src/app.d.ts` uses `SupabaseClient<Database>`.
- `packages/dtx-web/src/hooks.server.ts` creates `createServerClient<Database>`.

Therefore HPA-614 does **not** delete `packages/common/src/lib/types/supabase.types.ts`, the `Database` export, or root `gen-types`.

## Error and compatibility behavior

- Invalid full GraphQL simfile ids continue to fail immediately rather than leaking `NaN` into application state.
- Existing corrupt-cache handling remains for malformed current entries.
- Old cache entries are unsupported by design and ignored through the key version bump.
- No aliases, deprecated snake_case properties, proxy accessors, runtime schema library, or generic mapper abstraction are introduced.
- No backwards compatibility is provided for old internal renderer payloads.
- General updates cannot mutate `googleDriveFileId`.

## Testing strategy

### Common

- Add the camelCase model.
- Update `ChartDetail.test.ts` while retaining its current date fallback behavior.
- Keep legacy application-barrel exports until Task 5 so intermediate commits remain compile-safe.

### Web

- Update `chart.test.ts` to assert `toSimfileModel` returns required timestamps, nullable metadata, nested levels, assets, and numeric-id validation.
- Update chart-list/component tests to camelCase.
- Rename the application `formatLevelDisplay(dtx_files)` parameter to `dtxFiles`.
- Update chart-detail page tests and delete the cast.

### Rust

- Add `createdAt` / `updatedAt` to `LIST_SIMFILES_QUERY`.
- Assert full mapper output equals the shared `simfile_model.json` fixture.
- Keep the Drive-id exclusion test at the real outgoing update request seam.
- Keep score search ids as strings; rename only `isPublished` in that narrow projection.

### Desktop renderer

- Feed the same shared fixture into a Vitest native-mock/cache path.
- Update every full simfile fixture to camelCase.
- Add/adjust v2 cache tests and prove v1 keys are ignored.
- Run focused tests plus production renderer typecheck, while explicitly relying on grep gates for excluded test files.

### Desktop E2E

- Update both linkage-cache seed helpers to v2/camelCase.
- Run `packages/e2e-desktop` checks locally when available.
- Mark the implementation PR ready and require the desktop-E2E CI job before merge.

## Non-goals

- No GraphQL schema or D1 schema changes.
- No database migration.
- No production TypeScript generation from Rust; HPA-615 owns that.
- No extraction of `api.rs` or `SongDetails`; HPA-616 owns that.
- No broad `@dtx/common/server` ownership cleanup; HPA-617 owns that.
- No UI redesign or unrelated date behavior change.
- No generic DTO, mapper, repository, DI, validation, or cache-migration framework.

## Completion criteria

HPA-614 is complete when:

1. `SimfileModel` is the authoritative full simfile application model imported by shared UI, web application code, and desktop renderer code.
2. `publishDate`, `createdAt`, and `updatedAt` are required strings in that model, and all full-model native projections select them.
3. `ChartDetail` no longer imports D1 types and retains its current local-date fallback.
4. `LegacySimfile` and `SimfileWithDtx` are deleted after all consumers migrate.
5. The web detail-page cast is deleted.
6. Rust no longer emits the old snake_case renderer simfile shape; general updates still strip `googleDriveFileId` before GraphQL.
7. Desktop score `CloudSong` remains a narrow string-id projection with `isPublished` camelCase.
8. Desktop simfile/linkage caches and both desktop-E2E linkage seeds use the v2 keys/current model.
9. `CLAUDE.md` documents the v2 cache keys.
10. Rust and Vitest consume the same `simfile_model.json` behavioral fixture.
11. Load-bearing greps prove no active `LegacySimfile` / `SimfileWithDtx` imports or snake_case application object/property usage remain, including excluded test files and `packages/e2e-desktop`.
12. Common, web, desktop renderer, Rust API, `e2e-desktop` static checks, and the non-draft desktop-E2E CI gate pass for the implementation PR.
