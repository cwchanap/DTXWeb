# HPA-614 Current Simfile Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase/REST-era simfile compatibility shapes with one camelCase `SimfileModel` across shared UI, web, and the desktop renderer while keeping D1 snake_case types server-only.

**Architecture:** `@dtx/common` owns the neutral application model. Web generated GraphQL results and desktop Rust GraphQL results each normalize once at their real transport boundary. Shared/web/desktop application code consumes that model directly. Existing renderer caches are invalidated by versioned keys instead of migrated.

**Tech Stack:** TypeScript, Svelte 5, Vitest, generated GraphQL types, Rust/Tauri, `serde_json`, Bun workspaces.

## Global Constraints

- Keep D1/Drizzle row types and snake_case fields in server persistence code; do not move them into the application model.
- Use one shared application model: `SimfileModel` plus `SimfileDtxFile` / `SimfileAssetFile` nested value types.
- Do not add a generic DTO/mapper layer, runtime schema library, repository abstraction, cache migration framework, or compatibility aliases.
- Do not change the D1 schema or GraphQL schema.
- Do not add production Rust→TypeScript generation; that is HPA-615.
- Do not extract `api.rs` or `SongDetails.svelte`; that is HPA-616.
- Keep `Database` in `packages/common/src/lib/types/supabase.types.ts`, its existing export, and root `gen-types`: current web auth still consumes `SupabaseClient<Database>` / `createServerClient<Database>`.
- Invalidate renderer caches by switching to `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2`. Never read or adapt the old keys.
- This is a breaking internal migration. Do not retain `LegacySimfile`, `SimfileWithDtx`, snake_case renderer properties, or deprecated aliases.

---

## Task 1: Add the neutral shared model and migrate `ChartDetail`

**Files:**
- Create: `packages/common/src/lib/types/simfile.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/server.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/types/d1.types.test.ts`
- Modify: `packages/common/src/lib/components/ChartDetail.svelte`
- Modify: `packages/common/src/lib/components/ChartDetail.test.ts`

- [ ] **Step 1: Make `ChartDetail` tests describe the new contract first**

Change `mockSimfile` in `ChartDetail.test.ts` to camelCase and remove D1-only `simfile_id`:

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

Rename the DTX-list fixtures/assertions from `dtx_files` to `dtxFiles`.

- [ ] **Step 2: Run the focused test and confirm the old component contract fails**

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts
```

Expected: FAIL because `ChartDetail` still reads snake_case simfile fields.

- [ ] **Step 3: Add the current shared model**

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

Keep `SimfileDtxFile.id` optional because not every GraphQL list projection requests a chart id. Do not add `simfileId` / `simfile_id` to this application model.

- [ ] **Step 4: Make the browser-facing common barrel expose the application model instead of D1 rows**

Add:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Remove the main-barrel exports of D1 simfile/profile row types and the two D1 simfile aggregates. Those remain available from `@dtx/common/server` while the API still owns them.

Leave `Database` exported because web auth still uses it.

- [ ] **Step 5: Delete only the obsolete desktop-compatible D1 shape**

Delete `SimfileWithDtx` from `d1.types.ts` and remove tests that exist only for that shape.

Keep `SimfileWithDtxFiles` and `toSimfileWithDtx` server-side because `dtx-api` still consumes them. Update `packages/common/src/lib/server.ts` only to stop exporting the deleted `SimfileWithDtx` symbol.

- [ ] **Step 6: Migrate `ChartDetail` mechanically to camelCase**

Use:

```ts
import type { SimfileModel } from '../types/simfile';

interface Props {
	simfile?: Partial<SimfileModel> | null;
	// existing non-simfile props unchanged
}
```

Then replace only the compatibility field reads:

```ts
displayId = $bindable(simfile?.displayId ?? 0);
publishDate = $bindable(simfile?.publishDate ?? new Date().toISOString().split('T')[0]);
isPublished = $bindable(simfile?.isPublished ?? true);
downloadUrl = $bindable(simfile?.downloadUrl ?? '');
videoPreviewUrl = $bindable(simfile?.videoPreviewUrl ?? '');
let dtxFiles = $derived(simfile?.dtxFiles ?? []);
```

Do not redesign the component or change its existing camelCase save-event contract.

- [ ] **Step 7: Verify common**

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts src/lib/types/d1.types.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

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
- Modify: `packages/dtx-web/src/lib/components/ChartList.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartList.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.svelte`
- Modify: `packages/dtx-web/src/lib/components/ChartListTableItem.test.ts`
- Modify: `packages/dtx-web/src/lib/utils.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts`

- [ ] **Step 1: Change API adapter tests to the new public shape**

In `chart.test.ts`, replace snake_case result assertions with camelCase assertions. Cover nullable metadata and nested levels, for example:

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

Update list tests to assert `hasUploadedFiles` and Drive-binding tests to expect:

```ts
{
	id: 9,
	googleDriveFileId: 'drive-file-123',
	downloadUrl
}
```

Keep the existing invalid numeric-id coverage.

- [ ] **Step 2: Change chart-list fixtures/helper expectations before implementation**

`ChartList.test.ts` already owns both component and `ChartList.helpers` coverage. Migrate `mockListedChart` and helper assertions to:

```ts
{
	id: 1,
	isPublished: true,
	hasUploadedFiles: true,
	downloadUrl: 'https://example.com/download1',
	displayId: 1,
	dtxFiles: [{ level: 3, label: 'BSC' }]
}
```

Run:

```bash
cd packages/dtx-web
bun vitest run src/lib/api/chart.test.ts src/lib/components/ChartList.test.ts
```

Expected: FAIL while the adapter/list code still emits or reads snake_case.

- [ ] **Step 3: Replace `LegacySimfile` with one typed GraphQL→model adapter**

In `chart.ts` import:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Delete `LegacySimfile`. Rename/refocus `adaptSimfile` to `toSimfileModel` and return `SimfileModel`.

Keep the existing numeric-id parsing behavior and map current GraphQL names directly:

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
	...(simfile.hasUploadedFiles == null ? {} : { hasUploadedFiles: simfile.hasUploadedFiles })
});
```

Do not add a validation framework; this is the same explicit adapter the file already has, minus the legacy renaming.

Make `listSimfiles`, `getSimfile`, and `updateSimfile` return `SimfileModel`. Make `updateSimfileDriveFile` return camelCase `{ id, googleDriveFileId, downloadUrl }`.

- [ ] **Step 4: Migrate chart-list helpers/components**

Change the helper projection to:

```ts
export type ChartNavigationItem = {
	id?: number;
	isPublished?: boolean;
	hasUploadedFiles?: boolean;
};
```

Update `canBulkSelect`, `isPreviewable`, and `chartTitleHref` accordingly.

In `ChartList.svelte`, `ChartListItem.svelte`, and `ChartListTableItem.svelte`, use `SimfileModel` and replace only current-model properties such as:

- `is_published` → `isPublished`
- `has_uploaded_files` → `hasUploadedFiles`
- `display_id` → `displayId`
- `download_url` → `downloadUrl`
- `dtx_files` → `dtxFiles`

Do not alter layout or behavior.

- [ ] **Step 5: Remove the last web test dependency on D1 row types**

In `packages/dtx-web/src/lib/utils.test.ts`, replace `DtxFileRow[]` fixtures with `SimfileDtxFile[]` (or the function's existing structural `{ level }[]` type) and remove `simfile_id` from fixtures.

- [ ] **Step 6: Migrate the chart-detail page and delete its cast**

Use:

```ts
import type { SimfileModel } from '@dtx/common';
let simfile: SimfileModel | null = $state(null);
```

Delete the `LegacySimfile` import and render:

```svelte
<ChartDetail simfile={simfile} ... />
```

without `as import('@dtx/common').SimfileWithDtxFiles`.

Update page-level field reads and `chart-detail-page.test.ts` fixtures to camelCase while preserving existing load/save/error behavior.

- [ ] **Step 7: Verify web**

```bash
cd packages/dtx-web
bun vitest run \
  src/lib/api/chart.test.ts \
  src/lib/components/ChartList.test.ts \
  src/lib/components/ChartListItem.test.ts \
  src/lib/components/ChartListTableItem.test.ts \
  src/lib/utils.test.ts \
  'src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts'
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-web/src/lib/api/chart.ts \
  packages/dtx-web/src/lib/api/chart.test.ts \
  packages/dtx-web/src/lib/components/ChartList.helpers.ts \
  packages/dtx-web/src/lib/components/ChartList.svelte \
  packages/dtx-web/src/lib/components/ChartList.test.ts \
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

- [ ] **Step 1: Rewrite native API assertions to require camelCase output**

Update existing fetch/create/update/search API tests so the renderer-facing JSON is the same current model shape, for example:

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

Update cloud-search expectations from `is_published` to `isPublished` and make search ids numeric.

Add/update the update-command test so renderer input is already current/GraphQL-shaped:

```json
{
  "displayId": 7,
  "publishDate": "2026-08-15",
  "isPublished": true,
  "downloadUrl": "https://example.test/chart.zip",
  "videoPreviewUrl": "https://example.test/video"
}
```

and assert the GraphQL request receives those names unchanged.

- [ ] **Step 2: Confirm the old native contract fails**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: FAIL because native mapping still emits snake_case and update input still uses `update_input_from_renderer`.

- [ ] **Step 3: Replace the renderer compatibility mapper**

Rename `renderer_simfile_from_graphql` to `simfile_model_from_graphql`.

Keep `number_id` validation, but emit current JSON keys (`displayId`, `userId`, `googleDriveFileId`, `isPublished`, `downloadUrl`, `previewUrl`, `videoPreviewUrl`, `publishDate`, `createdAt`, `updatedAt`, `dtxFiles`).

Nested `dtxFiles` contain `id` when supplied plus `label` / `level`. Delete the positional id fallback that existed only for old cached renderer records.

Use this mapper in `fetch_user_simfiles_impl`, `fetch_cloud_song_impl`, `update_simfile_record_impl`, and `create_simfile_record_impl`.

- [ ] **Step 4: Delete the renderer→GraphQL snake_case round trip**

Delete `update_input_from_renderer` and change:

```rust
"input": update_input_from_renderer(update_data),
```

to:

```rust
"input": update_data,
```

The renderer now sends current GraphQL input names. Do not replace the deleted function with a new allowlist/mapper in this ticket.

- [ ] **Step 5: Make cloud search use the current projection names and numeric ids**

Because `number_id` is fallible, keep the collection fallible rather than hiding an invalid id:

```rust
let rows = songs
    .iter()
    .map(|song| -> Result<Value> {
        Ok(json!({
            "id": number_id(&song["id"] )?,
            "title": song["title"],
            "artist": song["artist"],
            "bpm": song["bpm"],
            "isPublished": song["isPublished"],
        }))
    })
    .collect::<Result<Vec<_>>>()?;
```

Keep the implementation idiomatic if the exact surrounding iterator shape differs; the invariant is numeric validated ids and camelCase output, not this exact formatting.

- [ ] **Step 6: Verify Rust formatting and API tests**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

If formatting fails, run `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml` and rerun both commands.

Expected: PASS.

- [ ] **Step 7: Commit**

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
- Modify as required by the shared `CloudSong` id/name change: `packages/dtx-desktop/src/renderer/src/components/ScoreSongCard.svelte`, `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`, `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`

- [ ] **Step 1: Make cache tests prove stale shapes are ignored**

In `simFileService.test.ts`, migrate fixtures to camelCase and assert only these keys are read/written:

```ts
'simfiles_cache_v2'
'simfiles_cache_timestamp_v2'
```

Add a test where old data exists only under `simfiles_cache`; verify the service still calls `desktopHost.fetchUserSimfiles()`.

In `linkageCacheService.test.ts`, migrate `sampleSimfile` to `SimfileModel`, expect `dtx_linkage_cache_v2`, and add the equivalent old-key-ignore assertion.

Run:

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts
```

Expected: FAIL because the implementation still uses v1 keys and `SimfileWithDtx`.

- [ ] **Step 2: Version caches without migration machinery**

In `simFileService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';

const CACHE_KEY = 'simfiles_cache_v2';
const CACHE_TIMESTAMP_KEY = 'simfiles_cache_timestamp_v2';
```

Change service/cache result types from `SimfileWithDtx` to `SimfileModel`.

In `linkageCacheService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';
const LINKAGE_CACHE_KEY = 'dtx_linkage_cache_v2';
```

Change `cloudSongData` / `saveLinkage` to `SimfileModel`. Do not read, delete, or transform `dtx_linkage_cache`; leaving an unreachable old entry is cheaper than adding migration behavior.

- [ ] **Step 3: Migrate renderer stores to `SimfileModel`**

Replace `SimfileWithDtx` annotations in `simFileStore.ts` with `SimfileModel`.

In `workspaceStore.ts`, use `SimfileModel` for linked/selected cloud simfiles and update Drive metadata directly in camelCase:

```ts
const driveUpdates: Partial<SimfileModel> = {};
if (fields.googleDriveFileId) driveUpdates.googleDriveFileId = fields.googleDriveFileId;
if (fields.downloadUrl) driveUpdates.downloadUrl = fields.downloadUrl;
```

Update the existing store fixtures/tests mechanically.

- [ ] **Step 4: Migrate score-page cloud projections without changing persisted link format**

In `scoreTypes.ts` reuse the current model names:

```ts
import type { SimfileModel } from '@dtx/common';

export type CloudSong = Pick<SimfileModel, 'id' | 'title' | 'artist' | 'isPublished'>;

export interface FetchCloudSongResult<T = SimfileModel> {
	success: boolean;
	cloudSongData?: T;
	error?: string;
}
```

Delete the old snake_case `CloudSongData` interface.

`CloudSong.id` is now numeric, but `savedLinks` intentionally remains `Record<string, string>` because it is a small persisted score-link map, not a simfile DTO. Keep that boundary explicit in `Scores.svelte`:

```ts
// Comparing a restored numeric model id to persisted string ids
String(existing.id) === cloudId

// Persisting a selected/restored current-model id
savedLinks = { ...savedLinks, [songKey(songRow)]: String(song.id) };
```

Also:

- construct placeholder/restored `CloudSong` ids with `Number(cloudId)` after the saved id has already been validated by a successful cloud fetch, or reuse the numeric `cloudSongData.id` when available;
- pass `String(song.id)` to native calls only where that command still takes the persisted string id;
- make `excludeIdsFor()` push `String(existing.id)`;
- in `CloudSongAutocomplete.svelte`, compare exclusions with `String(song.id)`;
- rename `is_published` → `isPublished` in score-page fixtures/results.

Do not introduce a second legacy `CloudSong` contract just to keep ids as strings.

- [ ] **Step 5: Migrate read-only desktop cloud components**

In `CloudSongDetail.svelte` and `SimFileList.svelte` use `SimfileModel` and mechanically rename:

- `dtx_files` → `dtxFiles`
- `publish_date` → `publishDate`
- `is_published` → `isPublished`

Update existing tests. No markup redesign.

- [ ] **Step 6: Migrate `SongDetails` and delete renderer compatibility normalization**

Use:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Change create/update/fetch result types to `SimfileModel` / `Partial<SimfileModel>`.

Delete `normalizeSimfile`; native now returns the current model. Keep only a minimal IPC object/id guard until HPA-615 generates contracts—do not add Zod or a schema layer.

Link current native data directly:

```ts
if (result.success && result.cloudSongData && isSimfileModel(result.cloudSongData)) {
	const linkedSimfile = result.cloudSongData;
	song.linkedSimFileId = String(linkedSimfile.id);
	song.linkedSimFile = linkedSimfile;
	workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);
}
```

Build local fallback DTX files as `SimfileDtxFile[]` without `simfile_id`.

Build the `ChartDetail` fallback as `Partial<SimfileModel>` using `publishDate`, `displayId`, `isPublished`, `downloadUrl`, `videoPreviewUrl`, and `dtxFiles`.

Send update payloads to Rust with current GraphQL names:

```ts
const updateData: Record<string, unknown> = {
	displayId: Number(event.detail.displayId),
	publishDate: String(event.detail.publishDate),
	isPublished: Boolean(event.detail.isPublished),
	videoPreviewUrl: String(event.detail.videoPreviewUrl)
};
if (!isDriveBound) updateData.downloadUrl = String(event.detail.downloadUrl);
```

Change linked-record reads such as `google_drive_file_id` / `download_url` to `googleDriveFileId` / `downloadUrl`.

Preserve existing stale-selection, concurrency, linking, save, and Drive-upload behavior tests.

- [ ] **Step 7: Verify desktop renderer**

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
  src/renderer/src/components/Scores.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src
git commit -m "refactor(desktop): consume current simfile model"
```

---

## Task 5: Remove compatibility residue and verify the full seam

- [ ] **Step 1: Prove obsolete named types are gone from active source**

```bash
rg -n "LegacySimfile|SimfileWithDtx\b" packages/common packages/dtx-web packages/dtx-desktop
```

Expected: no active source/test matches. Historical docs do not need rewriting.

- [ ] **Step 2: Prove snake_case simfile properties no longer leak into shared/web/renderer application code**

```bash
rg -n "\b(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\b" \
  packages/common/src/lib/components \
  packages/dtx-web/src \
  packages/dtx-desktop/src/renderer/src
```

Fix active application-model matches by using `SimfileModel`; do not add aliases.

Expected intentional boundaries:

- D1/server code is outside the shared-UI search and remains snake_case.
- `packages/common/src/lib/types/supabase.types.ts` is intentionally retained for auth typing.
- Rust identifiers may be idiomatic snake_case internally, but JSON crossing to the renderer is camelCase.

- [ ] **Step 3: Reconfirm the retained Supabase auth type is live**

```bash
rg -n "SupabaseClient<Database>|createServerClient<Database>|type \{ Database \}" packages/dtx-web packages/common
```

Expected live consumers in `packages/dtx-web/src/app.d.ts` and `packages/dtx-web/src/hooks.server.ts`. Leave `Database` and `gen-types` in place.

- [ ] **Step 4: Run affected package checks**

```bash
cd packages/common && bun run test && bun run check
cd ../dtx-web && bun run test && bun run check
cd ../dtx-desktop && bun run test && bun run typecheck
cd ../..
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: PASS. If a repo-wide suite exposes an unrelated pre-existing failure, record it separately; every HPA-614-focused test changed above must still pass.

- [ ] **Step 5: Review scope and diff hygiene**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- packages/common packages/dtx-web packages/dtx-desktop
```

Verify:

- no D1 or GraphQL schema change;
- no runtime schema/codegen framework;
- no compatibility alias for snake_case fields;
- no unrelated UI refactor;
- no deletion of the live Supabase auth `Database` type;
- cache changes are only the three explicit v2 keys.

- [ ] **Step 6: Commit only if cleanup produced changes**

```bash
git add packages/common packages/dtx-web packages/dtx-desktop
git commit -m "refactor: remove legacy simfile compatibility residue"
```

Do not create an empty commit.

---

## Expected End State

- `@dtx/common` exposes `SimfileModel`, `SimfileDtxFile`, and `SimfileAssetFile` for application use; D1 row/aggregate types remain server-only.
- `ChartDetail` accepts `Partial<SimfileModel>` and has no D1 import.
- Web GraphQL code adapts generated results directly into camelCase `SimfileModel`; `LegacySimfile` and the chart-page cast are gone.
- Desktop Rust emits camelCase current-model JSON and accepts camelCase update input without `update_input_from_renderer`.
- Desktop stores/services/components use `SimfileModel`; `SimfileWithDtx` and `normalizeSimfile` are gone.
- Desktop simfile/linkage caches use only the three v2 keys; old shapes are ignored.
- Score-link persistence remains a small string-id map with explicit conversion at that persistence boundary; it does not force the current simfile model back to string ids.
- `Database` / `gen-types` remain because auth still uses them.
- HPA-615 can generate Tauri TypeScript bindings against one stable renderer-facing model instead of encoding a legacy compatibility contract.
