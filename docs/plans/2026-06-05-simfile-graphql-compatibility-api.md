# Simfile GraphQL Compatibility API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing Drumery `simfile` / `simfiles` GraphQL API so Virgo can consume it directly and download chart/audio assets through current public R2 URLs.

**Architecture:** Keep the existing `packages/dtx-api` Pothos/Yoga schema and current `Simfile` / `DtxFile` type names. Add computed fields on those existing types, backed by request-scoped R2 discovery helpers that reuse the current R2 listing/batching patterns. Do not add new D1 columns, signed URLs, cursor pagination, or `song` / `songs` queries.

**Tech Stack:** TypeScript, Cloudflare Workers, Pothos GraphQL, GraphQL Yoga, Vitest, Cloudflare R2/D1 types, Bun workspaces.

---

## Task 1: Add Failing Schema Tests For Metadata Defaults

**Files:**

- Modify: `packages/dtx-api/src/schema/simfile.test.ts`
- Modify later: `packages/dtx-api/src/schema/simfile.ts`

**Step 1: Write the failing tests**

Add tests near the existing `Query.simfile` and `Query.simfiles` describe blocks:

```ts
it('exposes compatibility metadata defaults on a published simfile', async () => {
	mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
	mockedGetSimfile.mockResolvedValue(publishedSimfile);

	const result = await runQuery(makeCtx(), {
		query: '{ simfile(id: "42") { id genre tags durationSeconds } }'
	});

	expect(result.errors).toBeUndefined();
	expect(result.data?.simfile).toEqual({
		id: '42',
		genre: null,
		tags: [],
		durationSeconds: null
	});
});
```

Add this to the existing `Query.simfiles` describe block:

```ts
it('exposes compatibility metadata defaults in published list results', async () => {
	mockedList.mockResolvedValue({ data: [publishedSimfile], count: 1 });

	const result = await runQuery(makeCtx(), {
		query: '{ simfiles(scope: PUBLISHED) { count data { id genre tags durationSeconds } } }'
	});

	expect(result.errors).toBeUndefined();
	expect(result.data?.simfiles).toEqual({
		count: 1,
		data: [
			{
				id: '42',
				genre: null,
				tags: [],
				durationSeconds: null
			}
		]
	});
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
```

Expected: FAIL with GraphQL validation errors for unknown fields `genre`, `tags`, and `durationSeconds`.

**Step 3: Implement minimal schema fields**

In `packages/dtx-api/src/schema/simfile.ts`, add fields to `SimfileRef`:

```ts
genre: t.string({ nullable: true, resolve: () => null }),
tags: t.stringList({ resolve: () => [] }),
durationSeconds: t.int({ nullable: true, resolve: () => null }),
```

Keep the fields computed only; do not touch D1 schema or shared types.

**Step 4: Run tests to verify pass**

Run:

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(api): expose simfile catalog metadata defaults"
```

### Task 2: Add R2 Catalog Discovery Helpers

**Files:**

- Modify: `packages/dtx-api/src/services/r2Enrichment.ts`
- Modify: `packages/dtx-api/src/services/r2Enrichment.test.ts`
- Modify later: `packages/dtx-api/src/context.ts`

**Step 1: Write failing helper tests**

Add tests to `packages/dtx-api/src/services/r2Enrichment.test.ts` for a new `discoverCatalogFiles` helper. Use the existing mock style in the file.

Cover:

- Encodes each R2 key path segment against `PUBLIC_SIMFILE_BUCKET_URL`.
- Selects `preview.mp3` for `previewUrl`.
- Selects non-preview `.ogg` before `.mp3`, `.wav`, and `.flac` for `downloadUrl`.
- Matches `.dtx` rows by sorted fallback when no `set.def` is available.
- Parses `set.def` and matches labels to filenames when available.
- Returns an unmatched chart entry when a required `.dtx` object is missing.

Core expected shape:

```ts
const discovery = await discoverCatalogFiles(bucket, {
	simfileId: 42,
	dtxFiles: [{ label: 'BSC', level: 20 }],
	publicBaseUrl: 'https://bucket.example'
});

expect(discovery.previewUrl).toBe('https://bucket.example/42/preview.mp3');
expect(discovery.downloadUrl).toBe('https://bucket.example/42/music.ogg');
expect(discovery.charts[0]).toMatchObject({
	label: 'BSC',
	level: 20,
	fileUrl: 'https://bucket.example/42/basic.dtx',
	fileSizeBytes: 123,
	fileEncoding: 'SHIFT_JIS'
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
bun run --filter=dtx-api test -- src/services/r2Enrichment.test.ts
```

Expected: FAIL because `discoverCatalogFiles` does not exist.

**Step 3: Implement helper types and URL builder**

In `packages/dtx-api/src/services/r2Enrichment.ts`, import `GraphQLError` if needed later only in schema, not in this service. Add these exported types:

```ts
export type CatalogDtxFileInput = {
	label: string;
	level: number;
};

export type CatalogChartFile = CatalogDtxFileInput & {
	fileUrl: string | null;
	fileSizeBytes: number | null;
	fileEncoding: 'SHIFT_JIS';
};

export type CatalogFileDiscovery = {
	previewUrl: string | null;
	downloadUrl: string | null;
	charts: CatalogChartFile[];
};
```

Add a helper to encode keys:

```ts
const publicUrlForKey = (baseUrl: string, key: string): string => {
	const base = baseUrl.replace(/\/$/, '');
	const encodedKey = key.split('/').map(encodeURIComponent).join('/');
	return `${base}/${encodedKey}`;
};
```

**Step 4: Implement object classification**

Use existing `listAllR2Objects(bucket, prefix)` inside `discoverCatalogFiles`.

Rules:

- `previewUrl`: exact filename `preview.mp3`, case-insensitive.
- `downloadUrl`: first matching full audio by extension priority `.ogg`, `.mp3`, `.wav`, `.flac`, excluding `preview.mp3`.
- `.dtx` charts: filenames ending in `.dtx`, case-insensitive.
- `set.def`: exact filename `set.def`, case-insensitive.

**Step 5: Implement `set.def` parsing**

Use `await bucket.get(setDefKey)` only when `set.def` exists. Read text with `await object.text()`.

Support lines that map common DTX set labels to filenames:

```text
#L1LABEL BASIC
#L1FILE basic.dtx
#L2LABEL ADVANCED
#L2FILE advanced.dtx
```

Parsing rule:

- Track `#L<number>LABEL` and `#L<number>FILE`.
- Match a `dtxFiles` row when its `label` equals a parsed label, case-insensitive.
- Resolve the parsed file path under the simfile prefix.

If parsing fails or no match is found, fall through to sorted fallback.

**Step 6: Implement sorted fallback matching**

Sort input chart rows by `level`, then `label`, while retaining original index. Sort `.dtx` objects by key. Pair by sorted index, then restore original chart row order in the returned `charts` array.

**Step 7: Run helper tests**

Run:

```bash
bun run --filter=dtx-api test -- src/services/r2Enrichment.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add packages/dtx-api/src/services/r2Enrichment.ts packages/dtx-api/src/services/r2Enrichment.test.ts
git commit -m "feat(api): discover public catalog files in R2"
```

### Task 3: Add Computed URL Fields To GraphQL Types

**Files:**

- Modify: `packages/dtx-api/src/context.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`
- Modify: `packages/dtx-api/src/services/r2Enrichment.ts`

**Step 1: Write failing GraphQL tests**

In `packages/dtx-api/src/schema/simfile.test.ts`, update the `../services/r2Enrichment` mock to include:

```ts
discoverCatalogFiles: vi.fn();
```

Import and mock it:

```ts
const {
	enrichFiles,
	enrichHasUploadedFiles,
	batchEnrichHasUploadedFiles,
	batchEnrichFiles,
	discoverCatalogFiles
} = await import('../services/r2Enrichment');
const mockedCatalogFiles = vi.mocked(discoverCatalogFiles);
```

Add tests:

```ts
it('resolves dtx file public URL metadata from catalog discovery', async () => {
	mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 1 });
	mockedGetSimfile.mockResolvedValue({
		...publishedSimfile,
		dtx_files: [{ level: 20, label: 'BSC' }]
	});
	mockedCatalogFiles.mockResolvedValue({
		previewUrl: null,
		downloadUrl: null,
		charts: [
			{
				label: 'BSC',
				level: 20,
				fileUrl: 'https://bucket.example/42/basic.dtx',
				fileSizeBytes: 123,
				fileEncoding: 'SHIFT_JIS'
			}
		]
	});

	const result = await runQuery(
		makeCtx({ env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' } }),
		{
			query: '{ simfile(id: "42") { dtxFiles { label level fileUrl fileSizeBytes fileEncoding } } }'
		}
	);

	expect(result.errors).toBeUndefined();
	expect(result.data?.simfile).toEqual({
		dtxFiles: [
			{
				label: 'BSC',
				level: 20,
				fileUrl: 'https://bucket.example/42/basic.dtx',
				fileSizeBytes: 123,
				fileEncoding: 'SHIFT_JIS'
			}
		]
	});
});
```

Add tests for:

- `previewUrl` falls back when DB `preview_url` is `null`.
- `downloadUrl` falls back when DB `download_url` is `null`.
- Existing DB `preview_url` and `download_url` win over discovered values.
- Missing `fileUrl` produces a GraphQL field error with code `INTERNAL`.

**Step 2: Run tests to verify failure**

Run:

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
```

Expected: FAIL because `DtxFile.fileUrl`, `fileSizeBytes`, `fileEncoding`, and `discoverCatalogFiles` wiring do not exist.

**Step 3: Extend context**

In `packages/dtx-api/src/context.ts`, import the discovery type:

```ts
import type { CatalogFileDiscovery } from './services/r2Enrichment';
```

Add to `Ctx`:

```ts
catalogFilesCache: Map<number, Promise<CatalogFileDiscovery>>;
```

Initialize in `createContext` and in the test `makeCtx` helper:

```ts
catalogFilesCache: new Map();
```

**Step 4: Add schema enum**

In `packages/dtx-api/src/schema/simfile.ts`, register:

```ts
export const FileEncodingEnum = builder.enumType('FileEncoding', {
	values: ['SHIFT_JIS', 'UTF_8'] as const
});
```

**Step 5: Add helper functions in schema**

In `packages/dtx-api/src/schema/simfile.ts`, import `discoverCatalogFiles`.

Add:

```ts
const getCatalogDiscovery = (
	ctx: Ctx,
	simfile: SimfileWithDtxFiles
): Promise<CatalogFileDiscovery> => {
	const cached = ctx.catalogFilesCache.get(simfile.id);
	if (cached) return cached;

	const promise = discoverCatalogFiles(ctx.r2, {
		simfileId: simfile.id,
		dtxFiles: simfile.dtx_files,
		publicBaseUrl: ctx.env.PUBLIC_SIMFILE_BUCKET_URL
	});
	ctx.catalogFilesCache.set(simfile.id, promise);
	return promise;
};
```

Use local imports for `Ctx`, `CatalogFileDiscovery`, and `SimfileWithDtxFiles` as needed.

**Step 6: Add fallback resolvers on `SimfileRef`**

Change `previewUrl` and `downloadUrl` from direct exposure to resolver fields:

```ts
previewUrl: t.string({
	nullable: true,
	resolve: async (s, _args, ctx) =>
		s.preview_url ?? (await getCatalogDiscovery(ctx, s)).previewUrl
}),
downloadUrl: t.string({
	nullable: true,
	resolve: async (s, _args, ctx) =>
		s.download_url ?? (await getCatalogDiscovery(ctx, s)).downloadUrl
}),
```

**Step 7: Add `DtxFile` parent context**

Change `DtxFile` object parent type from `{ level: number; label: string }` to include the owning simfile id:

```ts
type DtxFileParent = {
	level: number;
	label: string;
	simfileId: number;
	simfile: SimfileWithDtxFiles;
};
```

Change `SimfileRef.dtxFiles` resolver from direct exposure to:

```ts
dtxFiles: t.field({
	type: [DtxFile],
	resolve: (s) =>
		s.dtx_files.map((file) => ({
			...file,
			simfileId: s.id,
			simfile: s
		}))
}),
```

**Step 8: Add `DtxFile` computed fields**

Add to `DtxFile`:

```ts
fileUrl: t.string({
	resolve: async (file, _args, ctx) => {
		const discovery = await getCatalogDiscovery(ctx, file.simfile);
		const chart = findCatalogChart(discovery, file);
		if (!chart?.fileUrl) {
			throw new GraphQLError('DTX chart file not found in R2', {
				extensions: { code: 'INTERNAL' }
			});
		}
		return chart.fileUrl;
	}
}),
fileSizeBytes: t.int({
	resolve: async (file, _args, ctx) => {
		const discovery = await getCatalogDiscovery(ctx, file.simfile);
		const chart = findCatalogChart(discovery, file);
		return chart?.fileSizeBytes ?? 0;
	}
}),
fileEncoding: t.field({
	type: FileEncodingEnum,
	resolve: async (file, _args, ctx) => {
		const discovery = await getCatalogDiscovery(ctx, file.simfile);
		const chart = findCatalogChart(discovery, file);
		return chart?.fileEncoding ?? 'SHIFT_JIS';
	}
})
```

Implement `findCatalogChart` by matching `label` and `level` against `discovery.charts`.

**Step 9: Run GraphQL tests**

Run:

```bash
bun run --filter=dtx-api test -- src/schema/simfile.test.ts
```

Expected: PASS.

**Step 10: Commit**

```bash
git add packages/dtx-api/src/context.ts packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(api): expose public file metadata on simfiles"
```

### Task 4: Batch-Prefill Catalog Discovery For List Queries

**Files:**

- Modify: `packages/dtx-api/src/services/r2Enrichment.ts`
- Modify: `packages/dtx-api/src/services/r2Enrichment.test.ts`
- Modify: `packages/dtx-api/src/schema/simfile.ts`
- Modify: `packages/dtx-api/src/schema/simfile.test.ts`

**Step 1: Write failing helper tests**

Add tests for `batchDiscoverCatalogFiles` in `packages/dtx-api/src/services/r2Enrichment.test.ts`:

```ts
const result = await batchDiscoverCatalogFiles(bucket, [
	{ simfileId: 1, dtxFiles: [], publicBaseUrl: 'https://bucket.example' },
	{ simfileId: 2, dtxFiles: [], publicBaseUrl: 'https://bucket.example' }
]);

expect(result).toBeInstanceOf(Map);
expect(result.get(1)).toBeDefined();
expect(result.get(2)).toBeDefined();
```

**Step 2: Implement batch helper**

In `packages/dtx-api/src/services/r2Enrichment.ts`, export:

```ts
export type CatalogDiscoveryOptions = {
	simfileId: number;
	dtxFiles: CatalogDtxFileInput[];
	publicBaseUrl: string;
};

export const batchDiscoverCatalogFiles = async (
	bucket: R2Bucket,
	options: CatalogDiscoveryOptions[]
): Promise<Map<number, CatalogFileDiscovery>> => {
	const results = new Map<number, CatalogFileDiscovery>();
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < options.length) {
			const option = options[nextIndex++];
			results.set(option.simfileId, await discoverCatalogFiles(bucket, option));
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, options.length) }, () => worker())
	);
	return results;
};
```

If `MAX_CONCURRENT_R2_LIST` is not exported, keep it internal and reuse it in the same file.

**Step 3: Write failing GraphQL batching tests**

In `packages/dtx-api/src/schema/simfile.test.ts`, mock and import `batchDiscoverCatalogFiles`.

Add tests:

- Selecting `dtxFiles { fileUrl }` in `simfiles` calls `batchDiscoverCatalogFiles` once and does not call per-row `discoverCatalogFiles`.
- Selecting only `id title` does not call catalog discovery.
- Selecting `previewUrl` or `downloadUrl` triggers catalog prefill/batch discovery only when the corresponding DB value is absent (`null`/empty). The decision logic must still check the existing DB `preview_url`/`download_url` before initiating an R2 listing load, so sims whose DB URL is already populated are skipped (cache pre-populated with their existing URL) and only sims with missing DB URLs are passed to `batchDiscoverCatalogFiles`.

Example query:

```ts
await runQuery(
	makeCtx({ env: { ...makeEnv(), PUBLIC_SIMFILE_BUCKET_URL: 'https://bucket.example' } }),
	{
		query: '{ simfiles(scope: PUBLISHED, pageSize: 2) { data { id dtxFiles { fileUrl } } } }'
	}
);

expect(mockedBatchCatalogFiles).toHaveBeenCalledWith(expect.anything(), [
	{
		simfileId: 1,
		dtxFiles: sim1.dtx_files,
		publicBaseUrl: 'https://bucket.example'
	},
	{
		simfileId: 2,
		dtxFiles: sim2.dtx_files,
		publicBaseUrl: 'https://bucket.example'
	}
]);
expect(mockedCatalogFiles).not.toHaveBeenCalled();
```

**Step 4: Wire batch prefill in `SimfileConnectionRef.data`**

In `packages/dtx-api/src/schema/simfile.ts`, import `batchDiscoverCatalogFiles`.

Add a selected-field check for any catalog-backed field:

```ts
const shouldBatchCatalogFiles =
	isFieldSelected(info, 'previewUrl') ||
	isFieldSelected(info, 'downloadUrl') ||
	isNestedFieldSelected(info, 'dtxFiles', ['fileUrl', 'fileSizeBytes', 'fileEncoding']);
```

If needed, extend the existing field-selection helper to support nested checks through fragments. Keep it local to `simfile.ts`.

When selected, call `batchDiscoverCatalogFiles` with all list rows and seed `ctx.catalogFilesCache`:

```ts
const catalogBatchPromise = batchDiscoverCatalogFiles(
	ctx.r2,
	c.data.map((s) => ({
		simfileId: s.id,
		dtxFiles: s.dtx_files,
		publicBaseUrl: ctx.env.PUBLIC_SIMFILE_BUCKET_URL
	}))
);
for (const s of c.data) {
	ctx.catalogFilesCache.set(
		s.id,
		catalogBatchPromise.then((map) => map.get(s.id) ?? emptyCatalogDiscovery(s.dtx_files))
	);
}
```

Implement `emptyCatalogDiscovery` locally or export it from `r2Enrichment.ts`.

**Step 5: Run focused tests**

Run:

```bash
bun run --filter=dtx-api test -- src/services/r2Enrichment.test.ts src/schema/simfile.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/dtx-api/src/services/r2Enrichment.ts packages/dtx-api/src/services/r2Enrichment.test.ts packages/dtx-api/src/schema/simfile.ts packages/dtx-api/src/schema/simfile.test.ts
git commit -m "feat(api): batch catalog file discovery"
```

### Task 5: Verify Type Safety And Full API Tests

**Files:**

- Modify only if checks reveal issues.

**Step 1: Run API tests**

Run:

```bash
bun run --filter=dtx-api test
```

Expected: PASS.

**Step 2: Run API typecheck**

Run:

```bash
bun run --filter=dtx-api check
```

Expected: PASS.

**Step 3: Fix failures narrowly**

If tests or typecheck fail, fix only the related files from earlier tasks. Do not run project-wide build commands.

**Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only implementation files changed, plus any generated schema file if a schema generation command is explicitly run later.

**Step 5: Final commit if needed**

If verification fixes produced changes:

```bash
git add packages/dtx-api/src
git commit -m "test(api): verify simfile compatibility api"
```

If no changes were needed after the previous commits, do not create an empty commit.
