import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import { GraphQLError } from 'graphql';
import { getSimfileOwner } from '@dtx/common/server';
import type { Ctx, OwnerCacheEntry } from '../context';

// Per-request in-flight promise map to deduplicate concurrent lookups for the same simfileId.
// Keyed by the request's ownerByIdCache instance so it is automatically scoped to the request
// lifetime and garbage-collected when the Map itself is collected.
const inFlight = new WeakMap<
	Map<string, OwnerCacheEntry | null>,
	Map<string, Promise<OwnerCacheEntry | null>>
>();

const loadOwner = (ctx: Ctx, cacheKey: string): Promise<OwnerCacheEntry | null> => {
	// 1. Return immediately if the resolved value is already cached.
	if (ctx.ownerByIdCache.has(cacheKey)) {
		return Promise.resolve(ctx.ownerByIdCache.get(cacheKey) ?? null);
	}

	// 2. Return the in-flight promise if a fetch for this key is already underway.
	let flights = inFlight.get(ctx.ownerByIdCache);
	if (!flights) {
		flights = new Map();
		inFlight.set(ctx.ownerByIdCache, flights);
	}
	if (flights.has(cacheKey)) {
		return flights.get(cacheKey)!;
	}

	// 3. First caller: validate the id, start the fetch, register the promise.
	const id = Number(cacheKey);
	if (!Number.isSafeInteger(id) || id <= 0) {
		ctx.ownerByIdCache.set(cacheKey, null);
		return Promise.resolve(null);
	}

	const promise = getSimfileOwner(ctx.db, id).then((row): OwnerCacheEntry | null => {
		const entry: OwnerCacheEntry | null = row
			? { userId: row.user_id, isPublished: row.is_published === 1 }
			: null;
		// Populate the resolved cache so subsequent (non-concurrent) callers skip the DB.
		ctx.ownerByIdCache.set(cacheKey, entry);
		flights!.delete(cacheKey);
		return entry;
	});

	flights.set(cacheKey, promise);
	return promise;
};

type ScopeArg = { simfileId: string };

export const builder = new SchemaBuilder<{
	Context: Ctx;
	AuthScopes: {
		user: boolean;
		owner: { simfileId: string };
		publicOrOwner: { simfileId: string };
	};
	DefaultFieldNullability: false;
}>({
	plugins: [ScopeAuthPlugin, ErrorsPlugin],
	defaultFieldNullability: false,
	scopeAuth: {
		treatErrorsAsUnauthorized: true,
		unauthorizedError: () =>
			new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } }),
		authScopes: async (ctx: Ctx) => ({
			user: ctx.user != null,
			owner: async ({ simfileId }: ScopeArg) => {
				if (!ctx.user) return false;
				const entry = await loadOwner(ctx, simfileId);
				return entry !== null && entry.userId === ctx.user.id;
			},
			publicOrOwner: async ({ simfileId }: ScopeArg) => {
				const entry = await loadOwner(ctx, simfileId);
				if (!entry) return false;
				if (entry.isPublished) return true;
				return ctx.user != null && entry.userId === ctx.user.id;
			}
		})
	}
});

builder.queryType({});
// Mutation root is declared in schema/index.ts before mutation fields land (Task 4).
