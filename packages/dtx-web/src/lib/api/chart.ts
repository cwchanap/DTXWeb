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

export type ScopeString = 'mine' | 'published';

export type LegacySimfile = {
	id: number;
	display_id: number | null;
	title: string;
	artist: string;
	bpm: number;
	user_id: string | null;
	is_published: boolean;
	google_drive_file_id: string | null;
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

/**
 * Input type for adaptSimfile, derived from the generated GraphQL fragment.
 * Both `getSimfile` and `updateSimfile` return the full `SimfileWithFilesFragment`
 * (so `files` and `hasUploadedFiles` are present), while `listSimfiles` returns
 * a partial fragment without `files` (but includes `hasUploadedFiles`).
 */
type AdaptSimfileInput = Omit<SimfileWithFilesFragment, 'files' | 'hasUploadedFiles'> & {
	files?: SimfileWithFilesFragment['files'];
	hasUploadedFiles?: SimfileWithFilesFragment['hasUploadedFiles'];
};

const adaptSimfile = (s: AdaptSimfileInput): LegacySimfile => {
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
		google_drive_file_id: s.googleDriveFileId ?? null,
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
	const numId = Number(result.simfile.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${result.simfile.id}`);
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
): Promise<LegacySimfile> => {
	const client = await getClient(ctx);
	const result = await client.request(UpdateSimfileDocument, { id, input });
	return adaptSimfile(result.updateSimfile);
};

export type DriveFileBinding = {
	id: number;
	google_drive_file_id: string | null;
	download_url: string | null;
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
	const numId = Number(result.updateSimfileDriveFile.id);
	if (!Number.isFinite(numId)) {
		throw new Error(`Invalid simfile id: ${result.updateSimfileDriveFile.id}`);
	}
	return {
		id: numId,
		google_drive_file_id: result.updateSimfileDriveFile.googleDriveFileId ?? null,
		download_url: result.updateSimfileDriveFile.downloadUrl ?? null
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
	const numId = Number(result.deleteSimfile.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${result.deleteSimfile.id}`);
	return {
		id: numId,
		deleted: result.deleteSimfile.deleted,
		partialDeletion: result.deleteSimfile.partialDeletion ?? undefined,
		message: result.deleteSimfile.message ?? undefined
	};
};
