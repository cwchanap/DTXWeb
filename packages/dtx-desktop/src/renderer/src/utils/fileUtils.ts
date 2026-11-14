export type FileContent = string | ArrayBuffer | Uint8Array;

export const toBlobPart = (content: FileContent): BlobPart => {
	if (content instanceof Uint8Array) {
		// Normalize Buffer/Uint8Array to a standalone ArrayBuffer for File ctor
		return new Uint8Array(content).buffer;
	}
	return content;
};

/**
 * True when `path` uses Windows path syntax: a drive-letter root (`C:\` or
 * `C:/`) or a UNC/verbatim root (`\\server\share`, `\\?\C:\`). A literal
 * backslash inside a POSIX file name is legal and must not flip joining
 * logic to Windows separators (`/Users/me/AC\DC` is a valid macOS folder).
 */
export const isWindowsPath = (path: string): boolean =>
	/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
