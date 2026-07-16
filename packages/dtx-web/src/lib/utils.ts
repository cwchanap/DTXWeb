/**
 * Decode a single raw `dtx_files.level` to its two-decimal display string.
 *
 * The canonical storage contract is an encoded integer on the ×10 scale
 * (e.g. 50 == 5.0, 55 == 5.5) or the ×100 scale (values > 100, e.g. 550 == 5.5).
 * The GraphQL schema exposes `level` as a `Float`, so a stray decimal (e.g. 5.5)
 * can arrive even though the canonical form is encoded; a non-integer is already
 * on the display scale and is returned as-is rather than divided again.
 */
export const formatLevel = (level: string | number | undefined | null): string => {
	const parsed = typeof level === 'string' ? parseFloat(level) : (level ?? 0);
	const n = Number.isFinite(parsed) ? parsed : 0;
	const display = Number.isInteger(n) ? (n > 100 ? n / 100 : n / 10) : n;
	return display.toFixed(2);
};

export const formatLevelDisplay = (dtx_files: Array<{ level?: string | number }>): string => {
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
