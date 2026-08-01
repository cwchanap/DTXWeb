// Normalize separators and discard empty or dot-only path segments.
// This avoids removal-based traversal sanitization, where deleting one
// substring can expose a new dangerous sequence at the same boundary.
const normalizePathSegments = (value: string): string =>
	value
		.replace(/\\/g, '/')
		.split('/')
		.filter((segment) => segment.length > 0 && !/^\.+$/.test(segment))
		.join('/');

// Helper function to sanitize filename for safe storage keys.
// Preserves directory structure and non-ASCII characters while preventing path traversal.
export const sanitizeFilename = (filename: string): string => {
	let sanitized = filename;

	// Remove control characters before segment parsing because their removal can join tokens.
	// eslint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');

	// Parse the path structurally rather than deleting traversal substrings.
	sanitized = normalizePathSegments(sanitized);

	// Truncate to reasonable max length (1024 chars for S3/object storage compatibility).
	// Truncation can create a new dot-only trailing segment, so segment parsing runs again below.
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

	// Re-parse after truncation so newly exposed empty or dot-only segments cannot survive.
	sanitized = normalizePathSegments(sanitized);

	// Fallback if result is empty or contains no usable filename characters.
	if (!sanitized || /^[._-]*$/.test(sanitized)) {
		sanitized = `file_${Date.now()}`;
	}

	return sanitized;
};
