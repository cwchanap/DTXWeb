# Simfile GraphQL Compatibility API Design

## Context

Virgo's client requirements document asks for a GraphQL API that lets a native
client browse published DTX songs, download chart/audio assets, and refresh a
local cache. Drumery already has a `packages/dtx-api` GraphQL Worker with
`simfile` and `simfiles` queries used by the existing web and desktop apps.

This design implements the client need as a compatibility layer over the
existing Drumery API contract. It does not introduce Virgo-specific `song` /
`songs` query names or a parallel catalog schema.

## Goals

- Let Virgo consume existing Drumery GraphQL queries directly.
- Preserve compatibility for current DTX web and desktop clients.
- Expose enough file metadata for a native client to download DTX charts and
  optional audio files.
- Use the existing public R2 base URL in v1.
- Avoid D1 schema migrations and R2 signing infrastructure in the first
  implementation.

## Non-Goals

- No new `Song`, `SongConnection`, cursor pagination, or Virgo-specific naming.
- No short-lived signed R2 URLs in v1.
- No new mutations, authentication flows, upload changes, or admin features.
- No strict support yet for `updatedSince`, genre filtering, difficulty
  filtering, or configurable sorting.

## API Contract

Virgo will use the existing endpoint and query names:

```graphql
simfile(id: ID!): Simfile
simfiles(scope: PUBLISHED, search: String, page: Int, pageSize: Int): SimfileConnection!
```

The existing connection shape remains:

```graphql
type SimfileConnection {
	data: [Simfile!]!
	count: Int!
}
```

`Simfile` remains the catalog item type. The client maps:

- `id` to its stable song/cache key.
- `title`, `artist`, and `bpm` directly.
- `previewUrl` to preview audio when available.
- `downloadUrl` to full audio or downloadable backing asset when available.
- `updatedAt` to cache refresh state.
- `dtxFiles` to the chart list.

Add computed compatibility fields to existing types:

```graphql
type Simfile {
	genre: String
	tags: [String!]!
	durationSeconds: Int
}

type DtxFile {
	fileUrl: String!
	fileSizeBytes: Int!
	fileEncoding: FileEncoding!
}

enum FileEncoding {
	SHIFT_JIS
	UTF_8
}
```

For v1, `genre` returns `null`, `tags` returns `[]`, and `durationSeconds`
returns `null` because current D1 storage does not contain those values.

## Pagination And Filtering

The existing `simfiles` query already supports page pagination:

- `page` defaults to `1`.
- `pageSize` defaults to `20`.
- `pageSize` is capped at `100`.
- `count` is the total match count after filters.
- SQL uses `LIMIT pageSize OFFSET (page - 1) * pageSize`.

This v1 keeps existing pagination rather than adding cursor pagination.
Search remains the existing SQLite `LIKE` match over title or artist. Sorting
remains current `publishDate DESC`.

## Public R2 URL Strategy

Use `env.PUBLIC_SIMFILE_BUCKET_URL` as the base for file URLs, matching current
DTX web and desktop behavior. URL construction must encode path segments:

```text
{PUBLIC_SIMFILE_BUCKET_URL}/{encoded-r2-key}
```

`previewUrl` behavior:

- Return the existing DB `preview_url` if set.
- Otherwise, return the public URL for `{simfileId}/preview.mp3` when that
  object exists in R2.
- Return `null` if no preview object exists.

`downloadUrl` behavior:

- Return the existing DB `download_url` if set.
- Otherwise, discover a likely full-audio object under `{simfileId}/` and return
  its public URL.
- Prefer `.ogg`, then common audio fallbacks such as `.mp3`, `.wav`, and `.flac`.
- Ignore preview objects when selecting full audio.
- Return `null` if no suitable audio object exists.

`DtxFile.fileUrl` behavior:

- Discover `.dtx` objects under the simfile's R2 prefix.
- Match each `dtx_files` row to the corresponding R2 object.
- Return the public URL for the matched object.

`DtxFile.fileSizeBytes` uses the matched R2 object's size.

`DtxFile.fileEncoding` returns `SHIFT_JIS` in v1.

## DTX File Matching

Current `dtx_files` stores `label`, `level`, and `simfile_id`, but not the chart
filename. Matching should be deterministic:

1. If `{simfileId}/set.def` exists, parse it and match chart labels to file
   names.
2. Otherwise, sort `.dtx` object keys and pair them with sorted `dtx_files`
   rows.
3. If a required chart file cannot be matched, `DtxFile.fileUrl` raises a
   GraphQL field-level error.

Sorted fallback ordering should be stable across requests. Sort chart rows by
`level`, then `label`, then original row order.

## Resolver Structure

Keep the implementation in `packages/dtx-api/src/schema/simfile.ts` unless it
becomes too large; if it does, split file-discovery helpers into a focused
service under `packages/dtx-api/src/services/`.

Use existing D1 helpers from `@dtx/common/server`:

- `getSimfile`
- `listSimfiles`
- existing `SimfileWithDtxFiles` mapping

Add request-scoped R2 discovery caching to `Ctx`, keyed by simfile id, similar
to the existing `filesCache` and `hasUploadedFilesCache`.

For list queries, batch-prefill R2 discovery only when selected fields require
it. Reuse the existing `isFieldSelected` pattern so normal web/desktop list
queries do not pay the R2 listing cost unless they request file-backed fields.

## Errors

Keep existing GraphQL error codes where they already exist:

- `BAD_USER_INPUT`
- `FORBIDDEN`
- `UNAUTHORIZED`
- `INTERNAL`

For optional file fields, return `null` when no object exists.

For required `DtxFile` fields (`fileUrl`, `fileSizeBytes`, and `fileEncoding`), raise a GraphQL field-level error when the chart object cannot be found. All three fields describe the same R2 object, so they must fail consistently — returning a fallback value (e.g., `0` / `SHIFT_JIS`) for a missing file would mislead clients. The error code should be `INTERNAL` because a published chart with a missing DTX file is a server-side data inconsistency.

## Compatibility Tradeoffs

This v1 intentionally differs from the Virgo requirement document in these
ways:

- It uses existing Drumery field names instead of `Song` / `Chart`.
- It uses page pagination instead of cursor pagination.
- It uses public R2 URLs instead of short-lived signed URLs.
- It defaults missing catalog metadata instead of adding new D1 columns.
- It does not implement `updatedSince`, genre filters, difficulty filters, or
  custom sort enums.

These are accepted tradeoffs for a compatibility-first implementation. They can
be addressed later with additive schema fields or a strict catalog query if the
client needs them.

## Tests

Add focused tests in `packages/dtx-api/src/schema/simfile.test.ts`:

- Published `simfile` exposes `genre`, `tags`, and `durationSeconds` defaults.
- Published `simfiles` can return the same defaults without changing the
  existing connection shape.
- `DtxFile.fileUrl`, `fileSizeBytes`, and `fileEncoding` resolve from mocked R2
  listing.
- `previewUrl` falls back to a public `preview.mp3` URL when DB value is absent.
- `downloadUrl` falls back to a public full-audio URL when DB value is absent.
- Missing required DTX object produces a GraphQL field-level error.
- R2 discovery is request-cached or batch-prefilled for list queries requesting
  file-backed fields.

If shared helper functions are added under `@dtx/common/server`, add focused
common package tests for those helpers.

## Verification

After implementation, run:

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check
```

Do not run project-wide build commands unless explicitly requested.
