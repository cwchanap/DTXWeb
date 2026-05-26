import {
	MeDocument,
	UpsertUserProfileDocument,
	type UpsertUserProfileInput
} from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

export type LegacyUserProfile = { user_id: string; username: string };

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

const adapt = (g: { userId: string; username: string }): LegacyUserProfile => ({
	user_id: g.userId,
	username: g.username
});

export const getMe = async (ctx?: ClientCtx): Promise<LegacyUserProfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/user/profile', { method: 'GET' });
		if (!res.ok) throw new Error(`me failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacyUserProfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(MeDocument, {});
	return adapt(result.me);
};

export const upsertUserProfile = async (
	input: UpsertUserProfileInput,
	ctx?: ClientCtx
): Promise<LegacyUserProfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/user/profile', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`upsert failed: ${res.status}`);
		const body = (await res.json()) as { data: LegacyUserProfile };
		return body.data;
	}
	const client = await getClient(ctx);
	const result = await client.request(UpsertUserProfileDocument, { input });
	return adapt(result.upsertUserProfile);
};
