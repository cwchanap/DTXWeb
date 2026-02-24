import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ModalStub from '../../../../tests/stubs/ModalStub.svelte';
import { makeWorkspace } from '../../../../tests/mocks/services';

const mockService = vi.hoisted(() => ({
	getWorkspaces: vi.fn(() => [
		makeWorkspace({ name: 'Workspace A' }),
		makeWorkspace({ name: 'Workspace B' })
	]),
	getCurrentWorkspace: vi.fn(() => makeWorkspace({ name: 'Workspace A' })),
	setCurrentWorkspace: vi.fn(),
	deleteWorkspace: vi.fn()
}));

vi.mock('$lib/services/workspaceService', () => ({
	workspaceService: mockService
}));

vi.mock('@dtx/ui-components/components', () => ({
	Modal: ModalStub
}));

import WorkspaceManagerModal from './WorkspaceManagerModal.svelte';

const defaultProps = {
	show: true,
	onClose: vi.fn(),
	onSwitchToWorkspace: vi.fn()
};

describe('WorkspaceManagerModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockService.getWorkspaces.mockReturnValue([
			makeWorkspace({ name: 'Workspace A' }),
			makeWorkspace({ name: 'Workspace B' })
		]);
		mockService.getCurrentWorkspace.mockReturnValue(makeWorkspace({ name: 'Workspace A' }));
	});

	describe('Rendering', () => {
		it('renders the modal heading when show is true', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			expect(screen.getByText('Manage Workspace')).toBeInTheDocument();
		});

		it('does not render the modal when show is false', () => {
			render(WorkspaceManagerModal, { props: { ...defaultProps, show: false } });
			expect(screen.queryByText('Manage Workspace')).not.toBeInTheDocument();
		});

		it('lists all workspaces returned by workspaceService', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			expect(screen.getByText('Workspace A')).toBeInTheDocument();
			expect(screen.getByText('Workspace B')).toBeInTheDocument();
		});

		it('marks the current workspace with "Current" label', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			expect(screen.getByText('Current')).toBeInTheDocument();
		});

		it('disables the button for the current workspace', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			const buttons = screen.getAllByRole('button');
			const workspaceAButton = buttons.find(
				(btn) =>
					btn.textContent?.includes('Workspace A') &&
					!btn.getAttribute('aria-label')?.includes('Delete')
			);
			expect(workspaceAButton).toBeDisabled();
		});

		it('renders a Cancel button', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
		});

		it('renders delete buttons for each workspace', () => {
			render(WorkspaceManagerModal, { props: defaultProps });
			const deleteButtons = screen.getAllByRole('button', { name: 'Delete workspace' });
			expect(deleteButtons).toHaveLength(2);
		});
	});

	describe('Switch workspace', () => {
		it('calls onSwitchToWorkspace with the selected workspace', async () => {
			const onSwitchToWorkspace = vi.fn();
			render(WorkspaceManagerModal, { props: { ...defaultProps, onSwitchToWorkspace } });

			const buttons = screen.getAllByRole('button');
			const workspaceBButton = buttons.find(
				(btn) =>
					btn.textContent?.includes('Workspace B') &&
					!btn.getAttribute('aria-label')?.includes('Delete')
			);
			expect(workspaceBButton).toBeDefined();
			await fireEvent.click(workspaceBButton!);

			expect(onSwitchToWorkspace).toHaveBeenCalled();
		});

		it('calls workspaceService.setCurrentWorkspace on switch', async () => {
			render(WorkspaceManagerModal, { props: defaultProps });

			const buttons = screen.getAllByRole('button');
			const workspaceBButton = buttons.find(
				(btn) =>
					btn.textContent?.includes('Workspace B') &&
					!btn.getAttribute('aria-label')?.includes('Delete')
			);
			await fireEvent.click(workspaceBButton!);

			expect(mockService.setCurrentWorkspace).toHaveBeenCalled();
		});

		it('calls onClose after switching workspace', async () => {
			const onClose = vi.fn();
			render(WorkspaceManagerModal, { props: { ...defaultProps, onClose } });

			const buttons = screen.getAllByRole('button');
			const workspaceBButton = buttons.find(
				(btn) =>
					btn.textContent?.includes('Workspace B') &&
					!btn.getAttribute('aria-label')?.includes('Delete')
			);
			await fireEvent.click(workspaceBButton!);

			expect(onClose).toHaveBeenCalled();
		});
	});

	describe('Delete workspace confirmation flow', () => {
		it('shows delete confirmation modal when delete button is clicked', async () => {
			render(WorkspaceManagerModal, { props: defaultProps });

			const deleteButtons = screen.getAllByRole('button', { name: 'Delete workspace' });
			await fireEvent.click(deleteButtons[1]); // Click delete on Workspace B

			expect(screen.getByRole('dialog', { name: 'Delete Workspace' })).toBeInTheDocument();
		});

		it('calls workspaceService.deleteWorkspace when confirmed', async () => {
			render(WorkspaceManagerModal, { props: defaultProps });

			const deleteButtons = screen.getAllByRole('button', { name: 'Delete workspace' });
			await fireEvent.click(deleteButtons[1]);

			const confirmButton = screen.getByRole('button', { name: 'Delete' });
			await fireEvent.click(confirmButton);

			expect(mockService.deleteWorkspace).toHaveBeenCalled();
		});

		it('dismisses the delete confirm modal when Cancel is clicked', async () => {
			render(WorkspaceManagerModal, { props: defaultProps });

			const deleteButtons = screen.getAllByRole('button', { name: 'Delete workspace' });
			await fireEvent.click(deleteButtons[1]);

			const dialog = screen.getByRole('dialog', { name: 'Delete Workspace' });
			expect(dialog).toBeInTheDocument();

			// Get the Cancel button inside the dialog
			const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
			// The cancel button inside the dialog is the one rendered by ModalStub
			const dialogCancelButton = cancelButtons.find((btn) => dialog.contains(btn));
			expect(dialogCancelButton).toBeDefined();
			await fireEvent.click(dialogCancelButton!);

			expect(
				screen.queryByRole('dialog', { name: 'Delete Workspace' })
			).not.toBeInTheDocument();
		});
	});

	describe('Close button', () => {
		it('calls onClose when Cancel button is clicked', async () => {
			const onClose = vi.fn();
			render(WorkspaceManagerModal, { props: { ...defaultProps, onClose } });

			await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			expect(onClose).toHaveBeenCalledOnce();
		});
	});
});
