/**
 * Sanitizes a file or folder name to be safe for the filesystem.
 *
 * Guards against:
 * - Directory traversal (`..` sequences) and path separators, which could
 *   escape the intended song folder when joined into a path.
 * - Windows-invalid characters (`< > : " | ? *`) and control characters.
 * - Leading/trailing dots and spaces (Windows restriction).
 * - Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 *
 * Falls back to `'untitled'` when nothing safe remains, and truncates to 200
 * characters to stay well under common filesystem name limits (255).
 *
 * Extracted from NewSong.svelte so the path-traversal / reserved-name logic is
 * directly unit-testable.
 */
export const sanitizeName = (name: string): string => {
	if (!name || typeof name !== 'string') {
		return '';
	}

	// Remove leading/trailing whitespace
	let sanitized = name.trim();

	// Remove or replace dangerous path traversal sequences
	sanitized = sanitized.replace(/\.\.+/g, ''); // Remove .. sequences
	sanitized = sanitized.replace(/[\\/]/g, ''); // Remove path separators

	// Remove or replace invalid filename characters (Windows + Unix)
	// Invalid characters: < > : " | ? * and control characters (0-31, 127)
	sanitized = sanitized.replace(/[<>:"|?*]/g, '');
	sanitized = sanitized
		.split('')
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join('');

	// Limit length to prevent filesystem issues (255 is common limit).
	// This MUST run before the leading/trailing dot+space strip below,
	// otherwise truncation could reintroduce a trailing '.' or ' ' that
	// Windows rejects (the earlier strip would have been undone).
	if (sanitized.length > 200) {
		sanitized = sanitized.substring(0, 200);
	}

	// Remove leading dots and spaces (Windows restriction)
	sanitized = sanitized.replace(/^[.\s]+/, '');

	// Remove trailing dots and spaces (Windows restriction)
	sanitized = sanitized.replace(/[.\s]+$/, '');

	// Handle reserved names on Windows
	const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
	if (reservedNames.test(sanitized)) {
		sanitized = sanitized + '_safe';
	}

	// Ensure the name is not empty after sanitization
	if (!sanitized) {
		sanitized = 'untitled';
	}

	return sanitized;
};
