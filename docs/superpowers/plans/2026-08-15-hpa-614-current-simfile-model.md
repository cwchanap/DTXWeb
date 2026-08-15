# HPA-614 Current Simfile Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase/REST-era simfile compatibility shapes with one camelCase `SimfileModel` across shared UI, web, and the desktop renderer while keeping D1 snake_case types server-only.

**Architecture:** `@dtx/common` owns the neutral application model. Web generated GraphQL responses and desktop Rust GraphQL responses each normalize once at their transport boundary. Shared/web/desktop application code consumes the neutral model directly. Old localStorage simfile shapes are invalidated by versioned cache keys rather than migrated.

**Tech Stack:** TypeScript, Svelte 5, Vitest, GraphQL Codegen types, Rust/Tauri, serde_json, Bun workspaces.

## Global Constraints

- Keep D1/Drizzle row types and snake_case fields in server persistence code; do not move them into the application model.
- Use exactly one shared application model: `SimfileModel` plus its nested `SimfileDtxFile` / `SimfileAssetFile` value types.
- Do not add a DTO/mapper framework, runtime schema library, repository layer, cache migration framework, or compatibility aliases.
- Do not change the D1 schema or GraphQL schema.
- Do not add production `ts-rs` or generated Tauri contracts; that is HPA-615.
- Do not extract `api.rs` / `SongDetails`; that is HPA-616.
- Keep `Database` in `packages/common/src/lib/types/supabase.types.ts`, its main-barrel export, and root `gen-types`: current web auth code still consumes `SupabaseClient<Database>`.
- Version caches by switching to `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2`. Never read or adapt the old keys.
- This is a breaking internal migration. Do not retain `LegacySimfile`, `SimfileWithDtx`, snake_case renderer properties, or deprecated aliases.

---

## Task 1: Add the neutral shared model and migrate `ChartDetail`

**Files:**
- Create: `packages/common/src/lib/types/simfile.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/types/d1.types.test.ts`
- Modify: `packages/common/src/lib/components/ChartDetail.svelte`
- Modify: `packages/common/src/lib/components/ChartDetail.test.ts`

- [ ] **Step 1: Make the `ChartDetail` test describe the new contract first**

Change `mockSimfile` in `ChartDetail.test.ts` to camelCase and remove the D1-only `simfile_id` field:

```ts
const mockSimfile = {
	id: 1,
	title: 'Test Song',
	artist: 'Test Artist',
	bpm: 140,
	isPublished: true,
	displayId: 1,
	downloadUrl: 'https://example.com/download',
	publishDate: '2024-01-01',
	videoPreviewUrl: null,
	dtxFiles: [
		{ id: 1, label: 'BASIC', level: 30 },
		{ id: 2, label: 'ADVANCED', level: 60 }
	]
};
```

Rename the DTX-list assertions from `dtx_files` to `dtxFiles`.

- [ ] **Step 2: Run the focused test and confirm the old component contract fails**

Run:

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts
```

Expected: FAIL because `ChartDetail` still reads `display_id`, `is_published`, `download_url`, `publish_date`, `video_preview_url`, and `dtx_files`.

- [ ] **Step 3: Add the shared current model**

Create `packages/common/src/lib/types/simfile.ts` with:

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

`id` on nested DTX files is optional because list projections do not require it. Do not add `simfileId`/`simfile_id` to this UI model.

- [ ] **Step 4: Make the browser-facing common barrel expose the application model, not D1 rows**

In `packages/common/src/lib/index.ts`:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Remove the main-barrel exports of `SimfileRow`, `SimfileInsert`, `SimfileUpdate`, `DtxFileRow`, `DtxFileInsert`, `UserProfileRow`, `UserProfileInsert`, `UserProfileUpdate`, `SimfileWithDtxFiles`, `SimfileWithDtx`, and `toSimfileWithDtx`.

Leave `Database` exported because web auth still uses it. Leave all persistence exports in `packages/common/src/lib/server.ts` unchanged except for removal of `SimfileWithDtx` after Step 5.

- [ ] **Step 5: Delete the desktop-compatible D1 shape**

Delete `SimfileWithDtx` from `packages/common/src/lib/types/d1.types.ts` and remove only tests/imports that exist solely to validate that compatibility shape.

Keep `SimfileWithDtxFiles` and `toSimfileWithDtx` server-side because `dtx-api`/D1 still use them. Do not rename or relocate those server types in HPA-614.

Update `packages/common/src/lib/server.ts` so it no longer exports the deleted `SimfileWithDtx` symbol but still exports current D1/server types.

- [ ] **Step 6: Migrate `ChartDetail` mechanically to camelCase**

Change the prop type to:

```ts
import type { SimfileModel } from '../types/simfile';

interface Props {
	simfile?: Partial<SimfileModel> | null;
	// existing non-simfile props unchanged
}
```

Update only the field reads/bind defaults:

```ts
displayId = $bindable(simfile?.displayId ?? 0);
publishDate = $bindable(simfile?.publishDate ?? new Date().toISOString().split('T')[0]);
isPublished = $bindable(simfile?.isPublished ?? true);
downloadUrl = $bindable(simfile?.downloadUrl ?? '');
videoPreviewUrl = $bindable(simfile?.videoPreviewUrl ?? '');
let dtxFiles = $derived(simfile?.dtxFiles ?? []);
```

Do not change the component layout or its existing camelCase save event payload.

- [ ] **Step 7: Run common verification**

Run:

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts src/lib/types/d1.types.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit the shared-model slice**

```bash
git add packages/common/src/lib/types/simfile.ts \
  packages/common/src/lib/index.ts \
  packages/common/src/lib/server.ts \
  packages/common/src/lib/types/d1.types.ts \
  packages/common/src/lib/types/d1.types.test.ts \
  packages/common/src/lib/components/ChartDetail.svelte \
  packages/common/src/lib/components/ChartDetail.test.ts
git commit -m "refactor(common): define current simfile model"
```

---

## Task 2: Migrate the web GraphQL boundary and web consumers

**Files:**
- Modify: `packages/dtx-web/src/lib/api/chart.ts`
- Modify: `packages/dtx-web/src/lib/api/chart.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartList.helpers.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartList.helpers.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
- Modify: `packages/dtx-web/src/lib/utils.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts`

- [ ] **Step 1: Change the API adapter tests to the new public shape**

In `chart.test.ts`, replace snake_case output assertions with camelCase assertions. Cover one complete adapter result, including nullable fields and nested DTX files:

```ts
expect(result).toMatchObject({
	id: 7,
	title: 't',
	googleDriveFileId: 'drive-file-123',
	displayId: null,
	isPublished: false,
	dtxFiles: []
});
```

Update list tests to assert `hasUploadedFiles`, and Drive-binding tests to expect:

```ts
{
	id: 9,
	googleDriveFileId: 'drive-file-123',
	downloadUrl
}
```

Keep the existing invalid numeric-id test.

- [ ] **Step 2: Change chart-list helper tests to camelCase before implementation**

Update helper fixtures and expectations so navigation/selectability uses:

```ts
{ id: 1, isPublished: true, hasUploadedFiles: true }
```

Run:

```bash
cd packages/dtx-web
bun vitest run src/lib/api/chart.test.ts src/lib/components/ChartList.helpers.test.ts
```

Expected: FAIL while the web adapter/helpers still emit/read snake_case.

- [ ] **Step 3: Replace `LegacySimfile` with a typed `SimfileModel` adapter**

In `chart.ts`:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Delete `LegacySimfile`. Rename/refocus `adaptSimfile` to `toSimfileModel` and return `SimfileModel`.

The adapter must use the current field names and stable null defaults:

```ts
const toSimfileModel = (simfile: AdaptSimfileInput): SimfileModel => ({
	id: parseSimfileId(simfile.id),
	title: simfile.title ?? '',
	artist: simfile.artist ?? '',
	bpm: Number(simfile.bpm ?? 0),
	displayId: simfile.displayId ?? null,
	userId: simfile.userId ?? null,
	googleDriveFileId: simfile.googleDriveFileId ?? null,
	isPublished: simfile.isPublished ?? false,
	downloadUrl: simfile.downloadUrl ?? null,
	previewUrl: simfile.previewUrl ?? null,
	videoPreviewUrl: simfile.videoPreviewUrl ?? null,
	publishDate: simfile.publishDate ?? null,
	createdAt: simfile.createdAt ?? null,
	updatedAt: simfile.updatedAt ?? null,
	dtxFiles: (simfile.dtxFiles ?? []).map((file): SimfileDtxFile => ({
		...(file.id == null ? {} : { id: parseSimfileId(file.id) }),
		label: file.label,
		level: Number(file.level)
	})),
	...(simfile.files == null ? {} : { files: simfile.files }),
	...(simfile.hasUploadedFiles == null
		? {}
		: { hasUploadedFiles: simfile.hasUploadedFiles })
});
```

Use the existing numeric-id helper/error behavior rather than adding validation machinery.

Make `listSimfiles`, `getSimfile`, and `updateSimfile` return this model. Make `updateSimfileDriveFile` return camelCase `{ id, googleDriveFileId, downloadUrl }`.

- [ ] **Step 4: Migrate chart-list helpers and components**

In `ChartList.helpers.ts` rename the narrow navigation fields:

```ts
export type ChartNavigationItem = {
	id?: number;
	isPublished?: boolean;
	hasUploadedFiles?: boolean;
};
```

Update `canBulkSelect`, `isPreviewable`, and `chartTitleHref` to use `hasUploadedFiles` / `isPublished`.

In `ChartList.svelte`, use `SimfileModel[]` directly and change all list state/filter/toggle reads to `isPublished`, `hasUploadedFiles`, `displayId`, and `dtxFiles`.

In `ChartListItem.svelte` and `ChartListTableItem.svelte`, replace `SimfileWithDtx` with `SimfileModel` and migrate their field reads. In particular:

```svelte
<DownloadDropdown
	simfileId={item.id}
	externalUrl={item.downloadUrl ?? null}
	hasUploadedFiles={item.hasUploadedFiles}
/>
```

Do not change UI behavior or styling.

- [ ] **Step 5: Remove the last web D1 test dependency**

In `packages/dtx-web/src/lib/utils.test.ts`, replace `DtxFileRow[]` fixtures with `SimfileDtxFile[]` (or the function's existing minimal `{ level }[]` structural type) and delete `simfile_id` from those fixtures.

This is necessary so the main `@dtx/common` barrel can stop exposing D1 row types.

- [ ] **Step 6: Migrate the web chart-detail page without a cast**

In `+page.svelte`:

```ts
import type { SimfileModel } from '@dtx/common';

let simfile: SimfileModel | null = $state(null);
```

Delete the `LegacySimfile` import and the cast:

```svelte
<ChartDetail simfile={simfile} ... />
```

Change page-level reads from `is_published` and other snake_case names to the current camelCase fields. Keep `files` handling unchanged apart from the new model type.

Update `chart-detail-page.test.ts` fixtures to camelCase and preserve the current load/save/error behavior assertions.

- [ ] **Step 7: Run web tests and type check**

Run:

```bash
cd packages/dtx-web
bun vitest run \
  src/lib/api/chart.test.ts \
  src/lib/components/ChartList.helpers.test.ts \
  src/lib/components/ChartListItem.test.ts \
  src/lib/components/ChartListTableItem.test.ts \
  src/lib/utils.test.ts \
  'src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts'
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit the web migration**

```bash
git add packages/dtx-web/src/lib/api/chart.ts \
  packages/dtx-web/src/lib/api/chart.test.ts \
  packages/dtx-web/src/lib/components/ChartList.helpers.ts \
  packages/dtx-web/src/lib/components/ChartList.helpers.test.ts \
  packages/dtx-web/src/lib/components/ChartList.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts \
  packages/dtx-web/src/lib/components/ChartListTableItem.svelte \
  packages/dtx-web/src/lib/components/ChartListTableItem.test.ts \
  packages/dtx-web/src/lib/utils.test.ts \
  'packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte' \
  'packages/dtx-web/src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts'
git commit -m "refactor(web): consume current simfile model"
```

---

## Task 3: Make the Rust/Tauri simfile boundary emit the current model

**Files:**
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

- [ ] **Step 1: Rewrite native API assertions to require camelCase renderer output**

Update the existing `renderer_simfile_from_graphql`/fetch/create/update/search tests in `api_tests.rs` so expected JSON uses:

```json
{
  "id": 42,
  "displayId": 7,
  "userId": "user-1",
  "googleDriveFileId": null,
  "isPublished": true,
  "downloadUrl": null,
  "previewUrl": null,
  "videoPreviewUrl": null,
  "publishDate": "2026-08-15",
  "createdAt": "2026-08-15T00:00:00Z",
  "updatedAt": "2026-08-15T00:00:00Z",
  "dtxFiles": [{ "id": 99, "label": "EXT", "level": 85 }]
}
```

Update cloud-search expectations from `is_published` to `isPublished`, and make search ids numeric so the renderer does not retain another incompatible id representation.

Add/update the update-command test so the renderer input is camelCase:

```json
{
  "displayId": 7,
  "publishDate": "2026-08-15",
  "isPublished": true,
  "downloadUrl": "https://example.test/chart.zip",
  "videoPreviewUrl": "https://example.test/video"
}
```

and the GraphQL mock receives those names unchanged.

- [ ] **Step 2: Run the native API test module and confirm failure**

Run:

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: FAIL because native mapping still emits snake_case and update input still passes through `update_input_from_renderer`.

- [ ] **Step 3: Replace the renderer compatibility mapper**

Rename:

```rust
renderer_simfile_from_graphql
```

to:

```rust
simfile_model_from_graphql
```

Keep `number_id` validation, but emit current JSON keys:

```rust
mapped.insert("id".to_string(), json!(number_id(&simfile["id"])?));
mapped.insert("displayId".to_string(), simfile["displayId"].clone());
mapped.insert("userId".to_string(), simfile["userId"].clone());
mapped.insert(
    "googleDriveFileId".to_string(),
    simfile["googleDriveFileId"].clone(),
);
mapped.insert("isPublished".to_string(), simfile["isPublished"].clone());
mapped.insert("downloadUrl".to_string(), simfile["downloadUrl"].clone());
mapped.insert("previewUrl".to_string(), simfile["previewUrl"].clone());
mapped.insert(
    "videoPreviewUrl".to_string(),
    simfile["videoPreviewUrl"].clone(),
);
mapped.insert("publishDate".to_string(), simfile["publishDate"].clone());
mapped.insert("createdAt".to_string(), simfile["createdAt"].clone());
mapped.insert("updatedAt".to_string(), simfile["updatedAt"].clone());
```

Keep `title`, `artist`, and `bpm` unchanged. Emit the nested collection as `dtxFiles` with only `id` when present plus `label`/`level`. Delete the positional id fallback that existed only for old cached renderer records.

Use `simfile_model_from_graphql` in `fetch_user_simfiles_impl`, `fetch_cloud_song_impl`, `update_simfile_record_impl`, and `create_simfile_record_impl`.

- [ ] **Step 4: Delete the renderer-to-GraphQL snake_case round trip**

Delete `update_input_from_renderer`.

Change `update_simfile_record_impl` from:

```rust
"input": update_input_from_renderer(update_data),
```

to:

```rust
"input": update_data,
```

The renderer will send only current GraphQL input names. Do not introduce an allowlist/mapper here; the GraphQL input remains the validation boundary.

- [ ] **Step 5: Make cloud search use the current projection names**

In `search_cloud_songs_impl`, return numeric `id` and camelCase `isPublished`:

```rust
json!({
    "id": number_id(&song["id"]),
    "title": song["title"],
    "artist": song["artist"],
    "bpm": song["bpm"],
    "isPublished": song["isPublished"],
})
```

If the closure needs fallible id parsing, collect a `Result<Vec<Value>>` rather than falling back to a string or `0`.

- [ ] **Step 6: Run Rust formatting and tests**

Run:

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

If `cargo fmt --check` reports formatting changes, run `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml`, then rerun both commands.

Expected: PASS.

- [ ] **Step 7: Commit the native boundary change**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor(desktop): emit current simfile model from native API"
```

---

## Task 4: Migrate desktop renderer state, consumers, and caches

**Files:**
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkageCacheService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkageCacheService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/simFileStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/simFileStore.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongDetail.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongDetail.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SimFileList.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SimFileList.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongAutocomplete.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongAutocomplete.test.ts`
- Modify as required by the same `CloudSong` type rename: `packages/dtx-desktop/src/renderer/src/components/ScoreSongCard.svelte`, `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`, and their existing tests.

- [ ] **Step 1: Make cache tests prove old shapes are not read**

In `simFileService.test.ts`, update fixtures to camelCase and assert the service only accesses:

```ts
'simfiles_cache_v2'
'simfiles_cache_timestamp_v2'
```

Add a test where the mock returns old data only for `simfiles_cache` and confirm `fetchUserSimfiles` is still called. This proves the old cache is ignored, not adapted.

In `linkageCacheService.test.ts`, update `sampleSimfile` to `SimfileModel`, expect writes/removals against `dtx_linkage_cache_v2`, and add the equivalent old-key-ignore test.

Run:

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts
```

Expected: FAIL because the implementation still uses v1 keys and `SimfileWithDtx`.

- [ ] **Step 2: Version the caches without migration code**

In `simFileService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';

const CACHE_KEY = 'simfiles_cache_v2';
const CACHE_TIMESTAMP_KEY = 'simfiles_cache_timestamp_v2';
```

Change `MainProcessSimFileResult`, `SimFileServiceResult`, `getCachedData`, and `setCachedData` from `SimfileWithDtx` to `SimfileModel`.

In `linkageCacheService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';

const LINKAGE_CACHE_KEY = 'dtx_linkage_cache_v2';
```

Change `cloudSongData` and `saveLinkage` to `SimfileModel`. Do not read, delete, or transform `dtx_linkage_cache`; leaving an unreachable old localStorage entry is cheaper and safer than migration logic.

- [ ] **Step 3: Migrate desktop stores to `SimfileModel`**

In `simFileStore.ts`, replace every `SimfileWithDtx` annotation with `SimfileModel`.

In `workspaceStore.ts`:

```ts
import type { SimfileModel } from '@dtx/common';
```

Use it for `TreeNode.linkedSimFile`, `selectedCloudSimFile`, `selectCloudSimFile`, and `linkSimFileToFolder`.

Keep `GoogleDriveFields` camelCase and stop translating them back to snake_case:

```ts
const driveUpdates: Partial<SimfileModel> = {};
if (fields.googleDriveFileId) {
	driveUpdates.googleDriveFileId = fields.googleDriveFileId;
}
if (fields.downloadUrl) {
	driveUpdates.downloadUrl = fields.downloadUrl;
}
```

Update both store test fixture families to camelCase.

- [ ] **Step 4: Migrate the desktop score/link projections to the current naming**

In `scoreTypes.ts`, import `SimfileModel` and make the cloud-search projection reuse the current model keys:

```ts
export type CloudSong = Pick<SimfileModel, 'id' | 'title' | 'artist' | 'isPublished'>;
```

Delete the old `CloudSongData` snake_case interface. Make the fetch envelope default to the full current model:

```ts
export interface FetchCloudSongResult<T = SimfileModel> {
	success: boolean;
	cloudSongData?: T;
	error?: string;
}
```

Update `CloudSongAutocomplete.svelte` to use the shared `CloudSong` type instead of redeclaring a second interface. Its exclusion check must compare `String(song.id)` with the existing string id list.

Update `ScoreSongCard.svelte`, `Scores.svelte`, and their tests only where the `CloudSong.id` number / `isPublished` rename requires it. Do not refactor score matching in this ticket.

- [ ] **Step 5: Migrate read-only cloud components**

In `CloudSongDetail.svelte`:

- `SimfileWithDtx` -> `SimfileModel`
- `dtx_files` -> `dtxFiles`
- `publish_date` -> `publishDate`
- `is_published` -> `isPublished`

In `SimFileList.svelte`:

- `publish_date` -> `publishDate`
- `dtx_files` -> `dtxFiles`
- `is_published` -> `isPublished`

Update their tests mechanically. No markup/layout redesign.

- [ ] **Step 6: Migrate `SongDetails` and delete renderer compatibility normalization**

Replace the imports with:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Change create/update/fetch result types from `SimfileWithDtx` to `SimfileModel` / `Partial<SimfileModel>`.

Rename the small IPC guard to `isSimfileModel` and keep it minimal until HPA-615, e.g. validate only the object/id/title shape needed to reject obviously malformed IPC data. Do not add Zod or a schema abstraction.

Delete `normalizeSimfile`. Native now returns the current model, so linking becomes:

```ts
if (result.success && result.cloudSongData && isSimfileModel(result.cloudSongData)) {
	const linkedSimfile = result.cloudSongData;
	song.linkedSimFileId = String(linkedSimfile.id);
	song.linkedSimFile = linkedSimfile;
	workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);
}
```

Build local fallback levels as `SimfileDtxFile[]`:

```ts
const fallbackDtxFiles: SimfileDtxFile[] = parsedLocalData.levels?.map((level) => ({
	label: level.label || 'Unknown',
	level: Number(level.level || 0)
})) ?? [];
```

Build `simfileData` as `Partial<SimfileModel>` with `publishDate`, `displayId`, `isPublished`, `downloadUrl`, `videoPreviewUrl`, and `dtxFiles`.

Change the update payload sent to `desktopHost.updateSimfileRecord` to GraphQL/current names:

```ts
const updateData: Record<string, unknown> = {
	displayId: Number(event.detail.displayId),
	publishDate: String(event.detail.publishDate),
	isPublished: Boolean(event.detail.isPublished),
	videoPreviewUrl: String(event.detail.videoPreviewUrl)
};
if (!isDriveBound) {
	updateData.downloadUrl = String(event.detail.downloadUrl);
}
```

Change all linked-record reads such as `google_drive_file_id` / `download_url` to `googleDriveFileId` / `downloadUrl`.

Update `SongDetails.test.ts` fixtures/IPC assertions accordingly. Preserve all existing stale-selection, concurrent action, linking, save, and Drive upload behavior tests.

- [ ] **Step 7: Run desktop renderer tests and type check**

Run:

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts \
  src/renderer/src/stores/simFileStore.test.ts \
  src/renderer/src/stores/workspaceStore.test.ts \
  src/renderer/src/components/SongDetails.test.ts \
  src/renderer/src/components/CloudSongDetail.test.ts \
  src/renderer/src/components/SimFileList.test.ts \
  src/renderer/src/components/CloudSongAutocomplete.test.ts \
  src/renderer/src/components/ScoreSongCard.test.ts \
  src/renderer/src/components/Scores.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the renderer/cache migration**

```bash
git add packages/dtx-desktop/src/renderer/src
git commit -m "refactor(desktop): consume current simfile model"
```

---

## Task 5: Remove compatibility residue and verify the full seam

**Files:**
- Modify only files surfaced by the explicit searches below if they are active application consumers of the removed compatibility contract.
- Do **not** edit `packages/common/src/lib/types/supabase.types.ts` or D1/server snake_case code merely because the searches find them.

- [ ] **Step 1: Prove the obsolete named types are gone**

Run from the repo root:

```bash
rg -n "LegacySimfile|SimfileWithDtx\b" packages/common packages/dtx-web packages/dtx-desktop
```

Expected: no matches in source/test code. Historical docs may still mention them and do not need rewriting.

- [ ] **Step 2: Prove snake_case simfile properties no longer leak into app/UI code**

Run:

```bash
rg -n "\b(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\b" \
  packages/common/src/lib/components \
  packages/dtx-web/src \
  packages/dtx-desktop/src/renderer/src
```

Expected application exceptions must be justified narrowly before leaving them. In particular:

- D1/server files are outside this search and remain snake_case.
- `packages/common/src/lib/types/supabase.types.ts` is intentionally retained and is outside shared UI.
- Native Rust identifiers may remain idiomatic snake_case internally, but JSON keys crossing to the renderer must be camelCase.

Fix active UI/renderer matches by using `SimfileModel`; do not add aliases.

- [ ] **Step 3: Confirm the retained Supabase auth type is still genuinely used**

Run:

```bash
rg -n "SupabaseClient<Database>|createServerClient<Database>|type \{ Database \}" packages/dtx-web packages/common
```

Expected: current uses in `packages/dtx-web/src/app.d.ts` and `packages/dtx-web/src/hooks.server.ts`. Leave `Database` and `gen-types` in place.

- [ ] **Step 4: Run all affected checks**

Run:

```bash
cd packages/common && bun run test && bun run check
cd ../dtx-web && bun run test && bun run check
cd ../dtx-desktop && bun run test && bun run typecheck
cd ../..
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: PASS. If the repo-wide test suites expose unrelated pre-existing failures, record those separately and still require every HPA-614-focused test changed above to pass.

- [ ] **Step 5: Review the diff for scope discipline**

Run:

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/common \
  packages/dtx-web \
  packages/dtx-desktop
```

Verify:

- no GraphQL schema/D1 schema changes;
- no runtime schema/codegen framework;
- no compatibility alias for snake_case fields;
- no unrelated UI refactor;
- no deletion of the live Supabase auth `Database` type;
- cache changes are only the three explicit v2 keys.

- [ ] **Step 6: Commit any final mechanical cleanup**

If Step 1/2 surfaced active compatibility residue and it was fixed:

```bash
git add packages/common packages/dtx-web packages/dtx-desktop
git commit -m "refactor: remove legacy simfile compatibility residue"
```

If there were no cleanup edits, do not create an empty commit.

---

## Expected End State

- `@dtx/common` main exports `SimfileModel`, `SimfileDtxFile`, and `SimfileAssetFile` for application use; D1 row/aggregate types remain server-only.
- `ChartDetail` accepts `Partial<SimfileModel>` and has no D1 import.
- Web GraphQL code adapts generated results directly into camelCase `SimfileModel`; `LegacySimfile` and the chart-page cast are gone.
- Desktop Rust emits camelCase current-model JSON and accepts camelCase update input without `update_input_from_renderer`.
- Desktop stores/services/components use `SimfileModel`; `SimfileWithDtx` and `normalizeSimfile` are gone.
- Desktop cache keys are `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2`; old cached shapes are ignored.
- `Database`/`gen-types` remain because auth still uses them.
- HPA-615 can now generate Tauri TypeScript bindings against one stable renderer-facing model instead of encoding a legacy compatibility contract.
