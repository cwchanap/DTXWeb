/**
 * Type definition for content validation callback
 * Returns true if the content appears to be valid for the specific file type
 */
export type ContentValidationCallback = (content: string) => boolean;

/**
 * Detects and decodes file content with automatic encoding detection
 * @param file - The file to decode
 * @param encodings - List of encodings to try in order (optional)
 * @param validateContent - Callback function to validate if content is valid for the file type
 * @param fallbackEncoding - Encoding to use as fallback if detection fails (default: 'utf-8')
 * @returns Object with decoded content and detected encoding
 */
export async function decodeFileWithEncodingDetection(
	file: File,
	validateContent: ContentValidationCallback,
	encodings: string[] = ['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'],
	fallbackEncoding: string = 'utf-8'
): Promise<{ content: string; encoding: string }> {
	const arrayBuffer = await file.arrayBuffer();

	for (const encoding of encodings) {
		try {
			const decoder = new TextDecoder(encoding);
			const content = decoder.decode(arrayBuffer);

			// Use the provided validation callback to check if content is valid
			if (validateContent(content)) {
				// Additional check: ensure no excessive null bytes (which would indicate wrong encoding)
				const nullByteRatio = (content.match(/\0/g) || []).length / content.length;
				if (nullByteRatio < 0.1) {
					return { content, encoding };
				}
			}
		} catch (error) {
			// Continue to next encoding if this one fails
			continue;
		}
	}

	// Fallback to specified encoding if nothing else works
	const decoder = new TextDecoder(fallbackEncoding);
	const content = decoder.decode(arrayBuffer);
	return { content, encoding: fallbackEncoding };
}

/**
 * Backward compatibility function that returns just the content string
 * @param file - The file to decode
 * @param validateContent - Callback function to validate if content is valid for the file type
 * @param encodings - List of encodings to try in order (optional)
 * @param fallbackEncoding - Encoding to use as fallback if detection fails (default: 'utf-8')
 * @returns Decoded file content as string
 */
export async function decodeFileWithEncodingDetectionLegacy(
	file: File,
	validateContent: ContentValidationCallback,
	encodings: string[] = ['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'],
	fallbackEncoding: string = 'utf-8'
): Promise<string> {
	const result = await decodeFileWithEncodingDetection(
		file,
		validateContent,
		encodings,
		fallbackEncoding
	);
	return result.content;
}

/**
 * Decodes file content with a specific encoding
 * @param file - The file to decode
 * @param encoding - The encoding to use
 * @returns Decoded file content as string
 */
export async function decodeFileWithSpecificEncoding(
	file: File,
	encoding: string
): Promise<string> {
	const arrayBuffer = await file.arrayBuffer();
	const decoder = new TextDecoder(encoding);
	return decoder.decode(arrayBuffer);
}
