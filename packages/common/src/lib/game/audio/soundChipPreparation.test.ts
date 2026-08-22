import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SoundChip } from '../../chart/dtx';

vi.mock('$lib/browser/audioDecoder', () => ({
	XAaudioContext: { decodeAudioData: vi.fn() }
}));

import { XAaudioContext } from '$lib/browser/audioDecoder';
import {
	getSoundCacheKey,
	audioBufferToWavBlob,
	prepareSoundChipAudioSource
} from './soundChipPreparation';

describe('getSoundCacheKey', () => {
	it('generates a lowercase cache key from soundChip fileName', () => {
		const soundChip = { id: 1, fileName: 'Drum.WAV' } as SoundChip;
		expect(getSoundCacheKey(soundChip)).toBe('soundchip_drum.wav');
	});

	it('handles already lowercase filenames', () => {
		const soundChip = { id: 2, fileName: 'snare.wav' } as SoundChip;
		expect(getSoundCacheKey(soundChip)).toBe('soundchip_snare.wav');
	});

	it('handles mixed-case filenames', () => {
		const soundChip = { id: 3, fileName: 'HiHat.ogg' } as SoundChip;
		expect(getSoundCacheKey(soundChip)).toBe('soundchip_hihat.ogg');
	});
});

describe('audioBufferToWavBlob', () => {
	it('returns a Blob of type audio/wav', () => {
		const mockAudioBuffer = {
			numberOfChannels: 1,
			length: 4,
			sampleRate: 44100,
			getChannelData: vi.fn().mockReturnValue(new Float32Array([0, 0.5, -0.5, 1]))
		} as unknown as AudioBuffer;

		const result = audioBufferToWavBlob(mockAudioBuffer);
		expect(result).toBeInstanceOf(Blob);
		expect(result.type).toBe('audio/wav');
	});

	it('produces correct WAV byte size for stereo audio', () => {
		const frames = 10;
		const channels = 2;
		const mockAudioBuffer = {
			numberOfChannels: channels,
			length: frames,
			sampleRate: 44100,
			getChannelData: vi.fn().mockReturnValue(new Float32Array(frames).fill(0))
		} as unknown as AudioBuffer;

		const result = audioBufferToWavBlob(mockAudioBuffer);
		// Expected size = frames * channels * 2 (bytes per sample) + 44 (header)
		expect(result.size).toBe(frames * channels * 2 + 44);
	});

	it('clamps audio samples to [-1, 1] range without throwing', () => {
		const mockAudioBuffer = {
			numberOfChannels: 1,
			length: 3,
			sampleRate: 44100,
			getChannelData: vi.fn().mockReturnValue(new Float32Array([2.0, -2.0, 0.5]))
		} as unknown as AudioBuffer;

		expect(() => audioBufferToWavBlob(mockAudioBuffer)).not.toThrow();
	});
});

describe('prepareSoundChipAudioSource', () => {
	beforeEach(() => {
		global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it('creates an object URL directly from the file for non-XA formats', async () => {
		const soundChip = { fileName: 'kick.wav' } as SoundChip;
		const file = new File(['audio'], 'kick.wav', { type: 'audio/wav' });

		const result = await prepareSoundChipAudioSource(file, soundChip);

		expect(result.cacheKey).toBe('soundchip_kick.wav');
		expect(URL.createObjectURL).toHaveBeenCalledWith(file);
		expect(result.objectUrl).toBe('blob:mock-url');
		expect(result.wavBlob).toBeUndefined();
	});

	it('decodes via XAaudioContext and returns a fresh wavBlob when no cachedBlob is provided', async () => {
		const soundChip = { fileName: 'drum.xa' } as SoundChip;
		const file = new File([new Uint8Array(4)], 'drum.xa', { type: 'audio/xa' });
		Object.defineProperty(file, 'arrayBuffer', {
			value: vi.fn().mockResolvedValue(new ArrayBuffer(4))
		});
		const mockAudioBuffer = {
			numberOfChannels: 1,
			sampleRate: 44100,
			length: 100,
			getChannelData: vi.fn().mockReturnValue(new Float32Array(100))
		} as unknown as AudioBuffer;

		(XAaudioContext.decodeAudioData as ReturnType<typeof vi.fn>).mockResolvedValue(
			mockAudioBuffer
		);

		const result = await prepareSoundChipAudioSource(file, soundChip);

		expect(result.cacheKey).toBe('soundchip_drum.xa');
		expect(XAaudioContext.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
		expect(result.wavBlob).toBeInstanceOf(Blob);
		expect(URL.createObjectURL).toHaveBeenCalledWith(result.wavBlob);
		expect(result.objectUrl).toBe('blob:mock-url');
	});

	it('reuses a provided cachedBlob for XA files without decoding, and returns no fresh wavBlob', async () => {
		const soundChip = { fileName: 'snare.xa' } as SoundChip;
		const file = new File([new Uint8Array(4)], 'snare.xa');
		const cachedBlob = new Blob(['wav-data'], { type: 'audio/wav' });

		const result = await prepareSoundChipAudioSource(file, soundChip, cachedBlob);

		expect(XAaudioContext.decodeAudioData).not.toHaveBeenCalled();
		expect(URL.createObjectURL).toHaveBeenCalledWith(cachedBlob);
		expect(result.objectUrl).toBe('blob:mock-url');
		expect(result.wavBlob).toBeUndefined();
	});

	it('propagates the error when XA decoding fails, letting the caller handle it', async () => {
		const soundChip = { fileName: 'bad.xa' } as SoundChip;
		const file = new File([new Uint8Array(4)], 'bad.xa');
		Object.defineProperty(file, 'arrayBuffer', {
			value: vi.fn().mockResolvedValue(new ArrayBuffer(4))
		});

		(XAaudioContext.decodeAudioData as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('decode failed')
		);

		await expect(prepareSoundChipAudioSource(file, soundChip)).rejects.toThrow('decode failed');
	});

	it('treats file extension matching case-insensitively for the XA branch', async () => {
		const soundChip = { fileName: 'DRUM.XA' } as SoundChip;
		const file = new File([new Uint8Array(4)], 'DRUM.XA');
		const cachedBlob = new Blob(['wav-data'], { type: 'audio/wav' });

		const result = await prepareSoundChipAudioSource(file, soundChip, cachedBlob);

		expect(result.cacheKey).toBe('soundchip_drum.xa');
		expect(URL.createObjectURL).toHaveBeenCalledWith(cachedBlob);
	});
});
