import { ClientError } from 'graphql-request';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getGraphQLClient } from './graphql/client';
import {
	ListSimfilesDocument,
	GetSimfileDocument,
	GetSimfileWithFilesDocument,
	CreateSimfileDocument,
	UpdateSimfileDocument,
	DeleteSimfileDocument,
	NextDisplayIdDocument,
	SimfileSearchDocument,
	MeDocument,
	UpsertUserProfileDocument,
	GenerateMagicLinkDocument,
	type CreateSimfileInput,
	type UpdateSimfileInput,
	type UpsertUserProfileInput,
	type SimfileScope,
	type ListSimfilesQuery,
	type GetSimfileQuery,
	type GetSimfileWithFilesQuery,
	type CreateSimfileMutation,
	type UpdateSimfileMutation,
	type DeleteSimfileMutation,
	type NextDisplayIdQuery,
	type SimfileSearchQuery,
	type MeQuery,
	type UpsertUserProfileMutation,
	type GenerateMagicLinkMutation
} from './graphql/generated/graphql';

export type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

const extractError = (err: unknown): string => {
	if (err instanceof ClientError) {
		const first = err.response.errors?.[0];
		const code = first?.extensions?.code as string | undefined;
		const msg = first?.message ?? `HTTP ${err.response.status}`;
		return code ? `${code}: ${msg}` : msg;
	}
	if (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string }).name === 'AbortError'
	) {
		return 'Request timed out after 30000ms';
	}
	return err instanceof Error ? err.message : 'Unknown error';
};

const runGraphQL = async <T, V extends object>(
	doc: TypedDocumentNode<T, V>,
	vars: V
): Promise<ApiResult<T>> => {
	try {
		const client = await getGraphQLClient();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data = (await (client as any).request(doc, vars)) as T;
		return { success: true, data };
	} catch (err) {
		return { success: false, error: extractError(err) };
	}
};

// Chart operations
export const listSimfiles = async (vars: {
	scope: SimfileScope;
	search?: string;
	page?: number;
	pageSize?: number;
}): Promise<ApiResult<ListSimfilesQuery['simfiles']>> => {
	const r = await runGraphQL<ListSimfilesQuery, typeof vars>(ListSimfilesDocument, vars);
	if (!r.success) return r;
	return { success: true, data: r.data.simfiles };
};

export const getSimfile = (id: string) =>
	runGraphQL<GetSimfileQuery, { id: string }>(GetSimfileDocument, { id });

export const getSimfileWithFiles = async (
	id: string
): Promise<ApiResult<GetSimfileWithFilesQuery['simfile']>> => {
	const r = await runGraphQL<GetSimfileWithFilesQuery, { id: string }>(
		GetSimfileWithFilesDocument,
		{ id }
	);
	if (!r.success) return r;
	return { success: true, data: r.data.simfile };
};

export const createSimfile = (input: CreateSimfileInput) =>
	runGraphQL<CreateSimfileMutation, { input: CreateSimfileInput }>(CreateSimfileDocument, {
		input
	});

export const updateSimfile = (id: string, input: UpdateSimfileInput) =>
	runGraphQL<UpdateSimfileMutation, { id: string; input: UpdateSimfileInput }>(
		UpdateSimfileDocument,
		{
			id,
			input
		}
	);

export const deleteSimfile = async (
	id: string
): Promise<ApiResult<{ id: string; deleted: boolean }>> => {
	const r = await runGraphQL<DeleteSimfileMutation, { id: string }>(DeleteSimfileDocument, {
		id
	});
	if (!r.success) return r;
	return { success: true, data: r.data.deleteSimfile };
};

export const nextDisplayId = async (): Promise<ApiResult<number>> => {
	const r = await runGraphQL<NextDisplayIdQuery, Record<string, never>>(
		NextDisplayIdDocument,
		{}
	);
	if (!r.success) return r;
	return { success: true, data: r.data.nextDisplayId };
};

export const simfileSearch = (vars: { query: string; excludeIds?: string[]; limit?: number }) =>
	runGraphQL<SimfileSearchQuery, typeof vars>(SimfileSearchDocument, vars);

// User operations
export const me = () => runGraphQL<MeQuery, Record<string, never>>(MeDocument, {});

export const upsertUserProfile = (input: UpsertUserProfileInput) =>
	runGraphQL<UpsertUserProfileMutation, { input: UpsertUserProfileInput }>(
		UpsertUserProfileDocument,
		{
			input
		}
	);

// Auth operations
export const generateMagicLink = () =>
	runGraphQL<GenerateMagicLinkMutation, Record<string, never>>(GenerateMagicLinkDocument, {});

// TEMPORARY shims removed in Tasks 25-26
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const apiGet = <T = unknown>(path: string): Promise<ApiResult<T>> => {
	throw new Error('apiGet is being migrated; see Task 25/26');
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const apiPost = <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> => {
	throw new Error('apiPost is being migrated; see Task 25/26');
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const apiPatch = <T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> => {
	throw new Error('apiPatch is being migrated; see Task 25/26');
};
