type GraphqlSimfile = {
	id: string;
	title: string;
	artist: string;
	bpm: number;
	userId: string | null;
	isPublished: boolean;
	displayId: number | null;
	downloadUrl: string | null;
	previewUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: Array<{ level: number; label: string }>;
};

export const toRendererSimfile = (s: GraphqlSimfile) => ({
	id: Number(s.id),
	title: s.title,
	artist: s.artist,
	bpm: s.bpm,
	user_id: s.userId ?? undefined,
	is_published: s.isPublished,
	display_id: s.displayId,
	download_url: s.downloadUrl,
	preview_url: s.previewUrl,
	video_preview_url: s.videoPreviewUrl,
	publish_date: s.publishDate,
	created_at: s.createdAt,
	updated_at: s.updatedAt,
	dtx_files: s.dtxFiles.map((f, index) => ({
		level: f.level,
		label: f.label,
		id: index + 1
	}))
});
