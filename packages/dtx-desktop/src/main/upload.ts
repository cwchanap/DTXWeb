import { getApiBaseUrl, getAccessToken } from './graphql/client';
import type { ApiResult } from './api-client';

const API_REQUEST_TIMEOUT_MS = 30000;

export type UploadResponse = {
	message: string;
	file: {
		fileName: string;
		key: string;
		size: number;
		contentType: string;
		status: string;
	};
};

const fetchWithTimeout = async (input: string, init: RequestInit): Promise<Response> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
};

export const uploadFile = async (formData: FormData): Promise<ApiResult<UploadResponse>> => {
	try {
		const token = await getAccessToken();
		const res = await fetchWithTimeout(`${getApiBaseUrl()}/upload`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'User-Agent': 'DTXDesktopApp',
				'X-Requested-With': 'DTXDesktopApp'
			},
			body: formData
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
				error?: string;
			};
			return { success: false, error: err.error || `HTTP ${res.status}` };
		}
		const data = (await res.json()) as UploadResponse;
		return { success: true, data };
	} catch (err) {
		if (
			typeof err === 'object' &&
			err !== null &&
			'name' in err &&
			(err as { name: string }).name === 'AbortError'
		) {
			return { success: false, error: `Request timed out after ${API_REQUEST_TIMEOUT_MS}ms` };
		}
		return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
	}
};
