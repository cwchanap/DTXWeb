import init, { WasmXADecoder } from 'xa_decoder';

export class XAAudioContext extends AudioContext {
	private initialized = false;

	constructor() {
		super();
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) {
			return;
		}
		await init();
		this.initialized = true;
	}

	async decodeAudioData(
		audioData: ArrayBuffer,
		successCallback?: DecodeSuccessCallback | null,
		errorCallback?: DecodeErrorCallback | null
	): Promise<AudioBuffer> {
		try {
			await this.ensureInitialized();

			const decoder = new WasmXADecoder();
			const data = decoder.decode(new Uint8Array(audioData));
			const format = decoder.get_format();

			const audioBuffer = this.createBuffer(
				format.channels,
				data.length,
				format.samples_rate
			);
			for (let i = 0; i < format.channels; i++) {
				const channelData = audioBuffer.getChannelData(i);
				for (let j = 0; j < data.length; j++) {
					channelData[j] = data[j] / 32768;
				}
			}
			successCallback?.(audioBuffer);
			return Promise.resolve(audioBuffer);
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
