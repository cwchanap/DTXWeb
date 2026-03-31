import { describe, it, expect, vi } from 'vitest';
import { isValidDtxFileExtension, isValidDtxFile } from './constants';

// Mock Svelte components so barrel files can be imported without rendering
vi.mock('./components/UploadedAssetFiles.svelte', () => ({ default: {} }));
vi.mock('./components/ChartDetail.svelte', () => ({ default: {} }));
vi.mock('./components/editor/MainTab.svelte', () => ({ default: {} }));
vi.mock('./components/editor/SoundTab.svelte', () => ({ default: {} }));
vi.mock('./components/editor/PreviewTab.svelte', () => ({ default: {} }));
vi.mock('./game/main.svelte', () => ({ default: {} }));

import * as componentsBarrel from './components';
import * as gameBarrel from './game';
import {
	DTXFile,
	SimFile,
	LaneMeasureNote,
	SoundChip,
	normalizePosition,
	VALID_DTX_FILE_EXTENSIONS,
	setFileProvider,
	getFileProvider,
	toSimfileWithDtx
} from './index';
import {
	DTXFile as ServerDTXFile,
	SimFile as ServerSimFile,
	VALID_DTX_FILE_EXTENSIONS as ServerExtensions,
	toSimfileWithDtx as ServerToSimfile
} from './server';

describe('constants', () => {
	describe('isValidDtxFileExtension', () => {
		it('returns true for valid DTX chart extensions', () => {
			expect(isValidDtxFileExtension('.dtx')).toBe(true);
			expect(isValidDtxFileExtension('.def')).toBe(true);
		});

		it('returns true for valid audio extensions', () => {
			expect(isValidDtxFileExtension('.wav')).toBe(true);
			expect(isValidDtxFileExtension('.mp3')).toBe(true);
			expect(isValidDtxFileExtension('.ogg')).toBe(true);
			expect(isValidDtxFileExtension('.flac')).toBe(true);
			expect(isValidDtxFileExtension('.m4a')).toBe(true);
			expect(isValidDtxFileExtension('.aac')).toBe(true);
			expect(isValidDtxFileExtension('.xa')).toBe(true);
		});

		it('returns true for valid image extensions', () => {
			expect(isValidDtxFileExtension('.png')).toBe(true);
			expect(isValidDtxFileExtension('.jpg')).toBe(true);
			expect(isValidDtxFileExtension('.jpeg')).toBe(true);
			expect(isValidDtxFileExtension('.gif')).toBe(true);
			expect(isValidDtxFileExtension('.bmp')).toBe(true);
			expect(isValidDtxFileExtension('.tiff')).toBe(true);
			expect(isValidDtxFileExtension('.tga')).toBe(true);
		});

		it('returns false for invalid extensions', () => {
			expect(isValidDtxFileExtension('.txt')).toBe(false);
			expect(isValidDtxFileExtension('.exe')).toBe(false);
			expect(isValidDtxFileExtension('.pdf')).toBe(false);
			expect(isValidDtxFileExtension('.zip')).toBe(false);
			expect(isValidDtxFileExtension('.doc')).toBe(false);
		});

		it('is case insensitive', () => {
			expect(isValidDtxFileExtension('.DTX')).toBe(true);
			expect(isValidDtxFileExtension('.MP3')).toBe(true);
			expect(isValidDtxFileExtension('.WAV')).toBe(true);
			expect(isValidDtxFileExtension('.PNG')).toBe(true);
			expect(isValidDtxFileExtension('.Ogg')).toBe(true);
		});

		it('returns false for empty string', () => {
			expect(isValidDtxFileExtension('')).toBe(false);
		});

		it('returns false for extension with no dot', () => {
			expect(isValidDtxFileExtension('dtx')).toBe(false);
			expect(isValidDtxFileExtension('mp3')).toBe(false);
		});
	});

	describe('isValidDtxFile', () => {
		it('returns true for valid DTX filenames', () => {
			expect(isValidDtxFile('song.dtx')).toBe(true);
			expect(isValidDtxFile('set.def')).toBe(true);
		});

		it('returns true for valid audio filenames', () => {
			expect(isValidDtxFile('drum.wav')).toBe(true);
			expect(isValidDtxFile('track.mp3')).toBe(true);
			expect(isValidDtxFile('audio.ogg')).toBe(true);
			expect(isValidDtxFile('music.flac')).toBe(true);
		});

		it('returns true for valid image filenames', () => {
			expect(isValidDtxFile('background.jpg')).toBe(true);
			expect(isValidDtxFile('cover.png')).toBe(true);
			expect(isValidDtxFile('preview.jpeg')).toBe(true);
		});

		it('returns false for invalid filenames', () => {
			expect(isValidDtxFile('readme.txt')).toBe(false);
			expect(isValidDtxFile('app.exe')).toBe(false);
			expect(isValidDtxFile('document.pdf')).toBe(false);
			expect(isValidDtxFile('archive.zip')).toBe(false);
		});

		it('is case insensitive for extensions', () => {
			expect(isValidDtxFile('SONG.DTX')).toBe(true);
			expect(isValidDtxFile('track.MP3')).toBe(true);
			expect(isValidDtxFile('background.JPG')).toBe(true);
		});

		it('handles filenames without extensions', () => {
			expect(isValidDtxFile('readme')).toBe(false);
			expect(isValidDtxFile('Makefile')).toBe(false);
		});

		it('handles filenames with multiple dots', () => {
			expect(isValidDtxFile('song.backup.dtx')).toBe(true);
			expect(isValidDtxFile('song.v2.txt')).toBe(false);
		});

		it('uses only the last extension segment', () => {
			expect(isValidDtxFile('archive.tar.gz')).toBe(false);
			expect(isValidDtxFile('file.dtx.bak')).toBe(false);
		});
	});
});

describe('components and game barrel exports', () => {
	it('components.ts exports all Svelte components', () => {
		expect(componentsBarrel.UploadedAssetFiles).toBeDefined();
		expect(componentsBarrel.ChartDetail).toBeDefined();
		expect(componentsBarrel.MainTab).toBeDefined();
		expect(componentsBarrel.SoundTab).toBeDefined();
		expect(componentsBarrel.PreviewTab).toBeDefined();
	});

	it('game.ts exports game modules', () => {
		expect(gameBarrel.EventBus).toBeDefined();
		expect(gameBarrel.EventType).toBeDefined();
		expect(gameBarrel.Editor).toBeDefined();
		expect(gameBarrel.getAssetPath).toBeDefined();
	});
});

describe('package barrel exports', () => {
	it('index.ts exports all expected symbols', () => {
		expect(DTXFile).toBeDefined();
		expect(SimFile).toBeDefined();
		expect(LaneMeasureNote).toBeDefined();
		expect(SoundChip).toBeDefined();
		expect(normalizePosition).toBeDefined();
		expect(VALID_DTX_FILE_EXTENSIONS).toBeDefined();
		expect(setFileProvider).toBeDefined();
		expect(getFileProvider).toBeDefined();
		expect(toSimfileWithDtx).toBeDefined();
	});

	it('server.ts exports all expected symbols', () => {
		expect(ServerDTXFile).toBeDefined();
		expect(ServerSimFile).toBeDefined();
		expect(ServerExtensions).toBeDefined();
		expect(ServerToSimfile).toBeDefined();
	});
});
