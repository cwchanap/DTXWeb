import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	WorkspaceService,
	type Workspace,
	type WorkspaceDTX,
	type WorkspaceFile
} from './workspaceService';
import { SoundLibrary } from './soundLibrary';

// Mock dependencies
vi.mock('@dtx/common', () => ({
	DTXFile: vi.fn().mockImplementation(function (this: any) {
		// ponytail: vitest 4+ constructable-mock rule â `new DTXFile()`
		Object.assign(this, {
			parseFromText: vi.fn().mockResolvedValue(undefined),
			parseSoundChips: vi.fn().mockReturnValue([]),
			meta: { title: 'Test Song', artist: 'Test Artist' }
		});
	}),
	SimFile: vi.fn().mockImplementation(function (this: any) {
		Object.assign(this, {
			files: [],
			meta: {}
		});
	}),
	decodeFileWithEncodingDetection: vi.fn().mockResolvedValue({
		content: 'mocked dtx content',
		encoding: 'utf-8'
	})
}));

vi.mock('./soundLibrary', () => ({
	SoundLibrary: {
		addFiles: vi.fn().mockResolvedValue({ added: 1, skipped: 0, errors: [] }),
		getAll: vi.fn().mockReturnValue([]),
		toFile: vi.fn().mockImplementation((sf) => new File(['mock'], sf.fileName)),
		generateFileHash: vi.fn().mockResolvedValue('mock-file-hash'),
		isLargeFile: vi.fn((size: number) => size > 2 * 1024 * 1024)
	}
}));

vi.mock('@dtx/common/services/fileManager');

// Mock localStorage
const mockLocalStorage = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

Object.defineProperty(window, 'localStorage', {
	value: mockLocalStorage
});

// Mock window.location
const mockLocation = {
	hash: '',
	replace: vi.fn()
};

Object.defineProperty(window, 'location', {
	value: mockLocation,
	writable: true
});

describe('WorkspaceService', () => {
	let workspaceService: WorkspaceService;

	beforeEach(async () => {
		workspaceService = new WorkspaceService();
		WorkspaceService.clearSessionFiles();
		vi.clearAllMocks();
		mockLocalStorage.getItem.mockReturnValue(null);
		mockLocation.hash = '';
		// Re-establish the decode mock after clearAllMocks
		const { decodeFileWithEncodingDetection } = await vi.importMock('@dtx/common');
		(decodeFileWithEncodingDetection as any).mockResolvedValue({
			content: 'mocked dtx content',
			encoding: 'utf-8'
		});
		vi.mocked(SoundLibrary.generateFileHash).mockResolvedValue('mock-file-hash');
		vi.mocked(SoundLibrary.isLargeFile).mockImplementation((size) => size > 2 * 1024 * 1024);
		vi.mocked(SoundLibrary.addFiles).mockResolvedValue({ added: 1, skipped: 0, errors: [] });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('importFolder', () => {
		it('should import folder with DTX and audio files', async () => {
			const dtxFile = new File(['dtx content'], 'song.dtx', { type: 'text/plain' });
			const audioFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });

			// Mock webkitRelativePath
			Object.defineProperty(dtxFile, 'webkitRelativePath', {
				value: 'MyFolder/song.dtx',
				writable: false
			});
			Object.defineProperty(audioFile, 'webkitRelativePath', {
				value: 'MyFolder/kick.wav',
				writable: false
			});

			const fileList = [dtxFile, audioFile] as unknown as FileList;
			mockLocalStorage.getItem.mockReturnValue('[]'); // No existing workspaces

			const result = await workspaceService.importFolder(fileList);

			expect(result.name).toBe('MyFolder');
			expect(result.dtxFiles).toHaveLength(1);
			expect(result.audioFiles).toHaveLength(1);
			expect(result.dtxFiles[0].name).toBe('song.dtx');
			expect(result.audioFiles[0].name).toBe('kick.wav');
			expect(SoundLibrary.addFiles).toHaveBeenCalledWith([audioFile]);
		});

		it('should handle large audio files in session memory', async () => {
			const largeAudioData = new Array(3 * 1024 * 1024).fill('x').join(''); // 3MB
			const largeAudioFile = new File([largeAudioData], 'large.wav', { type: 'audio/wav' });

			Object.defineProperty(largeAudioFile, 'webkitRelativePath', {
				value: 'MyFolder/large.wav',
				writable: false
			});

			const fileList = [largeAudioFile] as unknown as FileList;
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder(fileList);

			expect(result.audioFiles[0].isLarge).toBe(true);
		});

		it('should compute and store a hash for small audio files', async () => {
			const audioFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });

			Object.defineProperty(audioFile, 'webkitRelativePath', {
				value: 'MyFolder/kick.wav',
				writable: false
			});

			vi.mocked(SoundLibrary.generateFileHash).mockResolvedValue('hash-kick-abc');
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([audioFile] as unknown as FileList);

			expect(SoundLibrary.generateFileHash).toHaveBeenCalledWith(audioFile);
			expect(result.audioFiles[0].hash).toBe('hash-kick-abc');
			expect(SoundLibrary.addFiles).toHaveBeenCalledWith([audioFile]);
		});

		it('should persist the small audio hash in the stored workspace', async () => {
			const audioFile = new File(['audio data'], 'snare.wav', { type: 'audio/wav' });

			Object.defineProperty(audioFile, 'webkitRelativePath', {
				value: 'MyFolder/snare.wav',
				writable: false
			});

			vi.mocked(SoundLibrary.generateFileHash).mockResolvedValue('hash-snare-1');
			mockLocalStorage.getItem.mockReturnValue('[]');

			await workspaceService.importFolder([audioFile] as unknown as FileList);

			const savedPayload = mockLocalStorage.setItem.mock.calls.find(
				(call) => call[0] === 'dtx_workspaces'
			)?.[1] as string;
			const savedWorkspaces = JSON.parse(savedPayload) as Workspace[];
			expect(savedWorkspaces[0].audioFiles[0].hash).toBe('hash-snare-1');
		});

		it('should hash an audio file whose size equals the large-file threshold', async () => {
			const boundaryFile = new File(['audio data'], 'edge.wav', { type: 'audio/wav' });
			Object.defineProperty(boundaryFile, 'size', { value: 2 * 1024 * 1024 });

			Object.defineProperty(boundaryFile, 'webkitRelativePath', {
				value: 'MyFolder/edge.wav',
				writable: false
			});

			vi.mocked(SoundLibrary.generateFileHash).mockResolvedValue('hash-edge');
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([
				boundaryFile
			] as unknown as FileList);

			expect(result.audioFiles[0].isLarge).toBe(false);
			expect(SoundLibrary.generateFileHash).toHaveBeenCalledWith(boundaryFile);
			expect(result.audioFiles[0].hash).toBe('hash-edge');
		});

		it('should keep the workspace when small audio hashing fails', async () => {
			const dtxFile = new File(['dtx content'], 'song.dtx', { type: 'text/plain' });
			const audioFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });
			[dtxFile, audioFile].forEach((file) => {
				Object.defineProperty(file, 'webkitRelativePath', {
					value: `MyFolder/${file.name}`,
					writable: false
				});
			});
			vi.mocked(SoundLibrary.generateFileHash).mockRejectedValue(new Error('hash failed'));
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([
				dtxFile,
				audioFile
			] as unknown as FileList);

			expect(result.dtxFiles).toHaveLength(1);
			expect(result.audioFiles).toHaveLength(1);
			expect(result.audioFiles[0].hash).toBeUndefined();
			expect(result.audioFiles[0].libraryStorageFailed).toBe(true);
			expect(SoundLibrary.addFiles).toHaveBeenCalledWith([audioFile]);

			const savedPayload = mockLocalStorage.setItem.mock.calls.find(
				(call) => call[0] === 'dtx_workspaces'
			)?.[1] as string;
			const savedWorkspaces = JSON.parse(savedPayload) as Workspace[];
			expect(savedWorkspaces[0].audioFiles[0].hash).toBeUndefined();
			expect(savedWorkspaces[0].audioFiles[0].libraryStorageFailed).toBe(true);
		});

		it('should decode a DTX file with a UTF-8 BOM as UTF-8 without trying Shift-JIS first', async () => {
			const { decodeFileWithEncodingDetection } = await import('@dtx/common');
			const bomFile = new File([new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x54])], 'song.dtx');
			const sjisFile = new File([new Uint8Array([0x23, 0x54])], 'plain.dtx');
			[bomFile, sjisFile].forEach((file) => {
				Object.defineProperty(file, 'webkitRelativePath', {
					value: `MyFolder/${file.name}`,
					writable: false
				});
			});
			mockLocalStorage.getItem.mockReturnValue('[]');

			await workspaceService.importFolder([bomFile, sjisFile] as unknown as FileList);

			const calls = vi.mocked(decodeFileWithEncodingDetection).mock.calls;
			expect(calls[0][0]).toBe(bomFile);
			expect(calls[0][2]).toEqual(['utf-8']);
			expect(calls[0][3]).toBe('utf-8');
			expect(calls[1][0]).toBe(sjisFile);
			expect(calls[1][2]?.[0]).toBe('shift-jis');
			expect(calls[1][3]).toBe('shift-jis');
		});

		it('should not record a hash when the sound library rejects the audio file', async () => {
			const audioFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });
			Object.defineProperty(audioFile, 'webkitRelativePath', {
				value: 'MyFolder/kick.wav',
				writable: false
			});
			vi.mocked(SoundLibrary.addFiles).mockResolvedValue({
				added: 0,
				skipped: 0,
				errors: ['kick.wav: Would exceed storage limit (50MB)']
			});
			vi.spyOn(console, 'error').mockImplementation(() => undefined);
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([audioFile] as unknown as FileList);

			expect(result.audioFiles[0].hash).toBeUndefined();
			expect(result.audioFiles[0].libraryStorageFailed).toBe(true);
		});

		it('should not hash large audio files kept in session memory', async () => {
			const largeFile = new File(['audio data'], 'large.wav', { type: 'audio/wav' });
			Object.defineProperty(largeFile, 'size', { value: 2 * 1024 * 1024 + 1 });

			Object.defineProperty(largeFile, 'webkitRelativePath', {
				value: 'MyFolder/large.wav',
				writable: false
			});

			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([largeFile] as unknown as FileList);

			expect(result.audioFiles[0].isLarge).toBe(true);
			expect(result.audioFiles[0].hash).toBeUndefined();
			expect(SoundLibrary.generateFileHash).not.toHaveBeenCalled();
			expect(WorkspaceService.getLargeFile('MyFolder', 'large.wav')).toBe(largeFile);
			expect(SoundLibrary.addFiles).toHaveBeenCalledWith([largeFile]);

			const savedPayload = mockLocalStorage.setItem.mock.calls.find(
				(call) => call[0] === 'dtx_workspaces'
			)?.[1] as string;
			const savedWorkspaces = JSON.parse(savedPayload) as Workspace[];
			expect(savedWorkspaces[0].audioFiles[0].hash).toBeUndefined();
		});

		it('should sort DTX files: file with difficulty before file without', async () => {
			// One file has a difficulty keyword, one does not
			const unknownFile = new File(['u'], 'unknown_song.dtx', { type: 'text/plain' });
			const basicFile = new File(['b'], 'song_basic.dtx', { type: 'text/plain' });
			[unknownFile, basicFile].forEach((file) => {
				Object.defineProperty(file, 'webkitRelativePath', {
					value: `Folder/${file.name}`,
					writable: false
				});
			});
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([
				unknownFile,
				basicFile
			] as unknown as FileList);

			// basic (diff=1) should come before unknown_song (diff=0)
			expect(result.dtxFiles[0].name).toBe('song_basic.dtx');
			expect(result.dtxFiles[1].name).toBe('unknown_song.dtx');
		});

		it('should sort DTX files alphabetically when neither has a difficulty keyword', async () => {
			const fileB = new File(['b'], 'songB.dtx', { type: 'text/plain' });
			const fileA = new File(['a'], 'songA.dtx', { type: 'text/plain' });
			[fileA, fileB].forEach((file) => {
				Object.defineProperty(file, 'webkitRelativePath', {
					value: `Folder/${file.name}`,
					writable: false
				});
			});
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([
				fileB,
				fileA
			] as unknown as FileList);

			// Neither has a difficulty keyword, so alphabetical order applies
			expect(result.dtxFiles[0].name).toBe('songA.dtx');
			expect(result.dtxFiles[1].name).toBe('songB.dtx');
		});

		it('should call validateDtxContent callback when decoding DTX file', async () => {
			const { decodeFileWithEncodingDetection } = await vi.importMock('@dtx/common');
			(decodeFileWithEncodingDetection as any).mockImplementationOnce(
				async (_file: File, validate: (content: string) => boolean) => {
					// Call the callback with content that hits different branches
					validate('#TITLE:Test');
					validate('#ARTIST:Only');
					validate('#BPM:120');
					validate('#WAV01:kick.wav');
					validate('non-empty content');
					return { content: '#TITLE:Test', encoding: 'utf-8' };
				}
			);
			const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
			Object.defineProperty(dtxFile, 'webkitRelativePath', {
				value: 'Folder/song.dtx',
				writable: false
			});
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder([dtxFile] as unknown as FileList);

			expect(result.dtxFiles).toHaveLength(1);
			expect(decodeFileWithEncodingDetection).toHaveBeenCalled();
		});

		it('should sort DTX files by difficulty', async () => {
			const basicFile = new File(['basic content'], 'song_basic.dtx', { type: 'text/plain' });
			const masterFile = new File(['master content'], 'song_master.dtx', {
				type: 'text/plain'
			});
			const extremeFile = new File(['extreme content'], 'song_extreme.dtx', {
				type: 'text/plain'
			});

			[basicFile, masterFile, extremeFile].forEach((file, index) => {
				Object.defineProperty(file, 'webkitRelativePath', {
					value: `MyFolder/${file.name}`,
					writable: false
				});
			});

			const fileList = [basicFile, masterFile, extremeFile] as unknown as FileList;
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder(fileList);

			// Should be sorted: master (4), extreme (3), basic (1)
			expect(result.dtxFiles[0].name).toBe('song_master.dtx');
			expect(result.dtxFiles[1].name).toBe('song_extreme.dtx');
			expect(result.dtxFiles[2].name).toBe('song_basic.dtx');
		});

		it('should generate unique workspace name for conflicts', async () => {
			const existingWorkspaces = [{ name: 'MyFolder' }, { name: 'MyFolder (1)' }];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingWorkspaces));

			const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
			Object.defineProperty(dtxFile, 'webkitRelativePath', {
				value: 'MyFolder/song.dtx',
				writable: false
			});

			const fileList = [dtxFile] as unknown as FileList;

			const result = await workspaceService.importFolder(fileList);

			expect(result.name).toBe('MyFolder (2)');
		});

		it('should use fallback workspace name when webkitRelativePath is unavailable', async () => {
			const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
			const fileList = [dtxFile] as unknown as FileList;
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.importFolder(fileList);

			expect(result.name).toBe('Imported Folder');
			expect(result.path).toBe('Imported Folder');
		});
	});

	describe('parseDTXFile', () => {
		it('should parse DTX file successfully', async () => {
			// Import mocked modules to access them
			const { DTXFile, SimFile } = await import('@dtx/common');

			// Create mock instances with proper methods
			const mockDTXFile = {
				parseFromText: vi.fn().mockResolvedValue(undefined),
				parseSoundChips: vi.fn().mockReturnValue([]),
				title: 'Test Song',
				artist: 'Test Artist'
			};

			const mockSimFile = {
				files: [],
				title: ''
			};

			// Mock the constructors to return our mock instances
			vi.mocked(DTXFile).mockImplementation(function () {
				// ponytail: vitest 4+ constructable-mock rule - new DTXFile()
				return mockDTXFile as any;
			});
			vi.mocked(SimFile).mockImplementation(function () {
				// ponytail: vitest 4+ constructable-mock rule - new SimFile()
				return mockSimFile as any;
			});

			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [
					{
						name: 'test.dtx',
						content: '#TITLE: Test Song\n#ARTIST: Test Artist\n#WAV01: kick.wav',
						path: 'test.dtx'
					}
				],
				audioFiles: [],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			// Mock localStorage for saveWorkspace call
			mockLocalStorage.getItem.mockReturnValue('[]');

			// Mock SoundLibrary to return consistent results
			vi.mocked(SoundLibrary.getAll).mockReturnValue([]);

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			// Assert the method returns the expected structure
			expect(result).not.toBeNull();
			expect(result!.dtxFile).toBeDefined();
			expect(result!.simFile).toBeDefined();
			expect(result!.dtxFile.title).toBe('Test Song');
			expect(result!.dtxFile.artist).toBe('Test Artist');

			// Verify the mock methods were called
			expect(mockDTXFile.parseFromText).toHaveBeenCalledWith(
				'#TITLE: Test Song\n#ARTIST: Test Artist\n#WAV01: kick.wav'
			);
			expect(mockDTXFile.parseSoundChips).toHaveBeenCalled();
		});

		it('should return null for non-existent DTX file', async () => {
			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			const result = await workspaceService.parseDTXFile(workspace, 'nonexistent.dtx');

			expect(result).toBeNull();
		});

		it('should map library and session files and register them in file manager', async () => {
			const { DTXFile, SimFile } = await import('@dtx/common');
			const { setFile } = await import('@dtx/common/services/fileManager');

			const soundChips: { fileName: string; file?: File }[] = [
				{ fileName: 'kick.wav' },
				{ fileName: 'large.wav' },
				{ fileName: 'missing.wav' }
			];
			const mockDTXFile = {
				parseFromText: vi.fn().mockResolvedValue(undefined),
				parseSoundChips: vi.fn().mockReturnValue(soundChips),
				title: 'Mapped Song'
			};
			const mockSimFile = { files: [], title: '' };

			vi.mocked(DTXFile).mockImplementation(function () {
				// ponytail: vitest 4+ constructable-mock rule - new DTXFile()
				return mockDTXFile as any;
			});
			vi.mocked(SimFile).mockImplementation(function () {
				// ponytail: vitest 4+ constructable-mock rule - new SimFile()
				return mockSimFile as any;
			});

			const kickFile = new File(['kick'], 'kick.wav', { type: 'audio/wav' });
			const largeFile = new File(['large'], 'large.wav', { type: 'audio/wav' });

			vi.mocked(SoundLibrary.getAll).mockReturnValue([
				{ fileName: 'kick.wav', fileData: 'data' } as any,
				{ fileName: 'large.wav', fileData: 'data' } as any
			]);
			vi.mocked(SoundLibrary.toFile).mockReturnValue(kickFile);

			(WorkspaceService as any).sessionLargeFiles.set('Test Workspace/large.wav', largeFile);

			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [{ name: 'test.dtx', content: '#TITLE: mapped', path: 'test.dtx' }],
				audioFiles: [
					{ name: 'kick.wav', path: 'kick.wav', isLarge: false },
					{ name: 'large.wav', path: 'large.wav', isLarge: true }
				],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			expect(result).not.toBeNull();
			expect(result!.simFile.files).toEqual([kickFile, largeFile]);
			expect(soundChips[0].file).toBe(kickFile);
			expect(soundChips[1].file).toBe(largeFile);
			expect(soundChips[2].file).toBeUndefined();
			expect(setFile).toHaveBeenCalledWith('local:kick.wav', kickFile);
			expect(setFile).toHaveBeenCalledWith('local:large.wav', largeFile);
			expect(setFile).toHaveBeenCalledTimes(2);
		});

		it('should resolve small audio by stored hash and expose it under the workspace file name', async () => {
			const { DTXFile, SimFile } = await import('@dtx/common');
			const soundChips: { fileName: string; file?: File }[] = [{ fileName: 'kick.wav' }];
			vi.mocked(DTXFile).mockImplementation(function () {
				return {
					parseFromText: vi.fn().mockResolvedValue(undefined),
					parseSoundChips: vi.fn().mockReturnValue(soundChips),
					title: 'Pinned'
				} as any;
			});
			vi.mocked(SimFile).mockImplementation(function () {
				return { files: [], title: '' } as any;
			});
			// Another workspace's same-named file with different bytes, plus the pinned record
			// stored under a different name (content-deduplicated).
			const otherRecord = {
				hash: 'hash-other',
				fileName: 'kick.wav',
				fileData: 'other'
			} as any;
			const pinnedRecord = {
				hash: 'hash-pinned',
				fileName: 'Kick.WAV',
				fileData: 'pinned'
			} as any;
			vi.mocked(SoundLibrary.getAll).mockReturnValue([otherRecord, pinnedRecord]);
			vi.mocked(SoundLibrary.toFile).mockImplementation(
				(record) => new File([record.fileData], record.fileName, { type: 'audio/wav' })
			);
			mockLocalStorage.getItem.mockReturnValue('[]');

			const workspace: Workspace = {
				name: 'Pinned Workspace',
				path: 'p',
				dtxFiles: [{ name: 'test.dtx', content: '#TITLE: x', path: 'test.dtx' }],
				audioFiles: [
					{ name: 'kick.wav', path: 'kick.wav', isLarge: false, hash: 'hash-pinned' }
				],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			expect(result!.simFile.files).toHaveLength(1);
			expect(result!.simFile.files[0].name).toBe('kick.wav');
			expect(await result!.simFile.files[0].text()).toBe('pinned');
			expect(soundChips[0].file).toBe(result!.simFile.files[0]);
		});

		it('should not fall back to a same-named library file for a failed import', async () => {
			const { DTXFile, SimFile } = await import('@dtx/common');
			vi.mocked(DTXFile).mockImplementation(function () {
				return {
					parseFromText: vi.fn().mockResolvedValue(undefined),
					parseSoundChips: vi.fn().mockReturnValue([]),
					title: 'x'
				} as any;
			});
			vi.mocked(SimFile).mockImplementation(function () {
				return { files: [], title: '' } as any;
			});
			// Another workspace's same-named file sits in the library; this record
			// has no hash because storing it failed, so it must not name-match.
			vi.mocked(SoundLibrary.getAll).mockReturnValue([
				{ fileName: 'kick.wav', fileData: 'other-workspace-bytes' } as any
			]);
			vi.mocked(SoundLibrary.toFile).mockImplementation(
				(record) => new File([record.fileData], record.fileName)
			);
			mockLocalStorage.getItem.mockReturnValue('[]');

			const workspace: Workspace = {
				name: 'Failed Import Workspace',
				path: 'p',
				dtxFiles: [{ name: 'test.dtx', content: '#TITLE: x', path: 'test.dtx' }],
				audioFiles: [
					{
						name: 'kick.wav',
						path: 'kick.wav',
						isLarge: false,
						libraryStorageFailed: true
					}
				],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			expect(result).not.toBeNull();
			expect(result!.simFile.files).toHaveLength(0);
		});

		it('should drop stale local file entries and register files under lowercased keys', async () => {
			const { DTXFile, SimFile } = await import('@dtx/common');
			const { getKeys, removeFile, setFile } =
				await import('@dtx/common/services/fileManager');
			vi.mocked(DTXFile).mockImplementation(function () {
				return {
					parseFromText: vi.fn().mockResolvedValue(undefined),
					parseSoundChips: vi.fn().mockReturnValue([]),
					title: 'x'
				} as any;
			});
			vi.mocked(SimFile).mockImplementation(function () {
				return { files: [], title: '' } as any;
			});
			vi.mocked(getKeys).mockReturnValueOnce(['local:stale.wav', 'simfile-9:remote.wav']);
			const pinnedRecord = {
				hash: 'hash-pinned',
				fileName: 'KICK.WAV',
				fileData: 'bytes'
			} as any;
			vi.mocked(SoundLibrary.getAll).mockReturnValue([pinnedRecord]);
			vi.mocked(SoundLibrary.toFile).mockImplementation(
				(record) => new File([record.fileData], record.fileName)
			);
			mockLocalStorage.getItem.mockReturnValue('[]');

			const workspace: Workspace = {
				name: 'Stale Entry Workspace',
				path: 'p',
				dtxFiles: [{ name: 'test.dtx', content: '#TITLE: x', path: 'test.dtx' }],
				audioFiles: [
					{ name: 'KICK.WAV', path: 'KICK.WAV', isLarge: false, hash: 'hash-pinned' }
				],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			expect(result).not.toBeNull();
			expect(removeFile).toHaveBeenCalledWith('local:stale.wav');
			expect(removeFile).not.toHaveBeenCalledWith('simfile-9:remote.wav');
			expect(setFile).toHaveBeenCalledWith('local:kick.wav', expect.any(File));
		});

		it('should return null when parsing throws an error', async () => {
			const { DTXFile } = await import('@dtx/common');
			const mockDTXFile = {
				parseFromText: vi.fn().mockRejectedValue(new Error('parse failed')),
				parseSoundChips: vi.fn()
			};
			vi.mocked(DTXFile).mockImplementation(function () {
				// ponytail: vitest 4+ constructable-mock rule - new DTXFile()
				return mockDTXFile as any;
			});

			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [{ name: 'test.dtx', content: 'bad-content', path: 'test.dtx' }],
				audioFiles: [],
				currentDTX: 'test.dtx',
				lastModified: Date.now()
			};

			const result = await workspaceService.parseDTXFile(workspace, 'test.dtx');

			expect(result).toBeNull();
		});
	});

	describe('switchDTXFile', () => {
		it('should switch to valid DTX file', () => {
			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [
					{ name: 'song1.dtx', content: 'content1', path: 'song1.dtx' },
					{ name: 'song2.dtx', content: 'content2', path: 'song2.dtx' }
				],
				audioFiles: [],
				currentDTX: 'song1.dtx',
				lastModified: Date.now()
			};

			workspaceService.switchDTXFile(workspace, 'song2.dtx');

			expect(workspace.currentDTX).toBe('song2.dtx');
		});

		it('should not switch to invalid DTX file', () => {
			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [{ name: 'song1.dtx', content: 'content1', path: 'song1.dtx' }],
				audioFiles: [],
				currentDTX: 'song1.dtx',
				lastModified: Date.now()
			};

			workspaceService.switchDTXFile(workspace, 'nonexistent.dtx');

			expect(workspace.currentDTX).toBe('song1.dtx'); // Should remain unchanged
		});

		it('should update lastModified and persist when switching DTX files', () => {
			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [
					{ name: 'song1.dtx', content: 'content1', path: 'song1.dtx' },
					{ name: 'song2.dtx', content: 'content2', path: 'song2.dtx' }
				],
				audioFiles: [],
				currentDTX: 'song1.dtx',
				lastModified: 1000
			};

			mockLocalStorage.getItem.mockReturnValue('[]');
			const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456);

			workspaceService.switchDTXFile(workspace, 'song2.dtx');

			expect(workspace.currentDTX).toBe('song2.dtx');
			expect(workspace.lastModified).toBe(123456);
			expect(mockLocalStorage.setItem).toHaveBeenCalled();
			nowSpy.mockRestore();
		});
	});

	describe('getWorkspaces', () => {
		it('should return empty array when no workspaces exist', () => {
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = workspaceService.getWorkspaces();

			expect(result).toEqual([]);
		});

		it('should return stored workspaces', () => {
			const mockWorkspaces = [
				{ name: 'Workspace 1', path: 'path1' },
				{ name: 'Workspace 2', path: 'path2' }
			];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(mockWorkspaces));

			const result = workspaceService.getWorkspaces();

			expect(result).toEqual(mockWorkspaces);
		});

		it('should handle localStorage errors', () => {
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const result = workspaceService.getWorkspaces();

			expect(result).toEqual([]);
		});
	});

	describe('getWorkspace', () => {
		it('should return specific workspace by name', () => {
			const mockWorkspaces = [
				{ name: 'Workspace 1', path: 'path1' },
				{ name: 'Workspace 2', path: 'path2' }
			];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(mockWorkspaces));

			const result = workspaceService.getWorkspace('Workspace 2');

			expect(result).toEqual({ name: 'Workspace 2', path: 'path2' });
		});

		it('should return null for non-existent workspace', () => {
			mockLocalStorage.getItem.mockReturnValue('[]');

			const result = workspaceService.getWorkspace('Non-existent');

			expect(result).toBeNull();
		});
	});

	describe('saveWorkspace', () => {
		it('should save new workspace', () => {
			const workspace: Workspace = {
				name: 'New Workspace',
				path: 'new-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			mockLocalStorage.getItem.mockReturnValue('[]');

			workspaceService.saveWorkspace(workspace);

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dtx_workspaces',
				expect.stringContaining('"New Workspace"')
			);
		});

		it('should update existing workspace', () => {
			const existingWorkspaces = [{ name: 'Existing Workspace', path: 'old-path' }];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingWorkspaces));

			const updatedWorkspace: Workspace = {
				name: 'Existing Workspace',
				path: 'new-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			workspaceService.saveWorkspace(updatedWorkspace);

			expect(mockLocalStorage.setItem).toHaveBeenCalled();
		});

		it('should omit file objects when saving audio files', () => {
			mockLocalStorage.getItem.mockReturnValue('[]');

			const workspace: Workspace = {
				name: 'Serializable Workspace',
				path: 'serializable-path',
				dtxFiles: [],
				audioFiles: [
					{
						name: 'kick.wav',
						path: 'kick.wav',
						isLarge: false,
						file: new File(['data'], 'kick.wav', { type: 'audio/wav' })
					}
				],
				currentDTX: null,
				lastModified: Date.now()
			};

			workspaceService.saveWorkspace(workspace);

			const savedPayload = mockLocalStorage.setItem.mock.calls[0][1] as string;
			expect(savedPayload).toContain('Serializable Workspace');
			expect(savedPayload).not.toContain('"file"');
		});

		it('should persist audio file hashes when saving', () => {
			mockLocalStorage.getItem.mockReturnValue('[]');

			const workspace: Workspace = {
				name: 'Hashed Workspace',
				path: 'hashed-path',
				dtxFiles: [],
				audioFiles: [
					{
						name: 'kick.wav',
						path: 'kick.wav',
						isLarge: false,
						hash: 'saved-hash-1'
					}
				],
				currentDTX: null,
				lastModified: Date.now()
			};

			workspaceService.saveWorkspace(workspace);

			const savedPayload = mockLocalStorage.setItem.mock.calls[0][1] as string;
			const parsed = JSON.parse(savedPayload) as Workspace[];
			expect(parsed[0].audioFiles[0].hash).toBe('saved-hash-1');
		});

		it('should handle localStorage errors', () => {
			mockLocalStorage.setItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			// Should not throw
			expect(() => {
				workspaceService.saveWorkspace(workspace);
			}).not.toThrow();
		});
	});

	describe('deleteWorkspace', () => {
		it('should delete workspace by name', () => {
			const mockWorkspaces = [
				{ name: 'Workspace 1', path: 'path1' },
				{ name: 'Workspace 2', path: 'path2' }
			];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(mockWorkspaces));

			workspaceService.deleteWorkspace('Workspace 1');

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dtx_workspaces',
				JSON.stringify([{ name: 'Workspace 2', path: 'path2' }])
			);
		});

		it('should handle deletion of non-existent workspace', () => {
			mockLocalStorage.getItem.mockReturnValue('[]');

			workspaceService.deleteWorkspace('Non-existent');

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith('dtx_workspaces', '[]');
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => {
				workspaceService.deleteWorkspace('Workspace 1');
			}).not.toThrow();
		});

		it('should handle setItem error gracefully in deleteWorkspace', () => {
			mockLocalStorage.getItem.mockReturnValue('[]');
			mockLocalStorage.setItem.mockImplementation(() => {
				throw new Error('setItem error');
			});

			expect(() => {
				workspaceService.deleteWorkspace('any-name');
			}).not.toThrow();
			// ponytail: vitest 4 clearAllMocks keeps implementations — reset so the
			// throwing impl cannot leak into later tests
			mockLocalStorage.setItem.mockReset();
		});
	});

	describe('getCurrentWorkspace', () => {
		it('should return workspace from URL hash', () => {
			mockLocation.hash = '#workspace:Test Workspace';
			const mockWorkspaces = [{ name: 'Test Workspace', path: 'test-path' }];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(mockWorkspaces));

			const result = workspaceService.getCurrentWorkspace();

			expect(result).toEqual({ name: 'Test Workspace', path: 'test-path' });
		});

		it('should return workspace from localStorage when no hash', () => {
			mockLocation.hash = '';
			mockLocalStorage.getItem
				.mockReturnValueOnce('Last Workspace') // For last_workspace key
				.mockReturnValueOnce(
					JSON.stringify([{ name: 'Last Workspace', path: 'last-path' }])
				); // For getWorkspaces

			const result = workspaceService.getCurrentWorkspace();

			expect(result).toEqual({ name: 'Last Workspace', path: 'last-path' });
		});

		it('should return null when no current workspace', () => {
			mockLocation.hash = '';
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = workspaceService.getCurrentWorkspace();

			expect(result).toBeNull();
		});

		it('should ignore non-workspace hash and use localStorage fallback', () => {
			mockLocation.hash = '#editor';
			mockLocalStorage.getItem
				.mockReturnValueOnce('Last Workspace')
				.mockReturnValueOnce(
					JSON.stringify([{ name: 'Last Workspace', path: 'last-path' }])
				);

			const result = workspaceService.getCurrentWorkspace();

			expect(result).toEqual({ name: 'Last Workspace', path: 'last-path' });
		});

		it('should return null when localStorage throws in fallback path', () => {
			mockLocation.hash = '';
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const result = workspaceService.getCurrentWorkspace();

			expect(result).toBeNull();
		});
	});

	describe('setCurrentWorkspace', () => {
		it('should set current workspace', () => {
			const workspace: Workspace = {
				name: 'Current Workspace',
				path: 'current-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			workspaceService.setCurrentWorkspace(workspace);

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'last_workspace',
				'Current Workspace'
			);
			expect(mockLocation.hash).toBe('workspace:Current Workspace');
		});

		it('should handle localStorage errors', () => {
			mockLocalStorage.setItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const workspace: Workspace = {
				name: 'Test Workspace',
				path: 'test-path',
				dtxFiles: [],
				audioFiles: [],
				currentDTX: null,
				lastModified: Date.now()
			};

			// Should not throw
			expect(() => {
				workspaceService.setCurrentWorkspace(workspace);
			}).not.toThrow();
		});

		it('should clear current workspace when null is provided', () => {
			workspaceService.setCurrentWorkspace(null);

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('last_workspace');
			expect(mockLocation.hash).toBe('');
		});
	});

	describe('static methods', () => {
		it('should get large file from session memory', () => {
			const mockFile = new File(['large data'], 'large.wav', { type: 'audio/wav' });

			// Access the private static property for testing
			(WorkspaceService as any).sessionLargeFiles.set('Test Workspace/large.wav', mockFile);

			const result = WorkspaceService.getLargeFile('Test Workspace', 'large.wav');

			expect(result).toBe(mockFile);
		});

		it('should clear session files for specific workspace', () => {
			const file1 = new File(['data1'], 'file1.wav', { type: 'audio/wav' });
			const file2 = new File(['data2'], 'file2.wav', { type: 'audio/wav' });

			// Access the private static property for testing
			const sessionFiles = (WorkspaceService as any).sessionLargeFiles;
			sessionFiles.set('Workspace1/file1.wav', file1);
			sessionFiles.set('Workspace2/file2.wav', file2);

			WorkspaceService.clearSessionFiles('Workspace1');

			expect(sessionFiles.has('Workspace1/file1.wav')).toBe(false);
			expect(sessionFiles.has('Workspace2/file2.wav')).toBe(true);
		});

		it('should clear all session files when no workspace specified', () => {
			const file1 = new File(['data1'], 'file1.wav', { type: 'audio/wav' });
			const file2 = new File(['data2'], 'file2.wav', { type: 'audio/wav' });

			// Access the private static property for testing
			const sessionFiles = (WorkspaceService as any).sessionLargeFiles;
			sessionFiles.set('Workspace1/file1.wav', file1);
			sessionFiles.set('Workspace2/file2.wav', file2);

			WorkspaceService.clearSessionFiles();

			expect(sessionFiles.size).toBe(0);
		});
	});

	describe('helper methods', () => {
		it('should identify audio files correctly', () => {
			const workspaceService = new WorkspaceService();

			const audioFile1 = new File(['data'], 'test.wav', { type: 'audio/wav' });
			const audioFile2 = new File(['data'], 'test.mp3', { type: '' }); // By extension
			const textFile = new File(['data'], 'test.txt', { type: 'text/plain' });

			// Access private method for testing
			const isAudioFile = (workspaceService as any).isAudioFile.bind(workspaceService);

			expect(isAudioFile(audioFile1)).toBe(true);
			expect(isAudioFile(audioFile2)).toBe(true);
			expect(isAudioFile(textFile)).toBe(false);
		});

		it('should generate unique workspace names', () => {
			const existingWorkspaces = [
				{ name: 'Test' },
				{ name: 'Test (1)' },
				{ name: 'Test (2)' }
			];
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(existingWorkspaces));

			// Access private method for testing
			const generateUniqueWorkspaceName = (
				workspaceService as any
			).generateUniqueWorkspaceName.bind(workspaceService);

			const result = generateUniqueWorkspaceName('Test');

			expect(result).toBe('Test (3)');
		});

		it('should format file sizes correctly', () => {
			const workspaceService = new WorkspaceService();

			// Access private method for testing
			const formatFileSize = (workspaceService as any).formatFileSize.bind(workspaceService);

			expect(formatFileSize(500)).toBe('500.0 B');
			expect(formatFileSize(1024)).toBe('1.0 KB');
			expect(formatFileSize(1536)).toBe('1.5 KB');
			expect(formatFileSize(1048576)).toBe('1.0 MB');
			expect(formatFileSize(2097152)).toBe('2.0 MB');
			expect(formatFileSize(1073741824)).toBe('1.0 GB');
			expect(formatFileSize(0)).toBe('0.0 B');
		});
	});
	describe('toExportContent', () => {
		const decodeSjis = (value: string | Uint8Array) =>
			new TextDecoder('shift-jis').decode(value as Uint8Array);

		it('encodes Japanese text as Shift-JIS bytes that round-trip through the decoder', () => {
			const text = '#TITLE: 太鼓の達人 ｶﾀｶﾅ ①\\path\r\n#ARTIST: テスト';
			const encoded = WorkspaceService.toExportContent(text);

			expect(encoded).toBeInstanceOf(Uint8Array);
			expect(decodeSjis(encoded)).toBe(text);
		});

		it('produces the exact CP932 bytes for kanji', () => {
			expect(Array.from(WorkspaceService.toExportContent('太鼓') as Uint8Array)).toEqual([
				0x91, 0xbe, 0x8c, 0xdb
			]);
		});

		it('ignores a leading BOM character when encoding', () => {
			const encoded = WorkspaceService.toExportContent('\uFEFF#TITLE: x');
			expect(decodeSjis(encoded)).toBe('#TITLE: x');
		});

		it('falls back to UTF-8 with a BOM when a character is not representable', () => {
			expect(WorkspaceService.toExportContent('#TITLE: 🥁')).toBe('\uFEFF#TITLE: 🥁');
		});

		it('keeps an empty chart zero-byte', () => {
			expect(WorkspaceService.toExportContent('')).toBe('');
		});
	});
});
