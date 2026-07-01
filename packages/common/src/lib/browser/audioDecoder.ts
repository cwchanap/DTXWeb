type XaDecoderModule = typeof import('xa_decoder');

let xaDecoderModule: XaDecoderModule | null = null;

// `AudioContext` is a browser-only global. This module is reachable from
// `@dtx/common/audio` (via PreviewAudioEngine) and from direct relative imports
// (SoundTab.svelte, game scenes), so it can be evaluated during SSR (Vite /
// Cloudflare Worker) where `AudioContext` is undefined. Extending `undefined`
// throws at module-evaluation time and 500s the page. Fall back to a no-op base
// on the server; the real audio paths only run in the browser.
const AudioContextBase: typeof AudioContext =
	typeof AudioContext !== 'undefined'
		? AudioContext
		: (class {} as unknown as typeof AudioContext);

export class XAAudioContext extends AudioContextBase {
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
		try {
			const module = await import('xa_decoder');
			xaDecoderModule = module;
			await module.default();
			this.initialized = true;
			this.initializationPromise = null; // Clear promise after completion
		} catch (error) {
			// Clear promise on failure to allow retries
			this.initializationPromise = null;
			throw error;
		}
	}

	async decodeAudioData(
		audioData: ArrayBuffer,
		successCallback?: DecodeSuccessCallback | null,
		errorCallback?: DecodeErrorCallback | null
	): Promise<AudioBuffer> {
		try {
			await this.ensureInitialized();

			const decoderCtor = xaDecoderModule?.WasmXADecoder;
			if (!decoderCtor) {
				throw new Error('XA decoder is not initialized');
			}
			const decoder = new decoderCtor();
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
