import { describe, it, expect } from 'vitest';
import {
	resolveChipPath,
	toWorkspacePath,
	workspacePathKey,
	zipCollisionKey
} from './workspacePaths';

const NFC_CAFE = 'Café';
const NFD_CAFE = 'Café';

describe('toWorkspacePath', () => {
	it.each<[string | undefined, string, string]>([
		['Pack/Song A/mas.dtx', 'mas.dtx', 'Song A/mas.dtx'],
		['Pack/Song A/drums/cymbal.wav', 'cymbal.wav', 'Song A/drums/cymbal.wav'],
		['Pack/mas.dtx', 'mas.dtx', 'mas.dtx'],
		['mas.dtx', 'mas.dtx', 'mas.dtx'],
		[undefined, 'kick.wav', 'kick.wav'],
		['', 'kick.wav', 'kick.wav']
	])('maps webkitRelativePath %s + name %s to %s', (webkitRelativePath, fileName, expected) => {
		expect(toWorkspacePath(webkitRelativePath, fileName)).toBe(expected);
	});

	it('strips the first browser segment rather than a suffixed workspace name', () => {
		expect(toWorkspacePath('Pack/Song B/mas.dtx', 'mas.dtx')).toBe('Song B/mas.dtx');
	});
});

describe('workspacePathKey', () => {
	it.each<[string, string]>([
		['Song A/MAS.DTX', 'song a/mas.dtx'],
		['mas.dtx', 'mas.dtx'],
		[`${NFC_CAFE}/Kick.WAV`, 'café/kick.wav']
	])('normalizes %s to %s', (path, expected) => {
		expect(workspacePathKey(path)).toBe(expected);
	});

	it('equates NFD and NFC spellings of the same path', () => {
		expect(workspacePathKey(`${NFD_CAFE}/mas.dtx`)).toBe(
			workspacePathKey(`${NFC_CAFE}/mas.dtx`)
		);
	});

	it('equates paths that differ only by case', () => {
		expect(workspacePathKey('Song A/mas.dtx')).toBe(workspacePathKey('song a/MAS.DTX'));
	});
});

describe('zipCollisionKey', () => {
	it.each<[string, string]>([
		['Song A/Kick.WAV', 'song a/kick.wav'],
		['kick.wav', 'kick.wav'],
		['a/ b.wav', 'a/b.wav'],
		['a /b.wav', 'a/b.wav'],
		['a./b.wav', 'a/b.wav'],
		['Dir /Sub/KICK.WAV', 'dir/sub/kick.wav']
	])('normalizes %s to %s', (path, expected) => {
		expect(zipCollisionKey(path)).toBe(expected);
	});

	it('collides segments that differ only by Unicode normalization', () => {
		expect(zipCollisionKey(`${NFD_CAFE}/Kick.wav`)).toBe(
			zipCollisionKey(`${NFC_CAFE}/Kick.wav`)
		);
	});

	it('does not collide the same file name in different directories', () => {
		expect(zipCollisionKey('Song A/kick.wav')).not.toBe(zipCollisionKey('Song B/kick.wav'));
	});
});

describe('resolveChipPath', () => {
	const recordsFor = (...paths: string[]) => {
		const map = new Map<string, { path: string }[]>();
		for (const path of paths) {
			const key = workspacePathKey(path);
			const bucket = map.get(key) ?? [];
			bucket.push({ path });
			map.set(key, bucket);
		}
		return map;
	};

	it.each<[string, string, string]>([
		['Song A/mas.dtx', 'kick.wav', 'Song A/kick.wav'],
		['Song A/mas.dtx', 'drums\\cymbal.wav', 'Song A/drums/cymbal.wav'],
		['Song A/mas.dtx', 'drums/cymbal.wav', 'Song A/drums/cymbal.wav'],
		['Song A/mas.dtx', 'a/b/c.wav', 'Song A/a/b/c.wav'],
		['dir/sub/mas.dtx', 'kick.wav', 'dir/sub/kick.wav'],
		['mas.dtx', 'kick.wav', 'kick.wav'],
		['mas.dtx', 'sub/kick.wav', 'sub/kick.wav']
	])('joins %s with %s into %s', (dtxPath, ref, expectedPath) => {
		const audioKeys = recordsFor(expectedPath);
		expect(resolveChipPath(dtxPath, ref, audioKeys)?.path).toBe(expectedPath);
	});

	it.each([
		'',
		'.',
		'..',
		'./kick.wav',
		'../kick.wav',
		'..\\kick.wav',
		'/kick.wav',
		'//share/kick.wav',
		'a//b.wav',
		'a/./b.wav',
		'a/../b.wav'
	])('rejects chip ref %s', (ref) => {
		const audioKeys = recordsFor('Song A/kick.wav', 'kick.wav');
		expect(resolveChipPath('Song A/mas.dtx', ref, audioKeys)).toBeNull();
	});

	it('equates NFD/NFC and case between chart dir and stored path', () => {
		const audioKeys = recordsFor(`${NFC_CAFE}/KICK.WAV`);
		expect(resolveChipPath(`${NFD_CAFE}/mas.dtx`, 'kick.wav', audioKeys)?.path).toBe(
			`${NFC_CAFE}/KICK.WAV`
		);
	});

	it('does not fall back to a same-named file in another folder', () => {
		const audioKeys = recordsFor('Song B/kick.wav', 'Song B/snare.wav');
		expect(resolveChipPath('Song A/mas.dtx', 'kick.wav', audioKeys)).toBeNull();
		expect(resolveChipPath('Song A/mas.dtx', 'snare.wav', audioKeys)).toBeNull();
	});

	it('does not fall back to the workspace root for nested charts', () => {
		const audioKeys = recordsFor('kick.wav');
		expect(resolveChipPath('Song A/mas.dtx', 'kick.wav', audioKeys)).toBeNull();
	});

	it('returns null when several files collapse to the resolved key', () => {
		const audioKeys = recordsFor('Song A/kick.wav', 'song a/KICK.WAV');
		expect(resolveChipPath('Song A/mas.dtx', 'kick.wav', audioKeys)).toBeNull();
	});

	it.each<[string, string, string, string]>([
		['Song A/mas.dtx', 'kick.wav', 'wav', 'Song A/wav/kick.wav'],
		['Song A/mas.dtx', 'kick.wav', '.\\wav\\', 'Song A/wav/kick.wav'],
		['Song A/mas.dtx', 'sub/kick.wav', 'wav', 'Song A/wav/sub/kick.wav'],
		['Song A/mas.dtx', 'kick.wav', '..\\wav\\', 'wav/kick.wav'],
		['mas.dtx', 'kick.wav', 'wav', 'wav/kick.wav']
	])('resolves %s + %s under #PATH_WAV %s', (dtxPath, ref, wavPath, expectedPath) => {
		const audioKeys = recordsFor(expectedPath);
		expect(resolveChipPath(dtxPath, ref, audioKeys, wavPath)?.path).toBe(expectedPath);
	});

	it('rejects a #PATH_WAV that escapes the workspace root', () => {
		const audioKeys = recordsFor('wav/kick.wav');
		expect(resolveChipPath('mas.dtx', 'kick.wav', audioKeys, '..\\wav')).toBeNull();
	});
});
