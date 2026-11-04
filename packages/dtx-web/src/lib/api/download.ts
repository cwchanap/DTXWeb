import { env } from '$env/dynamic/public';

const apiBase = () => {
	const base = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');
	if (!base) {
		throw new Error('PUBLIC_DTX_API_URL is not configured — set it in .env');
	}
	return base;
};

export const downloadBaseUrl = (simfileId: string) => `${apiBase()}/downloads/${simfileId}`;

export const bulkDownloadBaseUrl = () => `${apiBase()}/downloads/bulk`;

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

// Revoking the object URL synchronously after a.click() can lose the download
// in Safari and some Firefox versions — the browser hasn't opened the blob yet.
// Defer the revoke so the download has time to start.
const REVOKE_DELAY_MS = 1000;

export const triggerBrowserDownload = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

export type DownloadOpts = {
	fetchFn?: typeof fetch;
	triggerBrowserDownload?: (blob: Blob, filename: string) => void;
};

export const downloadSimfile = async (simfileId: string, opts: DownloadOpts = {}) => {
	const fetchFn = opts.fetchFn ?? fetch;
	const trigger = opts.triggerBrowserDownload ?? triggerBrowserDownload;
	const res = await fetchFn(downloadBaseUrl(simfileId), { credentials: 'include' });
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	const blob = await res.blob();
	const filename =
		parseContentDispositionFilename(res.headers.get('content-disposition')) ??
		`chart-${simfileId}.zip`;
	trigger(blob, filename);
};

/** Build headers for bulk download requests against dtx-api. */
export const bulkDownloadHeaders = async (): Promise<Record<string, string>> => {
	return { 'Content-Type': 'application/json' };
};
