import { WasmXADecoder } from 'xa_decoder';

export class XAAudioContext extends AudioContext {
    constructor() {
        super();
    }

    decodeAudioData(audioData: ArrayBuffer, successCallback?: DecodeSuccessCallback | null, errorCallback?: DecodeErrorCallback | null): Promise<AudioBuffer> {
        try {
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
            console.error(e);
            errorCallback?.(e as DOMException);
            return Promise.reject(e);
        }
    }
}

export const XAaudioContext = new XAAudioContext();