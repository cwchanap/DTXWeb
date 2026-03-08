import { getSupabaseClient } from './auth';

/** Get a valid access token, refreshing the session if needed. */
const getAccessToken = async (): Promise<string> => {
	const supabaseClient = getSupabaseClient();
	if (!supabaseClient) throw new Error('User not authenticated');

	const {
		data: { session },
		error
	} = await supabaseClient.auth.getSession();

	if (error || !session?.access_token) {
		throw new Error('Failed to get valid session');
	}

	return session.access_token;
};

/** Get the API base URL from environment. */
const getApiBaseUrl = (): string => {
	const url = import.meta.env.VITE_DTX_SERVER_URL;
	if (!url) throw new Error('VITE_DTX_SERVER_URL environment variable is not set');
	return url;
};

/** Common headers for desktop app API calls. */
const getHeaders = async (): Promise<Record<string, string>> => {
	const token = await getAccessToken();
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'User-Agent': 'DTXDesktopApp',
		'X-Requested-With': 'DTXDesktopApp'
	};
};

const API_REQUEST_TIMEOUT_MS = 30000;

const isAbortError = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

const hasJsonResponseBody = (response: Response): boolean => {
	if (response.status === 204 || response.status === 205) {
		return false;
	}

	const contentLength = response.headers.get('Content-Length');
	if (contentLength === '0') {
		return false;
	}

	const contentType = response.headers.get('Content-Type')?.toLowerCase();
	return contentType?.includes('application/json') ?? false;
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

export type ApiResult<T = unknown> = { success: true; data: T } | { success: false; error: string };

const apiRequest = async <T = unknown>(
	method: 'GET' | 'POST' | 'PATCH',
	path: string,
	body?: unknown
): Promise<ApiResult<T>> => {
	try {
		const response = await fetchWithTimeout(`${getApiBaseUrl()}${path}`, {
			method,
			headers: await getHeaders(),
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }));
			return { success: false, error: err.error || `HTTP ${response.status}` };
		}

		if (!hasJsonResponseBody(response)) {
			return { success: true, data: undefined as T };
		}

		const data = await response.json();
		return { success: true, data: data as T };
	} catch (error) {
		if (isAbortError(error)) {
			return {
				success: false,
				error: `Request timed out after ${API_REQUEST_TIMEOUT_MS}ms`
			};
		}

		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};

/** Make an authenticated GET request to the web API. */
export const apiGet = async <T = unknown>(path: string): Promise<ApiResult<T>> =>
	apiRequest<T>('GET', path);

/** Make an authenticated POST request to the web API. */
export const apiPost = async <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> =>
	apiRequest<T>('POST', path, body);

/** Make an authenticated PATCH request to the web API. */
export const apiPatch = async <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> =>
	apiRequest<T>('PATCH', path, body);
