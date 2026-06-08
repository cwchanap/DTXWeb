import { browser } from '$app/environment';
import { getAccessTokenOrNull } from './token';
import { makeBrowserClient, makeServiceBindingClient, type GraphQLLikeClient } from './transport';

export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	accessToken?: string | null;
};

/** Returns a GraphQL client appropriate for the current context. */
export const getClient = async (ctx?: ClientCtx): Promise<GraphQLLikeClient> => {
	// SSR with the API service binding (pre-prod stanzas) uses the binding directly.
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken ?? null);
	}
	// Browser: resolve token from Supabase when not explicitly provided.
	const token = ctx?.accessToken !== undefined ? ctx.accessToken : await getAccessTokenOrNull();
	return makeBrowserClient(token);
};
