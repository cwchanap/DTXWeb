import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { getAccessTokenOrNull } from './token';
import { makeBrowserClient, makeServiceBindingClient, type GraphQLLikeClient } from './transport';

export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	accessToken?: string | null;
};

/** Single source of truth for the flag. */
export const useGraphQL = (): boolean => env.PUBLIC_USE_GRAPHQL_API === 'true';

/** Returns a GraphQL client appropriate for the current context. */
export const getClient = async (ctx?: ClientCtx): Promise<GraphQLLikeClient> => {
	// TODO (Phase 4): Wire ctx.platform from +page.server.ts load functions and add the
	// API service binding to the production wrangler.jsonc environment. The SSR path below
	// is tested and ready but currently unreachable because all callers are browser-side.
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken ?? null);
	}
	// Browser: resolve token from Supabase when not explicitly provided
	const token = ctx?.accessToken !== undefined ? ctx.accessToken : await getAccessTokenOrNull();
	return makeBrowserClient(token);
};
