import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import type { TreeNode } from '../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Navigation: {
		Rail: vi.fn(),
		Tile: vi.fn()
	},
	Switch: vi.fn(),
	Pagination: vi.fn(),
	createToaster: vi.fn(() => ({ trigger: vi.fn(), close: vi.fn(), closeAll: vi.fn() }))
}));

vi.mock('../stores/authStore', () => ({
	authStore: {
		subscribe: vi.fn((cb) => {
			cb({ isAuthenticated: false, isLoading: false, user: null, error: null });
			return () => {};
		})
	}
}));

vi.mock('../stores/workspaceStore', () => {
	let state = {
		path: null as string | null,
		currentSubWorkspace: null as string | null,
		subWorkspaces: [] as string[],
		treeStructure: [] as TreeNode[],
		isLoading: false,
		error: null as string | null,
		selectedSong: null as TreeNode | null,
		showSongDetails: false,
		showNewSong: false,
		showTemplates: false
	};
	const listeners: Array<(s: typeof state) => void> = [];

	return {
		workspaceStore: {
			subscribe: vi.fn((cb: (s: typeof state) => void) => {
				cb(state);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setState: (newState: Partial<typeof state>) => {
				state = { ...state, ...newState };
				listeners.forEach((cb) => cb(state));
			},
			reset: () => {
				state = {
					path: null,
					currentSubWorkspace: null,
					subWorkspaces: [],
					treeStructure: [],
					isLoading: false,
					error: null,
					selectedSong: null,
					showSongDetails: false,
					showNewSong: false,
					showTemplates: false
				};
				listeners.forEach((cb) => cb(state));
			},
			showNewSongForm: vi.fn(),
			showTemplatesView: vi.fn(),
			closeTemplatesView: vi.fn()
		}
	};
});

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn().mockResolvedValue(undefined),
		loadTreeStructure: vi.fn().mockResolvedValue(undefined),
		clearWorkspace: vi.fn()
	}
}));

vi.mock('./WorkspaceTree.svelte', () => ({ default: vi.fn() }));
vi.mock('./SubWorkspaceItem.svelte', () => ({ default: vi.fn() }));
vi.mock('./SongDetails.svelte', () => ({ default: vi.fn() }));
vi.mock('./SimFileList.svelte', () => ({ default: vi.fn() }));
vi.mock('./Templates.svelte', () => ({ default: vi.fn() }));
vi.mock('./Settings.svelte', () => ({ default: vi.fn() }));

import Workspace from './Workspace.svelte';
import { workspaceStore } from '../stores/workspaceStore';

const makeNode = (
	name: string,
	path = `/test/${name}`,
	overrides: Partial<TreeNode> = {}
): TreeNode => ({
	name,
	path,
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

describe('Workspace – empty state', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows select folder button when no workspace path is set', () => {
		render(Workspace);
		expect(
			screen.getByRole('button', { name: /select workspace folder/i })
		).toBeInTheDocument();
	});

	it('does not show New Song or Refresh buttons when no workspace is set', () => {
		render(Workspace);
		expect(screen.queryByRole('button', { name: /create new song/i })).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /refresh workspace/i })
		).not.toBeInTheDocument();
	});
});

describe('Workspace – with workspace path', () => {
	beforeEach(() => {
		vi.mocked(workspaceStore).setState({ path: '/workspace/test' });
	});

	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows workspace path when set', () => {
		render(Workspace);
		expect(screen.getByText('/workspace/test')).toBeInTheDocument();
	});

	it('shows New Song, Refresh and Clear buttons when workspace is set', () => {
		render(Workspace);
		expect(screen.getByRole('button', { name: /create new song/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /refresh workspace/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /clear workspace/i })).toBeInTheDocument();
	});

	it('shows search input when workspace is set', () => {
		render(Workspace);
		expect(screen.getByPlaceholderText(/search songs and folders/i)).toBeInTheDocument();
	});

	it('shows clear search button when search query is non-empty', async () => {
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i);
		await fireEvent.input(input, { target: { value: 'test query' } });
		expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();
	});

	it('hides clear search button when search is empty', () => {
		render(Workspace);
		expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument();
	});
});

describe('Workspace – loading state', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows loading indicator when isLoading is true', () => {
		vi.mocked(workspaceStore).setState({ path: '/workspace/test', isLoading: true });
		render(Workspace);
		expect(screen.getByText(/loading workspace/i)).toBeInTheDocument();
	});
});

describe('Workspace – error state', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows error message and Try Again button when error is set', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			error: 'Failed to load workspace'
		});
		render(Workspace);
		expect(screen.getByText('Failed to load workspace')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
	});
});

describe('Workspace – filterTreeNodes (via search)', () => {
	const leafNode = makeNode('SongA', '/ws/SongA', { containsDtxFiles: true });
	const noMatchNode = makeNode('SongB', '/ws/SongB');
	const parentNode = makeNode('ParentFolder', '/ws/Parent', {
		children: [
			makeNode('ChildMatch', '/ws/Parent/Child'),
			makeNode('ChildNoMatch', '/ws/Parent/NoChild')
		]
	});

	beforeEach(() => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [leafNode, noMatchNode, parentNode]
		});
	});

	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows "No folders found" when tree structure is empty with no search', () => {
		vi.mocked(workspaceStore).setState({ path: '/workspace/test', treeStructure: [] });
		render(Workspace);
		expect(screen.getByText('No folders found')).toBeInTheDocument();
	});

	it('shows "No results found" message when search matches nothing', async () => {
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i);
		await fireEvent.input(input, { target: { value: 'xyznonexistent' } });
		expect(screen.getByText(/no results found for/i)).toBeInTheDocument();
	});

	it('clears the search field when clear button is clicked', async () => {
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'SongA' } });
		const clearBtn = screen.getByRole('button', { name: /clear search/i });
		await fireEvent.click(clearBtn);
		expect(input.value).toBe('');
	});
});

describe('Workspace – button interactions', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('calls workspaceService.selectWorkspace when Select Folder button is clicked', async () => {
		const { workspaceService } = await import('../services/workspaceService');
		render(Workspace);
		await fireEvent.click(screen.getByRole('button', { name: /select workspace folder/i }));
		expect(workspaceService.selectWorkspace).toHaveBeenCalledOnce();
	});

	it('calls workspaceStore.showNewSongForm when New Song is clicked', async () => {
		vi.mocked(workspaceStore).setState({ path: '/workspace/test' });
		render(Workspace);
		await fireEvent.click(screen.getByRole('button', { name: /create new song/i }));
		expect(workspaceStore.showNewSongForm).toHaveBeenCalledOnce();
	});

	it('calls workspaceService.clearWorkspace when Clear button is clicked', async () => {
		const { workspaceService } = await import('../services/workspaceService');
		vi.mocked(workspaceStore).setState({ path: '/workspace/test' });
		render(Workspace);
		await fireEvent.click(screen.getByRole('button', { name: /clear workspace/i }));
		expect(workspaceService.clearWorkspace).toHaveBeenCalledOnce();
	});
});
