// packages/dtx-web/src/lib/api/client.ts
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
	// SSR with service binding takes precedence
	if (!browser && ctx?.platform?.env?.API) {
		return makeServiceBindingClient(ctx.platform.env.API, ctx.accessToken ?? null);
	}
	// Browser: resolve token from Supabase if not pre-supplied
	const token = ctx?.accessToken ?? (await getAccessTokenOrNull());
	return makeBrowserClient(token);
};
