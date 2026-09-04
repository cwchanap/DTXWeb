import { describe, expect, it } from 'vitest';
import {
	FULL_TRACK_AUDIO_EXTENSIONS,
	isTopLevelNamedR2Key,
	isTopLevelR2Key,
	r2FileName,
	selectTopLevelFullTrackObject,
	toPublicR2Url
} from './r2Files';

describe('R2 file helpers', () => {
	it('matches a named top-level key case-insensitively', () => {
		expect(isTopLevelNamedR2Key('42/BGM.M4A', '42/', 'bgm.m4a')).toBe(true);
	});

	it('rejects nested keys as top-level keys', () => {
		expect(isTopLevelR2Key('42/assets/bgm.m4a', '42/')).toBe(false);
		expect(isTopLevelNamedR2Key('42/assets/bgm.m4a', '42/', 'bgm.m4a')).toBe(false);
	});

	it('returns the final key segment as the filename', () => {
		expect(r2FileName('42/assets/music.ogg')).toBe('music.ogg');
	});

	it('encodes public URLs per path segment and removes trailing base slashes', () => {
		expect(toPublicR2Url('https://files.example///', '42/my song/音楽#1.ogg')).toBe(
			'https://files.example/42/my%20song/%E9%9F%B3%E6%A5%BD%231.ogg'
		);
	});
});

describe('selectTopLevelFullTrackObject', () => {
	it('excludes preview.mp3 by basename case-insensitively', () => {
		const selected = selectTopLevelFullTrackObject(
			[{ key: '42/PREVIEW.MP3' }, { key: '42/song.mp3' }],
			'42/'
		);

		expect(selected).toEqual({ key: '42/song.mp3' });
	});

	it('selects a top-level full track instead of nested audio', () => {
		const selected = selectTopLevelFullTrackObject(
			[{ key: '42/assets/kick.ogg' }, { key: '42/song.mp3' }],
			'42/'
		);

		expect(selected).toEqual({ key: '42/song.mp3' });
	});

	it('preserves extension priority and adds m4a after ogg', () => {
		expect(FULL_TRACK_AUDIO_EXTENSIONS).toEqual(['.ogg', '.m4a', '.mp3', '.wav', '.flac']);

		const selected = selectTopLevelFullTrackObject(
			[
				{ key: '42/song.flac' },
				{ key: '42/song.mp3' },
				{ key: '42/song.m4a' },
				{ key: '42/song.ogg' }
			],
			'42/'
		);

		expect(selected).toEqual({ key: '42/song.ogg' });
	});

	it('uses key ordering to break ties within an extension', () => {
		const selected = selectTopLevelFullTrackObject(
			[{ key: '42/z-song.ogg' }, { key: '42/a-song.ogg' }],
			'42/'
		);

		expect(selected).toEqual({ key: '42/a-song.ogg' });
	});

	it('accepts an exclusion predicate without excluding historical authored m4a files', () => {
		const selected = selectTopLevelFullTrackObject(
			[{ key: '42/bgm.m4a' }, { key: '42/music.m4a' }],
			'42/',
			(object) => isTopLevelNamedR2Key(object.key, '42/', 'bgm.m4a')
		);

		expect(selected).toEqual({ key: '42/music.m4a' });
	});
});
