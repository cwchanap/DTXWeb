# In-Flight Request Deduplication for DTX Chart Asset Fetches

## Problem

When the editor loads a DTX chart, `Promise.all(soundChips.map(c => c.fetchRemote(...)))` fires one `fetch()` per sound chip in parallel. Charts often reference the same audio file (e.g., `kick.wav`) in many `#WAV` entries, producing N concurrent GETs to the same URL. The browser's HTTP cache only deduplicates _completed_ responses, not in-flight requests, so all N requests hit the network.

The same pattern exists in `SimFile` parsing (`set.def`, per-level `.dtx`) but with lower duplication risk.

## Goal

Eliminate duplicate concurrent GETs to the same R2 URL within a page session, with the smallest, most contained change. HTTP cache (already configured via `Cache-Control: public, max-age=31536000` on uploads) continues to handle cross-load and post-completion repeats; this work targets the in-flight gap only.

## Non-Goals

- Persistent client-side caching (IndexedDB, Cache API). HTTP cache covers this.
- Retry / backoff logic.
- Cache invalidation, TTL management, or version pinning. Existing Cloudflare cache purge on upload handles freshness.
- Server-side / SSR usage of the helper. Module-level state would leak across Worker requests; this helper is browser-only.
- Metrics or telemetry.

## Architecture

A single new browser-only utility, `dedupedFetch`, in `@dtx/common`. It is a drop-in replacement for `fetch()` at the four call sites that hit the public R2 bucket. A module-level `Map<string, Promise<Response>>` tracks in-flight GET/HEAD requests; concurrent callers for the same URL receive a cloned `Response` from the same underlying promise. The map entry is deleted as soon as the underlying promise settles (resolve or reject), so subsequent calls are independent and rely on the browser HTTP cache.

## Components

### 1. New file: `packages/common/src/lib/utils/dedupedFetch.ts`

```ts
const inflight = new Map<string, Promise<Response>>();

export function dedupedFetch(url: string, init?: RequestInit): Promise<Response> {
	const method = init?.method ?? 'GET';
	if (method !== 'GET' && method !== 'HEAD') {
		return fetch(url, init);
	}
	const key = `${method} ${url}`;
	const existing = inflight.get(key);
	if (existing) {
		return existing.then((r) => r.clone());
	}
	const promise = fetch(url, init).finally(() => {
		inflight.delete(key);
	});
	inflight.set(key, promise);
	return promise.then((r) => r.clone());
}
```

Design choices:

- **Always `.clone()` before returning.** The map holds the original `Response` (never consumed); every caller, including the first, receives a clone. This avoids "body already read" errors when multiple callers consume different streams.
- **Only dedupe GET / HEAD.** Other methods are not safe to merge across callers and pass through unchanged.
- **Delete on settle (success or rejection).** A failed first request must not poison the URL for later retries.
- **No TTL or persistence.** Pure in-flight dedupe.

### 2. Call-site updates (4 places)

Each is a one-line change: `fetch(url)` → `dedupedFetch(url)`.

- `packages/common/src/lib/chart/simFile.ts:55` — `set.def` fetch in `parseFromRemoteURL`
- `packages/common/src/lib/chart/simFile.ts:87` — per-level `.dtx` fetch in `parseFromRemoteURLWithMetadata`
- `packages/common/src/lib/chart/simFile.ts:149` — per-level `.dtx` fetch in `parseHeader` (remote branch)
- `packages/common/src/lib/chart/dtx.ts:55` — audio chip fetch in `SoundChip.fetchRemote`

## Data Flow

**Before:** Editor calls `Promise.all(soundChips.map(c => c.fetchRemote(...)))`. If 5 chips share `kick.wav`, 5 parallel GETs go to R2.

**After:** First call registers a promise in `inflight`; the other 4 callers find the existing promise and await its clone. **Network sees 1 GET.** Each chip receives a distinct `Blob`/`File` built from its own cloned response body. The map entry is deleted in `.finally()` as soon as the underlying fetch settles, independent of when callers consume their bodies.

## Error Handling

- If the underlying `fetch` rejects, all concurrent clones reject with the same error.
- `.finally()` removes the entry regardless of outcome, so a caller-level retry starts a fresh request.
- Existing call-site error handling (`response.ok` checks, try/catch in editor) is unchanged. `dedupedFetch` returns a real `Response` with the same shape as `fetch`.

## Testing

New unit test: `packages/common/src/lib/utils/dedupedFetch.test.ts`. Use Vitest and mock `globalThis.fetch`.

Cases:

1. **Concurrent dedupe.** Call `dedupedFetch(url)` twice without awaiting. Assert mock called once; both callers receive readable bodies with identical content.
2. **Sequential pass-through.** Await the first call, then call again. Assert mock called twice (no post-settle dedupe).
3. **Rejection propagation + recovery.** First call rejects; concurrent second call sees the same rejection. A subsequent call (after settle) starts a new fetch, not stuck.
4. **Distinct URLs.** Concurrent calls to different URLs each trigger their own fetch.
5. **Method pass-through.** `dedupedFetch(url, { method: 'POST' })` calls `fetch` directly without registering in the map; two concurrent POSTs to the same URL trigger two fetches.

No existing tests should require changes — the helper is behaviorally transparent for non-duplicate calls.

## Risk Notes

- `Response.clone()` tees the body stream and buffers data in memory until both halves are read. For deduplicated requests this is the entire point. Audio files in this codebase are typically under a few MB per chip, so the buffering cost is negligible.
- `parseFromRemoteURLWithMetadata` fetches up to 5 distinct level filenames concurrently — duplicates here would be unusual but the dedupe is harmless if so.
- The helper relies on URL string equality. R2 URLs in this codebase are deterministic (`${bucketUrl}/${simfileID}/${fileName}`), so exact-match keying is sufficient.
