import {
	ListSimfilesDocument,
	GetSimfileDocument,
	UpdateSimfileDocument,
	DeleteSimfileDocument,
	SimfileScope,
	type UpdateSimfileInput
} from './generated/graphql';
import { getClient, useGraphQL, type ClientCtx } from './client';

export type ScopeString = 'mine' | 'published';

export type LegacySimfile = {
	id: number;
	display_id: number | null;
	title: string;
	artist: string;
	bpm: number;
	user_id: string | null;
	is_published: boolean;
	download_url: string | null;
	preview_url: string | null;
	video_preview_url: string | null;
	publish_date: string;
	created_at: string;
	updated_at: string;
	dtx_files: { level: number; label: string }[];
	files?: { key: string; size: number; uploaded: string }[];
	has_uploaded_files?: boolean;
};

export type SimfileListResult = { data: LegacySimfile[]; count: number };

const scopeToEnum = (scope: ScopeString): SimfileScope =>
	scope === 'mine' ? SimfileScope.Mine : SimfileScope.Published;

const adaptSimfile = (s: {
	id: string;
	displayId?: number | null;
	title: string;
	artist: string;
	bpm: number;
	userId?: string | null;
	isPublished: boolean;
	downloadUrl?: string | null;
	previewUrl?: string | null;
	videoPreviewUrl?: string | null;
	publishDate?: string;
	createdAt?: string;
	updatedAt?: string;
	dtxFiles?: { level: number; label: string }[];
	files?: { key: string; size: number; uploaded: string }[];
	hasUploadedFiles?: boolean;
}): LegacySimfile => ({
	id: Number(s.id),
	display_id: s.displayId ?? null,
	title: s.title,
	artist: s.artist,
	bpm: s.bpm,
	user_id: s.userId ?? null,
	is_published: s.isPublished,
	download_url: s.downloadUrl ?? null,
	preview_url: s.previewUrl ?? null,
	video_preview_url: s.videoPreviewUrl ?? null,
	publish_date: s.publishDate ?? '',
	created_at: s.createdAt ?? '',
	updated_at: s.updatedAt ?? '',
	dtx_files: s.dtxFiles ?? [],
	files: s.files,
	has_uploaded_files: s.hasUploadedFiles
});

const fetchFn = (ctx?: ClientCtx): typeof fetch => ctx?.fetch ?? fetch;

export type ListParams = {
	scope: ScopeString;
	search?: string;
	page?: number;
	pageSize?: number;
};

export const listSimfiles = async (
	params: ListParams,
	ctx?: ClientCtx
): Promise<SimfileListResult> => {
	if (!useGraphQL()) {
		const qs = new URLSearchParams({ scope: params.scope, check_uploaded: 'true' });
		if (params.search) qs.set('search', params.search);
		if (params.page) qs.set('page', String(params.page));
		if (params.pageSize) qs.set('pageSize', String(params.pageSize));
		const res = await fetchFn(ctx)(`/api/chart?${qs}`, { method: 'GET' });
		if (!res.ok) throw new Error(`list failed: ${res.status}`);
		return (await res.json()) as SimfileListResult;
	}
	const client = await getClient(ctx);
	const result = await client.request(ListSimfilesDocument, {
		scope: scopeToEnum(params.scope),
		search: params.search ?? null,
		page: params.page ?? 1,
		pageSize: params.pageSize ?? 20
	});
	return {
		data: result.simfiles.data.map(adaptSimfile),
		count: result.simfiles.count
	};
};

export const getSimfile = async (id: string, ctx?: ClientCtx): Promise<LegacySimfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/chart/${id}`, { method: 'GET' });
		if (!res.ok) throw new Error(`get failed: ${res.status}`);
		return (await res.json()) as LegacySimfile;
	}
	const client = await getClient(ctx);
	const result = await client.request(GetSimfileDocument, { id });
	if (!result.simfile) throw new Error('Simfile not found');
	return adaptSimfile(result.simfile);
};

export const updateSimfile = async (
	id: string,
	input: UpdateSimfileInput,
	ctx?: ClientCtx
): Promise<LegacySimfile> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/chart/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (!res.ok) throw new Error(`update failed: ${res.status}`);
		return (await res.json()) as LegacySimfile;
	}
	const client = await getClient(ctx);
	const result = await client.request(UpdateSimfileDocument, { id, input });
	return adaptSimfile(result.updateSimfile);
};

export type DeleteResult = {
	id: number;
	deleted: boolean;
	partialDeletion?: boolean;
	message?: string;
};

export const deleteSimfile = async (id: string, ctx?: ClientCtx): Promise<DeleteResult> => {
	if (!useGraphQL()) {
		const res = await fetchFn(ctx)(`/api/simFile/delete/${id}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`delete failed: ${res.status}`);
		const body = (await res.json()) as {
			partialDeletion?: boolean;
			message?: string;
		};
		return {
			id: Number(id),
			deleted: true,
			partialDeletion: body.partialDeletion,
			message: body.message
		};
	}
	const client = await getClient(ctx);
	const result = await client.request(DeleteSimfileDocument, { id });
	return { id: Number(result.deleteSimfile.id), deleted: result.deleteSimfile.deleted };
};
