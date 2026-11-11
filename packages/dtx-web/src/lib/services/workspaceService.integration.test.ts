import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceService, type Workspace } from './workspaceService';
import { WebFileProvider } from './webFileProvider';
import { SoundLibrary } from './soundLibrary';
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

	it('decodes a shared sample once per parse', async () => {
		const workspace = buildWorkspace();
		workspace.dtxFiles[0].content = ['#TITLE: A', '#WAV01: kick.wav', '#WAV02: kick.wav'].join(
			'\r\n'
		);
		const toFile = vi.spyOn(SoundLibrary, 'toFile');

		await service.parseDTXFile(workspace, 'Song A/mas.dtx');

		const kickDecodes = toFile.mock.calls.filter(([record]) => record.hash === 'hash-a-kick');
		expect(kickDecodes).toHaveLength(1);
	});

	it('leaves same-named hashless records unresolved instead of borrowing global library audio', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const findByFileName = vi.spyOn(SoundLibrary, 'findByFileName');
		const workspace = buildWorkspace();
		// Persisted pre-hash records: path-identified but carrying no pinned bytes.
		for (const af of workspace.audioFiles) {
			if (af.path === 'Song A/kick.wav' || af.path === 'Song B/kick.wav') {
				delete af.hash;
			}
		}

		await service.parseDTXFile(workspace, 'Song A/mas.dtx');
		expect(await provider.getFile(null, 'kick.wav')).toBeUndefined();
		expect(await (await provider.getFile(null, 'drums\\cymbal.wav'))!.text()).toBe(
			'cymbal-bytes'
		);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('kick.wav'));

		await service.parseDTXFile(workspace, 'Song B/mas.dtx');
		expect(await provider.getFile(null, 'kick.wav')).toBeUndefined();
		expect(findByFileName).not.toHaveBeenCalled();
	});

	it('resolves chip references through #PATH_WAV', async () => {
		const workspace = buildWorkspace();
		workspace.dtxFiles[0].content = [
			'#TITLE: A',
			'#PATH_WAV: drums',
			'#WAV01: cymbal.wav'
		].join('\r\n');

		await service.parseDTXFile(workspace, 'Song A/mas.dtx');

		expect(await (await provider.getFile(null, 'cymbal.wav'))!.text()).toBe('cymbal-bytes');
	});
});

describe('WorkspaceService.importFolder song-pack integration', () => {
	const service = new WorkspaceService();
	const provider = new WebFileProvider();

	const browserFile = (relativePath: string, bytes: string, size?: number): File => {
		const name = relativePath.split('/').pop()!;
		const file = new File([bytes], name, {
			type: name.endsWith('.dtx') ? 'text/plain' : 'audio/wav'
		});
		Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
		if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
		return file;
	};

	const packFileList = (): FileList =>
		[
			browserFile(
				'Pack/Song A/mas.dtx',
				'#TITLE: A\r\n#WAV01: kick.wav\r\n#WAV02: drums\\cymbal.wav\r\n#WAV03: bgm.wav'
			),
			browserFile('Pack/Song A/kick.wav', 'A-audio-bytes'),
			browserFile('Pack/Song A/drums/cymbal.wav', 'cymbal-bytes'),
			browserFile('Pack/Song A/bgm.wav', 'A-bgm-bytes', 2 * 1024 * 1024 + 1),
			browserFile(
				'Pack/Song B/mas.dtx',
				'#TITLE: B\r\n#WAV01: kick.wav\r\n#WAV02: bgm.wav\r\n#WAV03: missing.wav'
			),
			browserFile('Pack/Song B/kick.wav', 'B-audio-bytes'),
			browserFile('Pack/Song B/bgm.wav', 'B-bgm-bytes', 2 * 1024 * 1024 + 1)
		] as unknown as FileList;

	beforeEach(() => {
		localStorage.clear();
		FileManager.clear();
		WorkspaceService.clearSessionFiles();
		SoundLibrary.clearMemoryFiles();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('imports a browser FileList, strips the selected root, and pins audio by content hash', async () => {
		const workspace = await service.importFolder(packFileList());

		expect(workspace.name).toBe('Pack');
		expect(workspace.dtxFiles.map((f) => f.path)).toEqual(['Song A/mas.dtx', 'Song B/mas.dtx']);
		expect(workspace.audioFiles.map((f) => f.path)).toEqual([
			'Song A/kick.wav',
			'Song A/drums/cymbal.wav',
			'Song A/bgm.wav',
			'Song B/kick.wav',
			'Song B/bgm.wav'
		]);
		expect(workspace.currentDTX).toBe('Song A/mas.dtx');

		const kickA = workspace.audioFiles.find((f) => f.path === 'Song A/kick.wav')!;
		const cymbal = workspace.audioFiles.find((f) => f.path === 'Song A/drums/cymbal.wav')!;
		const kickB = workspace.audioFiles.find((f) => f.path === 'Song B/kick.wav')!;
		expect([kickA, cymbal, kickB].map((f) => f.isLarge)).toEqual([false, false, false]);
		expect(kickA.hash).toBeTruthy();
		expect(kickB.hash).toBeTruthy();
		expect(kickA.hash).not.toBe(kickB.hash);

		const byHash = (record: { hash?: string }) => SoundLibrary.getByHash(record.hash!);
		expect(await SoundLibrary.toFile(byHash(kickA)!)!.text()).toBe('A-audio-bytes');
		expect(await SoundLibrary.toFile(byHash(cymbal)!)!.text()).toBe('cymbal-bytes');
		expect(await SoundLibrary.toFile(byHash(kickB)!)!.text()).toBe('B-audio-bytes');

		const bgmA = workspace.audioFiles.find((f) => f.path === 'Song A/bgm.wav')!;
		const bgmB = workspace.audioFiles.find((f) => f.path === 'Song B/bgm.wav')!;
		expect([bgmA.isLarge, bgmA.hash, bgmB.isLarge, bgmB.hash]).toEqual([
			true,
			undefined,
			true,
			undefined
		]);
		expect(await WorkspaceService.getLargeFile('Pack', 'Song A/bgm.wav')!.text()).toBe(
			'A-bgm-bytes'
		);
		expect(await WorkspaceService.getLargeFile('Pack', 'Song B/bgm.wav')!.text()).toBe(
			'B-bgm-bytes'
		);
		expect(WorkspaceService.getLargeFile('Pack', 'bgm.wav')).toBeUndefined();

		const stored = JSON.parse(localStorage.getItem('dtx_workspaces')!) as Workspace[];
		expect(stored[0].audioFiles.map((f) => f.path)).toEqual(
			workspace.audioFiles.map((f) => f.path)
		);
		expect(stored[0].audioFiles.find((f) => f.path === 'Song A/kick.wav')!.hash).toBe(
			kickA.hash
		);
	});

	it('serves each chart its own imported audio bytes across A-B-A switches', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const workspace = await service.importFolder(packFileList());

		const resultA = await service.parseDTXFile(workspace, 'Song A/mas.dtx');
		expect(resultA).not.toBeNull();
		expect(resultA!.simFile.title).toBe('A');
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('A-audio-bytes');
		expect(await (await provider.getFile(null, 'drums\\cymbal.wav'))!.text()).toBe(
			'cymbal-bytes'
		);
		expect(await (await provider.getFile(null, 'bgm.wav'))!.text()).toBe('A-bgm-bytes');
		expect(await provider.getFile(null, 'missing.wav')).toBeUndefined();

		warnSpy.mockClear();
		const resultB = await service.parseDTXFile(workspace, 'Song B/mas.dtx');
		expect(resultB).not.toBeNull();
		expect(resultB!.simFile.title).toBe('B');
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('B-audio-bytes');
		expect(await (await provider.getFile(null, 'bgm.wav'))!.text()).toBe('B-bgm-bytes');
		expect(await provider.getFile(null, 'drums\\cymbal.wav')).toBeUndefined();
		expect(await provider.getFile(null, 'missing.wav')).toBeUndefined();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing.wav'));
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Song B/mas.dtx'));

		const resultA2 = await service.parseDTXFile(workspace, 'Song A/mas.dtx');
		expect(resultA2).not.toBeNull();
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('A-audio-bytes');
		expect(await (await provider.getFile(null, 'drums\\cymbal.wav'))!.text()).toBe(
			'cymbal-bytes'
		);
		expect(await provider.getFile(null, 'missing.wav')).toBeUndefined();
	});

	it('keeps a flat folder import flat and resolves root-level audio by name', async () => {
		const files = [
			browserFile('Flat/mas.dtx', '#TITLE: Flat\r\n#WAV01: kick.wav'),
			browserFile('Flat/kick.wav', 'flat-audio-bytes')
		] as unknown as FileList;

		const workspace = await service.importFolder(files);
		expect(workspace.name).toBe('Flat');
		expect(workspace.dtxFiles[0].path).toBe('mas.dtx');
		expect(workspace.audioFiles[0].path).toBe('kick.wav');

		const result = await service.parseDTXFile(workspace, 'mas.dtx');
		expect(result).not.toBeNull();
		expect(await (await provider.getFile(null, 'kick.wav'))!.text()).toBe('flat-audio-bytes');
	});
});
