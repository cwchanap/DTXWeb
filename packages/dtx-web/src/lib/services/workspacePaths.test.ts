import { describe, it, expect } from 'vitest';
import { toWorkspacePath, workspacePathKey, zipCollisionKey } from './workspacePaths';

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
