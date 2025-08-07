import { describe, it, expect } from 'vitest';
import { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

describe('constants', () => {
	describe('VALID_DTX_FILE_EXTENSIONS', () => {
		it('should contain only lowercase extensions', () => {
			VALID_DTX_FILE_EXTENSIONS.forEach((extension) => {
				expect(extension).toBe(extension.toLowerCase());
			});
		});

		it('should contain all extensions starting with dot', () => {
			VALID_DTX_FILE_EXTENSIONS.forEach((extension) => {
				expect(extension.startsWith('.')).toBe(true);
			});
		});
	});

	describe('isValidDtxFileExtension', () => {
		it('should return true for valid extensions', () => {
			const validExtensions = ['.dtx', '.def', '.wav', '.mp3', '.ogg', '.png', '.jpg'];

			validExtensions.forEach((extension) => {
				expect(isValidDtxFileExtension(extension)).toBe(true);
			});
		});

		it('should return true for valid extensions in uppercase', () => {
			const uppercaseExtensions = ['.DTX', '.DEF', '.WAV', '.MP3', '.PNG'];

			uppercaseExtensions.forEach((extension) => {
				expect(isValidDtxFileExtension(extension)).toBe(true);
			});
		});

		it('should return true for valid extensions in mixed case', () => {
			const mixedCaseExtensions = ['.Dtx', '.DeF', '.WaV', '.Mp3', '.PnG'];

			mixedCaseExtensions.forEach((extension) => {
				expect(isValidDtxFileExtension(extension)).toBe(true);
			});
		});

		it('should return false for invalid extensions', () => {
			const invalidExtensions = ['.txt', '.doc', '.pdf', '.exe', '.bat'];

			invalidExtensions.forEach((extension) => {
				expect(isValidDtxFileExtension(extension)).toBe(false);
			});
		});

		it('should handle empty string', () => {
			expect(isValidDtxFileExtension('')).toBe(false);
		});

		it('should handle extension without dot', () => {
			expect(isValidDtxFileExtension('dtx')).toBe(false);
			expect(isValidDtxFileExtension('mp3')).toBe(false);
		});

		it('should handle multiple dots', () => {
			expect(isValidDtxFileExtension('..dtx')).toBe(false);
			expect(isValidDtxFileExtension('.test.dtx')).toBe(false);
		});
	});

	describe('isValidDtxFile', () => {
		it('should return true for valid filenames', () => {
			const validFilenames = [
				'song.dtx',
				'basic.def',
				'preview.wav',
				'audio.mp3',
				'background.png',
				'cover.jpg'
			];

			validFilenames.forEach((filename) => {
				expect(isValidDtxFile(filename)).toBe(true);
			});
		});

		it('should return true for filenames with uppercase extensions', () => {
			const validFilenames = ['song.DTX', 'basic.DEF', 'preview.WAV', 'audio.MP3'];

			validFilenames.forEach((filename) => {
				expect(isValidDtxFile(filename)).toBe(true);
			});
		});

		it('should return true for filenames with mixed case extensions', () => {
			const validFilenames = ['song.Dtx', 'basic.DeF', 'preview.WaV', 'audio.Mp3'];

			validFilenames.forEach((filename) => {
				expect(isValidDtxFile(filename)).toBe(true);
			});
		});

		it('should return false for invalid filenames', () => {
			const invalidFilenames = [
				'document.txt',
				'readme.md',
				'script.js',
				'style.css',
				'archive.zip'
			];

			invalidFilenames.forEach((filename) => {
				expect(isValidDtxFile(filename)).toBe(false);
			});
		});

		it('should handle filename without extension', () => {
			expect(isValidDtxFile('filename')).toBe(false);
		});

		it('should handle empty filename', () => {
			expect(isValidDtxFile('')).toBe(false);
		});

		it('should handle filename with only dot', () => {
			expect(isValidDtxFile('.')).toBe(false);
			expect(isValidDtxFile('.hidden')).toBe(false);
		});

		it('should handle filename with multiple dots', () => {
			expect(isValidDtxFile('song.backup.dtx')).toBe(true);
			expect(isValidDtxFile('file.old.txt')).toBe(false);
		});

		it('should handle filename starting with dot', () => {
			expect(isValidDtxFile('.dtx')).toBe(true);
			expect(isValidDtxFile('.hidden.mp3')).toBe(true);
		});

		it('should use case-insensitive matching', () => {
			expect(isValidDtxFile('SONG.DTX')).toBe(true);
			expect(isValidDtxFile('Song.Dtx')).toBe(true);
			expect(isValidDtxFile('song.dtx')).toBe(true);
		});

		it('should handle long filenames', () => {
			const longValidFilename =
				'this-is-a-very-long-filename-with-many-characters-and-numbers-123456789.dtx';
			const longInvalidFilename =
				'this-is-a-very-long-filename-with-many-characters-and-numbers-123456789.txt';

			expect(isValidDtxFile(longValidFilename)).toBe(true);
			expect(isValidDtxFile(longInvalidFilename)).toBe(false);
		});

		it('should handle special characters in filename', () => {
			expect(isValidDtxFile('song-name_v2.dtx')).toBe(true);
			expect(isValidDtxFile('song name with spaces.mp3')).toBe(true);
			expect(isValidDtxFile('song@home.wav')).toBe(true);
		});
	});
});
