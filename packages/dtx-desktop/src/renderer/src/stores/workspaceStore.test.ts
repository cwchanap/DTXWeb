import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { SimfileWithDtx } from '@dtx/common';

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

	it('should initialize with default state', () => {
		const state = get(workspaceStore);
		expect(state.path).toBeNull();
		expect(state.currentSubWorkspace).toBeNull();
		expect(state.subWorkspaces).toEqual([]);
		expect(state.treeStructure).toEqual([]);
		expect(state.isLoading).toBe(false);
		expect(state.error).toBeNull();
		expect(state.selectedSong).toBeNull();
		expect(state.showSongDetails).toBe(false);
		expect(state.showNewSong).toBe(false);
		expect(state.showTemplates).toBe(false);
	});

	describe('setPath', () => {
		it('should set the workspace path', () => {
			workspaceStore.setPath('/workspace/path');

			const state = get(workspaceStore);
			expect(state.path).toBe('/workspace/path');
			expect(state.error).toBeNull();
		});

		it('should persist path to localStorage', () => {
			workspaceStore.setPath('/workspace/path');

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'workspace_path',
				JSON.stringify('/workspace/path')
			);
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
			expect(state.showSongDetails).toBe(false);
			expect(state.error).toBeNull();
		});

		it('should remove workspace_path from localStorage', () => {
			workspaceStore.clearWorkspace();
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('workspace_path');
		});

		it('should clear the linkage cache', () => {
			workspaceStore.clearWorkspace();
			expect(linkageCacheService.clearCache).toHaveBeenCalled();
		});
	});

	describe('selectSong', () => {
		it('should set the selected song and show song details', () => {
			const song = makeTreeNode('My Song', '/path/My Song');
			workspaceStore.selectSong(song);

			const state = get(workspaceStore);
			expect(state.selectedSong).toEqual(song);
			expect(state.showSongDetails).toBe(true);
			expect(state.showNewSong).toBe(false);
		});
	});

	describe('closeSongDetails', () => {
		it('should clear selected song and hide song details', () => {
			workspaceStore.selectSong(makeTreeNode('My Song', '/path'));
			workspaceStore.closeSongDetails();

			const state = get(workspaceStore);
			expect(state.selectedSong).toBeNull();
			expect(state.showSongDetails).toBe(false);
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
			expect(state.showSongDetails).toBe(false);
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
			expect(state.showSongDetails).toBe(false);
		});
	});

	describe('closeNewSongForm', () => {
		it('should hide the new song form', () => {
			workspaceStore.showNewSongForm();
			workspaceStore.closeNewSongForm();

			expect(get(workspaceStore).showNewSong).toBe(false);
		});
	});

	describe('showTemplatesView', () => {
		it('should show templates and hide other panels', () => {
			workspaceStore.selectSong(makeTreeNode('My Song', '/path'));
			workspaceStore.showNewSongForm();
			workspaceStore.showTemplatesView();

			const state = get(workspaceStore);
			expect(state.showTemplates).toBe(true);
			expect(state.selectedSong).toBeNull();
			expect(state.showSongDetails).toBe(false);
			expect(state.showNewSong).toBe(false);
		});
	});

	describe('closeTemplatesView', () => {
		it('should hide the templates view', () => {
			workspaceStore.showTemplatesView();
			workspaceStore.closeTemplatesView();

			expect(get(workspaceStore).showTemplates).toBe(false);
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
			expect(s.showSongDetails).toBe(false);
			expect(s.showTemplates).toBe(false);
		});

		it('setActiveSection("templates") sets showTemplates true', () => {
			workspaceStore.setActiveSection('templates');
			expect(get(workspaceStore).showTemplates).toBe(true);
		});

		it('setActiveSection clears the cloud simfile selection', () => {
			workspaceStore.selectCloudSimFile(makeSimFile(3));
			workspaceStore.setActiveSection('library');
			const s = get(workspaceStore);
			expect(s.selectedCloudSimFile).toBeNull();
			expect(s.showCloudSongDetails).toBe(false);
		});
	});
});
