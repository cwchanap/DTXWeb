import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeFileWithEncodingDetection, type ContentValidationCallback } from './encoding-utils';

// Mock TextDecoder
const mockTextDecoder = vi.fn();
global.TextDecoder = mockTextDecoder;

describe('encoding-utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('decodeFileWithEncodingDetection', () => {
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

			let isLastCall = false;
			mockTextDecoder.mockImplementation((encoding) => ({
				decode: vi.fn().mockImplementation(() => {
					if (encoding === 'shift-jis' && isLastCall) {
						return fallbackContent;
					}
					if (encoding === 'shift-jis') {
						isLastCall = true;
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
});
