import {
	MeDocument,
	UpsertUserProfileDocument,
	type UpsertUserProfileInput
} from './generated/graphql';
import { getClient, type ClientCtx } from './client';

export type LegacyUserProfile = { user_id: string; username: string };

const adapt = (g: { userId: string; username: string }): LegacyUserProfile => ({
	user_id: g.userId,
	username: g.username
});

export const getMe = async (ctx?: ClientCtx): Promise<LegacyUserProfile> => {
	const client = await getClient(ctx);
	const result = await client.request(MeDocument, {});
	return adapt(result.me);
};

export const upsertUserProfile = async (
	input: UpsertUserProfileInput,
	ctx?: ClientCtx
): Promise<LegacyUserProfile> => {
	const client = await getClient(ctx);
	const result = await client.request(UpsertUserProfileDocument, { input });
	return adapt(result.upsertUserProfile);
};
