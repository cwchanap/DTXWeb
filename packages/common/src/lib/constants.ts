/**
 * Valid file extensions for DTX-related files
 * These extensions are used for:
 * - File filtering in UploadedAssetFiles component
 * - Export validation in desktop app
 * - Upload validation
 */
export const VALID_DTX_FILE_EXTENSIONS = [
	'.dtx',
	'.def',
	'.wav',
	'.mp3',
	'.ogg',
	'.flac',
	'.m4a',
	'.aac',
	'.xa',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.bmp',
	'.tiff',
	'.tga'
] as const;

/**
 * Check if a file extension is valid for DTX files
 * @param extension - File extension to check (case insensitive)
 * @returns true if extension is valid
 */
export function isValidDtxFileExtension(extension: string): boolean {
	return VALID_DTX_FILE_EXTENSIONS.includes(
		extension.toLowerCase() as (typeof VALID_DTX_FILE_EXTENSIONS)[number]
	);
}

/**
 * Check if a filename has a valid DTX file extension
 * @param filename - Filename to check
 * @returns true if filename has valid extension
 */
export function isValidDtxFile(filename: string): boolean {
	const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
	return isValidDtxFileExtension(extension);
}
