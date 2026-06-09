# Simfile GraphQL Backend — Client Requirements

**Author:** Virgo client team
**Date:** 2026-05-16
**Audience:** Backend team owning the existing service that will host the simfile GraphQL API
**Status:** Draft, awaiting backend team review

## 1. Context

Virgo is a SwiftUI drum-notation/practice app (iOS 18.5+, macOS 14.0+). Today it talks to a small standalone FastAPI server (`server/main.py` in the Virgo repo) that lists DTX drum charts and serves the chart, BGM, and preview-audio files for download. That server is being retired and its responsibilities will be moved into your existing backend, exposed as **GraphQL**.

This document describes **what the Virgo client needs to read** from the new API. It does not describe how songs are ingested, parsed, or stored on the server side — those are the backend team's concerns.

## 2. Goals & non-goals

### Goals

- Let the client browse a catalog of drum songs and their charts.
- Let the client download the chart file (`.dtx`), full BGM audio (`.ogg`), and short preview clip (`.mp3`) for any song.
- Support search, filtering, and pagination as the catalog grows.
- Expose richer metadata than the underlying DTX files provide (genre, tags, accurate duration).
- Be cacheable and incrementally refreshable from the client.

### Non-goals (v1)

- Mutations of any kind (no admin, upload, edit, delete).
- User accounts, authentication, authorization. Anonymous reads only.
- Ratings, comments, leaderboards, social features.
- Real-time subscriptions.
- Backwards compatibility with the legacy "individual `.dtx` file" endpoints (`/dtx/list` → `individual_files`, `/dtx/metadata/{filename}`). The client will drop the corresponding code paths.

## 3. Transport & auth

- **Transport:** HTTPS, single GraphQL endpoint (e.g., `POST /graphql`).
- **Auth:** None. All queries are public.
- **CORS:** Not required — the client is a native iOS/macOS app, not a browser. (Permissive CORS is acceptable but not requested.)
- **Persisted queries:** Optional. The client's query set is small and fixed; if your platform prefers persisted queries we will adopt them.

## 4. File delivery contract

Binary files (DTX charts, BGM, preview audio) live in **Cloudflare R2**. The GraphQL API does **not** stream binary data. Instead, every URL field returns a **short-lived signed R2 URL** that the client downloads directly with `URLSession`.

Requirements:

| Field type     | TTL (recommended) | Optional? | If file missing in R2                                                           |
| -------------- | ----------------- | --------- | ------------------------------------------------------------------------------- |
| Chart `.dtx`   | ≥ 15 minutes      | No        | Server-side data error — surface as a GraphQL error on the parent `Chart` field |
| BGM `.ogg`     | ≥ 15 minutes      | Yes       | Return `null`                                                                   |
| Preview `.mp3` | ≥ 15 minutes      | Yes       | Return `null`                                                                   |

The 15-minute floor matters because the client may download a chart immediately and the larger BGM file later in the same session (e.g., on a slow mobile connection). URLs are per-request — the client does not persist them.

GraphQL responses that include signed URLs should carry `Cache-Control: private, max-age=<TTL/2>` so intermediate caches do not serve stale URLs to other clients.

## 5. Data model

A **Song** has 1..N **Charts** (one chart per difficulty). The client renders songs in a list (`ServerSongsView`) and downloads chart + audio assets on demand.

```graphql
type Song {
	id: ID! # stable identifier (e.g., URL-safe slug). Used as the client cache key.
	title: String!
	artist: String! # default "Unknown Artist" if the underlying source has none
	bpm: Float! # tempo in beats-per-minute (Double precision, e.g. 165.55)
	genre: String # server-curated; client falls back to "DTX Import" if null
	tags: [String!]! # server-curated; empty list is fine
	durationSeconds: Int # accurate duration if known; null if not yet computed
	bgmUrl: String # signed R2 URL for full BGM .ogg, or null
	previewAudioUrl: String # signed R2 URL for ~30s preview .mp3, or null
	charts: [Chart!]! # always at least one
	updatedAt: DateTime! # last time the server's record changed; powers `updatedSince` filter
}

type Chart {
	id: ID!
	difficulty: Difficulty! # canonical bucket
	difficultyLabel: String! # original label, e.g. "BASIC", "ADVANCED", "EXTREME", "MASTER", "REAL"
	level: Int! # numeric level inside the difficulty bucket (e.g. 36, 60, 74, 87)
	fileUrl: String! # signed R2 URL for the .dtx chart file
	fileSizeBytes: Int!
	fileEncoding: FileEncoding! # the client must know how to decode the .dtx file's text
}

enum Difficulty {
	EASY
	MEDIUM
	HARD
	EXPERT
}

enum FileEncoding {
	SHIFT_JIS # the common case for legacy DTX files
	UTF_8
}

scalar DateTime # ISO-8601 string, UTC
```

### Field notes

- **`Song.id`** is what the client persists in its SwiftData `ServerSong.songId`. It must be stable across catalog refreshes; renaming/restructuring server-side IDs would invalidate the client's download-state cache.
- **`Song.artist`, `Song.bpm`** are non-null because the client treats them as guaranteed in its UI. If the source data is missing, the server picks sensible defaults (`"Unknown Artist"`, last-known-good or `120.0`).
- **`Song.genre`** is nullable: the client falls back to a literal `"DTX Import"` today when nothing is provided, so `null` is safe.
- **`Song.durationSeconds`** replaces a fragile client-side estimate (the client currently guesses from note counts at ~120 BPM). If accurate duration isn't available the field can be `null` and the client keeps its estimate.
- **`Chart.difficulty`** is the canonical 4-bucket enum the app's UI groups by. The original label is preserved in `difficultyLabel` for display.
- **`Chart.fileEncoding`** is required because Virgo decodes the `.dtx` text with the indicated encoding (`String(data:, encoding: .shiftJIS)` today). Without this field, the client must hard-code an assumption.

## 6. Queries

The client needs exactly two read queries.

### 6.1 `song(id: ID!): Song`

Fetch a single song by id. Used when the client refreshes one entry (e.g., after the user opens its detail view, or after a download completes) without re-fetching the whole list.

Returns `null` if not found.

### 6.2 `songs(...): SongConnection!`

Paginated, filterable, sortable listing. Powers the main browse screen (`ServerSongsView`) and any future search UI.

```graphql
type Query {
	song(id: ID!): Song
	songs(
		first: Int = 50 # max 100
		after: String # opaque cursor
		filter: SongFilter
		sort: SongSort = TITLE_ASC
	): SongConnection!
}

input SongFilter {
	query: String # case-insensitive substring match against title OR artist
	genres: [String!]
	difficulty: Difficulty # song has at least one chart at this difficulty
	bpmMin: Float
	bpmMax: Float
	updatedSince: DateTime # only songs whose updatedAt > this value
}

enum SongSort {
	TITLE_ASC
	ARTIST_ASC
	UPDATED_AT_DESC
	BPM_ASC
}

type SongConnection {
	edges: [SongEdge!]!
	pageInfo: PageInfo!
	totalCount: Int! # total matches (server-side count after filters)
}

type SongEdge {
	cursor: String!
	node: Song!
}

type PageInfo {
	hasNextPage: Boolean!
	endCursor: String
}
```

### Why cursor pagination

The client maintains a persistent `ServerSong` SwiftData cache that lives across app launches and is refreshed every ~5 minutes. Offset pagination is unstable as the catalog grows or reorders; cursor pagination keeps the client's incremental refresh logic correct.

### `updatedSince` semantics

After the first full load, the client can re-fetch only changed songs via `filter: { updatedSince: <last-known-max-updatedAt> }`. Servers that cannot support this efficiently in v1 may return the full set, but the field should still accept the input so the client doesn't need a schema change later.

## 7. Errors

Use standard GraphQL `errors[]` with an `extensions.code` string. The client maps these to user-facing messages.

| `extensions.code` | Meaning                                | Client behavior                 |
| ----------------- | -------------------------------------- | ------------------------------- |
| `INVALID_INPUT`   | Filter values out of range / malformed | Treated as a bug; logged        |
| `RATE_LIMITED`    | Too many requests                      | Backoff + retry once            |
| `INTERNAL`        | Unexpected server error                | Show generic error, allow retry |

"Not found" cases are **not** errors: `song(id)` returns `null`, and an empty `songs` connection is a valid result.

Field-level errors (e.g., a `Chart.fileUrl` that cannot be signed because the file is missing) should be returned as a GraphQL error on that path so the client can still render the rest of the song.

## 8. Non-functional requirements

- **Latency target:** P95 < 300 ms for `song` and `songs` queries, excluding R2 signing time.
- **Page size:** `first` defaults to 50, max 100. The client typically requests 50.
- **Catalog size assumption:** hundreds of songs in v1, low thousands within a year.
- **Availability:** No formal SLA requested. The client degrades gracefully when offline (shows cached songs).
- **Schema evolution:** Additive changes preferred. The client uses a typed GraphQL client and is tolerant of unknown fields.

## 9. Reference: where each field is consumed in the client

For traceability when reviewing this spec against the current code:

| GraphQL field           | Client model field                              | Used in                           |
| ----------------------- | ----------------------------------------------- | --------------------------------- |
| `Song.id`               | `ServerSong.songId`                             | Cache key; download path          |
| `Song.title`            | `ServerSong.title` / `Song.title`               | List, detail, gameplay header     |
| `Song.artist`           | `ServerSong.artist` / `Song.artist`             | List, detail                      |
| `Song.bpm`              | `ServerSong.bpm` / `Song.bpm`                   | Metronome, gameplay               |
| `Song.genre`            | `Song.genre`                                    | List filter, library grouping     |
| `Song.durationSeconds`  | `Song.duration` (formatted as `mm:ss`)          | List, detail                      |
| `Song.bgmUrl`           | downloaded → `Song.bgmFilePath`                 | BGM playback in gameplay          |
| `Song.previewAudioUrl`  | downloaded → `Song.previewFilePath`             | Preview clip in song list         |
| `Chart.difficulty`      | `ServerChart.difficulty` / `Chart.difficulty`   | Difficulty badge, chart selection |
| `Chart.difficultyLabel` | `ServerChart.difficultyLabel`                   | Display label                     |
| `Chart.level`           | `ServerChart.level` / `Chart.level`             | Difficulty level number           |
| `Chart.fileUrl`         | downloaded → fed into `DTXFileParser`           | Note parsing for gameplay         |
| `Chart.fileSizeBytes`   | `ServerChart.size`                              | Download progress UX              |
| `Chart.fileEncoding`    | currently hard-coded as Shift-JIS in the client | DTX text decoding                 |

## 10. Open questions for backend team

These are answers we'd like before client integration starts:

1. **Signed URL TTL:** Is ≥ 15 min feasible with your R2 setup?
2. **`updatedSince` filter:** Can it be supported efficiently in v1, or should the client plan to do full refreshes only?
3. **Schema introspection:** Will introspection be enabled in production? (Affects whether we can run codegen against the live endpoint or need a pre-published schema file.)
4. **Endpoint URL & environments:** What hosts should the client target for dev / staging / prod?
