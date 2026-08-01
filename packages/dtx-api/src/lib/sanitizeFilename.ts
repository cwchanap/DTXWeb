// Iteratively strip path-traversal sequences and collapse dot-runs that could
// resolve to traversal after separator normalization. Runs until stable.
// Handles both forward and back slashes so it is valid before separator
// normalization as well as after.
const normalizeTraversal = (value: string): string => {
	let result = value;
	// Iteratively remove path traversal sequences until the string stabilizes.
	let previous: string;
	do {
		previous = result;
		result = result
			.replace(/\.\.(?:\/|\\)/g, '')
			.replace(/[/\\]\.\.$/, '')
			.replace(/^[/\\]+/, '')
			.replace(/[/\\]+$/, '');
	} while (result !== previous);

	// Collapse runs of dots followed by slashes (e.g., "....//" -> "")
	result = result.replace(/\.{2,}([/\\]+)/g, '');
	return result;
};

// Helper function to sanitize filename for safe storage keys.
// Preserves directory structure and non-ASCII characters while preventing path traversal.
export const sanitizeFilename = (filename: string): string => {
	let sanitized = filename;

	// Remove control characters before path traversal checks because their removal can join segments.
	// eslint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');

	sanitized = normalizeTraversal(sanitized);

	// Normalize path separators to forward slash for consistency
	sanitized = sanitized.replace(/\\/g, '/');

	// Truncate to reasonable max length (1024 chars for S3/object storage compatibility).
	// Truncation can create new dot-only path segments (e.g. "aaa/..x/bbb" sliced to
	// "aaa/.."), so traversal normalization MUST run again afterwards.
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

	// Re-normalize after truncation: slicing can expose a trailing "/.." or "/."
	// segment that wasn't present before the cut.
	sanitized = normalizeTraversal(sanitized);

	// Final guard: drop any remaining "." or ".." segments introduced by a
	// transformation that changed segment boundaries. encodeURIComponent leaves
	// "." and ".." untouched, so URL canonicalization would otherwise resolve
	// them as directory traversal against the public bucket.
	sanitized = sanitized
		.split('/')
		.filter((segment) => segment !== '.' && segment !== '..')
		.join('/');

	// Fallback if result is empty or just dots/slashes
	if (!sanitized || /^[./\\_-]*$/.test(sanitized)) {
		sanitized = `file_${Date.now()}`;
	}

	return sanitized;
};
