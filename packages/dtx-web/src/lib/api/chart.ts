import {
	ListSimfilesDocument,
	GetSimfileDocument,
	UpdateSimfileDocument,
	DeleteSimfileDocument,
	SimfileScope,
	type UpdateSimfileInput
} from './generated/graphql';
import { getClient, type ClientCtx } from './client';

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
}): LegacySimfile => {
	const numId = Number(s.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${s.id}`);
	return {
		id: numId,
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
	};
};

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
	const client = await getClient(ctx);
	const result = await client.request(DeleteSimfileDocument, { id });
	const numId = Number(result.deleteSimfile.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${result.deleteSimfile.id}`);
	return {
		id: numId,
		deleted: result.deleteSimfile.deleted,
		partialDeletion: result.deleteSimfile.partialDeletion ?? undefined,
		message: result.deleteSimfile.message ?? undefined
	};
};
