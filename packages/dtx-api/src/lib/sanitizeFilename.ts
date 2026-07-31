// Helper function to sanitize filename for safe storage keys.
// Preserves directory structure and non-ASCII characters while preventing path traversal.
export const sanitizeFilename = (filename: string): string => {
	let sanitized = filename;

	// Remove control characters before path traversal checks because their removal can join segments.
	// eslint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');

	// Iteratively remove path traversal sequences until the string stabilizes.
	let previousSanitized: string;
	do {
		previousSanitized = sanitized;
		sanitized = sanitized
			.replace(/\.\.(?:\/|\\)/g, '')
			.replace(/[/\\]\.\.$/, '')
			.replace(/^[/\\]+/, '')
			.replace(/[/\\]+$/, '');
	} while (sanitized !== previousSanitized);

	// Collapse runs of dots followed by slashes (e.g., "....//" -> "")
	sanitized = sanitized.replace(/\.{2,}([/\\]+)/g, '');

	// Normalize path separators to forward slash for consistency
	sanitized = sanitized.replace(/\\/g, '/');

	// Truncate to reasonable max length (1024 chars for S3/object storage compatibility)
	const MAX_LENGTH = 1024;
	if (sanitized.length > MAX_LENGTH) {
		const lastSlash = sanitized.lastIndexOf('/');
		const lastDot = sanitized.lastIndexOf('.');
		if (lastDot > lastSlash && lastDot > lastSlash + 1) {
			const ext = sanitized.slice(lastDot);
			const nameWithoutExt = sanitized.slice(0, lastDot);
			const allowedNameLen = Math.max(0, MAX_LENGTH - ext.length);
			if (allowedNameLen > 0) {
				sanitized = nameWithoutExt.slice(0, allowedNameLen) + ext;
			} else {
				sanitized = ext.slice(0, MAX_LENGTH);
			}
		} else {
			sanitized = sanitized.slice(0, MAX_LENGTH);
		}
	}

	// Fallback if result is empty or just dots/slashes
	if (!sanitized || /^[./\\_-]*$/.test(sanitized)) {
		sanitized = `file_${Date.now()}`;
	}

	return sanitized;
};
