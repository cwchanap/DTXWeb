import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import type { Ctx } from '../context';

export const builder = new SchemaBuilder<{
	Context: Ctx;
	AuthScopes: {
		user: boolean;
		owner: { simfileId: string };
		publicOrOwner: { simfileId: string };
	};
}>({
	plugins: [ScopeAuthPlugin, ErrorsPlugin],
	scopeAuth: {
		authScopes: async (ctx) => ({
			user: ctx.user != null,
			// Phase 2 wires these to ctx.ownerByIdCache + getSimfileOwner; Phase 1 stubs.
			owner: async () => false,
			publicOrOwner: async () => false
		})
	}
});

builder.queryType({});
// Phase 2 will add builder.mutationType({}) alongside its first mutation field.
// GraphQL requires every declared type to expose at least one field, so we
// leave the mutation type undeclared in Phase 1.
