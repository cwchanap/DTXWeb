import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { SimfileWithDtx } from '@dtx/common';
import type { TreeNode } from './workspaceStore';

// Mock linkageCacheService before importing workspaceStore
vi.mock('../services/linkageCacheService', () => ({
	linkageCacheService: {
		getLinkage: vi.fn().mockReturnValue(null),
		saveLinkage: vi.fn(),
		removeLinkage: vi.fn(),
		clearCache: vi.fn()
	}
}));

const { workspaceStore } = await import('./workspaceStore');
const { linkageCacheService } = await import('../services/linkageCacheService');

const makeSimFile = (id: number): SimfileWithDtx => ({
	id,
	title: `Song ${id}`,
	artist: 'Artist',
	bpm: 120,
	preview_url: null,
	download_url: null,
	is_published: false,
	display_id: null,
	publish_date: '2024-01-01',
	video_preview_url: null,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	user_id: 'test-user',
	dtx_files: []
});

const makeTreeNode = (name: string, path: string, children = []) => ({
	name,
	path,
	isExpanded: false,
	isLoading: false,
	children,
	hasChildren: false
});

describe('workspaceStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(linkageCacheService.getLinkage as ReturnType<typeof vi.fn>).mockReturnValue(null);
		workspaceStore.reset();
	});

	it('does not hydrate a workspace path from renderer localStorage during import', async () => {
		window.localStorage.setItem('workspace_path', JSON.stringify('/spoofed/path'));
		vi.resetModules();

		const { workspaceStore: importedStore } = await import('./workspaceStore');

		expect(get(importedStore).path).toBeNull();
		expect(window.localStorage.getItem).not.toHaveBeenCalledWith('workspace_path');
	});

	it('should initialize with default state', () => {
		const state = get(workspaceStore);
		expect(state.path).toBeNull();
		expect(state.currentSubWorkspace).toBeNull();
		expect(state.subWorkspaces).toEqual([]);
		expect(state.treeStructure).toEqual([]);
		expect(state.isLoading).toBe(false);
		expect(state.error).toBeNull();
		expect(state.selectedSong).toBeNull();
		expect(state.showNewSong).toBe(false);
	});

	describe('setPath', () => {
		it('should set the workspace path', () => {
			workspaceStore.setPath('/workspace/path');

			const state = get(workspaceStore);
			expect(state.path).toBe('/workspace/path');
			expect(state.error).toBeNull();
		});

		it('keeps the path in memory without persisting it to localStorage', () => {
			workspaceStore.setPath('/workspace/path');

			expect(window.localStorage.setItem).not.toHaveBeenCalled();
		});

		it('replaces the display path with native hydrated state', () => {
			workspaceStore.setPath('/stale/display/path');

			workspaceStore.hydratePath('/native/canonical/path');

			expect(get(workspaceStore).path).toBe('/native/canonical/path');
		});
	});

	describe('setCurrentSubWorkspace', () => {
		it('should set the current sub-workspace', () => {
			workspaceStore.setCurrentSubWorkspace('DTXFiles.SubWorkspace');

			expect(get(workspaceStore).currentSubWorkspace).toBe('DTXFiles.SubWorkspace');
		});

		it('should allow setting to null', () => {
			workspaceStore.setCurrentSubWorkspace('DTXFiles.SubWorkspace');
			workspaceStore.setCurrentSubWorkspace(null);

			expect(get(workspaceStore).currentSubWorkspace).toBeNull();
		});
	});

	describe('setSubWorkspaces', () => {
		it('should set the list of sub-workspaces', () => {
			const subWorkspaces = ['DTXFiles.A', 'DTXFiles.B'];
			workspaceStore.setSubWorkspaces(subWorkspaces);

			const state = get(workspaceStore);
			expect(state.subWorkspaces).toEqual(subWorkspaces);
			expect(state.error).toBeNull();
		});
	});

	describe('setTreeStructure', () => {
		it('should set the tree structure', () => {
			const nodes = [makeTreeNode('Song1', '/path/Song1')];
			workspaceStore.setTreeStructure(nodes);

			const state = get(workspaceStore);
			expect(state.treeStructure).toHaveLength(1);
			expect(state.treeStructure[0].name).toBe('Song1');
		});

		it('should apply cached linkage data to nodes', () => {
			const simFile = makeSimFile(1);
			(linkageCacheService.getLinkage as ReturnType<typeof vi.fn>).mockImplementation(
				(path: string) => {
					if (path === '/path/Song1') {
						return { linkedSimFileId: '1', cloudSongData: simFile };
					}
					return null;
				}
			);

			const nodes = [makeTreeNode('Song1', '/path/Song1')];
			workspaceStore.setTreeStructure(nodes);

			const state = get(workspaceStore);
			expect(state.treeStructure[0].linkedSimFileId).toBe('1');
			expect(state.treeStructure[0].linkedSimFile).toEqual(simFile);
		});

		it('should apply cached linkage recursively to nested nodes', () => {
			const simFile = makeSimFile(2);
			(linkageCacheService.getLinkage as ReturnType<typeof vi.fn>).mockImplementation(
				(path: string) => {
					if (path === '/path/Parent/Child') {
						return { linkedSimFileId: '2', cloudSongData: simFile };
					}
					return null;
				}
			);

			const childNode = makeTreeNode('Child', '/path/Parent/Child');
			const parentNode = { ...makeTreeNode('Parent', '/path/Parent'), children: [childNode] };
			workspaceStore.setTreeStructure([parentNode]);

			const state = get(workspaceStore);
			expect(state.treeStructure[0].children[0].linkedSimFileId).toBe('2');
		});

		it('should not apply linkage when no cache exists', () => {
			(linkageCacheService.getLinkage as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const nodes = [makeTreeNode('Song1', '/path/Song1')];
			workspaceStore.setTreeStructure(nodes);

			const state = get(workspaceStore);
			expect(state.treeStructure[0].linkedSimFileId).toBeUndefined();
		});
	});

	describe('updateTreeNode', () => {
		it('should update a node in the tree structure', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);

			workspaceStore.updateTreeNode('/path/Song1', { isExpanded: true });

			const state = get(workspaceStore);
			expect(state.treeStructure[0].isExpanded).toBe(true);
		});

		it('should update nested nodes recursively', () => {
			const childNode = makeTreeNode('Child', '/path/Parent/Child');
			const parentNode = { ...makeTreeNode('Parent', '/path/Parent'), children: [childNode] };
			workspaceStore.setTreeStructure([parentNode]);

			workspaceStore.updateTreeNode('/path/Parent/Child', { isExpanded: true });

			const state = get(workspaceStore);
			expect(state.treeStructure[0].children[0].isExpanded).toBe(true);
		});

		it('should not affect other nodes', () => {
			workspaceStore.setTreeStructure([
				makeTreeNode('Song1', '/path/Song1'),
				makeTreeNode('Song2', '/path/Song2')
			]);

			workspaceStore.updateTreeNode('/path/Song1', { isLoading: true });

			const state = get(workspaceStore);
			expect(state.treeStructure[0].isLoading).toBe(true);
			expect(state.treeStructure[1].isLoading).toBe(false);
		});
	});

	describe('setLoading', () => {
		it('should set loading state', () => {
			workspaceStore.setLoading(true);
			expect(get(workspaceStore).isLoading).toBe(true);

			workspaceStore.setLoading(false);
			expect(get(workspaceStore).isLoading).toBe(false);
		});
	});

	describe('setError', () => {
		it('should set error message', () => {
			workspaceStore.setError('Failed to load workspace');
			expect(get(workspaceStore).error).toBe('Failed to load workspace');
		});
	});

	describe('clearWorkspace', () => {
		it('should reset workspace-related state', () => {
			workspaceStore.setPath('/workspace');
			workspaceStore.setSubWorkspaces(['DTXFiles.A']);
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path')]);
			workspaceStore.selectSong(makeTreeNode('Song1', '/path'));

			workspaceStore.clearWorkspace();

			const state = get(workspaceStore);
			expect(state.path).toBeNull();
			expect(state.currentSubWorkspace).toBeNull();
			expect(state.subWorkspaces).toEqual([]);
			expect(state.treeStructure).toEqual([]);
			expect(state.selectedSong).toBeNull();
			expect(state.error).toBeNull();
		});

		it('removes a stale legacy key as cleanup without establishing trust', () => {
			window.localStorage.setItem('workspace_path', JSON.stringify('/spoofed/path'));
			workspaceStore.clearWorkspace();
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('workspace_path');
			expect(get(workspaceStore).path).toBeNull();
		});

		it('should clear the linkage cache', () => {
			workspaceStore.clearWorkspace();
			expect(linkageCacheService.clearCache).toHaveBeenCalled();
		});
	});

	describe('selectSong', () => {
		it('should set the selected song', () => {
			const song = makeTreeNode('My Song', '/path/My Song');
			workspaceStore.selectSong(song);

			const state = get(workspaceStore);
			expect(state.selectedSong).toEqual(song);
			expect(state.showNewSong).toBe(false);
		});
	});

	describe('closeSongDetails', () => {
		it('should clear the selected song', () => {
			workspaceStore.selectSong(makeTreeNode('My Song', '/path'));
			workspaceStore.closeSongDetails();

			const state = get(workspaceStore);
			expect(state.selectedSong).toBeNull();
		});
	});

	describe('selectCloudSimFile', () => {
		it('should set the selected cloud simfile and show its details', () => {
			const sim = makeSimFile(7);
			workspaceStore.selectCloudSimFile(sim);

			const state = get(workspaceStore);
			expect(state.selectedCloudSimFile).toEqual(sim);
			expect(state.showCloudSongDetails).toBe(true);
		});

		it('should clear the local song selection (mutually exclusive)', () => {
			workspaceStore.selectSong(makeTreeNode('Local', '/local'));
			workspaceStore.selectCloudSimFile(makeSimFile(7));

			const state = get(workspaceStore);
			expect(state.selectedSong).toBeNull();
			expect(state.selectedCloudSimFile).not.toBeNull();
		});

		it('selectSong should clear the cloud selection (mutually exclusive)', () => {
			workspaceStore.selectCloudSimFile(makeSimFile(7));
			workspaceStore.selectSong(makeTreeNode('Local', '/local'));

			const state = get(workspaceStore);
			expect(state.selectedCloudSimFile).toBeNull();
			expect(state.showCloudSongDetails).toBe(false);
			expect(state.selectedSong).not.toBeNull();
		});
	});

	describe('closeCloudSongDetails', () => {
		it('should clear the selected cloud simfile and hide its details', () => {
			workspaceStore.selectCloudSimFile(makeSimFile(7));
			workspaceStore.closeCloudSongDetails();

			const state = get(workspaceStore);
			expect(state.selectedCloudSimFile).toBeNull();
			expect(state.showCloudSongDetails).toBe(false);
		});
	});

	describe('showNewSongForm', () => {
		it('should show new song form and hide other panels', () => {
			workspaceStore.selectSong(makeTreeNode('My Song', '/path'));
			workspaceStore.showNewSongForm();

			const state = get(workspaceStore);
			expect(state.showNewSong).toBe(true);
			expect(state.selectedSong).toBeNull();
			// The form must land in the library section: AppShell renders
			// Settings/Templates before it checks showNewSong, so the flag alone
			// would be invisible from those sections.
			expect(state.activeSection).toBe('library');
		});

		it('switches to library when opened from a non-list section', () => {
			// Simulate running the New Song command while on Settings/Templates,
			// where the form would otherwise never render.
			workspaceStore.setActiveSection('settings');
			workspaceStore.setActiveSection('templates');
			workspaceStore.showNewSongForm();

			const state = get(workspaceStore);
			expect(state.activeSection).toBe('library');
			expect(state.showNewSong).toBe(true);
		});
	});

	describe('closeNewSongForm', () => {
		it('should hide the new song form', () => {
			workspaceStore.showNewSongForm();
			workspaceStore.closeNewSongForm();

			expect(get(workspaceStore).showNewSong).toBe(false);
		});
	});

	describe('linkSimFileToFolder', () => {
		it('should link a simFile to a folder in the tree', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);

			const simFile = makeSimFile(1);
			workspaceStore.linkSimFileToFolder('/path/Song1', simFile);

			const state = get(workspaceStore);
			expect(state.treeStructure[0].linkedSimFileId).toBe('1');
			expect(state.treeStructure[0].linkedSimFile).toEqual(simFile);
		});

		it('should save linkage to cache', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);

			const simFile = makeSimFile(1);
			workspaceStore.linkSimFileToFolder('/path/Song1', simFile);

			expect(linkageCacheService.saveLinkage).toHaveBeenCalledWith('/path/Song1', 1, simFile);
		});

		it('should convert simFile id to string for linkedSimFileId', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);

			const simFile = makeSimFile(42);
			workspaceStore.linkSimFileToFolder('/path/Song1', simFile);

			expect(get(workspaceStore).treeStructure[0].linkedSimFileId).toBe('42');
		});
	});

	describe('unlinkSimFileFromFolder', () => {
		it('should unlink a simFile from a folder', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);
			workspaceStore.linkSimFileToFolder('/path/Song1', makeSimFile(1));

			workspaceStore.unlinkSimFileFromFolder('/path/Song1');

			const state = get(workspaceStore);
			expect(state.treeStructure[0].linkedSimFileId).toBeNull();
			expect(state.treeStructure[0].linkedSimFile).toBeNull();
		});

		it('should remove linkage from cache', () => {
			workspaceStore.setTreeStructure([makeTreeNode('Song1', '/path/Song1')]);
			workspaceStore.unlinkSimFileFromFolder('/path/Song1');

			expect(linkageCacheService.removeLinkage).toHaveBeenCalledWith('/path/Song1');
		});
	});

	describe('reset', () => {
		it('should return to initial state', () => {
			workspaceStore.setPath('/workspace');
			workspaceStore.setLoading(true);
			workspaceStore.setError('error');
			workspaceStore.reset();

			const state = get(workspaceStore);
			expect(state.path).toBeNull();
			expect(state.isLoading).toBe(false);
			expect(state.error).toBeNull();
		});
	});

	describe('activeSection', () => {
		beforeEach(() => workspaceStore.reset());

		it('defaults to library', () => {
			const s = get(workspaceStore);
			expect(s.activeSection).toBe('library');
		});

		it('setActiveSection switches section and clears song selection', () => {
			workspaceStore.selectSong({ name: 'x', path: '/x' } as TreeNode);
			workspaceStore.setActiveSection('cloud');
			const s = get(workspaceStore);
			expect(s.activeSection).toBe('cloud');
			expect(s.selectedSong).toBeNull();
		});

		it('setActiveSection("templates") sets activeSection to templates', () => {
			workspaceStore.setActiveSection('templates');
			expect(get(workspaceStore).activeSection).toBe('templates');
		});

		it('switching from cloud to library clears the cloud simfile selection', () => {
			// Realistic flow: cloud selection only happens while in the cloud
			// section (the command palette switches section before selecting).
			workspaceStore.setActiveSection('cloud');
			workspaceStore.selectCloudSimFile(makeSimFile(3));
			workspaceStore.setActiveSection('library'); // cloud → library: real change
			const s = get(workspaceStore);
			expect(s.selectedCloudSimFile).toBeNull();
			expect(s.showCloudSongDetails).toBe(false);
		});

		it('re-clicking the active section is a no-op (keeps selection)', () => {
			// default activeSection is 'library'
			workspaceStore.selectSong({ name: 'x', path: '/x' } as TreeNode);
			workspaceStore.setActiveSection('library'); // same section → no-op
			const s = get(workspaceStore);
			expect(s.activeSection).toBe('library');
			expect(s.selectedSong).not.toBeNull(); // selection preserved
		});

		it('switching to a different section still clears selection', () => {
			workspaceStore.selectSong({ name: 'x', path: '/x' } as TreeNode);
			workspaceStore.setActiveSection('cloud'); // real change → clears
			const s = get(workspaceStore);
			expect(s.activeSection).toBe('cloud');
			expect(s.selectedSong).toBeNull();
		});
	});
});
