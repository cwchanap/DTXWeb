import { GraphQLError } from 'graphql';
import { z } from 'zod';
import { getUserProfile, upsertUserProfile, type UserProfileRow } from '@dtx/common/server';
import { builder } from './builder';

builder.mutationType({});

const UserProfileRef = builder.objectRef<UserProfileRow>('UserProfile').implement({
	fields: (t) => ({
		userId: t.id({ resolve: (row) => row.user_id }),
		username: t.exposeString('username')
	})
});

builder.queryField('me', (t) =>
	t.field({
		type: UserProfileRef,
		authScopes: { user: true },
		resolve: async (_root, _args, ctx) => {
			const profile = await getUserProfile(ctx.db, ctx.user!.id);
			if (!profile) {
				throw new GraphQLError('User profile not found', {
					extensions: { code: 'NOT_FOUND' }
				});
			}
			return profile;
		}
	})
);

const UpsertUserProfileInput = builder.inputType('UpsertUserProfileInput', {
	fields: (t) => ({ username: t.string({ required: true }) })
});

const usernameSchema = z
	.string()
	.transform((v) => v.trim())
	.pipe(
		z
			.string()
			.min(1, 'Username must be 1-30 characters')
			.max(30, 'Username must be 1-30 characters')
	);

builder.mutationField('upsertUserProfile', (t) =>
	t.field({
		type: UserProfileRef,
		args: { input: t.arg({ type: UpsertUserProfileInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			const parsed = usernameSchema.safeParse(input.username);
			if (!parsed.success) {
				throw new GraphQLError(parsed.error.issues[0]?.message ?? 'Bad input', {
					extensions: { code: 'BAD_USER_INPUT' }
				});
			}
			return upsertUserProfile(ctx.db, { user_id: ctx.user!.id, username: parsed.data });
		}
	})
);
