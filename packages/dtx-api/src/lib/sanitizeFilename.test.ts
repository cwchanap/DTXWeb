import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './sanitizeFilename';

describe('sanitizeFilename', () => {
	it('preserves simple filenames', () => {
		expect(sanitizeFilename('song.wav')).toBe('song.wav');
		expect(sanitizeFilename('audio.mp3')).toBe('audio.mp3');
	});

	it('preserves directory structure with forward slashes', () => {
		expect(sanitizeFilename('drums/kick.wav')).toBe('drums/kick.wav');
		expect(sanitizeFilename('audio/bgm/loop.mp3')).toBe('audio/bgm/loop.mp3');
	});

	it('normalizes backslashes to forward slashes', () => {
		expect(sanitizeFilename('drums\\kick.wav')).toBe('drums/kick.wav');
		expect(sanitizeFilename('audio\\bgm\\loop.mp3')).toBe('audio/bgm/loop.mp3');
	});

	it('removes path traversal sequences (../)', () => {
		expect(sanitizeFilename('../secret.txt')).toBe('secret.txt');
		expect(sanitizeFilename('audio/../song.wav')).toBe('audio/song.wav');
		expect(sanitizeFilename('../audio/song.wav')).toBe('audio/song.wav');
	});

	it('removes path traversal sequences (..\\)', () => {
		expect(sanitizeFilename('..\\secret.txt')).toBe('secret.txt');
		expect(sanitizeFilename('audio\\..\\song.wav')).toBe('audio/song.wav');
		expect(sanitizeFilename('..\\audio\\song.wav')).toBe('audio/song.wav');
	});

	it('handles multi-dot bypass sequences that collapse to path traversal', () => {
		// "....//path" collapses to "../path" in a single-pass replacement; iterative loop prevents it
		expect(sanitizeFilename('....//secret.txt')).toBe('secret.txt');
		// "..../path" (4 dots + 1 slash) removes the inner "../" leaving "..secret.txt" — safe, no slash after dots
		expect(sanitizeFilename('..../secret.txt')).toBe('..secret.txt');
		// ".....\\path" (4 dots + 2 backslashes) iteratively collapses to "secret.txt"
		expect(sanitizeFilename('....\\\\secret.txt')).toBe('secret.txt');
	});

	it('preserves non-ASCII characters', () => {
		expect(sanitizeFilename('歌曲.wav')).toBe('歌曲.wav');
		expect(sanitizeFilename('ミュージック.mp3')).toBe('ミュージック.mp3');
		expect(sanitizeFilename('audio/歌曲文件.wav')).toBe('audio/歌曲文件.wav');
	});

	it('removes leading slashes', () => {
		expect(sanitizeFilename('/absolute/path.wav')).toBe('absolute/path.wav');
		expect(sanitizeFilename('\\windows\\path.wav')).toBe('windows/path.wav');
	});

	it('removes trailing slashes', () => {
		expect(sanitizeFilename('folder/')).toBe('folder');
		expect(sanitizeFilename('folder\\')).toBe('folder');
	});

	it('removes null bytes and control characters', () => {
		expect(sanitizeFilename('file\x00name.wav')).toBe('filename.wav');
		expect(sanitizeFilename('file\x01\x02name.wav')).toBe('filename.wav');
	});

	it('handles empty and invalid filenames', () => {
		expect(sanitizeFilename('')).toMatch(/^file_\d+$/);
		expect(sanitizeFilename('...')).toMatch(/^file_\d+$/);
		expect(sanitizeFilename('/')).toMatch(/^file_\d+$/);
		expect(sanitizeFilename('\\')).toMatch(/^file_\d+$/);
	});

	it('preserves file extensions during truncation', () => {
		const longName = 'a'.repeat(1100) + '.wav';
		const result = sanitizeFilename(longName);
		expect(result.length).toBeLessThanOrEqual(1024);
		expect(result.endsWith('.wav')).toBe(true);
	});

	it('preserves complex directory structures with DTX-style paths', () => {
		expect(sanitizeFilename('graphics/jacket.png')).toBe('graphics/jacket.png');
		expect(sanitizeFilename('sound/snare.wav')).toBe('sound/snare.wav');
		expect(sanitizeFilename('BGM/song_preview.mp3')).toBe('BGM/song_preview.mp3');
	});

	it('handles filenames with spaces and special characters', () => {
		expect(sanitizeFilename('my song file.wav')).toBe('my song file.wav');
		expect(sanitizeFilename('audio - drums (kick).wav')).toBe('audio - drums (kick).wav');
		expect(sanitizeFilename('song@2x.png')).toBe('song@2x.png');
	});
});
