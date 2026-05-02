/**
 * In-flight request deduplication for browser GET/HEAD fetches.
 *
 * Concurrent callers requesting the same URL share a single underlying
 * `fetch()` and each receive a cloned `Response`. Once the underlying
 * promise settles, the entry is dropped — subsequent calls fetch fresh
 * (HTTP cache handles cross-call repeats).
 *
 * Browser-only. Module-level state would leak across requests in a Worker.
 */

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
