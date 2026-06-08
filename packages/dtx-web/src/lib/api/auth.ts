import { GenerateMagicLinkDocument } from './generated/graphql';
import { getClient, type ClientCtx } from './client';

export type MagicLinkResult = { magicLinkUrl: string };

export const generateMagicLink = async (ctx?: ClientCtx): Promise<MagicLinkResult> => {
	const client = await getClient(ctx);
	const result = await client.request(GenerateMagicLinkDocument, {});
	return { magicLinkUrl: result.generateMagicLink.magicLinkUrl };
};
