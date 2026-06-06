import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	decodeFileWithEncodingDetection,
	decodeFileWithEncodingDetectionLegacy,
	decodeFileWithSpecificEncoding,
	decodeArrayBufferWithBomDetection,
	type ContentValidationCallback
} from './encoding-utils';

// Preserve real TextDecoder before mock replacement so BOM detection tests
// (which exercise real decoding behavior) can opt-in to the runtime impl.
const RealTextDecoder = globalThis.TextDecoder;

// Mock TextDecoder
const mockTextDecoder = vi.fn();
global.TextDecoder = mockTextDecoder;

const createMockFile = (content: string, fileName: string = 'test.dtx'): File => {
	const blob = new Blob([content], { type: 'text/plain' });
	return new File([blob], fileName);
};

const createMockArrayBuffer = (content: string): ArrayBuffer => {
	const encoder = new TextEncoder();
	return encoder.encode(content).buffer;
};

const mockValidationCallback: ContentValidationCallback = (content: string) => {
	return content.includes('#TITLE:') || content.includes('#BPM:');
};

describe('encoding-utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('decodeFileWithEncodingDetection', () => {
		it('should decode file with first valid encoding', async () => {
			const testContent = '#TITLE: Test Song\n#BPM: 120';
			const mockFile = createMockFile(testContent);

			// Mock File.arrayBuffer()
			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			// Mock TextDecoder to return valid content for UTF-8
			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockReturnValue(testContent)
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['utf-8', 'shift-jis'],
				'utf-8'
			);

			expect(result.content).toBe(testContent);
			expect(result.encoding).toBe('utf-8');
			expect(mockTextDecoder).toHaveBeenCalledWith('utf-8');
		});

		it('should try multiple encodings until finding valid one', async () => {
			const testContent = '#TITLE: Test Song';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			// Mock TextDecoder to fail for first encoding but succeed for second
			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'utf-8') {
						return 'invalid content without markers';
					}
					if (encoding === 'shift-jis') {
						return testContent;
					}
					return 'other content';
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['utf-8', 'shift-jis'],
				'utf-8'
			);

			expect(result.content).toBe(testContent);
			expect(result.encoding).toBe('shift-jis');
		});

		it('should use fallback encoding when all encodings fail validation', async () => {
			const fallbackContent = '#TITLE: Fallback Song';
			const mockFile = createMockFile('invalid content');

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(
				createMockArrayBuffer('invalid content')
			);

			let callCount = 0;
			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					callCount++;
					if (encoding === 'utf-8' && callCount > 2) {
						// Fallback call
						return fallbackContent;
					}
					return 'invalid content without markers';
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['shift-jis', 'utf-16le'],
				'utf-8'
			);

			expect(result.content).toBe(fallbackContent);
			expect(result.encoding).toBe('utf-8');
		});

		it('should reject content with excessive null bytes', async () => {
			const contentWithNulls = '#TITLE: Test\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0';
			const goodContent = '#TITLE: Good Song';
			const mockFile = createMockFile('test');

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer('test'));

			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'utf-8') {
						return contentWithNulls; // Has too many null bytes
					}
					if (encoding === 'shift-jis') {
						return goodContent; // Clean content
					}
					return 'other';
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['utf-8', 'shift-jis'],
				'utf-8'
			);

			expect(result.content).toBe(goodContent);
			expect(result.encoding).toBe('shift-jis');
		});

		it('should handle TextDecoder errors gracefully', async () => {
			const testContent = '#TITLE: Test Song';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'invalid-encoding') {
						throw new Error('Unsupported encoding');
					}
					return testContent;
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['invalid-encoding', 'utf-8'],
				'utf-8'
			);

			expect(result.content).toBe(testContent);
			expect(result.encoding).toBe('utf-8');
		});

		it('should use default encodings when none provided', async () => {
			const testContent = '#BPM: 120';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(testContent)
			}));

			const result = await decodeFileWithEncodingDetection(mockFile, mockValidationCallback);

			expect(result.content).toBe(testContent);
			expect(mockTextDecoder).toHaveBeenCalledWith('utf-8'); // Should try UTF-8 first by default
		});

		it('should use custom fallback encoding', async () => {
			const fallbackContent = '#TITLE: Shift-JIS Song';
			const mockFile = createMockFile('test');

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer('test'));

			let callCount = 0;
			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					callCount++;
					// First call is utf-8 (in encodings array) - return invalid content
					if (callCount === 1 && encoding === 'utf-8') {
						return 'invalid content';
					}
					// Second call is shift-jis (fallback) - return valid content
					if (callCount === 2 && encoding === 'shift-jis') {
						return fallbackContent;
					}
					return 'invalid content';
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['utf-8'],
				'shift-jis'
			);

			expect(result.content).toBe(fallbackContent);
			expect(result.encoding).toBe('shift-jis');
		});

		it('should work with different validation callbacks', async () => {
			const xmlContent = '<?xml version="1.0"?><root></root>';
			const customValidation: ContentValidationCallback = (content) => {
				return content.includes('<?xml') || content.includes('<root>');
			};

			const mockFile = createMockFile(xmlContent);
			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(xmlContent));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(xmlContent)
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				customValidation,
				['utf-8'],
				'utf-8'
			);

			expect(result.content).toBe(xmlContent);
			expect(result.encoding).toBe('utf-8');
		});

		it('should handle empty file content', async () => {
			const emptyContent = '';
			const mockFile = createMockFile(emptyContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(0));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(emptyContent)
			}));

			// Validation that accepts empty content
			const emptyValidation: ContentValidationCallback = (content) => content === '';

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				emptyValidation,
				['utf-8'],
				'utf-8'
			);

			expect(result.content).toBe(emptyContent);
			expect(result.encoding).toBe('utf-8');
		});

		it('should handle binary content appropriately', async () => {
			const binaryContent = '\xFF\xFE\x00\x01\x02\x03'; // Binary data
			const textContent = '#TITLE: Text Song';
			const mockFile = createMockFile('binary');

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer('binary'));

			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'utf-16le') {
						return binaryContent; // Contains null bytes, should be rejected
					}
					if (encoding === 'utf-8') {
						return textContent; // Clean text content
					}
					return 'other';
				})
			}));

			const result = await decodeFileWithEncodingDetection(
				mockFile,
				mockValidationCallback,
				['utf-16le', 'utf-8'],
				'utf-8'
			);

			expect(result.content).toBe(textContent);
			expect(result.encoding).toBe('utf-8');
		});

		it('should handle file reading errors', async () => {
			const mockFile = createMockFile('test');

			// Mock arrayBuffer to throw an error
			vi.spyOn(mockFile, 'arrayBuffer').mockRejectedValue(new Error('File read error'));

			await expect(
				decodeFileWithEncodingDetection(
					mockFile,
					mockValidationCallback,
					['utf-8'],
					'utf-8'
				)
			).rejects.toThrow('File read error');
		});
	});

	describe('decodeFileWithEncodingDetectionLegacy', () => {
		it('should return just the content string (not an object)', async () => {
			const testContent = '#TITLE: Test Song\n#BPM: 120';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(testContent)
			}));

			const result = await decodeFileWithEncodingDetectionLegacy(
				mockFile,
				mockValidationCallback,
				['utf-8'],
				'utf-8'
			);

			expect(typeof result).toBe('string');
			expect(result).toBe(testContent);
		});

		it('should use default encodings when none provided', async () => {
			const testContent = '#BPM: 120';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(testContent)
			}));

			const result = await decodeFileWithEncodingDetectionLegacy(
				mockFile,
				mockValidationCallback
			);

			expect(result).toBe(testContent);
			expect(mockTextDecoder).toHaveBeenCalledWith('utf-8');
		});

		it('should fall back and return content from fallback encoding', async () => {
			const fallbackContent = '#TITLE: Fallback';
			const mockFile = createMockFile('test');

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer('test'));

			mockTextDecoder.mockImplementation((encoding: string) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'utf-8') return 'no match';
					if (encoding === 'shift-jis') return fallbackContent;
					return 'other encoding';
				})
			}));

			const result = await decodeFileWithEncodingDetectionLegacy(
				mockFile,
				(content) => content.includes('#TITLE:'),
				['utf-8'],
				'shift-jis'
			);

			expect(result).toBe(fallbackContent);
			expect(mockTextDecoder).toHaveBeenCalledWith('utf-8');
			expect(mockTextDecoder).toHaveBeenCalledWith('shift-jis');
		});
	});

	describe('decodeFileWithSpecificEncoding', () => {
		it('should decode file using the specified encoding', async () => {
			const testContent = 'Hello World';
			const mockFile = createMockFile(testContent);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(testContent));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(testContent)
			}));

			const result = await decodeFileWithSpecificEncoding(mockFile, 'utf-8');

			expect(result).toBe(testContent);
			expect(mockTextDecoder).toHaveBeenCalledWith('utf-8');
		});

		it('should use the specified encoding without trying alternatives', async () => {
			const content = 'Shift-JIS content';
			const mockFile = createMockFile(content);

			vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(createMockArrayBuffer(content));

			mockTextDecoder.mockImplementation(() => ({
				decode: vi.fn().mockReturnValue(content)
			}));

			const result = await decodeFileWithSpecificEncoding(mockFile, 'shift-jis');

			expect(result).toBe(content);
			expect(mockTextDecoder).toHaveBeenCalledWith('shift-jis');
			expect(mockTextDecoder).toHaveBeenCalledTimes(1);
		});

		it('should propagate errors from arrayBuffer', async () => {
			const mockFile = createMockFile('test');

			vi.spyOn(mockFile, 'arrayBuffer').mockRejectedValue(new Error('Read error'));

			await expect(decodeFileWithSpecificEncoding(mockFile, 'utf-8')).rejects.toThrow(
				'Read error'
			);
		});
	});

	describe('ContentValidationCallback type', () => {
		it('should accept valid callback function', () => {
			const callback: ContentValidationCallback = (content: string) => {
				return content.includes('valid');
			};

			expect(callback('valid content')).toBe(true);
			expect(callback('test content')).toBe(false);
		});

		it('should work with DTX validation logic', () => {
			const dtxCallback: ContentValidationCallback = (content: string) => {
				return (
					content.includes('#TITLE') ||
					content.includes('#BPM') ||
					content.includes('#WAV')
				);
			};

			expect(dtxCallback('#TITLE: Song Name')).toBe(true);
			expect(dtxCallback('#BPM: 120')).toBe(true);
			expect(dtxCallback('#WAV01: audio.wav')).toBe(true);
			expect(dtxCallback('invalid content')).toBe(false);
		});

		it('should work with complex validation patterns', () => {
			const midiCallback: ContentValidationCallback = (content: string) => {
				// Check for MIDI file header patterns
				return content.includes('MThd') || content.includes('MTrk');
			};

			expect(midiCallback('MThd\x00\x00\x00\x06')).toBe(true);
			expect(midiCallback('MTrk\x00\x00\x00\x20')).toBe(true);
			expect(midiCallback('Not a MIDI file')).toBe(false);
		});
	});

	describe('decodeArrayBufferWithBomDetection', () => {
		// These tests exercise the real runtime TextDecoder behavior, so restore
		// the global mock to the platform implementation for this block.
		const originalDecoder = global.TextDecoder;
		beforeEach(() => {
			global.TextDecoder = RealTextDecoder;
		});
		afterEach(() => {
			global.TextDecoder = originalDecoder;
		});

		it('decodes UTF-8 without BOM as UTF-8', () => {
			const text = '#L1LABEL BASIC\n#L1FILE basic.dtx\n';
			const buffer = new TextEncoder().encode(text).buffer;
			expect(decodeArrayBufferWithBomDetection(buffer)).toBe(text);
		});

		it('decodes UTF-8 BOM and strips the BOM character', () => {
			const text = '#TITLE UTF8 BOM\n#L1LABEL BASIC\n';
			const bytes = new TextEncoder().encode(text);
			const buffer = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]).buffer;
			// Without BOM stripping, the first directive would start with \uFEFF
			// and fail to match `^#L` regex parsing.
			const decoded = decodeArrayBufferWithBomDetection(buffer);
			expect(decoded).toBe(text);
			expect(decoded.charCodeAt(0)).not.toBe(0xfeff);
		});

		it('decodes UTF-16LE BOM and strips the BOM character', () => {
			const text = '#TITLE UTF16LE BOM\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
			const utf16Bytes = new Uint8Array(text.length * 2);
			for (let i = 0; i < text.length; i++) {
				const codeUnit = text.charCodeAt(i);
				utf16Bytes[i * 2] = codeUnit & 0xff;
				utf16Bytes[i * 2 + 1] = (codeUnit >> 8) & 0xff;
			}
			const buffer = new Uint8Array([0xff, 0xfe, ...utf16Bytes]).buffer;
			const decoded = decodeArrayBufferWithBomDetection(buffer);
			expect(decoded).toBe(text);
			expect(decoded.charCodeAt(0)).not.toBe(0xfeff);
		});

		it('returns empty string for empty buffer', () => {
			expect(decodeArrayBufferWithBomDetection(new ArrayBuffer(0))).toBe('');
		});

		it('handles single-byte buffer without throwing (no BOM match)', () => {
			const buffer = new Uint8Array([0x41]).buffer; // "A"
			expect(decodeArrayBufferWithBomDetection(buffer)).toBe('A');
		});
	});
});
