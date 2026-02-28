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

export interface ApiResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/** Make an authenticated GET request to the web API. */
export const apiGet = async <T = unknown>(path: string): Promise<ApiResult<T>> => {
	try {
		const response = await fetch(`${getApiBaseUrl()}${path}`, {
			method: 'GET',
			headers: await getHeaders()
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }));
			return { success: false, error: err.error || `HTTP ${response.status}` };
		}

		const data = await response.json();
		return { success: true, data: data as T };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};

/** Make an authenticated POST request to the web API. */
export const apiPost = async <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> => {
	try {
		const response = await fetch(`${getApiBaseUrl()}${path}`, {
			method: 'POST',
			headers: await getHeaders(),
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }));
			return { success: false, error: err.error || `HTTP ${response.status}` };
		}

		const data = await response.json();
		return { success: true, data: data as T };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};

/** Make an authenticated PATCH request to the web API. */
export const apiPatch = async <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> => {
	try {
		const response = await fetch(`${getApiBaseUrl()}${path}`, {
			method: 'PATCH',
			headers: await getHeaders(),
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({ error: response.statusText }));
			return { success: false, error: err.error || `HTTP ${response.status}` };
		}

		const data = await response.json();
		return { success: true, data: data as T };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};
