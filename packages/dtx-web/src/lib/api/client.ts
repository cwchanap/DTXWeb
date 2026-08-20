import { browser } from '$app/environment';
import { makeBrowserClient, makeServiceBindingClient, type GraphQLLikeClient } from './transport';

export type ClientCtx = {
	fetch?: typeof fetch;
	platform?: App.Platform;
	cookieHeader?: string | null;
	origin?: string | null;
};

/** Returns a GraphQL client appropriate for the current context. */
export const getClient = async (ctx?: ClientCtx): Promise<GraphQLLikeClient> => {
	// SSR with the API service binding (pre-prod stanzas) uses the binding directly.
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(
			ctx.platform.env.API,
			ctx.cookieHeader ?? null,
			ctx.origin ?? null
		);
	}
	return makeBrowserClient(ctx?.fetch);
};
