export interface SimfileDtxFile {
	id?: number;
	label: string;
	level: number;
}

export interface SimfileAssetFile {
	key: string;
	size: number;
	uploaded: string;
}

export interface SimfileModel {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	displayId: number | null;
	userId: string | null;
	googleDriveFileId: string | null;
	isPublished: boolean;
	downloadUrl: string | null;
	previewUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: SimfileDtxFile[];
	files?: SimfileAssetFile[];
	hasUploadedFiles?: boolean;
}
