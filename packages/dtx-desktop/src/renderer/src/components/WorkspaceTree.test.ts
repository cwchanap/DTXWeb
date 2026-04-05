import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { TreeNode } from '../stores/workspaceStore';

vi.mock('@lucide/svelte');

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		collapseTreeNode: vi.fn(),
		expandTreeNode: vi.fn().mockResolvedValue(undefined),
		selectSong: vi.fn()
	}
}));

vi.mock('../services/linkingService', () => ({
	linkingService: {
		unlinkSimFileFromFolder: vi.fn()
	}
}));

import WorkspaceTree from './WorkspaceTree.svelte';
import { workspaceService } from '../services/workspaceService';
import { linkingService } from '../services/linkingService';

const makeNode = (overrides: Partial<TreeNode> = {}): TreeNode => ({
	name: 'Test Folder',
	path: '/test/path',
	isExpanded: false,
	isLoading: false,
	children: [],
	hasChildren: false,
	containsDtxFiles: false,
	songTitle: null,
	linkedSimFileId: null,
	linkedSimFile: null,
	...overrides
});

describe('WorkspaceTree', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders a list of nodes by name', () => {
		const nodes = [
			makeNode({ name: 'Folder A', path: '/a' }),
			makeNode({ name: 'Folder B', path: '/b' })
		];
		render(WorkspaceTree, { props: { nodes } });
		expect(screen.getByText('Folder A')).toBeInTheDocument();
		expect(screen.getByText('Folder B')).toBeInTheDocument();
	});

	it('renders nothing when nodes is empty', () => {
		const { container } = render(WorkspaceTree, { props: { nodes: [] } });
		expect(container.querySelectorAll('.tree-node')).toHaveLength(0);
	});

	it('shows song title when songTitle is set', () => {
		const nodes = [
			makeNode({ name: 'My Song', songTitle: 'The Song Title', containsDtxFiles: true })
		];
		render(WorkspaceTree, { props: { nodes } });
		expect(screen.getByText('The Song Title')).toBeInTheDocument();
	});

	it('calls expandTreeNode when clicking a collapsed folder with children', async () => {
		const nodes = [makeNode({ path: '/folder', hasChildren: true, isExpanded: false })];
		render(WorkspaceTree, { props: { nodes } });
		const btn = screen.getAllByRole('button')[0];
		await fireEvent.click(btn);
		expect(workspaceService.expandTreeNode).toHaveBeenCalledWith('/folder');
	});

	it('calls collapseTreeNode when clicking an expanded folder', async () => {
		const nodes = [makeNode({ path: '/folder', isExpanded: true, hasChildren: true })];
		render(WorkspaceTree, { props: { nodes } });
		const btn = screen.getAllByRole('button')[0];
		await fireEvent.click(btn);
		expect(workspaceService.collapseTreeNode).toHaveBeenCalledWith('/folder');
	});

	it('calls selectSong when clicking a folder containing dtx files', async () => {
		const songNode = makeNode({ path: '/song', containsDtxFiles: true });
		render(WorkspaceTree, { props: { nodes: [songNode] } });
		const btn = screen.getAllByRole('button')[0];
		await fireEvent.click(btn);
		expect(workspaceService.selectSong).toHaveBeenCalledWith(songNode);
	});

	it('does not call any service when node button is disabled while loading', () => {
		const nodes = [makeNode({ path: '/folder', isLoading: true })];
		render(WorkspaceTree, { props: { nodes } });
		const btn = screen.getAllByRole('button')[0];
		expect(btn).toBeDisabled();
	});

	it('shows Linked indicator when node has linkedSimFileId', () => {
		const nodes = [makeNode({ containsDtxFiles: true, linkedSimFileId: 'sim-123' })];
		render(WorkspaceTree, { props: { nodes } });
		expect(screen.getByText('Linked')).toBeInTheDocument();
	});

	it('does not show Linked indicator for unlinked song nodes', () => {
		const nodes = [makeNode({ containsDtxFiles: true, linkedSimFileId: null })];
		render(WorkspaceTree, { props: { nodes } });
		expect(screen.queryByText('Linked')).not.toBeInTheDocument();
	});

	it('shows unlink button when node has linkedSimFileId', () => {
		const nodes = [makeNode({ containsDtxFiles: true, linkedSimFileId: 'sim-123' })];
		render(WorkspaceTree, { props: { nodes } });
		expect(
			screen.getByRole('button', { name: /Unlink folder from cloud simFile/i })
		).toBeInTheDocument();
	});

	it('does not show unlink button when node has no linkedSimFileId', () => {
		const nodes = [makeNode({ containsDtxFiles: true, linkedSimFileId: null })];
		render(WorkspaceTree, { props: { nodes } });
		expect(
			screen.queryByRole('button', { name: /Unlink folder from cloud simFile/i })
		).not.toBeInTheDocument();
	});

	it('calls unlinkSimFileFromFolder when unlink button is clicked', async () => {
		const nodes = [
			makeNode({ path: '/song', containsDtxFiles: true, linkedSimFileId: 'sim-123' })
		];
		render(WorkspaceTree, { props: { nodes } });
		const unlinkBtn = screen.getByRole('button', {
			name: /Unlink folder from cloud simFile/i
		});
		await fireEvent.click(unlinkBtn);
		expect(linkingService.unlinkSimFileFromFolder).toHaveBeenCalledWith('/song');
	});

	it('renders children of expanded folder', () => {
		const childNode = makeNode({ name: 'Child Folder', path: '/parent/child' });
		const parentNode = makeNode({
			name: 'Parent Folder',
			path: '/parent',
			isExpanded: true,
			hasChildren: true,
			children: [childNode]
		});
		render(WorkspaceTree, { props: { nodes: [parentNode] } });
		expect(screen.getByText('Parent Folder')).toBeInTheDocument();
		expect(screen.getByText('Child Folder')).toBeInTheDocument();
	});

	it('does not render children of collapsed folder', () => {
		const childNode = makeNode({ name: 'Hidden Child', path: '/parent/child' });
		const parentNode = makeNode({
			name: 'Parent Folder',
			path: '/parent',
			isExpanded: false,
			hasChildren: true,
			children: [childNode]
		});
		render(WorkspaceTree, { props: { nodes: [parentNode] } });
		expect(screen.getByText('Parent Folder')).toBeInTheDocument();
		expect(screen.queryByText('Hidden Child')).not.toBeInTheDocument();
	});

	it('handles expand errors gracefully', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(workspaceService.expandTreeNode).mockRejectedValue(new Error('IPC error'));
		const nodes = [makeNode({ path: '/folder', hasChildren: true, isExpanded: false })];
		render(WorkspaceTree, { props: { nodes } });
		const btn = screen.getAllByRole('button')[0];
		await fireEvent.click(btn);
		await waitFor(() => {
			expect(consoleSpy).toHaveBeenCalled();
		});
		consoleSpy.mockRestore();
	});
});
