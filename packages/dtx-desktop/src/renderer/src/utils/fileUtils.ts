export type FileContent = string | ArrayBuffer | Uint8Array;

export const toBlobPart = (content: FileContent): BlobPart => {
	if (content instanceof Uint8Array) {
		// Normalize Buffer/Uint8Array to a standalone ArrayBuffer for File ctor
		return new Uint8Array(content).buffer;
	}
	return content;
};
