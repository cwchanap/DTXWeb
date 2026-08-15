# HPA-614 Current Simfile Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase/REST-era simfile compatibility shapes with one camelCase `SimfileModel` across shared UI, web, desktop renderer code, and desktop E2E linkage fixtures while keeping D1 snake_case types server-only.

**Architecture:** `@dtx/common` owns the neutral application model. Web generated GraphQL results and desktop Rust GraphQL results each normalize once at their real transport boundary. Application code consumes that model directly. Renderer caches are invalidated by versioned keys, and desktop E2E seeds use the same current key/shape.

**Tech Stack:** TypeScript, Svelte 5, Vitest, generated GraphQL types, Rust/Tauri, `serde_json`, Bun workspaces, WebdriverIO desktop E2E.

## Global Constraints

- Keep D1/Drizzle row types and snake_case fields in server persistence code; do not move them into the application model.
- Use one shared application model: `SimfileModel` plus `SimfileDtxFile` / `SimfileAssetFile` nested value types.
- Do not add a generic DTO/mapper layer, runtime schema library, repository abstraction, cache migration framework, or compatibility aliases.
- Do not change the D1 schema or GraphQL schema.
- Do not add production Rust→TypeScript generation; that is HPA-615.
- Do not extract `api.rs` or `SongDetails.svelte`; that is HPA-616.
- Keep `Database` in `packages/common/src/lib/types/supabase.types.ts`, its existing export, and root `gen-types`: current web auth still consumes `SupabaseClient<Database>` / `createServerClient<Database>`.
- Invalidate renderer caches by switching to `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2`. Never read or adapt the old keys.
- Desktop E2E linkage seeds must use `dtx_linkage_cache_v2` and camelCase current-model data, without adding an `@dtx/common` dependency to the E2E package.
- This is a breaking internal migration. Do not retain `LegacySimfile`, `SimfileWithDtx`, snake_case renderer properties, or deprecated aliases after final cleanup.
- Do not remove old `@dtx/common` application-barrel D1/compatibility exports until all web/desktop consumers have migrated; never redirect renderer code to `@dtx/common/server` as an intermediate fix.
- Preserve `ChartDetail`'s current `dayjs().format('YYYY-MM-DD')` publish-date fallback while renaming fields.
- General simfile updates must never send `googleDriveFileId`; Drive binding remains owned by the dedicated Drive mutation.

---

## Task 1: Add the neutral shared model and migrate `ChartDetail`

**Files:**
- Create: `packages/common/src/lib/types/simfile.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/components/ChartDetail.svelte`
- Modify: `packages/common/src/lib/components/ChartDetail.test.ts`

**Interfaces:**
- Produces: `SimfileModel`, `SimfileDtxFile`, `SimfileAssetFile` exported from the main `@dtx/common` barrel.
- Keeps temporarily: existing D1/compatibility exports, including `SimfileWithDtx`, until Task 5.

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

Rename DTX-list fixtures/assertions from `dtx_files` to `dtxFiles`.

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

Keep `SimfileDtxFile.id` optional because not every web projection currently requests chart ids. Do not add `simfileId` / `simfile_id` to this application model.

- [ ] **Step 4: Export the new model without removing old application-barrel exports yet**

Add to `packages/common/src/lib/index.ts`:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Do **not** remove `SimfileWithDtx`, `SimfileWithDtxFiles`, D1 row types, or `toSimfileWithDtx` from the main barrel in this task. Current web/desktop consumers and `constants.test.ts` still rely on them; removal belongs in Task 5 after the consumer migration.

- [ ] **Step 5: Migrate `ChartDetail` mechanically to camelCase**

Use:

```ts
import type { SimfileModel } from '../types/simfile';

interface Props {
	simfile?: Partial<SimfileModel> | null;
	// existing non-simfile props unchanged
}
```

Rename the existing bindings/reads:

```ts
displayId = $bindable(simfile?.displayId ?? 0);
publishDate = $bindable(simfile?.publishDate ?? dayjs().format('YYYY-MM-DD'));
isPublished = $bindable(simfile?.isPublished ?? true);
downloadUrl = $bindable(simfile?.downloadUrl ?? '');
videoPreviewUrl = $bindable(simfile?.videoPreviewUrl ?? '');
let dtxFiles = $derived(simfile?.dtxFiles ?? []);
```

Keep the existing `dayjs` import and fallback. Do not replace it with `new Date().toISOString()` in this migration.

- [ ] **Step 6: Verify common without removing live barrel exports**

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts src/lib/constants.test.ts
bun run check
```

Expected: PASS. `constants.test.ts` must still pass because the old barrel exports remain until Task 5.

- [ ] **Step 7: Commit**

```bash
git add packages/common/src/lib/types/simfile.ts \
  packages/common/src/lib/index.ts \
  packages/common/src/lib/components/ChartDetail.svelte \
  packages/common/src/lib/components/ChartDetail.test.ts
git commit -m "refactor(common): add current simfile model"
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

**Interfaces:**
- Consumes: `SimfileModel`, `SimfileDtxFile` from Task 1.
- Produces: `toSimfileModel()` as the single web GraphQL→application adapter.

- [ ] **Step 1: Change API adapter tests to the new public shape**

In `chart.test.ts`, replace snake_case result assertions with camelCase assertions and cover nullable metadata/nested levels:

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

Update list tests to assert `hasUploadedFiles`. Update Drive-binding expectations to:

```ts
{
	id: 9,
	googleDriveFileId: 'drive-file-123',
	downloadUrl
}
```

Keep the existing invalid numeric-id test.

- [ ] **Step 2: Change chart-list fixtures/helper expectations before implementation**

`ChartList.test.ts` owns both component and `ChartList.helpers` coverage. Migrate `mockListedChart` and helper assertions to camelCase:

```ts
const mockListedChart = {
	id: 1,
	title: 'Test Song 1',
	artist: 'Test Artist 1',
	bpm: 120,
	isPublished: true,
	hasUploadedFiles: true,
	downloadUrl: 'https://example.com/download1',
	displayId: 1,
	dtxFiles: [{ level: 3, label: 'BSC' }]
};
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

Delete `LegacySimfile`. Rename/refocus `adaptSimfile` to `toSimfileModel` and return `SimfileModel`:

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

Use the existing numeric-id error behavior; do not add runtime validation machinery.

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

In `ChartList.svelte`, `ChartListItem.svelte`, and `ChartListTableItem.svelte`, use `SimfileModel` and replace only current-model property names:

- `is_published` → `isPublished`
- `has_uploaded_files` → `hasUploadedFiles`
- `display_id` → `displayId`
- `download_url` → `downloadUrl`
- `dtx_files` → `dtxFiles`

Do not alter layout or behavior.

- [ ] **Step 5: Remove web test dependency on D1 row types**

In `packages/dtx-web/src/lib/utils.test.ts`, replace `DtxFileRow[]` fixtures with `SimfileDtxFile[]` (or the helper's structural `{ level }[]` type) and remove `simfile_id` from fixtures.

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

Update page-level fields and `chart-detail-page.test.ts` fixtures to camelCase while preserving load/save/error behavior.

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

**Interfaces:**
- Produces: camelCase current-model JSON from `simfile_model_from_graphql`.
- Preserves: general-update exclusion of `googleDriveFileId`.

- [ ] **Step 1: Rewrite native API assertions to require camelCase output**

Update fetch/create/update/search API tests so renderer-facing simfile JSON uses the current model, for example:

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

Change the update-command request fixture to already use camelCase input names:

```json
{
  "displayId": 7,
  "publishDate": "2026-08-15",
  "isPublished": true,
  "downloadUrl": "https://example.test/chart.zip",
  "videoPreviewUrl": "https://example.test/video"
}
```

Keep the Drive-id ownership test: after the general mapper is removed, rewrite it against `update_simfile_record_impl`'s one-field omission so it still proves `googleDriveFileId` cannot reach `UpdateSimfileInput`.

- [ ] **Step 2: Confirm the old native contract fails**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: FAIL because native mapping still emits snake_case and update input still uses the old general mapper.

- [ ] **Step 3: Replace the renderer compatibility mapper**

Rename `renderer_simfile_from_graphql` to `simfile_model_from_graphql`.

Keep `number_id` validation, but emit current JSON keys: `displayId`, `userId`, `googleDriveFileId`, `isPublished`, `downloadUrl`, `previewUrl`, `videoPreviewUrl`, `publishDate`, `createdAt`, `updatedAt`, `dtxFiles`.

Nested `dtxFiles` contain a real `id` when supplied plus `label` / `level`. Delete the positional id fallback that existed for older cached renderer records.

Use the mapper in `fetch_user_simfiles_impl`, `fetch_cloud_song_impl`, `update_simfile_record_impl`, and `create_simfile_record_impl`.

- [ ] **Step 4: Remove the general update mapper but preserve Drive ownership inline**

Delete `update_input_from_renderer`; the renderer no longer sends snake_case.

Inside `update_simfile_record_impl`, remove only `googleDriveFileId` before constructing the GraphQL variables:

```rust
let input = match update_data {
    Value::Object(mut object) => {
        object.remove("googleDriveFileId");
        Value::Object(object)
    }
    other => other,
};

let result = graphql_result_with_url(
    base_url,
    token,
    &graphql_document(UPDATE_SIMFILE_MUTATION),
    json!({
        "id": simfile_id.to_string().trim_matches('"'),
        "input": input,
    }),
)
.await?;
```

Do not create a replacement mapper/helper. The renderer constructs explicit update payloads in Task 4; this inline omission exists only to preserve Drive-id ownership at the native boundary.

Update the existing native test to capture/assert the outgoing GraphQL request (or an extracted local input value already inside the test seam) and prove `googleDriveFileId` is absent while normal fields such as `title` remain.

- [ ] **Step 5: Make cloud search use current projection names and numeric ids**

Keep invalid ids fallible:

```rust
let rows = songs
    .iter()
    .map(|song| -> Result<Value> {
        Ok(json!({
            "id": number_id(&song["id"])?,
            "title": song["title"],
            "artist": song["artist"],
            "bpm": song["bpm"],
            "isPublished": song["isPublished"],
        }))
    })
    .collect::<Result<Vec<_>>>()?;
```

- [ ] **Step 6: Verify Rust formatting and API tests**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor(desktop): emit current simfile model from native API"
```

---

## Task 4: Migrate every desktop renderer consumer and cache seed

**Files — services/stores/app:**
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/simFileService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkageCacheService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkageCacheService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkingService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/linkingService.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/simFileStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/simFileStore.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify as fixtures require: `packages/dtx-desktop/src/renderer/src/App.test.ts`

**Files — renderer components:**
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongDetail.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongDetail.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SimFileList.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/SimFileList.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongAutocomplete.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/CloudSongAutocomplete.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.test.ts`

**Files — score projection:**
- Modify: `packages/dtx-desktop/src/renderer/src/lib/scoreTypes.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/components/ScoreSongCard.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Scores.test.ts`

**Files — desktop E2E current-cache seeds:**
- Modify: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`

**Interfaces:**
- Consumes: `SimfileModel` and camelCase native JSON from Tasks 1/3.
- Keeps separate: score-link `Record<string, string>` persistence.

- [ ] **Step 1: Make renderer cache tests prove stale shapes are ignored**

In `simFileService.test.ts`, migrate fixtures to camelCase and assert only these keys are read/written:

```ts
'simfiles_cache_v2'
'simfiles_cache_timestamp_v2'
```

Add a test where valid-looking old data exists only under `simfiles_cache`; verify `desktopHost.fetchUserSimfiles()` is still called.

In `linkageCacheService.test.ts`, migrate `sampleSimfile` to `SimfileModel`, expect `dtx_linkage_cache_v2`, and add the equivalent old-key-ignore assertion.

Run:

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts
```

Expected: FAIL because implementation still uses v1 keys and `SimfileWithDtx`.

- [ ] **Step 2: Version caches without migration machinery**

In `simFileService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';

const CACHE_KEY = 'simfiles_cache_v2';
const CACHE_TIMESTAMP_KEY = 'simfiles_cache_timestamp_v2';
```

Change service/cache result types to `SimfileModel`.

In `linkageCacheService.ts`:

```ts
import type { SimfileModel } from '@dtx/common';
const LINKAGE_CACHE_KEY = 'dtx_linkage_cache_v2';
```

Change `cloudSongData` / `saveLinkage` to `SimfileModel`. Do not read, delete, or transform `dtx_linkage_cache`.

- [ ] **Step 3: Migrate stores, auto-link service, app, command palette, and workspace fixtures**

Replace `SimfileWithDtx` with `SimfileModel` in:

- `simFileStore.ts`
- `workspaceStore.ts`
- `linkingService.ts`
- `App.svelte` (`triggerAutoLinking(remoteSimFiles: SimfileModel[])`)
- `CommandPalette.svelte` (`FlatResult` cloud variant)

Update their tests/fixtures, including `linkingService.test.ts`, `CommandPalette.test.ts`, `Workspace.test.ts`, and `App.test.ts` if its current mocks/fixtures encode the old shape.

In `workspaceStore.ts`, update Drive metadata with camelCase:

```ts
const driveUpdates: Partial<SimfileModel> = {};
if (fields.googleDriveFileId) driveUpdates.googleDriveFileId = fields.googleDriveFileId;
if (fields.downloadUrl) driveUpdates.downloadUrl = fields.downloadUrl;
```

Do not alter linking heuristics, store ownership, command-palette behavior, or workspace UI behavior.

- [ ] **Step 4: Migrate score-page cloud projections without changing persisted link format**

In `scoreTypes.ts`:

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

`CloudSong.id` is numeric, but `savedLinks` intentionally stays `Record<string, string>`. Keep conversions explicit in `Scores.svelte`:

```ts
String(existing.id) === cloudId
savedLinks = { ...savedLinks, [songKey(songRow)]: String(song.id) };
```

Use string ids only for score-link persistence/native calls that still take the persisted string id. Use numeric `song.id` inside current-model application state.

Update `excludeIdsFor()` to push `String(existing.id)`. In `CloudSongAutocomplete.svelte`, compare exclusions with `String(song.id)`. Rename `is_published` → `isPublished` in score fixtures/results.

- [ ] **Step 5: Migrate read-only cloud components**

Use `SimfileModel` in `CloudSongDetail.svelte` and `SimFileList.svelte`. Mechanically rename:

- `dtx_files` → `dtxFiles`
- `publish_date` → `publishDate`
- `is_published` → `isPublished`

Update their existing tests. No markup redesign.

- [ ] **Step 6: Migrate `SongDetails` and keep update payloads explicit**

Use:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Change create/update/fetch result types to `SimfileModel` / `Partial<SimfileModel>`.

Delete `normalizeSimfile`; native already returns the current model. Keep only the existing minimal IPC object/id guard until HPA-615 generates contracts.

Link current native data directly:

```ts
if (result.success && result.cloudSongData && isSimfileModel(result.cloudSongData)) {
	const linkedSimfile = result.cloudSongData;
	song.linkedSimFileId = String(linkedSimfile.id);
	song.linkedSimFile = linkedSimfile;
	workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);
}
```

Build fallback levels as `SimfileDtxFile[]` without `simfile_id`. Build the `ChartDetail` fallback as `Partial<SimfileModel>` with camelCase fields.

General update payloads must be explicit picks, never `{ ...simfile }`:

```ts
const updateData: Record<string, unknown> = {
	displayId: Number(event.detail.displayId),
	publishDate: String(event.detail.publishDate),
	isPublished: Boolean(event.detail.isPublished),
	videoPreviewUrl: String(event.detail.videoPreviewUrl)
};
if (!isDriveBound) updateData.downloadUrl = String(event.detail.downloadUrl);
if (parsedLocalData.bpm) updateData.bpm = parsedLocalData.bpm;
if (parsedLocalData.artist) updateData.artist = parsedLocalData.artist;
if (song.songTitle || song.name) updateData.title = song.songTitle || song.name;
```

Determine Drive ownership from `targetSong.linkedSimFile?.googleDriveFileId`. Do not add `googleDriveFileId`, `dtxFiles`, `id`, `files`, or other `SimfileModel` fields to the general update payload.

Preserve stale-selection, concurrency, linking, save, and Drive-upload tests.

- [ ] **Step 7: Update desktop E2E linkage-cache seeds to the current key/shape**

Do not add `@dtx/common` as an E2E dependency just to type a fixture. Keep the helper structural/inferred, but make its data match `SimfileModel` exactly.

In `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`, change the helper data to:

```ts
const linkedSimfile = ({
	downloadUrl,
	googleDriveFileId,
	rendererTitle
}: {
	downloadUrl: string | null;
	googleDriveFileId: string | null;
	rendererTitle: string;
}) => ({
	id: Number(simfileId),
	title: rendererTitle,
	artist: 'Integration Test',
	bpm: 120,
	isPublished: false,
	publishDate: '2026-07-25',
	displayId: Number(simfileId),
	downloadUrl,
	googleDriveFileId,
	previewUrl: null,
	videoPreviewUrl: null,
	userId: null,
	createdAt: null,
	updatedAt: null,
	dtxFiles: []
});
```

Seed:

```ts
localStorage.setItem('dtx_linkage_cache_v2', JSON.stringify({
	[songPath]: {
		linkedSimFileId: String(cloudSong.id),
		linkedAt: '2026-07-25T00:00:00.000Z',
		cloudSongData: cloudSong
	}
}));
```

Apply the same key/field migration in `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`. Do not add a fallback seed under `dtx_linkage_cache`.

- [ ] **Step 8: Verify desktop renderer consumer coverage**

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts \
  src/renderer/src/services/linkingService.test.ts \
  src/renderer/src/stores/simFileStore.test.ts \
  src/renderer/src/stores/workspaceStore.test.ts \
  src/renderer/src/components/SongDetails.test.ts \
  src/renderer/src/components/CloudSongDetail.test.ts \
  src/renderer/src/components/SimFileList.test.ts \
  src/renderer/src/components/CloudSongAutocomplete.test.ts \
  src/renderer/src/components/Workspace.test.ts \
  src/renderer/src/components/shell/CommandPalette.test.ts \
  src/renderer/src/components/Scores.test.ts
bun run typecheck
```

If `App.test.ts` contains a migrated fixture or assertion, include it in the focused run:

```bash
bun vitest run src/renderer/src/App.test.ts
```

Expected: PASS.

- [ ] **Step 9: Validate the affected Drive E2E setup path**

Run the existing desktop E2E command that owns both helpers:

```bash
cd packages/e2e-desktop
bun run e2e
```

This runs the normal WDIO flow plus relaunch and Drive crash-recovery scripts. The Drive upload flow must reach linked Song Details using `dtx_linkage_cache_v2`, and crash recovery must restore the same linked song after reload.

If the full native E2E environment is unavailable locally, still run the package's existing TypeScript check:

```bash
bun run check
```

Record the environment limitation in the implementation PR; do not add compatibility code to make an old seed work.

- [ ] **Step 10: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop/specs/google-drive-upload.e2e.ts \
  packages/e2e-desktop/scripts/google-drive-crash-recovery.ts
git commit -m "refactor(desktop): consume current simfile model"
```

---

## Task 5: Remove compatibility residue only after every consumer has migrated

**Files:**
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/server.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/types/d1.types.test.ts`
- Modify: `packages/common/src/lib/constants.test.ts`
- Modify only if final grep finds a missed active consumer: files under `packages/dtx-web`, `packages/dtx-desktop`, or `packages/e2e-desktop`

**Interfaces:**
- Deletes: `SimfileWithDtx` and application-barrel D1/compatibility exports after consumers are gone.
- Keeps: `SimfileWithDtxFiles`, D1 rows/helpers under `@dtx/common/server`; `Database` auth type.

- [ ] **Step 1: Delete `SimfileWithDtx` now that renderer consumers are gone**

Remove `SimfileWithDtx` from `packages/common/src/lib/types/d1.types.ts` and its `@dtx/common/server` export.

Keep `SimfileWithDtxFiles` and `toSimfileWithDtx` server-side because `dtx-api` still consumes them.

- [ ] **Step 2: Remove D1/compatibility exports from the main application barrel**

In `packages/common/src/lib/index.ts`, keep:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Remove main-barrel exports of persistence/application-compatibility symbols such as `SimfileRow`, `SimfileInsert`, `SimfileUpdate`, `DtxFileRow`, `DtxFileInsert`, `UserProfileRow`, `UserProfileInsert`, `UserProfileUpdate`, `SimfileWithDtxFiles`, `SimfileWithDtx`, and `toSimfileWithDtx`.

Do not remove those persistence types/helpers from `@dtx/common/server` except the deleted `SimfileWithDtx` compatibility shape.

- [ ] **Step 3: Update barrel tests with the cleanup**

In `packages/common/src/lib/constants.test.ts`, remove the main-barrel import/assertion for `toSimfileWithDtx` but keep the server-barrel assertion:

```ts
import {
	DTXFile as ServerDTXFile,
	SimFile as ServerSimFile,
	VALID_DTX_FILE_EXTENSIONS as ServerExtensions,
	toSimfileWithDtx as ServerToSimfile
} from './server';
```

Keep:

```ts
expect(ServerToSimfile).toBeDefined();
```

Update `d1.types.test.ts` only for deleted `SimfileWithDtx` compatibility coverage; keep D1 conversion coverage.

Run:

```bash
cd packages/common
bun vitest run src/lib/constants.test.ts src/lib/types/d1.types.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 4: Prove obsolete named types are gone from active application/E2E code**

```bash
rg -n "LegacySimfile|SimfileWithDtx\b" \
  packages/common \
  packages/dtx-web \
  packages/dtx-desktop \
  packages/e2e-desktop
```

Expected: no active source/test matches for `LegacySimfile` or `SimfileWithDtx`. Historical docs outside these active package paths do not need rewriting.

- [ ] **Step 5: Prove compatibility snake_case simfile properties no longer leak into application/E2E code**

```bash
rg -n "\b(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\b" \
  packages/common/src/lib/components \
  packages/dtx-web/src \
  packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop
```

Fix active current-model matches by using `SimfileModel`; do not add aliases.

Expected intentional exceptions must be evaluated by ownership rather than blindly renamed:

- D1/server persistence is outside the shared-UI search and remains snake_case.
- `packages/common/src/lib/types/supabase.types.ts` remains for auth typing.
- desktop E2E may contain snake_case only when asserting a true native/server persistence wire shape unrelated to the linkage `SimfileModel`; linkage cache seeds must be camelCase.
- Rust identifiers may be idiomatic snake_case internally, but JSON crossing to the renderer is camelCase.

- [ ] **Step 6: Prove old cache keys are not active or seeded**

```bash
rg -n "\b(simfiles_cache|simfiles_cache_timestamp|dtx_linkage_cache)\b" \
  packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop
```

Expected: no active exact v1 key usages. `*_v2` matches are allowed.

- [ ] **Step 7: Reconfirm retained Supabase auth type is live**

```bash
rg -n "SupabaseClient<Database>|createServerClient<Database>|type \{ Database \}" packages/dtx-web packages/common
```

Expected live consumers in `packages/dtx-web/src/app.d.ts` and `packages/dtx-web/src/hooks.server.ts`. Leave `Database` and `gen-types` in place.

- [ ] **Step 8: Run affected package checks**

```bash
cd packages/common && bun run test && bun run check
cd ../dtx-web && bun run test && bun run check
cd ../dtx-desktop && bun run test && bun run typecheck
cd ../e2e-desktop && bun run check
cd ../..
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Run `bun run e2e` from `packages/e2e-desktop` when the native E2E environment is available.

Expected: all HPA-614-focused tests changed above pass. Record unrelated pre-existing failures separately rather than weakening the migration.

- [ ] **Step 9: Review scope and diff hygiene**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- packages/common packages/dtx-web packages/dtx-desktop packages/e2e-desktop
```

Verify:

- no D1 or GraphQL schema change;
- no runtime schema/codegen framework;
- no compatibility alias for snake_case fields;
- no unrelated UI refactor;
- no deletion of the live Supabase auth `Database` type;
- `ChartDetail` still uses the existing `dayjs` date fallback;
- general simfile update payloads are explicit picks and native strips `googleDriveFileId` inline;
- cache changes are only the three explicit v2 keys plus matching E2E seed updates.

- [ ] **Step 10: Commit only if cleanup produced changes**

```bash
git add packages/common packages/dtx-web packages/dtx-desktop packages/e2e-desktop
git commit -m "refactor: remove legacy simfile compatibility residue"
```

Do not create an empty commit.

---

## Expected End State

- `@dtx/common` exposes `SimfileModel`, `SimfileDtxFile`, and `SimfileAssetFile` for application use; D1 row/aggregate types are server-only.
- `ChartDetail` accepts `Partial<SimfileModel>`, has no D1 import, and retains its current `dayjs` publish-date fallback.
- Web GraphQL code adapts generated results directly into camelCase `SimfileModel`; `LegacySimfile` and the chart-page cast are gone.
- Desktop Rust emits camelCase current-model JSON. The general update mapper is gone, while `update_simfile_record_impl` still removes `googleDriveFileId` inline before `UpdateSimfileInput`.
- Desktop stores/services/components — including auto-linking, `App.svelte`, `CommandPalette`, and workspace fixtures — use `SimfileModel`.
- Desktop simfile/linkage caches use only the three v2 keys; both desktop-E2E linkage seeds use `dtx_linkage_cache_v2` with camelCase current-model data and no new common-package dependency.
- `SimfileWithDtx` is deleted only after consumers migrate; no renderer imports persistence types from `@dtx/common/server`.
- Score-link persistence remains a small string-id map with explicit conversion at that boundary.
- `PreviewSimfile` remains a purpose-specific web projection.
- `Database` / `gen-types` remain because auth still uses them.
- HPA-615 can generate Tauri TypeScript bindings against one stable renderer-facing model instead of encoding a legacy compatibility contract.
