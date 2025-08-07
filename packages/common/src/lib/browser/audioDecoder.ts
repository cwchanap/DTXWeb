import init, { WasmXADecoder } from 'xa_decoder';

export class XAAudioContext extends AudioContext {
	private initialized = false;
	private initializationPromise: Promise<void> | null = null;

	constructor() {
		super();
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) {
			return;
		}

		// Prevent race conditions by reusing the same initialization promise
		if (this.initializationPromise) {
			return this.initializationPromise;
		}

		this.initializationPromise = this.performInitialization();
		return this.initializationPromise;
	}

	private async performInitialization(): Promise<void> {
		await init();
		this.initialized = true;
		this.initializationPromise = null; // Clear promise after completion
	}

	async decodeAudioData(
		audioData: ArrayBuffer,
		successCallback?: DecodeSuccessCallback | null,
		errorCallback?: DecodeErrorCallback | null
	): Promise<AudioBuffer> {
		try {
			await this.ensureInitialized();

			const decoder = new WasmXADecoder();
			try {
				const data = decoder.decode(new Uint8Array(audioData));
				const format = decoder.get_format();

				const samplesPerChannel = data.length / format.channels;
				const audioBuffer = this.createBuffer(
					format.channels,
					samplesPerChannel,
					format.samples_rate
				);

				for (let i = 0; i < format.channels; i++) {
					const channelData = audioBuffer.getChannelData(i);
					for (let j = 0; j < samplesPerChannel; j++) {
						// For interleaved audio data, extract samples for each channel
						channelData[j] = data[j * format.channels + i] / 32768;
					}
				}
				successCallback?.(audioBuffer);
				return audioBuffer;
			} finally {
				// Ensure decoder is properly freed if it has a free/destroy method
				if (typeof decoder.free === 'function') {
					decoder.free();
				}
			}
		} catch (e) {
			console.warn(
				`Failed to decode XA audio: ${e instanceof Error ? e.message : String(e)}`
			);

			// Don't fallback to standard decoding for XA files - it won't work
			// Instead, properly reject so Phaser can handle it
			const domError = new DOMException(
				'XA decoder failed: ' + (e instanceof Error ? e.message : String(e)),
				'EncodingError'
			);
			errorCallback?.(domError);
			return Promise.reject(domError);
		}
	}
}

export const XAaudioContext = new XAAudioContext();
