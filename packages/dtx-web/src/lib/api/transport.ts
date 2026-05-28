import { GraphQLClient } from 'graphql-request';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type { Fetcher } from '@cloudflare/workers-types';
import { print } from 'graphql';
import { env } from '$env/dynamic/public';

const graphqlEndpoint = () => {
	const base = (env.PUBLIC_DTX_API_URL ?? '').replace(/\/$/, '');
	if (!base) {
		throw new Error('PUBLIC_DTX_API_URL is not configured — set it in .env');
	}
	return `${base}/graphql`;
};

export const makeBrowserClient = (token?: string | null) =>
	new GraphQLClient(graphqlEndpoint(), {
		headers: token ? { Authorization: `Bearer ${token}` } : {}
	});

export type GraphQLLikeClient = {
	request: <T, V extends object>(doc: TypedDocumentNode<T, V>, vars: V) => Promise<T>;
};

export const makeServiceBindingClient = (
	binding: Fetcher,
	token?: string | null
): GraphQLLikeClient => ({
	request: async <T, V extends object>(doc: TypedDocumentNode<T, V>, vars: V): Promise<T> => {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (token) headers.authorization = `Bearer ${token}`;
		const req = new Request('https://api.internal/graphql', {
			method: 'POST',
			headers,
			body: JSON.stringify({ query: print(doc), variables: vars })
		});
		// Cast needed: @cloudflare/workers-types Request has extra required fields
		// not present on the DOM Request; at runtime CF accepts DOM Request objects.
		const res = await binding.fetch(req as unknown as Parameters<Fetcher['fetch']>[0]);
		if (!res.ok) {
			const body = await res.text();
			throw new Error(
				`GraphQL request failed: ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
			);
		}
		const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
		if (json.errors && json.errors.length > 0) {
			throw new Error(json.errors[0].message);
		}
		if (json.data === undefined) {
			throw new Error('GraphQL response missing data');
		}
		return json.data;
	}
});
