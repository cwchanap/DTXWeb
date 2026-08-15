# HPA-614 Current Simfile Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase/REST-era full-simfile compatibility shapes with one camelCase `SimfileModel` across shared UI, web, desktop renderer code, caches, and desktop E2E linkage fixtures while keeping D1 snake_case types server-only.

**Architecture:** `@dtx/common` owns the neutral full application model. Web generated GraphQL results and desktop Rust GraphQL results each normalize once at their real transport boundary. Renderer caches are version-invalidated rather than migrated. A single JSON fixture is consumed by Rust and Vitest as behavioral proof that both sides agree on the same renderer-facing field names.

**Tech Stack:** TypeScript, Svelte 5, Vitest, generated GraphQL types, Rust/Tauri, `serde_json`, Bun workspaces, WebdriverIO desktop E2E.

## Global Constraints

- Keep D1/Drizzle row types and snake_case fields in server persistence code.
- Use one shared full application model: `SimfileModel` plus `SimfileDtxFile` / `SimfileAssetFile`.
- `publishDate`, `createdAt`, and `updatedAt` are required strings because the GraphQL schema declares them non-null.
- Add `createdAt` / `updatedAt` to the desktop list query rather than weakening the model for an omitted projection.
- Keep `files?` / `hasUploadedFiles?` optional because those are projection-specific extras.
- Keep `SimfileDtxFile.id?` optional; the web full fragment does not select it and shared UI does not require it.
- Keep score-page `CloudSong.id` as `string`; only migrate `is_published` → `isPublished` there.
- Keep `PreviewSimfile` as its existing purpose-specific projection.
- Do not add a generic DTO/mapper layer, runtime schema library, repository abstraction, cache migration framework, or compatibility aliases.
- Do not change the D1 schema or GraphQL schema.
- Do not add production Rust→TypeScript generation; HPA-615 owns that.
- Do not extract `api.rs` or `SongDetails.svelte`; HPA-616 owns that.
- Keep `Database` / root `gen-types`; current web auth still consumes `SupabaseClient<Database>` / `createServerClient<Database>`.
- Invalidate renderer caches by switching to `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2`. Never read/adapt v1 keys.
- Desktop E2E linkage seeds must use `dtx_linkage_cache_v2` and camelCase current-model data.
- Do not remove existing main-barrel D1/compatibility exports until Task 5, after every consumer has migrated.
- Preserve `ChartDetail`'s current `dayjs().format('YYYY-MM-DD')` publish-date fallback.
- General simfile updates must never send `googleDriveFileId`; Drive binding remains owned by the dedicated mutation.
- Renderer update payloads are explicit picks, never `{ ...simfile }`.
- Tasks 3 and 4 belong in one implementation PR. Do not merge/publish the native boundary without its renderer consumers.
- The implementation PR must be marked ready for review after Tasks 3–4 so `.github/workflows/desktop-e2e-test.yml` actually runs before merge.

---

## Task 1: Add the neutral model and migrate `ChartDetail`

**Files:**
- Create: `packages/common/src/lib/types/simfile.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/components/ChartDetail.svelte`
- Modify: `packages/common/src/lib/components/ChartDetail.test.ts`

**Interfaces:**
- Produces: `SimfileModel`, `SimfileDtxFile`, `SimfileAssetFile` from the main `@dtx/common` barrel.
- Temporarily preserves: existing main-barrel `SimfileWithDtx`, D1 row exports, and `toSimfileWithDtx` until Task 5.

- [ ] **Step 1: Change `ChartDetail` tests to the current names first**

Use a camelCase fixture:

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
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-02T00:00:00Z',
	videoPreviewUrl: null,
	dtxFiles: [
		{ id: 1, label: 'BASIC', level: 30 },
		{ id: 2, label: 'ADVANCED', level: 60 }
	]
};
```

Rename `dtx_files` assertions/fixtures to `dtxFiles`. Do not alter component layout behavior.

- [ ] **Step 2: Run the focused test and confirm the old contract fails**

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts
```

Expected: FAIL because `ChartDetail` still reads snake_case properties.

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
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: SimfileDtxFile[];
	files?: SimfileAssetFile[];
	hasUploadedFiles?: boolean;
}
```

- [ ] **Step 4: Export the model without deleting old barrel exports yet**

Add:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Do **not** remove `SimfileWithDtx`, D1 row types, `SimfileWithDtxFiles`, or `toSimfileWithDtx` from the main barrel in Task 1. Current downstream consumers and `constants.test.ts` still require them; Task 5 removes them after the migration is complete.

- [ ] **Step 5: Migrate `ChartDetail` mechanically**

Use:

```ts
import type { SimfileModel } from '../types/simfile';

interface Props {
	simfile?: Partial<SimfileModel> | null;
	// existing non-simfile props unchanged
}
```

Rename only the compatibility reads/bindings:

```ts
displayId = $bindable(simfile?.displayId ?? 0);
publishDate = $bindable(simfile?.publishDate ?? dayjs().format('YYYY-MM-DD'));
isPublished = $bindable(simfile?.isPublished ?? true);
downloadUrl = $bindable(simfile?.downloadUrl ?? '');
videoPreviewUrl = $bindable(simfile?.videoPreviewUrl ?? '');
let dtxFiles = $derived(simfile?.dtxFiles ?? []);
```

Keep the existing `dayjs` import and save-event payload.

- [ ] **Step 6: Verify common while compatibility exports are still live**

```bash
cd packages/common
bun vitest run src/lib/components/ChartDetail.test.ts src/lib/constants.test.ts
bun run check
```

Expected: PASS.

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
- Modify: `packages/dtx-web/src/lib/utils.ts`
- Modify: `packages/dtx-web/src/lib/utils.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts`

**Interfaces:**
- Consumes: `SimfileModel`, `SimfileDtxFile` from Task 1.
- Produces: `toSimfileModel()` as the only web GraphQL→full-model adapter.

- [ ] **Step 1: Change adapter tests to required current-model fields**

Update `chart.test.ts` expectations to camelCase and include the non-null timestamps:

```ts
expect(result).toMatchObject({
	id: 7,
	title: 't',
	googleDriveFileId: 'drive-file-123',
	displayId: null,
	isPublished: false,
	publishDate: '2026-08-15',
	createdAt: '2026-08-15T00:00:00Z',
	updatedAt: '2026-08-15T00:00:01Z',
	dtxFiles: []
});
```

Update list tests to assert `hasUploadedFiles`. Update Drive-binding expectations to camelCase:

```ts
{
	id: 9,
	googleDriveFileId: 'drive-file-123',
	downloadUrl
}
```

Keep invalid numeric-id coverage.

- [ ] **Step 2: Change chart-list fixtures/helper expectations first**

`ChartList.test.ts` owns helper coverage. Migrate its fixture to current names, including:

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

Expected: FAIL while web code still emits/reads snake_case.

- [ ] **Step 3: Replace `LegacySimfile` with `toSimfileModel`**

Import:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Delete `LegacySimfile`. Rename/refocus `adaptSimfile` to `toSimfileModel` and preserve schema nullability:

```ts
const toSimfileModel = (simfile: AdaptSimfileInput): SimfileModel => ({
	id: parseSimfileId(simfile.id),
	title: simfile.title,
	artist: simfile.artist,
	bpm: simfile.bpm,
	displayId: simfile.displayId ?? null,
	userId: simfile.userId ?? null,
	googleDriveFileId: simfile.googleDriveFileId ?? null,
	isPublished: simfile.isPublished,
	downloadUrl: simfile.downloadUrl ?? null,
	previewUrl: simfile.previewUrl ?? null,
	videoPreviewUrl: simfile.videoPreviewUrl ?? null,
	publishDate: simfile.publishDate,
	createdAt: simfile.createdAt,
	updatedAt: simfile.updatedAt,
	dtxFiles: (simfile.dtxFiles ?? []).map((file): SimfileDtxFile => ({
		label: file.label,
		level: file.level
	})),
	...(simfile.files == null ? {} : { files: simfile.files }),
	...(simfile.hasUploadedFiles == null ? {} : { hasUploadedFiles: simfile.hasUploadedFiles })
});
```

Do not invent `null` for required schema fields. The generated fragment already carries `publishDate`, `createdAt`, and `updatedAt` as required strings.

Make `listSimfiles`, `getSimfile`, and `updateSimfile` return `SimfileModel`. Make `updateSimfileDriveFile` return `{ id, googleDriveFileId, downloadUrl }`.

- [ ] **Step 4: Migrate chart-list helpers/components**

Use current projection names:

```ts
export type ChartNavigationItem = {
	id?: number;
	isPublished?: boolean;
	hasUploadedFiles?: boolean;
};
```

Update `canBulkSelect`, `isPreviewable`, `chartTitleHref`, `ChartList.svelte`, `ChartListItem.svelte`, and `ChartListTableItem.svelte` mechanically:

- `is_published` → `isPublished`
- `has_uploaded_files` → `hasUploadedFiles`
- `display_id` → `displayId`
- `download_url` → `downloadUrl`
- `dtx_files` → `dtxFiles`

Do not alter UI behavior/styling.

- [ ] **Step 5: Remove application-level D1 naming from the level-display helper**

Rename:

```ts
formatLevelDisplay(dtx_files)
```

to:

```ts
formatLevelDisplay(dtxFiles)
```

and update the comment to describe DTX level values rather than naming the D1 column. Keep the function behavior unchanged.

Update `utils.test.ts` to use `SimfileDtxFile[]` or its existing structural level shape; remove D1-only `simfile_id` fixture fields.

- [ ] **Step 6: Migrate the web chart-detail page and delete the cast**

Use:

```ts
import type { SimfileModel } from '@dtx/common';
let simfile: SimfileModel | null = $state(null);
```

Delete the `LegacySimfile` import and render:

```svelte
<ChartDetail simfile={simfile} ... />
```

with no `SimfileWithDtxFiles` cast. Update page-level field reads and tests to camelCase.

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
  packages/dtx-web/src/lib/utils.ts \
  packages/dtx-web/src/lib/utils.test.ts \
  'packages/dtx-web/src/routes/(app)/app/chart/[id]/+page.svelte' \
  'packages/dtx-web/src/routes/(app)/app/chart/[id]/chart-detail-page.test.ts'
git commit -m "refactor(web): consume current simfile model"
```

---

## Task 3: Make the Rust/Tauri full-simfile boundary emit the current model

**Files:**
- Create: `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json`
- Modify: `packages/dtx-desktop/src-tauri/src/api.rs`
- Modify: `packages/dtx-desktop/src-tauri/src/tests/api_tests.rs`

**Interfaces:**
- Produces: camelCase full-model JSON from `simfile_model_from_graphql`.
- Produces: one cross-language behavioral fixture consumed again in Task 4.
- Preserves: score-search string ids and general-update exclusion of `googleDriveFileId`.

- [ ] **Step 1: Add one canonical renderer-facing fixture**

Create:

```json
{
  "id": 42,
  "displayId": 7,
  "title": "Fixture Song",
  "artist": "Fixture Artist",
  "bpm": 123.5,
  "userId": "user-1",
  "googleDriveFileId": null,
  "isPublished": true,
  "downloadUrl": "https://example.test/chart.zip",
  "previewUrl": null,
  "videoPreviewUrl": null,
  "publishDate": "2026-08-15",
  "createdAt": "2026-08-15T00:00:00Z",
  "updatedAt": "2026-08-15T00:00:01Z",
  "dtxFiles": [
    { "id": 99, "label": "EXT", "level": 85 }
  ]
}
```

This fixture is expected output for a full native simfile, not a generated type artifact.

- [ ] **Step 2: Change native tests to assert the shared fixture**

Build a GraphQL input object whose mapped output should equal the fixture. Load the expected JSON from:

```rust
include_str!("../../tests/fixtures/simfile_model.json")
```

Deserialize to `serde_json::Value` and assert `simfile_model_from_graphql(&graphql_value)? == expected_fixture`.

Also update create/fetch/update envelope assertions to current names.

For cloud search, keep ids as GraphQL/persisted strings and change only:

```json
{ "isPublished": false }
```

instead of `is_published`.

- [ ] **Step 3: Add missing required timestamps to the desktop list query**

In `LIST_SIMFILES_QUERY`, add:

```graphql
createdAt
updatedAt
```

immediately with the other base simfile metadata. `publishDate` is already selected.

Do not make timestamps optional/null in the application model to accommodate this omission.

- [ ] **Step 4: Confirm the old native contract fails**

```bash
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Expected: FAIL because the mapper still emits snake_case and list data omits timestamps.

- [ ] **Step 5: Replace the renderer compatibility mapper**

Rename `renderer_simfile_from_graphql` to `simfile_model_from_graphql`.

Keep numeric-id validation for full simfiles and emit:

- `id`
- `displayId`
- `title`
- `artist`
- `bpm`
- `userId`
- `googleDriveFileId`
- `isPublished`
- `downloadUrl`
- `previewUrl`
- `videoPreviewUrl`
- `publishDate`
- `createdAt`
- `updatedAt`
- `dtxFiles`

Nested desktop `dtxFiles` use their real GraphQL `id`, `label`, and `level`. Delete the positional id fallback for old cached renderer records; every current desktop full query already selects `dtxFiles.id`.

Use this mapper in full-simfile fetch/create/update paths.

- [ ] **Step 6: Remove the general update mapper but preserve Drive ownership inline**

Delete `update_input_from_renderer`; renderer updates are already camelCase after Task 4.

Inside `update_simfile_record_impl`, remove only `googleDriveFileId` before constructing GraphQL variables:

```rust
let input = match update_data {
    Value::Object(mut object) => {
        object.remove("googleDriveFileId");
        Value::Object(object)
    }
    other => other,
};
```

Then send `input` unchanged to `UPDATE_SIMFILE_MUTATION`.

Do not create another mapper/allowlist. Keep/rewrite the existing native test so it inspects the outgoing GraphQL variables and proves `googleDriveFileId` is absent while ordinary fields such as `title` survive.

- [ ] **Step 7: Keep the score-search id boundary string-based**

In `search_cloud_songs_impl`, do **not** convert search result ids to numbers. Preserve:

```rust
"id": song["id"]
```

and rename only:

```rust
"isPublished": song["isPublished"]
```

This projection feeds persisted score links and `fetchCloudSongCharts(string)`; numeric conversion would only add round trips/conversions.

- [ ] **Step 8: Verify Rust**

```bash
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

If needed, run `cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml` and rerun both commands.

Expected: PASS, including exact equality with `simfile_model.json`.

- [ ] **Step 9: Commit**

```bash
git add packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json \
  packages/dtx-desktop/src-tauri/src/api.rs \
  packages/dtx-desktop/src-tauri/src/tests/api_tests.rs
git commit -m "refactor(desktop): emit current simfile model from native API"
```

Do not open/merge this native change as a separate implementation PR. Continue immediately to Task 4 on the same branch.

---

## Task 4: Migrate every desktop consumer, test fixture, cache seed, and score projection

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

**Files — desktop E2E:**
- Modify: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Modify: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`

**Interfaces:**
- Consumes: `SimfileModel` and camelCase full native JSON from Tasks 1/3.
- Consumes: `packages/dtx-desktop/src-tauri/tests/fixtures/simfile_model.json` in Vitest as behavioral seam proof.
- Keeps separate: score-link `Record<string, string>` and string-id `CloudSong` projection.

- [ ] **Step 1: Make renderer cache tests use the shared fixture and v2 keys**

In `simFileService.test.ts`, read the same native fixture with Node rather than adding `resolveJsonModule` to production config:

```ts
import { readFileSync } from 'node:fs';

const sharedSimfileFixture = JSON.parse(
	readFileSync(
		new URL('../../../../src-tauri/tests/fixtures/simfile_model.json', import.meta.url),
		'utf8'
	)
);
```

Use that object as `desktopHost.fetchUserSimfiles()` data and assert renderer code reads its title/current names correctly.

This test is behavioral. Do not claim the fixture import type-checks `SimfileModel`; desktop `tsconfig.web.json` excludes tests.

Migrate cache expectations to:

```ts
'simfiles_cache_v2'
'simfiles_cache_timestamp_v2'
```

Add a test where a valid-looking old shape exists only under `simfiles_cache`; verify IPC is still called.

In `linkageCacheService.test.ts`, migrate fixtures to camelCase, expect `dtx_linkage_cache_v2`, and add the equivalent old-key-ignore test.

- [ ] **Step 2: Confirm cache tests fail before implementation**

```bash
cd packages/dtx-desktop
bun vitest run \
  src/renderer/src/services/simFileService.test.ts \
  src/renderer/src/services/linkageCacheService.test.ts
```

Expected: FAIL while implementation still uses v1 keys/old shape.

- [ ] **Step 3: Version caches without migration machinery**

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

Change `cloudSongData` / `saveLinkage` to `SimfileModel`. Do not read/delete/transform `dtx_linkage_cache`.

- [ ] **Step 4: Migrate stores, auto-linking, app, palette, and workspace fixtures**

Replace `SimfileWithDtx` with `SimfileModel` in:

- `simFileStore.ts`
- `workspaceStore.ts`
- `linkingService.ts`
- `App.svelte` (`triggerAutoLinking(remoteSimFiles: SimfileModel[])`)
- `CommandPalette.svelte` cloud result type

Update all associated fixtures/tests, including:

- `linkingService.test.ts`
- `CommandPalette.test.ts`
- `Workspace.test.ts`
- `App.test.ts` if its mocks/fixtures carry the old simfile contract

In `workspaceStore.ts`, update Drive metadata using camelCase:

```ts
const driveUpdates: Partial<SimfileModel> = {};
if (fields.googleDriveFileId) driveUpdates.googleDriveFileId = fields.googleDriveFileId;
if (fields.downloadUrl) driveUpdates.downloadUrl = fields.downloadUrl;
```

Do not change linking heuristics or command/workspace behavior.

- [ ] **Step 5: Keep score `CloudSong` narrow and string-id based**

In `scoreTypes.ts`:

```ts
import type { SimfileModel } from '@dtx/common';

export interface CloudSong {
	id: string;
	title: string;
	artist: string;
	isPublished: boolean;
}

export interface FetchCloudSongResult<T = SimfileModel> {
	success: boolean;
	cloudSongData?: T;
	error?: string;
}
```

Delete the old snake_case `CloudSongData` interface.

In `Scores.svelte`:

- keep saved `cloudId` strings as `CloudSong.id`;
- when a full `fetchCloudSong` returns numeric `SimfileModel.id`, keep the existing persisted/search id (`cloudId`) on the narrow `CloudSong` object;
- rename only `is_published` → `isPublished`;
- keep `desktopHost.fetchCloudSongCharts(...)(song.id)` unchanged because it still takes `string`;
- keep `savedLinks: Record<string, string>` unchanged;
- keep `excludeIdsFor()` string-based.

In `CloudSongAutocomplete.svelte`, search results keep string ids and rename only `is_published` → `isPublished`.

This avoids adding numeric↔string conversions at `Scores.svelte` chart-fetch call sites.

- [ ] **Step 6: Migrate read-only full-simfile components**

Use `SimfileModel` in `CloudSongDetail.svelte` and `SimFileList.svelte` and mechanically rename:

- `dtx_files` → `dtxFiles`
- `publish_date` → `publishDate`
- `is_published` → `isPublished`

Update tests. Do not redesign markup.

- [ ] **Step 7: Migrate `SongDetails` and keep updates explicit**

Use:

```ts
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';
```

Change create/update/fetch result types to `SimfileModel` / `Partial<SimfileModel>`.

Delete `normalizeSimfile`; native full responses already match the current model. Keep only the existing minimal IPC object/id guard until HPA-615 generates contracts.

Link current native data directly:

```ts
if (result.success && result.cloudSongData && isSimfileModel(result.cloudSongData)) {
	const linkedSimfile = result.cloudSongData;
	song.linkedSimFileId = String(linkedSimfile.id);
	song.linkedSimFile = linkedSimfile;
	workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);
}
```

Build fallback levels as `SimfileDtxFile[]` without `simfile_id`. Build `ChartDetail` draft data as `Partial<SimfileModel>`.

General update payloads are explicit picks:

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

Determine `isDriveBound` from `targetSong.linkedSimFile?.googleDriveFileId`. Never spread a full `SimfileModel` into this payload and never include `googleDriveFileId`, `dtxFiles`, `id`, `files`, or `hasUploadedFiles`.

- [ ] **Step 8: Update both desktop E2E linkage seeds**

Do not add `@dtx/common` as an E2E dependency just to type a fixture. Keep E2E helper objects structural but match the current model fields exactly.

In `google-drive-upload.e2e.ts`, seed a camelCase object containing at least:

```ts
{
	id: Number(simfileId),
	title: rendererTitle,
	artist: 'Integration Test',
	bpm: 120,
	displayId: Number(simfileId),
	userId: null,
	googleDriveFileId,
	isPublished: false,
	downloadUrl,
	previewUrl: null,
	videoPreviewUrl: null,
	publishDate: '2026-07-25',
	createdAt: '2026-07-25T00:00:00.000Z',
	updatedAt: '2026-07-25T00:00:00.000Z',
	dtxFiles: []
}
```

Use:

```ts
localStorage.setItem('dtx_linkage_cache_v2', JSON.stringify({
	[songPath]: {
		linkedSimFileId: String(cloudSong.id),
		linkedAt: '2026-07-25T00:00:00.000Z',
		cloudSongData: cloudSong
	}
}));
```

Apply the same key/shape migration in `scripts/google-drive-crash-recovery.ts`. Do not seed v1 as fallback.

- [ ] **Step 9: Run the focused desktop behavior tests**

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
```

Run `App.test.ts` too if Task 4 changed its fixture/mocks:

```bash
bun vitest run src/renderer/src/App.test.ts
```

Expected: PASS.

Vitest executes these tests but does **not** type-check their TypeScript annotations.

- [ ] **Step 10: Run production renderer typecheck, with its limitation stated explicitly**

```bash
bun run typecheck
```

Expected: PASS for production renderer source.

This uses `tsconfig.web.json`, which has `strict: false` and excludes `**/*.test.ts` / `**/*.spec.ts`. Do not treat this as proof that migrated test-only imports/types are valid.

- [ ] **Step 11: Run the load-bearing legacy-type grep before deleting the type**

From repository root:

```bash
rg -n "LegacySimfile|SimfileWithDtx\b" \
  packages/dtx-web \
  packages/dtx-desktop/src/renderer \
  packages/e2e-desktop
```

Expected: no active web/renderer/E2E source/test imports or annotations remain. This grep is required precisely because desktop tests are excluded from typecheck and Vitest does not type-check them.

Do not proceed to Task 5 deletion until this is clean.

- [ ] **Step 12: Type-check the E2E package**

```bash
cd packages/e2e-desktop
bun run check
```

Expected: PASS. This covers the modified E2E TypeScript helpers/scripts.

- [ ] **Step 13: Commit the consumer migration**

```bash
git add packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop/specs/google-drive-upload.e2e.ts \
  packages/e2e-desktop/scripts/google-drive-crash-recovery.ts
git commit -m "refactor(desktop): consume current simfile model"
```

- [ ] **Step 14: Make the implementation PR eligible for the real seam gate**

Tasks 3 and 4 must be present in the same implementation PR. After both are complete and local focused checks pass, mark that implementation PR **ready for review**.

Reason: `.github/workflows/desktop-e2e-test.yml` has:

```yaml
if: ${{ github.event_name != 'pull_request' || github.event.pull_request.draft == false }}
```

so the desktop-E2E job is skipped on draft PRs.

Do not rely on a draft implementation PR for native→renderer verification.

- [ ] **Step 15: Require desktop E2E before merge**

If the local environment supports it:

```bash
cd packages/e2e-desktop
bun run e2e
```

Regardless of local availability, require the non-draft implementation PR's **Desktop E2E Test / Tauri Integration Test** CI job to run and pass before merge.

The current docs-only PR may remain draft; this requirement applies to the later implementation PR.

---

## Task 5: Delete compatibility residue, update docs, and run load-bearing completion gates

**Files:**
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/common/src/lib/server.ts`
- Modify: `packages/common/src/lib/types/d1.types.ts`
- Modify: `packages/common/src/lib/types/d1.types.test.ts`
- Modify: `packages/common/src/lib/constants.test.ts`
- Modify: `CLAUDE.md`
- Modify only if final gates reveal a missed active consumer: files under `packages/dtx-web`, `packages/dtx-desktop`, or `packages/e2e-desktop`

**Interfaces:**
- Deletes: `SimfileWithDtx` and application-barrel D1/compatibility exports.
- Keeps: `SimfileWithDtxFiles`, D1 rows/helpers under `@dtx/common/server`; `Database` auth type; narrow `PreviewSimfile` and string-id `CloudSong` projections.

- [ ] **Step 1: Delete `SimfileWithDtx` only after Task 4's grep is clean**

Remove `SimfileWithDtx` from `packages/common/src/lib/types/d1.types.ts` and its server/main barrel exports.

Keep `SimfileWithDtxFiles` / `toSimfileWithDtx` under `@dtx/common/server` because `dtx-api` still uses them.

- [ ] **Step 2: Remove persistence exports from the main application barrel**

Keep:

```ts
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';
```

Remove main-barrel exports of persistence/compatibility symbols such as:

- `SimfileRow`
- `SimfileInsert`
- `SimfileUpdate`
- `DtxFileRow`
- `DtxFileInsert`
- `UserProfileRow`
- `UserProfileInsert`
- `UserProfileUpdate`
- `SimfileWithDtxFiles`
- `SimfileWithDtx`
- `toSimfileWithDtx`

Do not remove the still-used server exports except `SimfileWithDtx` itself.

- [ ] **Step 3: Update barrel/D1 tests with the final cleanup**

In `constants.test.ts`, remove the main-barrel `toSimfileWithDtx` import/assertion but keep the server-barrel assertion for `ServerToSimfile`.

Update `d1.types.test.ts` only for deleted `SimfileWithDtx` compatibility coverage; keep D1 conversion tests.

Run:

```bash
cd packages/common
bun vitest run src/lib/constants.test.ts src/lib/types/d1.types.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 4: Update the repository cache-debugging documentation**

In `CLAUDE.md`'s Manual Cache Clearing section, replace:

```js
localStorage.removeItem('simfiles_cache');
localStorage.removeItem('simfiles_cache_timestamp');
```

with:

```js
localStorage.removeItem('simfiles_cache_v2');
localStorage.removeItem('simfiles_cache_timestamp_v2');
localStorage.removeItem('dtx_linkage_cache_v2');
```

Keep `simFileService.clearCache()` and unrelated `song_templates` guidance intact.

`AGENTS.md` follows `CLAUDE.md`; do not duplicate the same documentation elsewhere.

- [ ] **Step 5: Re-run the named-type gate across every active package**

```bash
rg -n "LegacySimfile|SimfileWithDtx\b" \
  packages/common \
  packages/dtx-web \
  packages/dtx-desktop \
  packages/e2e-desktop
```

Expected: no active source/test matches. Historical docs outside these active package paths do not need rewriting.

This is a **load-bearing acceptance gate**, not cleanup hygiene.

- [ ] **Step 6: Run a syntax-oriented snake_case application-model gate**

Use syntax patterns that catch property access/object keys rather than every prose mention:

```bash
rg -n "\.(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\b|\b(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\s*:" \
  packages/common/src/lib/components \
  packages/dtx-web/src \
  packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop
```

Expected: no current-model property/object-key usage.

The `formatLevelDisplay` parameter was renamed in Task 2 specifically so it does not create a false positive here.

- [ ] **Step 7: Run the broad informational snake_case grep and classify the known documentation references**

```bash
rg -n "\b(display_id|is_published|dtx_files|google_drive_file_id|download_url|preview_url|video_preview_url|publish_date|created_at|updated_at|user_id)\b" \
  packages/common/src/lib/components \
  packages/dtx-web/src \
  packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop
```

Known acceptable prose references include:

- `packages/dtx-desktop/src/renderer/src/lib/scoreMatching.ts` comments describing the real server/D1 `dtx_files.level` column.
- `packages/dtx-web/src/routes/preview/[id]/+page.svelte` comments explaining duplicate D1 `dtx_files` rows.

Any other match must be classified by boundary ownership. Do not mechanically rename true persistence/native-wire documentation merely to make the broad grep empty.

- [ ] **Step 8: Prove exact v1 cache keys are no longer active or seeded**

```bash
rg -n "['\"](simfiles_cache|simfiles_cache_timestamp|dtx_linkage_cache)['\"]" \
  packages/dtx-desktop/src/renderer/src \
  packages/e2e-desktop \
  CLAUDE.md
```

Expected: no exact v1-key usage. `*_v2` keys are expected.

- [ ] **Step 9: Reconfirm retained Supabase auth typing is live**

```bash
rg -n "SupabaseClient<Database>|createServerClient<Database>|type \{ Database \}" packages/dtx-web packages/common
```

Expected live consumers in `packages/dtx-web/src/app.d.ts` and `packages/dtx-web/src/hooks.server.ts`. Leave `Database` and `gen-types` in place.

- [ ] **Step 10: Run affected package checks with honest coverage claims**

```bash
cd packages/common && bun run test && bun run check
cd ../dtx-web && bun run test && bun run check
cd ../dtx-desktop && bun run test && bun run typecheck
cd ../e2e-desktop && bun run check
cd ../..
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml api_tests
```

Interpretation:

- Common/web checks type-check their configured source.
- Desktop `bun run typecheck` checks production renderer source only; it does not type-check test files and runs with `strict: false`.
- Desktop test-file legacy imports are proven by the load-bearing `rg` gate, not by `svelte-check`.
- `e2e-desktop` `bun run check` statically checks the changed E2E TypeScript helpers/scripts.

Expected: all HPA-614-focused tests/checks pass.

- [ ] **Step 11: Require the non-draft desktop E2E CI gate**

Confirm the implementation PR is non-draft and the **Desktop E2E Test / Tauri Integration Test** workflow ran for its final head commit.

Do not merge HPA-614 implementation without that job because Tasks 3–4 are the native/renderer seam that unit suites can independently pass while disagreeing.

- [ ] **Step 12: Review scope and diff hygiene**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/common \
  packages/dtx-web \
  packages/dtx-desktop \
  packages/e2e-desktop \
  CLAUDE.md
```

Verify:

- no D1/GraphQL schema change;
- no runtime schema/codegen framework;
- no compatibility alias/reader;
- no renderer import from `@dtx/common/server`;
- no unrelated UI refactor;
- no deletion of live `Database` auth typing;
- `ChartDetail` still uses the existing `dayjs` local-date fallback;
- `publishDate` / `createdAt` / `updatedAt` remain required model fields;
- desktop list GraphQL selects both timestamps;
- score `CloudSong.id` remains string;
- general simfile updates are explicit picks and native strips only `googleDriveFileId`;
- cache changes are exactly the three v2 keys plus matching E2E/docs updates;
- Rust/Vitest both consume the shared `simfile_model.json` fixture.

- [ ] **Step 13: Commit cleanup if it produced changes**

```bash
git add packages/common packages/dtx-web packages/dtx-desktop packages/e2e-desktop CLAUDE.md
git commit -m "refactor: remove legacy simfile compatibility residue"
```

Do not create an empty commit.

---

## Expected End State

- `@dtx/common` exposes `SimfileModel`, `SimfileDtxFile`, and `SimfileAssetFile` for full application use; D1 row/aggregate types are server-only.
- `SimfileModel.publishDate`, `createdAt`, and `updatedAt` are required strings matching the non-null GraphQL schema.
- Desktop `LIST_SIMFILES_QUERY` selects `createdAt` / `updatedAt` so a full native model never uses omission-as-null.
- `ChartDetail` accepts `Partial<SimfileModel>`, has no D1 import, and retains its current `dayjs` publish-date fallback.
- Web GraphQL code adapts generated results directly into `SimfileModel`; `LegacySimfile` and the chart-page cast are gone.
- Desktop Rust emits camelCase full-model JSON and no longer maps current fields through snake_case compatibility names.
- General native updates remove only `googleDriveFileId`; renderer update objects are explicit picks.
- Desktop stores/services/components, auto-linking, `App.svelte`, `CommandPalette`, and workspace fixtures use `SimfileModel`.
- Score-page `CloudSong` stays a purpose-specific string-id projection with camelCase `isPublished`; score links remain `Record<string, string>`.
- `simfiles_cache_v2`, `simfiles_cache_timestamp_v2`, and `dtx_linkage_cache_v2` are the only active renderer simfile/linkage keys.
- Both desktop-E2E linkage seeds use `dtx_linkage_cache_v2` with current-model camelCase data.
- `CLAUDE.md` documents the active v2 cache keys.
- Rust API tests and desktop Vitest consume one shared `src-tauri/tests/fixtures/simfile_model.json` behavioral fixture.
- Desktop production typecheck is not overstated; excluded test-type cleanup is proven with load-bearing repository greps.
- `SimfileWithDtx` is deleted only after all consumers migrate; no renderer code imports persistence types from `@dtx/common/server`.
- `PreviewSimfile`, `Database`, and `gen-types` remain because they still have current owners/consumers.
- Tasks 3 and 4 ship in one implementation PR, and that PR is non-draft before the required desktop-E2E CI gate.
- HPA-615 can generate Tauri TypeScript bindings against one stable renderer-facing model instead of encoding a compatibility contract.
