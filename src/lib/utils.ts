import type { Tables } from '@/types/supabase.types';
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
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                channelData[i] = data[i] / 32768;
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

export function formatLevelDisplay(dtx_files: Tables<'dtx_files'>[]) {
    return dtx_files?.map((file) => (
        file.level > 100 ? file.level / 100 : file.level / 10).toFixed(2)
    ).join(' / ') || 'N/A'
}

export const XAaudioContext = new XAAudioContext();
