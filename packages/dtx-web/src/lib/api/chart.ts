import {
	ListSimfilesDocument,
	GetSimfileDocument,
	GetPreviewSimfileDocument,
	UpdateSimfileDocument,
	UpdateSimfileDriveFileDocument,
	DeleteSimfileDocument,
	SimfileScope,
	type UpdateSimfileInput,
	type SimfileWithFilesFragment
} from './generated/graphql';
import { getClient, type ClientCtx } from './client';
import type { SimfileModel, SimfileDtxFile } from '@dtx/common';

export type ScopeString = 'mine' | 'published';

export type SimfileListResult = { data: SimfileModel[]; count: number };

const scopeToEnum = (scope: ScopeString): SimfileScope =>
	scope === 'mine' ? SimfileScope.Mine : SimfileScope.Published;

/**
 * Input type for toSimfileModel, derived from the generated GraphQL fragment.
 * Both `getSimfile` and `updateSimfile` return the full `SimfileWithFilesFragment`
 * (so `files` and `hasUploadedFiles` are present), while `listSimfiles` returns
 * a partial fragment without `files` (but includes `hasUploadedFiles`).
 */
type AdaptSimfileInput = Omit<SimfileWithFilesFragment, 'files' | 'hasUploadedFiles'> & {
	files?: SimfileWithFilesFragment['files'];
	hasUploadedFiles?: SimfileWithFilesFragment['hasUploadedFiles'];
};

const parseSimfileId = (id: string): number => {
	const numId = Number(id);
	if (!Number.isSafeInteger(numId)) throw new Error(`Invalid simfile id: ${id}`);
	return numId;
};

const toSimfileModel = (simfile: AdaptSimfileInput): SimfileModel => ({
	id: parseSimfileId(simfile.id),
	title: simfile.title,
	artist: simfile.artist,
	bpm: simfile.bpm,
	displayId: simfile.displayId ?? null,
	userId: simfile.userId ?? null,
	googleDriveFileId: simfile.googleDriveFileId ?? null,
	isPublished: simfile.isPublished,
	downloadUrl: simfile.downloadUrl ?? null,
	previewUrl: simfile.previewUrl ?? null,
	videoPreviewUrl: simfile.videoPreviewUrl ?? null,
	publishDate: simfile.publishDate,
	createdAt: simfile.createdAt,
	updatedAt: simfile.updatedAt,
	dtxFiles: (simfile.dtxFiles ?? []).map((file): SimfileDtxFile => ({
		label: file.label,
		level: file.level
	})),
	...(simfile.files == null ? {} : { files: simfile.files }),
	...(simfile.hasUploadedFiles == null ? {} : { hasUploadedFiles: simfile.hasUploadedFiles })
});

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
		data: result.simfiles.data.map(toSimfileModel),
		count: result.simfiles.count
	};
};

export const getSimfile = async (id: string, ctx?: ClientCtx): Promise<SimfileModel> => {
	const client = await getClient(ctx);
	const result = await client.request(GetSimfileDocument, { id });
	if (!result.simfile) throw new Error('Simfile not found');
	return toSimfileModel(result.simfile);
};

export type PreviewLevel = { level: number; label: string; fileUrl: string };

export type PreviewSimfile = {
	id: number;
	title: string;
	artist: string;
	levels: PreviewLevel[];
};

/**
 * Minimal metadata fetch for the `/preview` page: title/artist plus each level's
 * R2 `fileUrl`. Uses a dedicated query (not `SimfileFull`) so the
 * `DtxFile.fileUrl` resolver — which returns null on a missing R2 object — is
 * scoped to this single-chart call and cannot break the shared list/detail
 * fragments. Levels whose R2 object is missing (fileUrl null) are filtered out
 * here so the preview degrades to the available levels instead of failing.
 */
export const getPreviewSimfile = async (id: string, ctx?: ClientCtx): Promise<PreviewSimfile> => {
	const client = await getClient(ctx);
	const result = await client.request(GetPreviewSimfileDocument, { id });
	if (!result.simfile) throw new Error('Simfile not found');
	const numId = parseSimfileId(result.simfile.id);
	return {
		id: numId,
		title: result.simfile.title,
		artist: result.simfile.artist,
		levels: (result.simfile.dtxFiles ?? [])
			.filter(
				(f): f is { level: number; label: string; fileUrl: string } => f.fileUrl != null
			)
			.map((f) => ({
				level: f.level,
				label: f.label,
				fileUrl: f.fileUrl
			}))
	};
};

export const updateSimfile = async (
	id: string,
	input: UpdateSimfileInput,
	ctx?: ClientCtx
): Promise<SimfileModel> => {
	const client = await getClient(ctx);
	const result = await client.request(UpdateSimfileDocument, { id, input });
	return toSimfileModel(result.updateSimfile);
};

export type DriveFileBinding = {
	id: number;
	googleDriveFileId: string | null;
	downloadUrl: string | null;
};

export const updateSimfileDriveFile = async (
	id: string,
	googleDriveFileId: string,
	downloadUrl: string,
	ctx?: ClientCtx
): Promise<DriveFileBinding> => {
	const client = await getClient(ctx);
	const result = await client.request(UpdateSimfileDriveFileDocument, {
		id,
		googleDriveFileId,
		downloadUrl
	});
	return {
		id: parseSimfileId(result.updateSimfileDriveFile.id),
		googleDriveFileId: result.updateSimfileDriveFile.googleDriveFileId ?? null,
		downloadUrl: result.updateSimfileDriveFile.downloadUrl ?? null
	};
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
	return {
		id: parseSimfileId(result.deleteSimfile.id),
		deleted: result.deleteSimfile.deleted,
		partialDeletion: result.deleteSimfile.partialDeletion ?? undefined,
		message: result.deleteSimfile.message ?? undefined
	};
};
