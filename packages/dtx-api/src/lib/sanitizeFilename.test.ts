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

	it('removes trailing parent-directory segments (foo/..)', () => {
		expect(sanitizeFilename('foo/..')).toBe('foo');
		expect(sanitizeFilename('audio/bar/..')).toBe('audio/bar');
		expect(sanitizeFilename('foo\\..')).toBe('foo');
		expect(sanitizeFilename('foo/bar/../..')).toBe('foo/bar');
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

	it('removes traversal sequences exposed by control-character removal', () => {
		expect(sanitizeFilename('.\x00./secret.txt')).toBe('secret.txt');
		expect(sanitizeFilename('audio/.\x01./song.wav')).toBe('audio/song.wav');
	});

	it('removes Windows-style backslash traversal sequences exposed by control-character removal', () => {
		// ".\x00.\" collapses to "..\" after control-char stripping, which the iterative loop removes.
		expect(sanitizeFilename('.\x00.\\secret.txt')).toBe('secret.txt');
		expect(sanitizeFilename('audio\\.\x01.\\song.wav')).toBe('audio/song.wav');
		expect(sanitizeFilename('..\\.\x00.\\secret.txt')).toBe('secret.txt');
	});

	it('removes DEL character (0x7f)', () => {
		expect(sanitizeFilename('file\x7fname.wav')).toBe('filename.wav');
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

	it('re-normalizes traversal after truncation exposes a trailing ".." segment', () => {
		// Length 1045 > 1024. "..x/" is not a traversal segment before truncation
		// (the dots are followed by "x", not a slash), so the pre-truncation loop
		// leaves it intact. Slicing to 1024 cuts at "aaa/.." and would return a
		// trailing "/.." segment without a final normalization pass.
		const input = 'a'.repeat(1021) + '/..x/' + 'b'.repeat(20);
		const result = sanitizeFilename(input);
		expect(result.length).toBeLessThanOrEqual(1024);
		// No path segment may resolve to parent-directory traversal.
		const segments = result.split('/');
		expect(segments).not.toContain('..');
		expect(segments).not.toContain('.');
		// The trailing "/.." must have been stripped, leaving the leading dir.
		expect(result).toBe('a'.repeat(1021));
	});

	it('drops a trailing "." segment exposed by truncation', () => {
		// Slicing to 1024 cuts at "aaa/." producing a trailing "/." segment.
		const input = 'a'.repeat(1023) + '/.x' + 'b'.repeat(20);
		const result = sanitizeFilename(input);
		expect(result.length).toBeLessThanOrEqual(1024);
		const segments = result.split('/');
		expect(segments).not.toContain('.');
		expect(segments).not.toContain('..');
		expect(result).toBe('a'.repeat(1023));
	});

	it('drops single-dot segments the traversal regex loop does not match', () => {
		// The regex loop only matches ".." (two dots). A single "." segment such as
		// "foo/./bar" passes through it unchanged; the final segment guard must drop it
		// so URL canonicalization does not collapse "/./" against the public bucket.
		expect(sanitizeFilename('foo/./bar')).toBe('foo/bar');
		expect(sanitizeFilename('./foo')).toBe('foo');
		expect(sanitizeFilename('foo/.')).toBe('foo');
	});

	it('re-trims separators after dropping dot segments adjacent to repeated slashes', () => {
		// The final segment filter removes "." / ".." segments but preserves the
		// empty segments next to them, so join('/') reintroduces a leading or
		// trailing slash. A trailing normalizeTraversal pass must strip them.
		expect(sanitizeFilename('.//song.dtx')).toBe('song.dtx');
		expect(sanitizeFilename('...///song.dtx')).toBe('song.dtx');
		expect(sanitizeFilename('folder//.')).toBe('folder');
		expect(sanitizeFilename('./folder/.')).toBe('folder');
		expect(sanitizeFilename('folder/./sub/.')).toBe('folder/sub');
		// Leading/trailing separators must never survive sanitization, otherwise
		// the upload caller builds keys like `42//song.dtx` and catalog discovery
		// (r2Enrichment.isTopLevelKey) misclassifies a top-level file as nested.
		const result = sanitizeFilename('.//song.dtx');
		expect(result.startsWith('/')).toBe(false);
		expect(result.endsWith('/')).toBe(false);
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
