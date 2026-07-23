import { formatLevel, normalizeLevel } from '@dtx/common';

export { formatLevel };

/**
 * Decode and join the `dtx_files.level` values for list display, sorted by
 * normalized (display-scale) level so mixed encodings (×10 and ×100) are
 * ordered correctly. See `formatLevel` / `normalizeLevel` (re-exported from
 * `@dtx/common`) for the per-value decode contract.
 */
export const formatLevelDisplay = (dtx_files: Array<{ level?: string | number }>): string => {
	return (
		dtx_files
			?.slice()
			.sort((a, b) => normalizeLevel(a.level) - normalizeLevel(b.level))
			.map((file) => formatLevel(file.level))
			.join(' / ') || 'N/A'
	);
};

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
