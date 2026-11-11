import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceService, type Workspace } from './workspaceService';
import { WebFileProvider } from './webFileProvider';
import * as FileManager from '@dtx/common/services/fileManager';

vi.mock('@dtx/common', async () => await vi.importActual('@dtx/common'));
vi.mock(
	'@dtx/common/services/fileManager',
	async () => await vi.importActual('@dtx/common/services/fileManager')
);

const libraryRecord = (hash: string, fileName: string, bytes: string) => ({
	hash,
	fileName,
	fileType: 'audio/wav',
	fileData: btoa(bytes),
	size: bytes.length,
	dateAdded: 0
});

describe('WorkspaceService.parseDTXFile song-pack integration', () => {
	const service = new WorkspaceService();
	const provider = new WebFileProvider();

	const buildWorkspace = (): Workspace => ({
		name: 'Pack',
		path: 'Pack',
		dtxFiles: [
			{
				name: 'mas.dtx',
				content: [
					'#TITLE: A',
					'#WAV01: kick.wav',
					'#WAV02: drums\\cymbal.wav',
					'#WAV03: snare.wav',
					'#WAV04: bgm.wav'
				].join('\r\n'),
				path: 'Song A/mas.dtx'
			},
			{
				name: 'mas.dtx',
				content: [
					'#TITLE: B',
					'#WAV01: kick.wav',
					'#WAV02: bgm.wav',
					'#WAV03: missing.wav'
				].join('\r\n'),
				path: 'Song B/mas.dtx'
			}
		],
		audioFiles: [
			{ name: 'kick.wav', path: 'Song A/kick.wav', isLarge: false, hash: 'hash-a-kick' },
			{
				name: 'cymbal.wav',
				path: 'Song A/drums/cymbal.wav',
				isLarge: false,
				hash: 'hash-a-cymbal'
			},
			{ name: 'bgm.wav', path: 'Song A/bgm.wav', isLarge: true },
			{ name: 'kick.wav', path: 'Song B/kick.wav', isLarge: false, hash: 'hash-b-kick' },
			{ name: 'bgm.wav', path: 'Song B/bgm.wav', isLarge: true }
		],
		currentDTX: 'Song A/mas.dtx',
		lastModified: Date.now()
	});

	beforeEach(() => {
		localStorage.clear();
		FileManager.clear();
		WorkspaceService.clearSessionFiles();
		localStorage.setItem(
			'dtx_sound_library',
			JSON.stringify([
				libraryRecord('hash-a-kick', 'Kick.WAV', 'A-audio-bytes'),
				libraryRecord('hash-a-cymbal', 'dedup-cymbal.wav', 'cymbal-bytes'),
				libraryRecord('hash-b-kick', 'KICK.WAV', 'B-audio-bytes')
			])
		);
		(WorkspaceService as any).sessionLargeFiles.set(
			'Pack/Song A/bgm.wav',
			new File(['A-bgm-bytes'], 'bgm.wav')
		);
		(WorkspaceService as any).sessionLargeFiles.set(
			'Pack/Song B/bgm.wav',
			new File(['B-bgm-bytes'], 'bgm.wav')
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('resolves each chart to only its own audio across A-B-A switches', async () => {
		const remoteFile = new File(['remote-bytes'], 'remote.wav');
		FileManager.setFile('simfile-42:remote.wav', remoteFile);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const workspace = buildWorkspace();

		const resultA = await service.parseDTXFile(workspace, 'Song A/mas.dtx');
		expect(resultA).not.toBeNull();
		expect(resultA!.simFile.files).toEqual([]);
		const kickA = await provider.getFile(null, 'kick.wav');
		expect(await kickA!.text()).toBe('A-audio-bytes');
		expect(kickA!.name).toBe('kick.wav');
		const cymbal = await provider.getFile(null, 'drums\\cymbal.wav');
		expect(await cymbal!.text()).toBe('cymbal-bytes');
		expect(cymbal!.name).toBe('cymbal.wav');
		expect(await (await provider.getFile(null, 'bgm.wav'))!.text()).toBe('A-bgm-bytes');
		expect(await provider.getFile(null, 'snare.wav')).toBeUndefined();
		expect(FileManager.getFile('simfile-42:remote.wav')).toBe(remoteFile);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('snare.wav'));
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Song A/mas.dtx'));

		warnSpy.mockClear();
		const resultB = await service.parseDTXFile(workspace, 'Song B/mas.dtx');
		expect(resultB).not.toBeNull();
		expect(resultB!.simFile.files).toEqual([]);
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('B-audio-bytes');
		expect(await provider.getFile(null, 'drums\\cymbal.wav')).toBeUndefined();
		expect(await provider.getFile(null, 'snare.wav')).toBeUndefined();
		expect(await (await provider.getFile(null, 'bgm.wav'))!.text()).toBe('B-bgm-bytes');
		expect(await provider.getFile(null, 'missing.wav')).toBeUndefined();
		expect(FileManager.getFile('simfile-42:remote.wav')).toBe(remoteFile);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing.wav'));
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Song B/mas.dtx'));

		const resultA2 = await service.parseDTXFile(workspace, 'Song A/mas.dtx');
		expect(resultA2).not.toBeNull();
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('A-audio-bytes');
		expect(await (await provider.getFile(null, 'drums\\cymbal.wav'))!.text()).toBe(
			'cymbal-bytes'
		);
		expect(await (await provider.getFile(null, 'bgm.wav'))!.text()).toBe('A-bgm-bytes');
		expect(await provider.getFile(null, 'missing.wav')).toBeUndefined();
		expect(FileManager.getFile('simfile-42:remote.wav')).toBe(remoteFile);
	});
});
