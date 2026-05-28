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

export type ApiResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code?: string };

const extractError = (err: unknown): { error: string; code?: string } => {
	if (err instanceof ClientError) {
		const first = err.response.errors?.[0];
		const code = first?.extensions?.code as string | undefined;
		const msg = first?.message ?? `HTTP ${err.response.status}`;
		return code ? { error: `${code}: ${msg}`, code } : { error: msg, code };
	}
	if (
		typeof err === 'object' &&
		err !== null &&
		'name' in err &&
		(err as { name: string }).name === 'AbortError'
	) {
		return { error: 'Request timed out after 30000ms' };
	}
	return { error: err instanceof Error ? err.message : 'Unknown error' };
};

const runGraphQL = async <T, V extends object>(
	doc: TypedDocumentNode<T, V>,
	vars: V
): Promise<ApiResult<T>> => {
	try {
		const client = await getGraphQLClient();
		// Cast needed: getGraphQLClient returns a graphql-request client whose request()
		// signature doesn't match TypedDocumentNode; the cast is safe because codegen
		// generates matching types for each operation.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data = (await (client as any).request(doc, vars)) as T;
		return { success: true, data };
	} catch (err) {
		return { success: false, ...extractError(err) };
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

export const getSimfile = async (
	id: string
): Promise<ApiResult<NonNullable<GetSimfileQuery['simfile']>>> => {
	const r = await runGraphQL<GetSimfileQuery, { id: string }>(GetSimfileDocument, { id });
	if (!r.success) return r;
	if (!r.data.simfile) {
		return { success: false, error: 'Simfile not found', code: 'NOT_FOUND' };
	}
	return { success: true, data: r.data.simfile };
};

export const getSimfileWithFiles = async (
	id: string
): Promise<ApiResult<NonNullable<GetSimfileWithFilesQuery['simfile']>>> => {
	const r = await runGraphQL<GetSimfileWithFilesQuery, { id: string }>(
		GetSimfileWithFilesDocument,
		{ id }
	);
	if (!r.success) return r;
	if (!r.data.simfile) {
		return { success: false, error: 'Simfile not found', code: 'NOT_FOUND' };
	}
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
): Promise<
	ApiResult<{ id: string; deleted: boolean; partialDeletion?: boolean; message?: string }>
> => {
	const r = await runGraphQL<DeleteSimfileMutation, { id: string }>(DeleteSimfileDocument, {
		id
	});
	if (!r.success) return r;
	const { partialDeletion, message, ...rest } = r.data.deleteSimfile;
	return {
		success: true,
		data: {
			...rest,
			partialDeletion: partialDeletion ?? undefined,
			message: message ?? undefined
		}
	};
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
