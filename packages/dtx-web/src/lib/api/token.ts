import type { Session } from '@supabase/supabase-js';
import { browser } from '$app/environment';
import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

let supabaseClient: ReturnType<typeof createBrowserClient> | null = null;

const getSupabaseClient = () => {
	if (!supabaseClient) {
		supabaseClient = createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
	}
	return supabaseClient;
};

/** Returns the current Supabase access token, or null if no session is active. Browser-only. */
export const getAccessTokenOrNull = async (): Promise<string | null> => {
	if (!browser) return null;
	const supabase = getSupabaseClient();
	const { data } = await supabase.auth.getSession();
	return data.session?.access_token ?? null;
};

/** Same as above but throws when no token is available. */
export const getAccessToken = async (): Promise<string> => {
	const token = await getAccessTokenOrNull();
	if (!token) throw new Error('User not authenticated');
	return token;
};

/** Extracts token from a SSR-provided session, falling back to null. */
export const tokenFromSession = (session: Session | null | undefined): string | null =>
	session?.access_token ?? null;
