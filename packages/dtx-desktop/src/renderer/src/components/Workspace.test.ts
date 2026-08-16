import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import type { SimfileModel } from '@dtx/common';
import type { TreeNode, ShellSection } from '../stores/workspaceStore';

vi.mock('@lucide/svelte');

vi.mock('../stores/workspaceStore', () => {
	let state = {
		path: null as string | null,
		currentSubWorkspace: null as string | null,
		subWorkspaces: [] as string[],
		treeStructure: [] as TreeNode[],
		isLoading: false,
		error: null as string | null,
		selectedSong: null as TreeNode | null,
		selectedCloudSimFile: null as SimfileModel | null,
		showCloudSongDetails: false,
		showNewSong: false,
		activeSection: 'library' as ShellSection
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
					selectedCloudSimFile: null,
					showCloudSongDetails: false,
					showNewSong: false,
					activeSection: 'library'
				};
				listeners.forEach((cb) => cb(state));
			},
			showNewSongForm: vi.fn()
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

vi.mock('../stores/bookmarkStore', () => {
	let value: Array<{ path: string; name: string }> = [];
	const listeners: Array<(v: typeof value) => void> = [];
	return {
		bookmarkStore: {
			subscribe: vi.fn((cb: (v: typeof value) => void) => {
				cb(value);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setValue: (next: typeof value) => {
				value = next;
				listeners.forEach((cb) => cb(value));
			},
			add: vi.fn(),
			remove: vi.fn(),
			rename: vi.fn()
		},
		basename: (p: string) => p.split('/').pop() ?? p
	};
});

vi.mock('./WorkspaceBookmarksMenu.svelte', () => ({ default: vi.fn() }));

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

	it('does not render a standalone Select Folder button when no workspace path is set', () => {
		// The empty state only shows the WorkspaceBookmarksMenu dropdown; the
		// browse action lives inside that menu's "Browse for folder…" entry.
		render(Workspace);
		expect(
			screen.queryByRole('button', { name: /select workspace folder/i })
		).not.toBeInTheDocument();
	});

	it('does not show New Song or Refresh buttons when no workspace is set', () => {
		render(Workspace);
		expect(screen.queryByRole('button', { name: /create new song/i })).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /refresh workspace/i })
		).not.toBeInTheDocument();
	});

	it('renders WorkspaceBookmarksMenu in the empty state so bookmarks are accessible', async () => {
		const WorkspaceBookmarksMenu = (await import('./WorkspaceBookmarksMenu.svelte')).default;
		render(Workspace);
		expect(WorkspaceBookmarksMenu).toHaveBeenCalled();
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

	it('calls workspaceService.loadSubWorkspaces and loadTreeStructure when Refresh is clicked', async () => {
		const { workspaceService } = await import('../services/workspaceService');
		vi.mocked(workspaceStore).setState({ path: '/workspace/test' });
		render(Workspace);
		await fireEvent.click(screen.getByRole('button', { name: /refresh workspace/i }));
		expect(workspaceService.loadSubWorkspaces).toHaveBeenCalled();
		expect(workspaceService.loadTreeStructure).toHaveBeenCalled();
	});
});

describe('Workspace – sub-workspaces section', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('renders sub-workspaces when subWorkspaces are present', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			subWorkspaces: ['DTXFiles.Rock', 'DTXFiles.Pop'],
			treeStructure: [makeNode('SongA', '/ws/SongA', { containsDtxFiles: true })]
		});
		render(Workspace);
		// SubWorkspaceItem is mocked but tree has nodes so "No folders found" should be absent
		expect(screen.queryByText('No folders found')).not.toBeInTheDocument();
	});

	it('shows tree structure with currentSubWorkspace label', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			currentSubWorkspace: 'DTXFiles.Rock',
			treeStructure: [makeNode('SongA', '/ws/SongA', { containsDtxFiles: true })]
		});
		render(Workspace);
		expect(screen.getByText(/Tree: Rock/i)).toBeInTheDocument();
	});

	it('shows "Workspace Tree" label when no subWorkspace is active', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [makeNode('SongA', '/ws/SongA', { containsDtxFiles: true })]
		});
		render(Workspace);
		expect(screen.getByText('Workspace Tree')).toBeInTheDocument();
	});

	it('shows "Showing contents of selected sub-workspace" when subWorkspace is active', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			currentSubWorkspace: 'DTXFiles.Rock',
			treeStructure: [makeNode('SongA', '/ws/SongA')]
		});
		render(Workspace);
		expect(screen.getByText(/Showing contents of selected sub-workspace/i)).toBeInTheDocument();
	});

	it('shows "Showing all folders in workspace" when no subWorkspace is active', () => {
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [makeNode('SongA', '/ws/SongA')]
		});
		render(Workspace);
		expect(screen.getByText(/Showing all folders in workspace/i)).toBeInTheDocument();
	});

	it('renders WorkspaceBookmarksMenu in place of the legacy Change folder link when a path is set', async () => {
		const WorkspaceBookmarksMenu = (await import('./WorkspaceBookmarksMenu.svelte')).default;

		(workspaceStore as any).setState({ path: '/test/workspace' });
		render(Workspace);

		expect(screen.queryByRole('link', { name: /change folder/i })).toBeNull();
		expect(WorkspaceBookmarksMenu).toHaveBeenCalled();
	});
});

describe('Workspace – filterTreeNodes edge cases', () => {
	const makeFullNode = (
		name: string,
		path = `/ws/${name}`,
		overrides: Partial<TreeNode> = {}
	): TreeNode => makeNode(name, path, overrides);

	afterEach(() => {
		cleanup();
		vi.mocked(workspaceStore).reset();
	});

	it('shows matching nodes when search term matches song title', async () => {
		const song = makeFullNode('FolderName', '/ws/FolderName', {
			songTitle: 'My Unique Song Title',
			containsDtxFiles: true
		});
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [song]
		});
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i);
		await fireEvent.input(input, { target: { value: 'Unique Song' } });
		expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
	});

	it('includes parent nodes in results when a child name matches the search', async () => {
		const childMatch = makeFullNode('ChildMatch', '/ws/Parent/ChildMatch');
		const parent = makeFullNode('ParentFolder', '/ws/Parent', {
			children: [childMatch],
			hasChildren: true
		});
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [parent]
		});
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i);
		await fireEvent.input(input, { target: { value: 'ChildMatch' } });
		// The tree is rendered but WorkspaceTree is mocked – just check no error
		expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
	});

	it('filters out nodes that do not match', async () => {
		const noMatch = makeFullNode('ZZZNoMatch', '/ws/ZZZNoMatch');
		vi.mocked(workspaceStore).setState({
			path: '/workspace/test',
			treeStructure: [noMatch]
		});
		render(Workspace);
		const input = screen.getByPlaceholderText(/search songs and folders/i);
		await fireEvent.input(input, { target: { value: 'ChildMatch' } });
		expect(screen.getByText(/no results found for "ChildMatch"/i)).toBeInTheDocument();
	});
});
