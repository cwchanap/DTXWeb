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
	});
});
