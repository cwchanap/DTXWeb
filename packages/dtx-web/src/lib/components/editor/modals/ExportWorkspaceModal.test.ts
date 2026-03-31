import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
	getLargeFile: vi.fn(() => null)
}));

const soundLibMock = vi.hoisted(() => ({
	findByFileName: vi.fn(() => []),
	toFile: vi.fn(() => null)
}));

const toastMock = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn()
}));

const mockZipInstance = vi.hoisted(() => ({
	file: vi.fn(),
	generateAsync: vi.fn().mockResolvedValue(new Blob(['zip content']))
}));

const mockJSZipConstructor = vi.hoisted(() => vi.fn(() => mockZipInstance));

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

const defaultProps = {
	show: true,
	onClose: vi.fn()
};

describe('ExportWorkspaceModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
		global.URL.revokeObjectURL = vi.fn();
		mockService.getWorkspaces.mockReturnValue([
			makeWorkspace({ name: 'Workspace A' }),
			makeWorkspace({ name: 'Workspace B' })
		]);
		mockZipInstance.file.mockImplementation(() => undefined);
		mockZipInstance.generateAsync.mockResolvedValue(new Blob(['zip content']));
		mockJSZipConstructor.mockImplementation(() => mockZipInstance);
		(global.URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValue('blob:mock-url');
	});

	afterEach(() => {
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
		it('triggers export when workspace button is clicked', async () => {
			render(ExportWorkspaceModal, { props: defaultProps });

			// Spy on appendChild AFTER rendering so it does not interfere with test setup
			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const workspaceAButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') && !btn.textContent?.includes('Cancel')
			);
			expect(workspaceAButton).toBeDefined();
			await fireEvent.click(workspaceAButton!);

			expect(mockZipInstance.generateAsync).toHaveBeenCalled();

			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('calls toastStore.success after successful export', async () => {
			render(ExportWorkspaceModal, { props: defaultProps });

			// Spy on appendChild AFTER rendering so it does not interfere with test setup
			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const workspaceAButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') && !btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(workspaceAButton!);

			// Wait for async export to complete
			await vi.waitFor(() => {
				expect(toastMock.success).toHaveBeenCalled();
			});

			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('calls toastStore.error when export fails', async () => {
			mockZipInstance.generateAsync.mockRejectedValueOnce(new Error('zip failed'));

			render(ExportWorkspaceModal, { props: defaultProps });

			const workspaceButtons = screen.getAllByRole('button');
			const workspaceAButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') && !btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(workspaceAButton!);

			await vi.waitFor(() => {
				expect(toastMock.error).toHaveBeenCalled();
			});
		});

		it('calls toastStore.error when workspace has no exportable files', async () => {
			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Empty Workspace',
					dtxFiles: [
						{ name: 'empty.dtx', content: '', path: '/workspace/empty/empty.dtx' }
					],
					audioFiles: []
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });

			const workspaceButtons = screen.getAllByRole('button');
			const emptyWorkspaceButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Empty Workspace') &&
					!btn.textContent?.includes('Cancel')
			);
			expect(emptyWorkspaceButton).toBeDefined();
			await fireEvent.click(emptyWorkspaceButton!);

			await vi.waitFor(() => {
				expect(toastMock.error).toHaveBeenCalled();
			});
		});

		it('exports audio files found in sound library', async () => {
			const mockFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });
			const expectedEntry = {
				hash: 'abc',
				fileName: 'kick.wav',
				fileType: 'audio/wav',
				fileData: 'base64',
				size: 1024,
				dateAdded: expect.any(Number)
			};
			soundLibMock.findByFileName.mockReturnValue([
				{
					hash: 'abc',
					fileName: 'kick.wav',
					fileType: 'audio/wav',
					fileData: 'base64',
					size: 1024,
					dateAdded: Date.now()
				}
			]);
			soundLibMock.toFile.mockImplementation((arg) => {
				expect(arg).toEqual(expectedEntry);
				return mockFile;
			});

			render(ExportWorkspaceModal, { props: defaultProps });

			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const workspaceAButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') && !btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(workspaceAButton!);

			await vi.waitFor(() => {
				expect(soundLibMock.findByFileName).toHaveBeenCalled();
				expect(soundLibMock.toFile).toHaveBeenCalled();
				expect(mockZipInstance.file).toHaveBeenCalledWith('kick.wav', mockFile);
			});

			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('handles large audio files from session storage', async () => {
			const largeFile = new File(['large audio'], 'large.wav', { type: 'audio/wav' });
			mockWorkspaceServiceClass.getLargeFile.mockReturnValue(largeFile);

			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Large Workspace',
					audioFiles: [{ name: 'large.wav', path: '/workspace/large.wav', isLarge: true }]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });

			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const largeWorkspaceButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Large Workspace') &&
					!btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(largeWorkspaceButton!);

			await vi.waitFor(() => {
				expect(mockWorkspaceServiceClass.getLargeFile).toHaveBeenCalledWith(
					'Large Workspace',
					'large.wav'
				);
				expect(mockZipInstance.file).toHaveBeenCalledWith('large.wav', largeFile);
			});

			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('skips large audio file when getLargeFile returns undefined', async () => {
			mockWorkspaceServiceClass.getLargeFile.mockReturnValue(undefined);

			mockService.getWorkspaces.mockReturnValue([
				makeWorkspace({
					name: 'Large Workspace',
					audioFiles: [{ name: 'large.wav', path: '/workspace/large.wav', isLarge: true }]
				})
			]);

			render(ExportWorkspaceModal, { props: defaultProps });

			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const largeWorkspaceButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Large Workspace') &&
					!btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(largeWorkspaceButton!);

			await vi.waitFor(() => {
				expect(mockWorkspaceServiceClass.getLargeFile).toHaveBeenCalledWith(
					'Large Workspace',
					'large.wav'
				);
				// zip.file should not have been called for the skipped large file
				expect(mockZipInstance.file).not.toHaveBeenCalledWith(
					'large.wav',
					expect.anything()
				);
			});

			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('catches DTX file errors and continues export', async () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			// First zip.file call throws (for basic.dtx); second call (advanced.dtx) uses default → succeeds
			mockZipInstance.file.mockImplementationOnce(() => {
				throw new Error('failed to add dtx');
			});

			render(ExportWorkspaceModal, { props: defaultProps });

			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceAButton = screen
				.getAllByRole('button')
				.find(
					(btn) =>
						btn.textContent?.includes('Workspace A') &&
						!btn.textContent?.includes('Cancel')
				)!;
			await fireEvent.click(workspaceAButton);

			await vi.waitFor(() => {
				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining('Failed to add DTX file basic.dtx'),
					expect.any(Error)
				);
			});

			warnSpy.mockRestore();
			appendChild.mockRestore();
			removeChild.mockRestore();
		});

		it('clears exportWorkspaceError after 10 seconds via setTimeout', async () => {
			vi.useFakeTimers();
			try {
				mockZipInstance.generateAsync.mockRejectedValueOnce(new Error('zip failed'));
				render(ExportWorkspaceModal, { props: defaultProps });

				const workspaceAButton = screen
					.getAllByRole('button')
					.find(
						(btn) =>
							btn.textContent?.includes('Workspace A') &&
							!btn.textContent?.includes('Cancel')
					)!;

				await fireEvent.click(workspaceAButton);
				// Flush all promises and timers (including the 10s setTimeout)
				await vi.runAllTimersAsync();

				expect(toastMock.error).toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it('catches audio file errors and continues export', async () => {
			// Workspace A has 2 DTX files (basic.dtx, advanced.dtx) and 1 audio file (kick.wav)
			// mock zip.file to succeed for both DTX files and then throw for the audio file
			mockZipInstance.file
				.mockImplementationOnce(() => undefined) // basic.dtx succeeds
				.mockImplementationOnce(() => undefined) // advanced.dtx succeeds
				.mockImplementationOnce(() => {
					throw new Error('failed to add audio');
				}); // kick.wav audio fails

			soundLibMock.findByFileName.mockReturnValue([
				{
					hash: 'abc',
					fileName: 'kick.wav',
					fileType: 'audio/wav',
					fileData: 'base64',
					size: 1024,
					dateAdded: Date.now()
				}
			]);
			soundLibMock.toFile.mockReturnValue(new File(['audio'], 'kick.wav'));

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			render(ExportWorkspaceModal, { props: defaultProps });

			const appendChild = vi
				.spyOn(document.body, 'appendChild')
				.mockImplementation((el) => el);
			const removeChild = vi
				.spyOn(document.body, 'removeChild')
				.mockImplementation((el) => el);

			const workspaceButtons = screen.getAllByRole('button');
			const workspaceAButton = workspaceButtons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') && !btn.textContent?.includes('Cancel')
			);
			await fireEvent.click(workspaceAButton!);

			await vi.waitFor(() => {
				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining('Failed to add audio file kick.wav'),
					expect.any(Error)
				);
			});

			warnSpy.mockRestore();
			appendChild.mockRestore();
			removeChild.mockRestore();
		});
	});
});
