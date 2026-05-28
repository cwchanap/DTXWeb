import { env } from '$env/dynamic/public';
import { useGraphQL } from '../client';
import { getAccessTokenOrNull } from '../token';

const apiBase = () => (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');

export const downloadBaseUrl = (simfileId: string) =>
	useGraphQL() ? `${apiBase()}/downloads/${simfileId}` : `/api/simFile/download/${simfileId}`;

export const bulkDownloadBaseUrl = () =>
	useGraphQL() ? `${apiBase()}/downloads/bulk` : '/api/simFile/download/bulk';

export const parseContentDispositionFilename = (header: string | null): string | null => {
	if (!header) return null;
	const isEncoded = /filename\*=/i.test(header);
	const match = /filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^;]+))/i.exec(header);
	if (!match) return null;
	const raw = (match[1] ?? match[2] ?? '').trim();
	if (!raw) return null;
	if (isEncoded) {
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	return raw;
};

const defaultTriggerBrowserDownload = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
};

const triggerDirectDownload = (url: string) => {
	const a = document.createElement('a');
	a.href = url;
	document.body.appendChild(a);
	a.click();
	a.remove();
};

export type DownloadOpts = {
	fetchFn?: typeof fetch;
	triggerBrowserDownload?: (blob: Blob, filename: string) => void;
	/** Override the direct-download mechanism (for testing). */
	directDownloadFn?: (url: string) => void;
};

export const downloadSimfile = async (simfileId: string, opts: DownloadOpts = {}) => {
	// REST path: same-origin, no auth needed — stream directly, skip buffering
	if (!useGraphQL()) {
		const directDownload = opts.directDownloadFn ?? triggerDirectDownload;
		directDownload(downloadBaseUrl(simfileId));
		return;
	}

	// GraphQL path: needs auth header, must fetch + blob
	const fetchFn = opts.fetchFn ?? fetch;
	const trigger = opts.triggerBrowserDownload ?? defaultTriggerBrowserDownload;
	const headers: Record<string, string> = {};
	const token = await getAccessTokenOrNull();
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetchFn(downloadBaseUrl(simfileId), { headers });
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const filename =
		parseContentDispositionFilename(res.headers.get('content-disposition')) ??
		`chart-${simfileId}.zip`;
	trigger(blob, filename);
};

/** Bearer header for bulk download — caller supplies fetchFn; we just return the headers. */
export const bulkDownloadHeaders = async (): Promise<Record<string, string>> => {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (useGraphQL()) {
		const token = await getAccessTokenOrNull();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	return headers;
};
