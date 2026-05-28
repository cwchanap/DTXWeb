import { GenerateMagicLinkDocument } from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

export type MagicLinkResult = { magicLinkUrl: string };

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

export const generateMagicLink = async (ctx?: ClientCtx): Promise<MagicLinkResult> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)('/api/auth/generate-magic-link', { method: 'POST' });
		if (!res.ok) throw new Error(`magic-link failed: ${res.status}`);
		return (await res.json()) as MagicLinkResult;
	}
	const client = await getClient(ctx);
	const result = await client.request(GenerateMagicLinkDocument, {});
	return { magicLinkUrl: result.generateMagicLink.magicLinkUrl };
};
