import { GraphQLError } from 'graphql';
import { builder } from './builder';
import { generateMagicLink } from '../services/magicLink';

const MagicLinkResult = builder.objectRef<{ magicLinkUrl: string }>('MagicLinkResult').implement({
	fields: (t) => ({
		magicLinkUrl: t.exposeString('magicLinkUrl'),
		success: t.boolean({ resolve: () => true })
	})
});

builder.mutationField('generateMagicLink', (t) =>
	t.field({
		type: MagicLinkResult,
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => {
			const email = ctx.user!.email;
			if (!email) {
				throw new GraphQLError('User has no email address', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			const ip = ctx.request.headers.get('cf-connecting-ip');
			return generateMagicLink(ctx.env, ctx.kv, ctx.logger, { id: ctx.user!.id, email }, ip);
		}
	})
);
