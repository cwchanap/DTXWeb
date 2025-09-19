import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XAAudioContext } from './audioDecoder';

// Mock xa_decoder module
const mockInit = vi.fn();
const mockWasmXADecoder = vi.fn();

vi.mock('xa_decoder', () => ({
	default: mockInit,
	WasmXADecoder: mockWasmXADecoder
}));

// Mock global AudioContext
const mockCreateBuffer = vi.fn();
const mockAudioContext = {
	createBuffer: mockCreateBuffer,
	decodeAudioData: vi.fn()
};

// Store original AudioContext
const originalAudioContext = global.AudioContext;

describe('XAAudioContext', () => {
	let xaContext: XAAudioContext;
	let mockDecoder: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock AudioContext globally
		global.AudioContext = vi.fn().mockImplementation(() => mockAudioContext);

		// Setup mock decoder instance
		mockDecoder = {
			decode: vi.fn(),
			get_format: vi.fn(),
			free: vi.fn()
		};

		mockWasmXADecoder.mockImplementation(() => mockDecoder);

		// Reset initialization state
		mockInit.mockResolvedValue(undefined);

		xaContext = new XAAudioContext();
	});

	afterEach(() => {
		global.AudioContext = originalAudioContext;
	});

	describe('constructor', () => {
		it('should create instance without initializing WASM', () => {
			expect(mockInit).not.toHaveBeenCalled();
			expect(xaContext).toBeInstanceOf(XAAudioContext);
		});

		it('should extend AudioContext', () => {
			expect(global.AudioContext).toHaveBeenCalled();
		});
	});

	describe('decodeAudioData - XA decoding', () => {
		const createMockXAData = (): ArrayBuffer => {
			const buffer = new ArrayBuffer(1024);
			const view = new Uint8Array(buffer);
			// Fill with some test data
			for (let i = 0; i < view.length; i++) {
				view[i] = i % 256;
			}
			return buffer;
		};

		const mockFormat = {
			channels: 2,
			samples_rate: 44100
		};

		const mockDecodedData = new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5, -0.6]);

		beforeEach(() => {
			mockDecoder.get_format.mockReturnValue(mockFormat);
			mockDecoder.decode.mockReturnValue(mockDecodedData);

			// Mock createBuffer to return a proper AudioBuffer-like object
			const mockAudioBuffer = {
				numberOfChannels: mockFormat.channels,
				length: mockDecodedData.length / mockFormat.channels,
				sampleRate: mockFormat.samples_rate,
				getChannelData: vi
					.fn()
					.mockReturnValue(
						new Float32Array(mockDecodedData.length / mockFormat.channels)
					),
				copyFromChannel: vi.fn(),
				copyToChannel: vi.fn()
			};

			mockCreateBuffer.mockReturnValue(mockAudioBuffer);
		});

		it('should initialize WASM on first call', async () => {
			const testData = createMockXAData();

			await xaContext.decodeAudioData(testData);

			expect(mockInit).toHaveBeenCalledOnce();
		});

		it('should not reinitialize WASM on subsequent calls', async () => {
			const testData = createMockXAData();

			await xaContext.decodeAudioData(testData);
			await xaContext.decodeAudioData(testData);

			expect(mockInit).toHaveBeenCalledOnce();
		});

		it('should decode XA audio data successfully', async () => {
			const testData = createMockXAData();

			const result = await xaContext.decodeAudioData(testData);

			expect(mockWasmXADecoder).toHaveBeenCalled();
			expect(mockDecoder.decode).toHaveBeenCalledWith(new Uint8Array(testData));
			expect(mockDecoder.get_format).toHaveBeenCalled();
			expect(result).toBeDefined();
		});

		it('should create AudioBuffer with correct parameters', async () => {
			const testData = createMockXAData();

			await xaContext.decodeAudioData(testData);

			const expectedSamplesPerChannel = mockDecodedData.length / mockFormat.channels;
			expect(mockCreateBuffer).toHaveBeenCalledWith(
				mockFormat.channels,
				expectedSamplesPerChannel,
				mockFormat.samples_rate
			);
		});

		it('should populate AudioBuffer channels with decoded data', async () => {
			const testData = createMockXAData();
			const mockChannelData = new Float32Array(3);
			const mockAudioBuffer = {
				numberOfChannels: 2,
				getChannelData: vi.fn().mockReturnValue(mockChannelData)
			};

			mockCreateBuffer.mockReturnValue(mockAudioBuffer);

			await xaContext.decodeAudioData(testData);

			// Should call getChannelData for each channel
			expect(mockAudioBuffer.getChannelData).toHaveBeenCalledWith(0);
			expect(mockAudioBuffer.getChannelData).toHaveBeenCalledWith(1);
		});

		it('should call success callback when provided', async () => {
			const testData = createMockXAData();
			const successCallback = vi.fn();
			const mockAudioBuffer = { test: 'buffer' };

			mockCreateBuffer.mockReturnValue(mockAudioBuffer);

			await xaContext.decodeAudioData(testData, successCallback);

			expect(successCallback).toHaveBeenCalledWith(mockAudioBuffer);
		});

		it('should handle WASM initialization failure', async () => {
			const testData = createMockXAData();
			const initError = new Error('WASM init failed');

			mockInit.mockRejectedValue(initError);

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow('WASM init failed');
		});

		it('should handle XA decoder creation failure', async () => {
			const testData = createMockXAData();

			mockWasmXADecoder.mockImplementation(() => {
				throw new Error('Decoder creation failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow();
		});

		it('should handle XA decoding failure', async () => {
			const testData = createMockXAData();

			mockDecoder.decode.mockImplementation(() => {
				throw new Error('XA decode failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow('XA decoder failed');
		});

		it('should handle format retrieval failure', async () => {
			const testData = createMockXAData();

			mockDecoder.get_format.mockImplementation(() => {
				throw new Error('Format retrieval failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow('XA decoder failed');
		});

		it('should call error callback on XA decoding failure', async () => {
			const testData = createMockXAData();
			const successCallback = vi.fn();
			const errorCallback = vi.fn();

			mockDecoder.decode.mockImplementation(() => {
				throw new Error('XA decode failed');
			});

			await expect(
				xaContext.decodeAudioData(testData, successCallback, errorCallback)
			).rejects.toThrow();

			expect(errorCallback).toHaveBeenCalled();
			expect(successCallback).not.toHaveBeenCalled();
		});

		it('should free decoder resources after successful decoding', async () => {
			const testData = createMockXAData();

			await xaContext.decodeAudioData(testData);

			expect(mockDecoder.free).toHaveBeenCalled();
		});

		it('should free decoder resources even after failure', async () => {
			const testData = createMockXAData();

			mockDecoder.decode.mockImplementation(() => {
				throw new Error('Decode failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow();

			expect(mockDecoder.free).toHaveBeenCalled();
		});

		it('should handle concurrent initialization properly', async () => {
			const testData = createMockXAData();

			// Start multiple decoding operations simultaneously
			const promises = [
				xaContext.decodeAudioData(testData),
				xaContext.decodeAudioData(testData),
				xaContext.decodeAudioData(testData)
			];

			await Promise.all(promises);

			// Should only initialize once despite concurrent calls
			expect(mockInit).toHaveBeenCalledOnce();
		});

		it('should handle empty audio data', async () => {
			const emptyData = new ArrayBuffer(0);

			// This should either succeed with empty buffer or throw appropriate error
			try {
				await xaContext.decodeAudioData(emptyData);
				// If it succeeds, verify decoder was called with empty data
				expect(mockDecoder.decode).toHaveBeenCalledWith(new Uint8Array(emptyData));
			} catch (error) {
				// If it fails, it should be a proper error
				expect(error).toBeInstanceOf(Error);
			}
		});

		it('should handle mono audio format', async () => {
			const testData = createMockXAData();
			const monoFormat = { channels: 1, samples_rate: 22050 };
			const monoData = new Float32Array([0.1, 0.2, 0.3, 0.4]);

			mockDecoder.get_format.mockReturnValue(monoFormat);
			mockDecoder.decode.mockReturnValue(monoData);

			await xaContext.decodeAudioData(testData);

			expect(mockCreateBuffer).toHaveBeenCalledWith(1, 4, 22050);
		});

		it('should handle high sample rates', async () => {
			const testData = createMockXAData();
			const highSampleRateFormat = { channels: 2, samples_rate: 96000 };

			mockDecoder.get_format.mockReturnValue(highSampleRateFormat);

			await xaContext.decodeAudioData(testData);

			expect(mockCreateBuffer).toHaveBeenCalledWith(2, mockDecodedData.length / 2, 96000);
		});

		it('should create proper DOMException for encoding errors', async () => {
			const testData = createMockXAData();
			const decodeError = new Error('Invalid XA format');

			mockDecoder.decode.mockImplementation(() => {
				throw decodeError;
			});

			try {
				await xaContext.decodeAudioData(testData);
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
				expect((error as DOMException).name).toBe('EncodingError');
				expect((error as DOMException).message).toContain('XA decoder failed');
			}
		});

		it('should handle large audio files', async () => {
			// Create a large buffer (1MB)
			const largeBuffer = new ArrayBuffer(1024 * 1024);
			const view = new Uint8Array(largeBuffer);
			view.fill(0x80); // Fill with some pattern

			const largeDecodedData = new Float32Array(1024 * 512); // 512k samples
			mockDecoder.decode.mockReturnValue(largeDecodedData);

			await xaContext.decodeAudioData(largeBuffer);

			expect(mockDecoder.decode).toHaveBeenCalledWith(view);
			expect(mockCreateBuffer).toHaveBeenCalledWith(
				mockFormat.channels,
				largeDecodedData.length / mockFormat.channels,
				mockFormat.samples_rate
			);
		});
	});

	describe('initialization race conditions', () => {
		it('should handle initialization promise rejection', async () => {
			const testData = new ArrayBuffer(100);
			const initError = new Error('Init failed');

			mockInit.mockRejectedValue(initError);

			// First call should fail
			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow('Init failed');

			// Reset mock to succeed
			mockInit.mockResolvedValue(undefined);

			// Second call should retry initialization
			await xaContext.decodeAudioData(testData);

			// Should have been called twice (failed attempt + retry)
			expect(mockInit).toHaveBeenCalledTimes(2);
		});

		it('should handle concurrent calls during failed initialization', async () => {
			const testData = new ArrayBuffer(100);
			let initCallCount = 0;

			mockInit.mockImplementation(() => {
				initCallCount++;
				if (initCallCount === 1) {
					return Promise.reject(new Error('First init failed'));
				}
				return Promise.resolve();
			});

			// Start multiple concurrent calls during failed init
			const promises = [
				xaContext.decodeAudioData(testData).catch(() => 'error1'),
				xaContext.decodeAudioData(testData).catch(() => 'error2'),
				xaContext.decodeAudioData(testData).catch(() => 'error3')
			];

			const results = await Promise.all(promises);

			// All should fail initially
			expect(results).toEqual(['error1', 'error2', 'error3']);

			// But subsequent call should work after retry
			await xaContext.decodeAudioData(testData);
			expect(mockInit).toHaveBeenCalledTimes(2);
		});
	});

	describe('memory management', () => {
		it('should properly clean up decoder on success', async () => {
			const testData = new ArrayBuffer(100);

			await xaContext.decodeAudioData(testData);

			expect(mockDecoder.free).toHaveBeenCalled();
		});

		it('should properly clean up decoder on decode failure', async () => {
			const testData = new ArrayBuffer(100);

			mockDecoder.decode.mockImplementation(() => {
				throw new Error('Decode failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow();

			expect(mockDecoder.free).toHaveBeenCalled();
		});

		it('should properly clean up decoder on format failure', async () => {
			const testData = new ArrayBuffer(100);

			mockDecoder.get_format.mockImplementation(() => {
				throw new Error('Format failed');
			});

			await expect(xaContext.decodeAudioData(testData)).rejects.toThrow();

			expect(mockDecoder.free).toHaveBeenCalled();
		});
	});

	describe('error message formatting', () => {
		it('should format error messages properly for Error instances', async () => {
			const testData = new ArrayBuffer(100);
			const specificError = new Error('Specific XA decode error');

			mockDecoder.decode.mockImplementation(() => {
				throw specificError;
			});

			try {
				await xaContext.decodeAudioData(testData);
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as DOMException).message).toContain('Specific XA decode error');
			}
		});

		it('should format error messages properly for non-Error instances', async () => {
			const testData = new ArrayBuffer(100);

			mockDecoder.decode.mockImplementation(() => {
				throw 'String error message';
			});

			try {
				await xaContext.decodeAudioData(testData);
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as DOMException).message).toContain('String error message');
			}
		});
	});
});
