import { XAaudioContext } from '../../browser/audioDecoder';
import type { SoundChip } from '../../chart/dtx';

export const getSoundCacheKey = (soundChip: SoundChip): string => {
	return `soundchip_${soundChip.fileName.toLowerCase()}`;
};

export const audioBufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
	const numberOfChannels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length * numberOfChannels * 2 + 44;
	const arrayBuffer = new ArrayBuffer(length);
	const view = new DataView(arrayBuffer);
	const channels = [];
	let pos = 0;

	// Collect audio data from all channels
	for (let i = 0; i < numberOfChannels; i++) {
		channels.push(audioBuffer.getChannelData(i));
	}

	// Write WAV header
	const writeString = (str: string) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(pos + i, str.charCodeAt(i));
		}
		pos += str.length;
	};

	const writeUint32 = (data: number) => {
		view.setUint32(pos, data, true);
		pos += 4;
	};

	const writeUint16 = (data: number) => {
		view.setUint16(pos, data, true);
		pos += 2;
	};

	writeString('RIFF');
	writeUint32(length - 8);
	writeString('WAVE');
	writeString('fmt ');
	writeUint32(16);
	writeUint16(1);
	writeUint16(numberOfChannels);
	writeUint32(audioBuffer.sampleRate);
	writeUint32(audioBuffer.sampleRate * 2 * numberOfChannels);
	writeUint16(numberOfChannels * 2);
	writeUint16(16);
	writeString('data');
	writeUint32(length - pos - 4);

	// Write interleaved audio data
	for (let i = 0; i < audioBuffer.length; i++) {
		for (let channel = 0; channel < numberOfChannels; channel++) {
			const sample = Math.max(-1, Math.min(1, channels[channel][i]));
			view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			pos += 2;
		}
	}

	return new Blob([arrayBuffer], { type: 'audio/wav' });
};

export interface PreparedSoundChipAudioSource {
	cacheKey: string;
	objectUrl: string;
	// Only set when a new XA decode happened; callers use this to update
	// their own processed-blob cache (e.g. Preview.soundCacheMap).
	wavBlob?: Blob;
}

/**
 * Prepares the audio source for a sound chip: computes its cache key and
 * produces an object URL for loading, decoding XA files (or reusing an
 * already-decoded cachedBlob) as needed. Pure aside from the DOM
 * URL.createObjectURL/XAaudioContext.decodeAudioData calls — no Phaser
 * dependency. Errors are not caught here; callers decide how to handle them.
 */
export const prepareSoundChipAudioSource = async (
	file: File,
	soundChip: SoundChip,
	cachedBlob?: Blob
): Promise<PreparedSoundChipAudioSource> => {
	const cacheKey = getSoundCacheKey(soundChip);

	if (soundChip.fileName.toLowerCase().endsWith('.xa')) {
		let wavBlob: Blob | undefined;
		let blobToLoad: Blob;

		if (cachedBlob) {
			blobToLoad = cachedBlob;
		} else {
			const arrayBuffer = await file.arrayBuffer();
			const audioBuffer = await XAaudioContext.decodeAudioData(arrayBuffer);
			wavBlob = audioBufferToWavBlob(audioBuffer);
			blobToLoad = wavBlob;
		}

		const objectUrl = URL.createObjectURL(blobToLoad);
		return { cacheKey, objectUrl, wavBlob };
	}

	const objectUrl = URL.createObjectURL(file);
	return { cacheKey, objectUrl };
};
