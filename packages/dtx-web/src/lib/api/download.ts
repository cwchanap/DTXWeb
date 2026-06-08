import { env } from '$env/dynamic/public';
import { getAccessTokenOrNull } from './token';

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

export type DownloadOpts = {
	fetchFn?: typeof fetch;
	triggerBrowserDownload?: (blob: Blob, filename: string) => void;
};

export const downloadSimfile = async (simfileId: string, opts: DownloadOpts = {}) => {
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

/** Build headers for bulk download requests against dtx-api (Content-Type + Bearer). */
export const bulkDownloadHeaders = async (): Promise<Record<string, string>> => {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const token = await getAccessTokenOrNull();
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
};
