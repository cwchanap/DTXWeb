import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DeleteWorkspaceModal from './DeleteWorkspaceModal.svelte';
import { makeWorkspace } from '../../../../tests/mocks/services';

const workspace = makeWorkspace({
	name: 'My Workspace',
	dtxFiles: [
		{ name: 'basic.dtx', content: '', path: '' },
		{ name: 'adv.dtx', content: '', path: '' }
	],
	audioFiles: [{ name: 'kick.wav', path: '', isLarge: false }],
	lastModified: new Date('2024-06-15').getTime()
});

describe('DeleteWorkspaceModal', () => {
	const defaultProps = {
		show: true,
		workspaceToDelete: workspace,
		currentWorkspace: null,
		onConfirm: vi.fn(),
		onCancel: vi.fn()
	};

	it('does not render when workspaceToDelete is null', () => {
		render(DeleteWorkspaceModal, { props: { ...defaultProps, workspaceToDelete: null } });
		expect(screen.queryByText('Delete Workspace?')).not.toBeInTheDocument();
	});

	it('does not render when show is false', () => {
		render(DeleteWorkspaceModal, { props: { ...defaultProps, show: false } });
		expect(screen.queryByText('Delete Workspace?')).not.toBeInTheDocument();
	});

	it('shows workspace name', () => {
		render(DeleteWorkspaceModal, { props: defaultProps });
		expect(screen.getByText(/"My Workspace"/)).toBeInTheDocument();
	});

	it('shows DTX and audio file counts', () => {
		render(DeleteWorkspaceModal, { props: defaultProps });
		expect(screen.getByText(/2 DTX files/)).toBeInTheDocument();
		expect(screen.getByText(/1 audio files/)).toBeInTheDocument();
	});

	it('shows last modified date', () => {
		render(DeleteWorkspaceModal, { props: defaultProps });
		expect(screen.getByText(/Last modified/)).toBeInTheDocument();
	});

	it('shows current workspace warning when deleting the active workspace', () => {
		render(DeleteWorkspaceModal, {
			props: { ...defaultProps, currentWorkspace: workspace }
		});
		expect(screen.getByText(/This is your current workspace/i)).toBeInTheDocument();
	});

	it('does not show current workspace warning for other workspaces', () => {
		const other = makeWorkspace({ name: 'Other' });
		render(DeleteWorkspaceModal, {
			props: { ...defaultProps, currentWorkspace: other }
		});
		expect(screen.queryByText(/This is your current workspace/i)).not.toBeInTheDocument();
	});

	it('calls onConfirm when Delete Workspace button is clicked', async () => {
		const onConfirm = vi.fn();
		render(DeleteWorkspaceModal, { props: { ...defaultProps, onConfirm } });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace' }));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('calls onCancel when Cancel button is clicked', async () => {
		const onCancel = vi.fn();
		render(DeleteWorkspaceModal, { props: { ...defaultProps, onCancel } });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledOnce();
	});
});
