/**
 * Workspace path helpers.
 *
 * Browser folder imports deliver `webkitRelativePath` values that include the
 * selected root directory as the first segment. Workspace `path` fields are
 * persisted relative to that root so they stay stable when the generated
 * workspace name is suffixed (e.g. "Pack (1)") and so nested song folders
 * keep their identity. Files at the import root — and flat imports with no
 * relative path at all — resolve to the bare file name, so `path === name`.
 */

/**
 * Strip the first browser path segment (the selected root directory) from a
 * `webkitRelativePath`, falling back to the file name when there is no
 * directory structure to remove.
 */
export const toWorkspacePath = (
	webkitRelativePath: string | undefined,
	fileName: string
): string => {
	const segments = (webkitRelativePath ?? '').split('/');
	return segments.length > 1 ? segments.slice(1).join('/') : fileName;
};

/**
 * NFC-normalized, lowercased form of a workspace-relative path for identity
 * comparisons, tolerating platform differences in case or Unicode
 * normalization (macOS can deliver NFD names).
 */
export const workspacePathKey = (path: string): string => path.normalize('NFC').toLowerCase();

/**
 * Per-segment collision key for ZIP entry paths: each segment is
 * NFC-normalized and lowercased so names that extract onto the same file on
 * case-insensitive / normalizing filesystems (macOS, Windows) collide, and
 * leading spaces plus trailing spaces/dots are folded because Windows
 * extraction strips them (' dir/kick.wav' and 'dir/kick.wav' land on one
 * file).
 */
export const zipCollisionKey = (path: string): string =>
	path
		.split('/')
		.map((segment) =>
			segment
				.normalize('NFC')
				.toLowerCase()
				.replace(/^ +/, '')
				.replace(/[ .]+$/, '')
		)
		.join('/');
