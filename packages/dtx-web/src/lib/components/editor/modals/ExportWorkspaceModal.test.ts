import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
	generateAsync: vi.fn().mockResolvedValue(new Blob(['zip content']))
}));

const mockJSZipConstructor = vi.hoisted(() =>
	// ponytail: vitest 4+ constructable-mock rule — `new JSZip()`
	vi.fn(function (this: unknown) {
		Object.assign(this, mockZipInstance);
	})
);

vi.mock('$lib/services/workspaceService', () => ({
	workspaceService: mockService,
	WorkspaceService: mockWorkspaceServiceClass
}));

vi.mock('$lib/services/soundLibrary', () => ({
	SoundLibrary: soundLibMock
}));

vi.mock('$lib/toaster', () => ({ default: toastMock }));

vi.mock('jszip', () => ({ default: mockJSZipConstructor }));

import ExportWorkspaceModal from './ExportWorkspaceModal.svelte';

const libraryRecord = (hash: string, fileName: string): SoundLibraryFile => ({
	hash,
	fileName,
	fileType: 'audio/wav',
	fileData: 'bW9jay1hdWRpby1ieXRlcw==',
	size: 16,
	dateAdded: 0
});

const smallAudioFile = (name: string, hash?: string) => ({
	name,
	path: `/workspace/test/${name}`,
	isLarge: false,
	hash
});

const kickLibraryRecord = libraryRecord('mock-hash-kick', 'kick.wav');
const kickFile = new File(['kick audio bytes'], 'kick.wav', { type: 'audio/wav' });

const defaultProps = {
	show: true,
	onClose: vi.fn()
};

const clickExport = async (workspaceName: string) => {
	// Spy on appendChild AFTER rendering so it does not interfere with test setup
	const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el);
	const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);
	const workspaceButton = screen
		.getAllByRole('button')
		.find(
			(btn) =>
				btn.textContent?.includes(workspaceName) && !btn.textContent?.includes('Cancel')
		);
	expect(workspaceButton).toBeDefined();
	await fireEvent.click(workspaceButton!);
	return { appendChild, removeChild };
};

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
		mockZipInstance.file.mockImplementation(() => undefined);
		mockZipInstance.generateAsync.mockReset();
		mockZipInstance.generateAsync.mockResolvedValue(new Blob(['zip content']));
		mockJSZipConstructor.mockReset();
		mockJSZipConstructor.mockImplementation(function () {
			// ponytail: vitest 4+ constructable-mock rule - new JSZip()
			return mockZipInstance;
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
			});
		});

		it('adds unique entries, downloads once, reports actual counts, and closes on success', async () => {
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Workspace A');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});

			const entryNames = mockZipInstance.file.mock.calls.map((call) => call[0]);
			expect(entryNames).toEqual(['basic.dtx', 'advanced.dtx', 'kick.wav']);
			expect(new Set(entryNames).size).toBe(entryNames.length);
			expect(soundLibMock.getByHash).toHaveBeenCalledWith('mock-hash-kick');
			expect(soundLibMock.findByFileName).not.toHaveBeenCalled();
			expect(mockZipInstance.file).toHaveBeenCalledWith('kick.wav', kickFile);
			expect(mockZipInstance.generateAsync).toHaveBeenCalledTimes(1);
			expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
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
						{ name: 'BASIC.dtx', content: 'DTX', path: '/workspace/test/BASIC.dtx' },
						{
							name: 'Advanced.DTX',
							content: 'DTX',
							path: '/workspace/test/Advanced.DTX'
						}
					],
					audioFiles: [smallAudioFile('Kick.WAV', 'mock-hash-kick')]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Mixed Case Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			const entryNames = mockZipInstance.file.mock.calls.map((call) => call[0]);
			expect(entryNames).toEqual(['BASIC.dtx', 'Advanced.DTX', 'Kick.WAV']);
		});

		it('includes a zero-byte DTX file in the export', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Empty DTX Workspace',
					dtxFiles: [
						{ name: 'empty.dtx', content: '', path: '/workspace/test/empty.dtx' }
					],
					audioFiles: []
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Empty DTX Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			expect(mockZipInstance.file).toHaveBeenCalledWith('empty.dtx', '');
		});

		it('exports DTX files only when audio is unchecked and audio is unavailable', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Missing Audio Workspace',
					audioFiles: [smallAudioFile('missing.wav', 'hash-not-stored')]
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
			expect(toastMock.success).toHaveBeenCalledWith({
				title: 'Workspace "Missing Audio Workspace" exported successfully! (2 DTX files only)'
			});
			expect(onClose).toHaveBeenCalled();
		});

		it('resolves large audio files from the session cache', async () => {
			const largeFile = new File(['large audio'], 'large.wav', { type: 'audio/wav' });
			mockWorkspaceServiceClass.getLargeFile.mockReturnValue(largeFile);
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Large Workspace',
					audioFiles: [{ name: 'large.wav', path: '/workspace/large.wav', isLarge: true }]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });
			await clickExport('Large Workspace');

			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});
			expect(mockWorkspaceServiceClass.getLargeFile).toHaveBeenCalledWith(
				'Large Workspace',
				'large.wav'
			);
			expect(mockZipInstance.file).toHaveBeenCalledWith('large.wav', largeFile);
		});

		it('exports the selected workspace audio when another workspace reuses the file name', async () => {
			const recordA = libraryRecord('hash-kick-a', 'kick.wav');
			const fileA = new File(['workspace A kick bytes'], 'kick.wav');
			const recordB = libraryRecord('hash-kick-b', 'kick.wav');
			const fileB = new File(['workspace B kick bytes'], 'kick.wav');
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Workspace A',
					audioFiles: [smallAudioFile('kick.wav', 'hash-kick-a')]
				}),
				makeWorkspace({
					name: 'Workspace B',
					audioFiles: [smallAudioFile('kick.wav', 'hash-kick-b')]
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
			expect(mockZipInstance.file).toHaveBeenCalledWith('kick.wav', fileA);
			const kickEntry = mockZipInstance.file.mock.calls.find(
				(call) => call[0] === 'kick.wav'
			);
			expect(kickEntry?.[1]).toBe(fileA);
			expect(kickEntry?.[1]).not.toBe(fileB);
		});

		it('fails with the no-files error when the workspace has no files to export', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({ name: 'Empty Workspace', dtxFiles: [], audioFiles: [] })
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Empty Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent('No files found in workspace to export');
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
			expect(alert).toHaveTextContent('zip failed');
			expect(mockZipInstance.generateAsync).toHaveBeenCalledTimes(1);
			expect(toastMock.error).toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});
	});

	describe('Export integrity failures', () => {
		it('fails when a small audio record has no content hash', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Legacy Workspace',
					audioFiles: [
						{ name: 'kick.wav', path: '/workspace/test/kick.wav', isLarge: false }
					]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Legacy Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/kick\.wav/);
			expect(alert).toHaveTextContent(/re-import/i);
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
					audioFiles: [smallAudioFile('snare.wav', 'hash-not-stored')]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Missing Audio Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/snare\.wav/);
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
					audioFiles: [smallAudioFile('hat.wav', 'hash-hat')]
				})
			]);
			soundLibMock.getByHash.mockImplementation((hash) =>
				hash === 'hash-hat' ? libraryRecord('hash-hat', 'hat.wav') : null
			);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Undecodable Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/hat\.wav/);
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
					audioFiles: [{ name: 'bgm.ogg', path: '/workspace/bgm.ogg', isLarge: true }]
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Reloaded Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/bgm\.ogg/);
			expect(alert).toHaveTextContent(/uncheck/i);
			expect(alert).toHaveTextContent(/newly imported copy/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two DTX files share a case-insensitive ZIP name', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Duplicate DTX Workspace',
					dtxFiles: [
						{ name: 'Chart.dtx', content: 'first', path: '/workspace/a/Chart.dtx' },
						{ name: 'chart.DTX', content: 'second', path: '/workspace/b/chart.DTX' }
					],
					audioFiles: []
				})
			]);
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Duplicate DTX Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/chart\.dtx/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when two audio files share a case-insensitive ZIP name', async () => {
			const upperRecord = libraryRecord('hash-bgm-upper', 'BGM.ogg');
			const lowerRecord = libraryRecord('hash-bgm-lower', 'bgm.ogg');
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Case Collision Workspace',
					audioFiles: [
						smallAudioFile('BGM.ogg', 'hash-bgm-upper'),
						smallAudioFile('bgm.ogg', 'hash-bgm-lower')
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
			expect(alert).toHaveTextContent(/bgm\.ogg/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails when a DTX file and an audio file share a case-insensitive ZIP name', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Cross Collision Workspace',
					dtxFiles: [{ name: 'chart.dtx', content: 'dtx', path: '/workspace/chart.dtx' }],
					audioFiles: [smallAudioFile('CHART.DTX', 'hash-chart-audio')]
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
			expect(alert).toHaveTextContent(/chart\.dtx/i);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails and names the file when a DTX entry cannot be added to the ZIP', async () => {
			mockZipInstance.file.mockImplementation((name: string) => {
				if (name === 'basic.dtx') {
					throw new Error('add failed');
				}
			});
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Workspace A');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/basic\.dtx/);
			expect(toastMock.error).toHaveBeenCalled();
			expect(mockZipInstance.generateAsync).not.toHaveBeenCalled();
			expect(global.URL.createObjectURL).not.toHaveBeenCalled();
			expect(toastMock.success).not.toHaveBeenCalled();
			expect(onClose).not.toHaveBeenCalled();
		});

		it('fails and names the file when an audio entry cannot be added to the ZIP', async () => {
			mockZipInstance.file.mockImplementation((name: string) => {
				if (name === 'kick.wav') {
					throw new Error('add failed');
				}
			});
			const onClose = vi.fn();
			render(ExportWorkspaceModal, { props: { show: true, onClose } });

			await clickExport('Workspace A');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveTextContent(/kick\.wav/);
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
					audioFiles: [smallAudioFile('lost.wav', 'hash-lost')]
				})
			]);
			render(ExportWorkspaceModal, { props: defaultProps });

			vi.useFakeTimers();
			try {
				await clickExport('Retry Workspace');
				await vi.waitFor(() => {
					expect(screen.getByRole('alert')).toHaveTextContent(/lost\.wav/);
				});

				await vi.advanceTimersByTimeAsync(11_000);
				expect(screen.getByRole('alert')).toHaveTextContent(/lost\.wav/);

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
				expect(screen.queryByRole('alert')).not.toBeInTheDocument();
				expect(toastMock.success).not.toHaveBeenCalled();

				resolveZip(new Blob(['zip content']));
				await vi.advanceTimersByTimeAsync(0);
				expect(toastMock.success).toHaveBeenCalled();
				expect(screen.queryByRole('alert')).not.toBeInTheDocument();
			} finally {
				vi.useRealTimers();
			}
		});

		it('clears the inline error when the modal is closed and reopened', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Retry Workspace',
					audioFiles: [smallAudioFile('lost.wav', 'hash-lost')]
				})
			]);
			const { rerender } = render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Retry Workspace');
			await screen.findByRole('alert');

			await rerender({ show: false, onClose: defaultProps.onClose });
			await rerender({ show: true, onClose: defaultProps.onClose });

			expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		});

		it('renders multi-item errors inside a whitespace-pre-line alert', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Missing Audio Workspace',
					audioFiles: [
						smallAudioFile('a.wav', 'hash-a'),
						smallAudioFile('b.wav', 'hash-b')
					]
				})
			]);
			render(ExportWorkspaceModal, { props: defaultProps });

			await clickExport('Missing Audio Workspace');

			const alert = await screen.findByRole('alert');
			expect(alert).toHaveClass('whitespace-pre-line');
			expect(alert).toHaveTextContent(/a\.wav/);
			expect(alert).toHaveTextContent(/b\.wav/);
		});
	});
});
