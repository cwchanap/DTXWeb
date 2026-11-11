import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import JSZip from 'jszip';
import type { SoundLibraryFile } from '$lib/services/soundLibrary';
import { makeWorkspace } from '../../../../tests/mocks/services';

const originalCreateObjectURL = global.URL.createObjectURL;
const originalRevokeObjectURL = global.URL.revokeObjectURL;

const mockService = vi.hoisted(() => ({
	getWorkspaces: vi.fn(() => [
		makeWorkspace({ name: 'Workspace A' }),
		makeWorkspace({ name: 'Workspace B' })
	]),
	getCurrentWorkspace: vi.fn(() => makeWorkspace({ name: 'Workspace A' }))
}));

const mockWorkspaceServiceClass = vi.hoisted(() => ({
	getLargeFile: vi.fn<(workspaceName: string, fileName: string) => File | undefined>(
		() => undefined
	)
}));

const soundLibMock = vi.hoisted(() => ({
	getByHash: vi.fn<(hash: string) => SoundLibraryFile | null>(() => null),
	findByFileName: vi.fn<(fileName: string) => SoundLibraryFile[]>(() => []),
	toFile: vi.fn<(libraryFile: SoundLibraryFile) => File | null>(() => null)
}));

const toastMock = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn()
}));

const mockZipInstance = vi.hoisted(() => ({
	file: vi.fn(),
	generateAsync: vi.fn(),
	real: null as unknown as JSZip
}));

const mockJSZipConstructor = vi.hoisted(() =>
	// ponytail: vitest 4+ constructable-mock rule — `new JSZip()`
	vi.fn(function (this: unknown) {
		Object.assign(this, mockZipInstance);
	})
);

const realZip = vi.hoisted(() => ({ ctor: null as unknown as typeof JSZip }));

vi.mock('jszip', async (importOriginal) => {
	const actual = await importOriginal<{ default: typeof JSZip }>();
	realZip.ctor = actual.default;
	return {
		default: Object.assign(mockJSZipConstructor, {
			loadAsync: actual.default.loadAsync.bind(actual.default)
		})
	};
});

vi.mock('$lib/services/workspaceService', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/workspaceService')>();
	return {
		workspaceService: mockService,
		// Use the real encoder so tests assert the bytes-level contract, not a copy of it
		WorkspaceService: {
			...mockWorkspaceServiceClass,
			toExportContent: actual.WorkspaceService.toExportContent
		}
	};
});

vi.mock('$lib/services/soundLibrary', () => ({
	SoundLibrary: soundLibMock
}));

vi.mock('$lib/toaster', () => ({ default: toastMock }));

import ExportWorkspaceModal from './ExportWorkspaceModal.svelte';

const libraryRecord = (hash: string, fileName: string): SoundLibraryFile => ({
	hash,
	fileName,
	fileType: 'audio/wav',
	fileData: 'bW9jay1hdWRpby1ieXRlcw==',
	size: 16,
	dateAdded: 0
});

const audioFileAt = (path: string, hash?: string) => ({
	name: path.split('/').pop() ?? path,
	path,
	isLarge: false,
	hash
});

const largeAudioFileAt = (path: string) => ({
	name: path.split('/').pop() ?? path,
	path,
	isLarge: true
});

const kickLibraryRecord = libraryRecord('mock-hash-kick', 'kick.wav');
const kickFile = new File(['kick audio bytes'], 'kick.wav', { type: 'audio/wav' });

const defaultProps = {
	show: true,
	onClose: vi.fn()
};

const clickExport = async (workspaceName: string) => {
	// Spy on download hooks AFTER rendering so they do not interfere with test setup
	const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el);
	const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
	const anchorClick = vi
		.spyOn(HTMLAnchorElement.prototype, 'click')
		.mockImplementation(() => undefined);
	const workspaceButton = screen
		.getAllByRole('button')
		.find(
			(btn) =>
				btn.textContent?.includes(workspaceName) && !btn.textContent?.includes('Cancel')
		);
	expect(workspaceButton).toBeDefined();
	await fireEvent.click(workspaceButton!);
	return { appendChild, removeChild, anchorClick };
};

const exportedZip = async (): Promise<JSZip> => {
	const createObjectURL = vi.mocked(global.URL.createObjectURL);
	expect(createObjectURL).toHaveBeenCalledTimes(1);
	const blob = createObjectURL.mock.calls[0][0] as Blob;
	return JSZip.loadAsync(await blob.arrayBuffer());
};

const zipEntryNames = (zip: JSZip): string[] =>
	Object.values(zip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name);

const zipEntryBytes = async (zip: JSZip, name: string): Promise<Uint8Array> => {
	const entry = zip.file(name);
	expect(entry).not.toBeNull();
	return entry!.async('uint8array');
};

const NFC_CAFE = 'Café';
const NFD_CAFE = 'Cafe\u0301';

describe('ExportWorkspaceModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		global.URL.revokeObjectURL = vi.fn();

		mockService.getWorkspaces.mockReset();
		mockService.getWorkspaces.mockReturnValue([
			makeWorkspace({ name: 'Workspace A' }),
			makeWorkspace({ name: 'Workspace B' })
		]);
		mockService.getCurrentWorkspace.mockReset();
		mockService.getCurrentWorkspace.mockReturnValue(makeWorkspace({ name: 'Workspace A' }));

		mockWorkspaceServiceClass.getLargeFile.mockReset();
		mockWorkspaceServiceClass.getLargeFile.mockReturnValue(undefined);

		soundLibMock.getByHash.mockReset();
		soundLibMock.getByHash.mockImplementation((hash) =>
			hash === 'mock-hash-kick' ? kickLibraryRecord : null
		);
		soundLibMock.findByFileName.mockReset();
		soundLibMock.findByFileName.mockReturnValue([]);
		soundLibMock.toFile.mockReset();
		soundLibMock.toFile.mockImplementation((libraryFile) =>
			libraryFile.hash === 'mock-hash-kick' ? kickFile : null
		);

		mockZipInstance.file.mockReset();
		mockZipInstance.file.mockImplementation(function (this: any, name, data, options) {
			return this.real.file(name, data, options);
		});
		mockZipInstance.generateAsync.mockReset();
		mockZipInstance.generateAsync.mockImplementation(function (this: any, options, onUpdate) {
			return this.real.generateAsync(options, onUpdate);
		});
		mockJSZipConstructor.mockReset();
		mockJSZipConstructor.mockImplementation(function () {
			// ponytail: vitest 4+ constructable-mock rule - new JSZip()
			const wrapper = Object.create(mockZipInstance);
			wrapper.real = new realZip.ctor();
			return wrapper;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		global.URL.createObjectURL = originalCreateObjectURL;
		global.URL.revokeObjectURL = originalRevokeObjectURL;
	});

	describe('Rendering', () => {
		it('renders the modal heading when show is true', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			expect(screen.getByText('Export Workspace')).toBeInTheDocument();
		});

		it('does not render the modal when show is false', () => {
			render(ExportWorkspaceModal, { props: { ...defaultProps, show: false } });
			expect(screen.queryByText('Export Workspace')).not.toBeInTheDocument();
		});

		it('lists all workspaces returned by workspaceService', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			expect(screen.getByText('Workspace A')).toBeInTheDocument();
			expect(screen.getByText('Workspace B')).toBeInTheDocument();
		});

		it('shows DTX file count for each workspace', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			const dtxCounts = screen.getAllByText(/2 DTX files/);
			expect(dtxCounts.length).toBeGreaterThanOrEqual(2);
		});

		it('shows audio file count when include audio is checked', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			expect(screen.getAllByText(/1 audio files/).length).toBeGreaterThanOrEqual(1);
		});

		it('renders the include audio files checkbox', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			expect(screen.getByRole('checkbox')).toBeInTheDocument();
		});

		it('renders the Cancel button', () => {
			render(ExportWorkspaceModal, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
		});
	});

	describe('Include audio toggle', () => {
		it('hides audio file count when include audio is unchecked', async () => {
			render(ExportWorkspaceModal, { props: defaultProps });

			const checkbox = screen.getByRole('checkbox');
			await fireEvent.click(checkbox);

			// After unchecking, audio file count should not appear (but "Include audio files" label still shows)
			expect(screen.queryByText(/\d+ audio files/)).not.toBeInTheDocument();
		});
	});

	describe('Cancel button', () => {
		it('calls onClose when Cancel is clicked', async () => {
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { ...defaultProps, onClose } });

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	describe('Export flow', () => {
		it('triggers export when a workspace button is clicked', async () => {
			render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Workspace A');

			await vi.waitFor(() => {
				expect(mockZipInstance.generateAsync).toHaveBeenCalled();
				expect(toastMock.success).toHaveBeenCalled();
			});
		});

		it('adds unique entries, downloads once, reports actual counts, and closes on success', async () => {
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			const { anchorClick } = await clickExport('Workspace A');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});

			const zip = await exportedZip();
			const entryNames = zipEntryNames(zip);
			expect(entryNames).toEqual(['basic.dtx', 'advanced.dtx', 'kick.wav']);
			expect(new Set(entryNames).size).toBe(entryNames.length);
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('mock-hash-kick');
			expect(soundLibMock.findByFileName).not.toHaveBeenCalled();
			expect(await zipEntryBytes(zip, 'kick.wav')).toEqual(
				new Uint8Array(await kickFile.arrayBuffer())
			);
			expect(mockZipInstance.generateAsync).toHaveBeenCalledTimes(1);
			expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
			expect(anchorClick).toHaveBeenCalledTimes(1);
			expect(toastMock.success).toHaveBeenCalledTimes(1);
			expect(toastMock.success).toHaveBeenCalledWith({
				title: 'Workspace "Workspace A" exported successfully! (2 DTX files, 1 audio files)'
			});
			expect(onClose).toHaveBeenCalledTimes(1);
		});

		it('preserves the original filename casing of every ZIP entry on success', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Mixed Case Workspace',
					dtxFiles: [
						{ name: 'BASIC.dtx', content: 'DTX', path: 'Charts/BASIC.dtx' },
						{
							name: 'Advanced.DTX',
							content: 'DTX',
							path: 'Charts/Advanced.DTX'
						}
					],
					audioFiles: [audioFileAt('Charts/Kick.WAV', 'mock-hash-kick')]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Mixed Case Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual([
				'Charts/BASIC.dtx',
				'Charts/Advanced.DTX',
				'Charts/Kick.WAV'
			]);
		});

		it('includes a zero-byte DTX file in the export', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Empty DTX Workspace',
					dtxFiles: [{ name: 'empty.dtx', content: '', path: 'empty.dtx' }],
					audioFiles: []
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Empty DTX Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual(['empty.dtx']);
			expect((await zipEntryBytes(zip, 'empty.dtx')).length).toBe(0);
		});

		it('writes DTX text as Shift-JIS bytes so DTXmania can read it', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Japanese Workspace',
					dtxFiles: [
						{
							name: 'song.dtx',
							content: '#TITLE: 太鼓',
							path: 'song.dtx'
						}
					],
					audioFiles: []
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Japanese Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const entry = mockZipInstance.file.mock.calls.find((call) => call[0] === 'song.dtx');
			expect(entry?.[1]).toBeInstanceOf(Uint8Array);
			expect(new TextDecoder('shift-jis').decode(entry?.[1] as Uint8Array)).toBe(
				'#TITLE: 太鼓'
			);
			const zip = await exportedZip();
			expect(new TextDecoder('shift-jis').decode(await zipEntryBytes(zip, 'song.dtx'))).toBe(
				'#TITLE: 太鼓'
			);
		});

		it('writes DTX text as UTF-8 with a BOM when Shift-JIS cannot represent it', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Unicode Workspace',
					dtxFiles: [
						{
							name: 'song.dtx',
							content: '#TITLE: 🥁 song',
							path: 'song.dtx'
						}
					],
					audioFiles: []
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Unicode Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			const bytes = await zipEntryBytes(zip, 'song.dtx');
			expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
			expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(
				'\uFEFF#TITLE: 🥁 song'
			);
		});

		it('exports DTX files only when audio is unchecked and audio is unavailable', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Missing Audio Workspace',
					audioFiles: [audioFileAt('missing.wav', 'hash-not-stored')]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await fireEvent.click(screen.getByRole('checkbox'));
			await clickExport('Missing Audio Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			expect(soundLibMock.getByHash).not.toHaveBeenCalled();
			expect(mockWorkspaceServiceClass.getLargeFile).not.toHaveBeenCalled();
			expect(mockZipInstance.file).toHaveBeenCalledTimes(2);
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual(['basic.dtx', 'advanced.dtx']);
			expect(toastMock.success).toHaveBeenCalledWith({
				title: 'Workspace "Missing Audio Workspace" exported successfully! (2 DTX files only)'
			});
			expect(onClose).toHaveBeenCalled();
		});

		it('resolves large audio files from the session cache by relative path', async () => {
			const largeFile = new File(['large audio'], 'large.wav', { type: 'audio/wav' });
			mockWorkspaceServiceClass.getLargeFile.mockReturnValue(largeFile);
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Large Workspace',
					audioFiles: [largeAudioFileAt('Song A/large.wav')]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Large Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			expect(mockWorkspaceServiceClass.getLargeFile).toHaveBeenCalledWith(
				'Large Workspace',
				'Song A/large.wav'
			);
			const zip = await exportedZip();
			expect(await zipEntryBytes(zip, 'Song A/large.wav')).toEqual(
				new Uint8Array(await largeFile.arrayBuffer())
			);
		});

		it('exports the selected workspace audio when another workspace reuses the file name', async () => {
			const recordA = libraryRecord('hash-kick-a', 'kick.wav');
			const fileA = new File(['workspace A kick bytes'], 'kick.wav');
			const recordB = libraryRecord('hash-kick-b', 'kick.wav');
			const fileB = new File(['workspace B kick bytes'], 'kick.wav');
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Workspace A',
					audioFiles: [audioFileAt('kick.wav', 'hash-kick-a')]
				}),
				makeWorkspace({
					name: 'Workspace B',
					audioFiles: [audioFileAt('kick.wav', 'hash-kick-b')]
				})
			]);
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash === 'hash-kick-a' ? recordA : hash === 'hash-kick-b' ? recordB : null
			);
			soundLibMock.toFile.mockImplementation((libraryFile) =>
				libraryFile === recordA ? fileA : libraryFile === recordB ? fileB : null
			);
			soundLibMock.findByFileName.mockReturnValue([recordB]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Workspace A');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('hash-kick-a');
			expect(soundLibMock.findByFileName).not.toHaveBeenCalled();
			const zip = await exportedZip();
			const kickBytes = await zipEntryBytes(zip, 'kick.wav');
			expect(kickBytes).toEqual(new Uint8Array(await fileA.arrayBuffer()));
			expect(kickBytes).not.toEqual(new Uint8Array(await fileB.arrayBuffer()));
		});

		it('fails with the no-files error when the workspace has no files to export', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({ name: 'Empty Workspace', dtxFiles: [], audioFiles: [] })
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Empty Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('No files found in workspace to export');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('surfaces a ZIP generation failure without downloading', async () => {
			mockZipInstance.generateAsync.mockRejectedValueOnce(new Error('zip failed'));
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Workspace A');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('zip failed');
			expect(mockZipInstance.generateAsync).toHaveBeenCalledTimes(1);
			expect(toastMock.error).toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});
	});

	describe('Relative paths in the ZIP', () => {
		const packBytes: Record<string, string> = {
			'hash-kick-a': 'A-audio-bytes',
			'hash-cymbal': 'cymbal-bytes',
			'hash-kick-b': 'B-audio-bytes'
		};

		const songPackWorkspace = () =>
			makeWorkspace({
				name: 'Pack',
				dtxFiles: [
					{
						name: 'mas.dtx',
						content: '#WAV01: kick.wav\n#WAV02: drums\\cymbal.wav',
						path: 'Song A/mas.dtx'
					},
					{
						name: 'mas.dtx',
						content: '#WAV01: kick.wav',
						path: 'Song B/mas.dtx'
					}
				],
				audioFiles: [
					audioFileAt('Song A/kick.wav', 'hash-kick-a'),
					audioFileAt('Song A/drums/cymbal.wav', 'hash-cymbal'),
					audioFileAt('Song B/kick.wav', 'hash-kick-b')
				]
			});

		const mockPackLibrary = () => {
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash in packBytes ? libraryRecord(hash, `${hash}.wav`) : null
			);
			soundLibMock.toFile.mockImplementation((libraryFile) =>
				libraryFile.hash in packBytes
					? new File([packBytes[libraryFile.hash]], libraryFile.fileName)
					: null
			);
		};

		it('mirrors the imported folder hierarchy with each file at its relative path', async () => {
			mockService.getWorkspaces.mockReturnValue([songPackWorkspace()]);
			mockPackLibrary();

			render(ExportWorkspaceModal, { props: defaultProps });
			const { anchorClick } = await clickExport('Pack');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual([
				'Song A/mas.dtx',
				'Song B/mas.dtx',
				'Song A/kick.wav',
				'Song A/drums/cymbal.wav',
				'Song B/kick.wav'
			]);
			expect(
				new TextDecoder('shift-jis').decode(await zipEntryBytes(zip, 'Song A/mas.dtx'))
			).toBe('#WAV01: kick.wav\n#WAV02: drums\\cymbal.wav');
			expect(new TextDecoder().decode(await zipEntryBytes(zip, 'Song B/mas.dtx'))).toBe(
				'#WAV01: kick.wav'
			);
			expect(new TextDecoder().decode(await zipEntryBytes(zip, 'Song A/kick.wav'))).toBe(
				'A-audio-bytes'
			);
			expect(new TextDecoder().decode(await zipEntryBytes(zip, 'Song B/kick.wav'))).toBe(
				'B-audio-bytes'
			);
			expect(
				new TextDecoder().decode(await zipEntryBytes(zip, 'Song A/drums/cymbal.wav'))
			).toBe('cymbal-bytes');
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('hash-kick-a');
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('hash-cymbal');
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('hash-kick-b');
			expect(anchorClick).toHaveBeenCalledTimes(1);
		});

		it('writes a DTX-only song pack with nested chart paths', async () => {
			mockService.getWorkspaces.mockReturnValue([songPackWorkspace()]);
			mockPackLibrary();

			render(ExportWorkspaceModal, { props: defaultProps });
			await fireEvent.click(screen.getByRole('checkbox'));
			await clickExport('Pack');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual(['Song A/mas.dtx', 'Song B/mas.dtx']);
			expect(soundLibMock.getByHash).not.toHaveBeenCalled();
		});

		it('preserves original casing and normalization in non-colliding entry names', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Verbatim Workspace',
					dtxFiles: [],
					audioFiles: [
						audioFileAt('Drums/SNARE.WAV', 'hash-snare'),
						audioFileAt('perc/snare.wav', 'hash-snare-lower'),
						audioFileAt(`${NFC_CAFE}/kick.wav`, 'hash-nfc'),
						audioFileAt(`${NFD_CAFE} B/cymbal.wav`, 'hash-nfd')
					]
				})
			]);
			const bytes: Record<string, string> = {
				'hash-nfc': 'nfc bytes',
				'hash-nfd': 'nfd bytes',
				'hash-snare': 'upper bytes',
				'hash-snare-lower': 'lower bytes'
			};
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash in bytes ? libraryRecord(hash, `${hash}.wav`) : null
			);
			soundLibMock.toFile.mockImplementation((libraryFile) =>
				libraryFile.hash in bytes
					? new File([bytes[libraryFile.hash]], libraryFile.fileName)
					: null
			);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Verbatim Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const zip = await exportedZip();
			expect(zipEntryNames(zip)).toEqual([
				'Drums/SNARE.WAV',
				'perc/snare.wav',
				`${NFC_CAFE}/kick.wav`,
				`${NFD_CAFE} B/cymbal.wav`
			]);
			expect(new TextDecoder().decode(await zipEntryBytes(zip, 'Drums/SNARE.WAV'))).toBe(
				'upper bytes'
			);
			expect(new TextDecoder().decode(await zipEntryBytes(zip, 'perc/snare.wav'))).toBe(
				'lower bytes'
			);
		});
	});

	describe('Export integrity failures', () => {
		it('fails when a small audio record has no content hash', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Legacy Workspace',
					audioFiles: [{ name: 'kick.wav', path: 'Song A/kick.wav', isLarge: false }]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Legacy Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/Song A\/kick\.wav/);
			expect(alert.textContent).toMatch(/re-import/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when the audio hash matches no stored library record', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Missing Audio Workspace',
					audioFiles: [audioFileAt('Song A/snare.wav', 'hash-not-stored')]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Missing Audio Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/Song A\/snare\.wav/);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when stored audio bytes cannot be converted back to a file', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Undecodable Workspace',
					audioFiles: [audioFileAt('Song A/hat.wav', 'hash-hat')]
				})
			]);
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash === 'hash-hat' ? libraryRecord('hash-hat', 'hat.wav') : null
			);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Undecodable Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/Song A\/hat\.wav/);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails with recovery guidance when a large audio file is no longer cached', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Reloaded Workspace',
					audioFiles: [largeAudioFileAt('Song A/bgm.ogg')]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Reloaded Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/Song A\/bgm\.ogg/);
			expect(alert.textContent).toMatch(/uncheck/i);
			expect(alert.textContent).toMatch(/newly imported copy/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two DTX files share a case-insensitive full path', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Duplicate DTX Workspace',
					dtxFiles: [
						{ name: 'Chart.dtx', content: 'first', path: 'Songs/a/Chart.dtx' },
						{ name: 'chart.DTX', content: 'second', path: 'songs/A/chart.DTX' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Duplicate DTX Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain(
				'songs/A/chart.DTX conflicts with Songs/a/Chart.dtx'
			);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two files share an identical full path', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Identical Path Workspace',
					dtxFiles: [
						{ name: 'mas.dtx', content: 'first', path: 'Song A/mas.dtx' },
						{ name: 'mas.dtx', content: 'second', path: 'Song A/mas.dtx' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Identical Path Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('Song A/mas.dtx conflicts with Song A/mas.dtx');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two paths collide only after Unicode normalization', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'NFC Collision Workspace',
					dtxFiles: [
						{ name: 'chart.dtx', content: 'first', path: `${NFC_CAFE}/chart.dtx` },
						{ name: 'CHART.DTX', content: 'second', path: `${NFD_CAFE}/CHART.DTX` }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('NFC Collision Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain(
				`${NFD_CAFE}/CHART.DTX conflicts with ${NFC_CAFE}/chart.dtx`
			);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('advises re-importing the renamed files for name collisions', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Collision Recovery Workspace',
					dtxFiles: [
						{ name: 'Chart.dtx', content: 'first', path: 'a/Chart.dtx' },
						{ name: 'chart.DTX', content: 'second', path: 'A/chart.DTX' }
					],
					audioFiles: []
				})
			]);
			render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Collision Recovery Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/chart\.dtx/i);
			expect(alert.textContent).toMatch(/rename/i);
			expect(alert.textContent).toMatch(/re-import/i);
			expect(alert.textContent).toMatch(/newly imported copy/i);
		});

		it('fails when two audio files share a case-insensitive full path', async () => {
			const upperRecord = libraryRecord('hash-bgm-upper', 'BGM.ogg');
			const lowerRecord = libraryRecord('hash-bgm-lower', 'bgm.ogg');
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Case Collision Workspace',
					audioFiles: [
						audioFileAt('dir/BGM.ogg', 'hash-bgm-upper'),
						audioFileAt('DIR/bgm.ogg', 'hash-bgm-lower')
					]
				})
			]);
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash === 'hash-bgm-upper'
					? upperRecord
					: hash === 'hash-bgm-lower'
						? lowerRecord
						: null
			);
			soundLibMock.toFile.mockImplementation((libraryFile) =>
				libraryFile === upperRecord
					? new File(['upper'], 'BGM.ogg')
					: libraryFile === lowerRecord
						? new File(['lower'], 'bgm.ogg')
						: null
			);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Case Collision Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('DIR/bgm.ogg conflicts with dir/BGM.ogg');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when a DTX file and an audio file share a case-insensitive full path', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Cross Collision Workspace',
					dtxFiles: [{ name: 'chart.dtx', content: 'dtx', path: 'a/chart.dtx' }],
					audioFiles: [audioFileAt('A/CHART.DTX', 'hash-chart-audio')]
				})
			]);
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash === 'hash-chart-audio' ? libraryRecord('hash-chart-audio', 'CHART.DTX') : null
			);
			soundLibMock.toFile.mockImplementation((libraryFile) =>
				libraryFile.hash === 'hash-chart-audio' ? new File(['audio'], 'CHART.DTX') : null
			);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Cross Collision Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('A/CHART.DTX conflicts with a/chart.dtx');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two paths differ only by leading or trailing space/dot padding', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Padded Name Workspace',
					dtxFiles: [
						{ name: 'chart.dtx', content: 'first', path: 'a/chart.dtx' },
						{ name: 'chart.dtx', content: 'second', path: 'a/ chart.dtx' },
						{ name: 'other.dtx', content: 'third', path: 'c/other.dtx ' },
						{ name: 'other.dtx', content: 'fourth', path: 'c./other.dtx' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Padded Name Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/chart\.dtx/i);
			expect(alert.textContent).toMatch(/other\.dtx/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when a file claims a path already used as a directory prefix', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Dir Prefix Workspace',
					dtxFiles: [
						{ name: 'kick.wav', content: 'nested', path: 'samples.wav/kick.wav' },
						{ name: 'Samples.wav', content: 'flat', path: 'Samples.wav' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Dir Prefix Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('Samples.wav conflicts with samples.wav/kick.wav');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when a nested path claims a prefix already used by a file', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'File Prefix Workspace',
					dtxFiles: [
						{ name: 'Samples.wav', content: 'flat', path: 'Samples.wav' },
						{ name: 'kick.wav', content: 'nested', path: 'samples.wav/kick.wav' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('File Prefix Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toContain('samples.wav/kick.wav conflicts with Samples.wav');
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails and names the file when an audio entry cannot be read', async () => {
			const unreadableFile = new File(['bytes'], 'lost.wav', { type: 'audio/wav' });
			vi.spyOn(unreadableFile, 'arrayBuffer').mockRejectedValue(
				new Error('NotReadableError')
			);
			mockWorkspaceServiceClass.getLargeFile.mockReturnValue(unreadableFile);
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Unreadable Workspace',
					audioFiles: [largeAudioFileAt('Song A/lost.wav')]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Unreadable Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(/Song A\/lost\.wav/);
			expect(alert.textContent).toMatch(/failed to read/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});
	});

	describe('Export error display', () => {
		it('keeps the inline error until the next export attempt and has no auto-clear timer', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Retry Workspace',
					audioFiles: [audioFileAt('lost.wav', 'hash-lost')]
				})
			]);
			render(ExportWorkspaceModal, { props: defaultProps });

			vi.useFakeTimers();
			try {
				await clickExport('Retry Workspace');
				await vi.waitFor(() => {
					expect(screen.getByRole('alert').textContent).toMatch(/lost\.wav/);
				});

				await vi.advanceTimersByTimeAsync(11_000);
				expect(screen.getByRole('alert').textContent).toMatch(/lost\.wav/);

				soundLibMock.getByHash.mockImplementation((hash) =>
					hash === 'hash-lost' ? libraryRecord('hash-lost', 'lost.wav') : null
				);
				soundLibMock.toFile.mockImplementation((libraryFile) =>
					libraryFile.hash === 'hash-lost' ? new File(['lost bytes'], 'lost.wav') : null
				);
				let resolveZip: (blob: Blob) => void = () => undefined;
				const pendingZip = new Promise<Blob>((resolve) => {
					resolveZip = resolve;
				});
				mockZipInstance.generateAsync.mockImplementation(() => pendingZip);

				await clickExport('Retry Workspace');
				expect(screen.queryByRole('alert')).toBeNull();
				expect(toastMock.success).not.toHaveBeenCalled();

				resolveZip(new Blob(['zip content']));
				await vi.advanceTimersByTimeAsync(0);
				expect(toastMock.success).toHaveBeenCalled();
				expect(screen.queryByRole('alert')).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});

		it('clears the inline error when the modal is closed and reopened', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Retry Workspace',
					audioFiles: [audioFileAt('lost.wav', 'hash-lost')]
				})
			]);
			const { rerender } = render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Retry Workspace');
			await screen.findByRole('alert');

			await rerender({ show: false, onClose: defaultProps.onClose });
			await rerender({ show: true, onClose: defaultProps.onClose });

			expect(screen.queryByRole('alert')).toBeNull();
		});

		it('renders multi-item errors inside a whitespace-pre-line alert', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Missing Audio Workspace',
					audioFiles: [audioFileAt('a.wav', 'hash-a'), audioFileAt('b.wav', 'hash-b')]
				})
			]);
			render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Missing Audio Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert.classList.contains('whitespace-pre-line')).toBe(true);
			expect(alert.textContent).toMatch(/a\.wav/);
			expect(alert.textContent).toMatch(/b\.wav/);
			expect(alert.textContent).toContain('\n');
			const workspaceButton = screen.getByRole('button', {
				name: /Missing Audio Workspace/
			});
			expect(alert.compareDocumentPosition(workspaceButton)).toBe(
				Node.DOCUMENT_POSITION_FOLLOWING
			);
		});
	});

	describe('JSZip archive isolation', () => {
		it('keeps archives independent across two constructed wrappers', async () => {
			const zipA = new JSZip();
			const zipB = new JSZip();
			expect(zipA).not.toBe(zipB);

			zipA.file('kick.wav', 'A-audio-bytes');
			zipB.file('kick.wav', 'B-audio-bytes');

			const blobA = (await zipA.generateAsync({ type: 'blob' })) as Blob;
			const blobB = (await zipB.generateAsync({ type: 'blob' })) as Blob;
			const archiveA = await JSZip.loadAsync(await blobA.arrayBuffer());
			const archiveB = await JSZip.loadAsync(await blobB.arrayBuffer());

			expect(new TextDecoder().decode(await zipEntryBytes(archiveA, 'kick.wav'))).toBe(
				'A-audio-bytes'
			);
			expect(new TextDecoder().decode(await zipEntryBytes(archiveB, 'kick.wav'))).toBe(
				'B-audio-bytes'
			);
		});
	});
});
