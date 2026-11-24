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

/**
 * Detects BOM (UTF-16LE, UTF-16BE or UTF-8) in an ArrayBuffer and decodes
 * accordingly, stripping the BOM character from the result. When no BOM is
 * present, UTF-16 is still detected from the zero-byte parity of the first
 * pairs — the desktop decoder tries UTF-16LE/BE without a BOM, so BOM-less
 * UTF-16 charts reach R2 — and anything else falls back to UTF-8.
 *
 * Used for raw byte sources (e.g. `R2Object.arrayBuffer()`) where the default
 * `text()` path always decodes as UTF-8 and would either garble UTF-16LE
 * content or leave a BOM character on the first directive. set.def files in
 * this app are routinely written as UTF-16LE with BOM
 * (see `write_utf16le_with_bom` in `packages/dtx-desktop/src-tauri/src/songs.rs`).
 *
 * @param buffer - Raw bytes (typically from `R2Object.arrayBuffer()`)
 * @returns Decoded string with BOM character stripped if present
 */
export function decodeArrayBufferWithBomDetection(buffer: ArrayBuffer): string {
	const uint8 = new Uint8Array(buffer);
	if (uint8.length === 0) return '';
	let text: string;
	if (uint8[0] === 0xff && uint8[1] === 0xfe) {
		// UTF-16LE BOM
		text = new TextDecoder('utf-16le').decode(buffer);
	} else if (uint8[0] === 0xfe && uint8[1] === 0xff) {
		// UTF-16BE BOM — the desktop uploader's decode_bom recognizes it
		// too, so a BOM'd UTF-16BE chart can be a cataloged row's source.
		text = new TextDecoder('utf-16be').decode(buffer);
	} else if (uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
		// UTF-8 BOM
		text = new TextDecoder('utf-8').decode(buffer);
	} else {
		// No BOM — but the desktop decoder also tries UTF-16LE/BE without
		// a byte-order mark (DTX_DECODING_PRIORITY in
		// packages/dtx-desktop/src-tauri/src/songs.rs), so a BOM-less
		// UTF-16 chart can be a cataloged row's source. Such a file
		// decodes as NUL-interleaved garbage under UTF-8: ASCII-heavy
		// chart text is zero in every second byte (odd offsets for LE,
		// even for BE). Detect that zero-byte parity over the first
		// pairs; anything else defaults to UTF-8 (matching Workers'
		// default text() behavior).
		let evenZeros = 0;
		let oddZeros = 0;
		const pairs = Math.min(uint8.length >> 1, 512);
		for (let i = 0; i < pairs; i++) {
			if (uint8[i * 2] === 0) evenZeros++;
			if (uint8[i * 2 + 1] === 0) oddZeros++;
		}
		let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
		if (oddZeros > evenZeros && oddZeros * 4 > pairs) {
			encoding = 'utf-16le';
		} else if (evenZeros > oddZeros && evenZeros * 4 > pairs) {
			encoding = 'utf-16be';
		} else if (uint8.length >= 2) {
			// Sparse-zero UTF-16 (e.g. #TITLE: followed by hundreds of CJK chars)
			// fails the zero-byte density test; sniff valid directives in both
			// UTF-16 byte orders before falling back to UTF-8. Truncate the
			// probe slice to an even byte count so an odd-length ranged read
			// doesn't emit U+FFFD for a trailing half-code-unit.
			const directiveRegex =
				/^\s*#(?:TITLE|ARTIST|BPM|DLEVEL|COMMENT|WAV|BMP|PREVIEW|L\d+(?:LABEL|FILE|FONT))/im;
			const probeEnd = Math.min(uint8.length & ~1, 2048);
			const probeSlice = uint8.subarray(0, probeEnd);
			for (const candidate of ['utf-16le', 'utf-16be'] as const) {
				const decoded = new TextDecoder(candidate).decode(probeSlice);
				if (
					!decoded.includes('\u0000') &&
					!decoded.includes('\uFFFD') &&
					directiveRegex.test(decoded)
				) {
					encoding = candidate;
					break;
				}
			}
		}
		text = new TextDecoder(encoding).decode(buffer);
	}
	// Strip BOM character if it survived decoding
	if (text.charCodeAt(0) === 0xfeff) {
		text = text.slice(1);
	}
	return text;
}
