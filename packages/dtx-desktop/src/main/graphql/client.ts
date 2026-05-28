import { GraphQLClient } from 'graphql-request';
import { getSupabaseClient } from '../auth';

const API_REQUEST_TIMEOUT_MS = 30000;

const getApiBaseUrl = (): string => {
	const url = import.meta.env.VITE_DTX_API_URL || import.meta.env.VITE_DTX_SERVER_URL;
	if (!url)
		throw new Error('VITE_DTX_API_URL or VITE_DTX_SERVER_URL environment variable is not set');
	return url.replace(/\/$/, '');
};

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

/** Lazily build a GraphQLClient with current bearer + a fetch wrapped in a timeout. */
export const getGraphQLClient = async (): Promise<GraphQLClient> => {
	const token = await getAccessToken();
	return new GraphQLClient(`${getApiBaseUrl()}/graphql`, {
		headers: {
			Authorization: `Bearer ${token}`,
			'User-Agent': 'DTXDesktopApp',
			'X-Requested-With': 'DTXDesktopApp'
		},
		fetch: (input, init) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
			return fetch(input, { ...init, signal: controller.signal }).finally(() =>
				clearTimeout(timeoutId)
			);
		}
	});
};

export { getApiBaseUrl, getAccessToken };
