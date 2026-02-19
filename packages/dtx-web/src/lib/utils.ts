export function formatLevelDisplay(dtx_files: Array<{ level?: string | number }>) {
	return (
		dtx_files
			?.slice()
			.sort((a, b) => {
				const parsedA = typeof a.level === 'string' ? parseFloat(a.level) : a.level || 0;
				const parsedB = typeof b.level === 'string' ? parseFloat(b.level) : b.level || 0;
				const levelA = Number.isFinite(parsedA) ? parsedA : 0;
				const levelB = Number.isFinite(parsedB) ? parsedB : 0;
				return levelA - levelB;
			})
			.map((file) => {
				const level =
					typeof file.level === 'string' ? parseFloat(file.level) : file.level || 0;
				return (level > 100 ? level / 100 : level / 10).toFixed(2);
			})
			.join(' / ') || 'N/A'
	);
}

export function filterFiles(files: FileList | File[], filters: string[]) {
	return Array.from(files).filter((file) =>
		new Set(filters).has(file.name.toLowerCase().slice(file.name.lastIndexOf('.')))
	);
}

/**
 * Builds a preview URL for simfile assets (images, audio, etc.)
 * @param simfileBucketUrl - The base bucket URL (e.g., 'https://example.com/bucket')
 * @param itemId - The simfile ID
 * @param ext - The file extension (e.g., 'jpg', 'mp3')
 * @returns The full preview URL or null if itemId is undefined, zero, or negative
 */
export function buildPreviewUrl(
	simfileBucketUrl: string,
	itemId: number | undefined,
	ext: string
): string | null {
	if (itemId === undefined || itemId <= 0) {
		return null;
	}
	const normalizedBucketUrl = simfileBucketUrl.replace(/\/$/, '');
	return `${normalizedBucketUrl}/${itemId}/preview.${ext}`;
}
