import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		setCurrentSubWorkspace: vi.fn().mockResolvedValue(undefined)
	}
}));

import SubWorkspaceItem from './SubWorkspaceItem.svelte';
import { workspaceService } from '../services/workspaceService';

describe('SubWorkspaceItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders sub-workspace name', () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: false } });
		expect(screen.getByText('MySongs')).toBeInTheDocument();
	});

	it('strips DTXFiles. prefix from display name', () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'DTXFiles.MySongs', isActive: false } });
		expect(screen.getByText('MySongs')).toBeInTheDocument();
		expect(screen.queryByText('DTXFiles.MySongs')).not.toBeInTheDocument();
	});

	it('renders button with correct aria-label when inactive', () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: false } });
		expect(
			screen.getByRole('button', { name: /Select sub-workspace MySongs/i })
		).toBeInTheDocument();
	});

	it('renders button with correct aria-label when active', () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: true } });
		expect(
			screen.getByRole('button', { name: /Deselect sub-workspace MySongs/i })
		).toBeInTheDocument();
	});

	it('calls setCurrentSubWorkspace with null when active and clicked', async () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: true } });
		const btn = screen.getByRole('button');
		await fireEvent.click(btn);
		expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith(null);
	});

	it('calls setCurrentSubWorkspace with subWorkspace name when inactive and clicked', async () => {
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: false } });
		const btn = screen.getByRole('button');
		await fireEvent.click(btn);
		expect(workspaceService.setCurrentSubWorkspace).toHaveBeenCalledWith('MySongs');
	});

	it('handles errors from setCurrentSubWorkspace gracefully', async () => {
		vi.mocked(workspaceService.setCurrentSubWorkspace).mockRejectedValue(
			new Error('Network error')
		);
		render(SubWorkspaceItem, { props: { subWorkspace: 'MySongs', isActive: false } });
		const btn = screen.getByRole('button');
		await fireEvent.click(btn);
		// Should not throw - error handled internally
		await waitFor(() => expect(console.error).toHaveBeenCalled());
	});
});
