// Normalize Windows-style backslashes to forward slashes for the
// fetch URL. R2 stores sample paths with forward slashes (the
// upload sanitizer at dtx-api/sanitizeFilename.ts and the set.def
// normalizer both replace `\` with `/`), so a #WAV reference like
// `sound\kick.wav` must be fetched as `sound/kick.wav`. Without
// this, the backslash survives segment splitting and is
// percent-encoded to %5C, producing a URL R2 does not have.
// Reject path-traversal segments before building the URL. The
// fileName originates from untrusted DTX `#WAV` lines, and
// encodeURIComponent does NOT encode `.` — so `../foo.wav`
// would survive encoding and let the browser normalize the URL
// out of the chart directory. Block `.`, `..`, empty segments,
// and absolute paths (leading `/`) to confine fetches to the
// intended bucket subdirectory.
export const normalizeAudioReference = (reference: string): string | null => {
	const normalized = reference.replaceAll('\\', '/');
	const segments = normalized.split('/');
	if (segments.some((s) => s === '..' || s === '.' || s === '') || normalized.startsWith('/')) {
		return null;
	}
	return normalized;
};
