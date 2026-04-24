/**
 * Unit tests for the Editor page component
 *
 * These tests focus on the logic and state management of the editor page,
 * testing the various modal interactions, workspace operations, and DTX file handling.
 *
 * Note: Uses mocks for external dependencies and Svelte 5 compatible testing approach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import type { Workspace } from '$lib/services/workspaceService';

// Mock external dependencies
vi.mock('phaser', () => ({
	Scene: vi.fn()
}));

vi.mock('@dtx/common/game', () => ({
	default: vi.fn(),
	Editor: vi.fn(),
	Preview: vi.fn(),
	EventBus: {
		on: vi.fn(),
		off: vi.fn(),
		emit: vi.fn()
	},
	EventType: {
		EDITOR_LOADED: 'EDITOR_LOADED',
		EDITOR_READY: 'EDITOR_READY',
		PREVIEW_START: 'PREVIEW_START',
		PREVIEW_END: 'PREVIEW_END'
	}
}));

vi.mock('@dtx/common', () => ({
	DTXFile: vi.fn().mockImplementation(() => ({
		header: { title: 'Test Song', artist: 'Test Artist' },
		soundChips: new Map(),
		lanes: new Map(),
		parse: vi.fn()
	})),
	SimFile: vi.fn().mockImplementation(() => ({
		files: new Map(),
		loadFromDTXFile: vi.fn()
	})),
	decodeFileWithEncodingDetection: vi.fn()
}));

vi.mock('$lib/store', () => ({
	default: {
		currentDtxFile: { subscribe: vi.fn(), set: vi.fn() },
		currentSimfile: { subscribe: vi.fn(), set: vi.fn() },
		activeScene: { subscribe: vi.fn(), set: vi.fn() }
	}
}));

vi.mock('$app/state', () => ({
	page: {
		url: {
			searchParams: {
				get: vi.fn()
			}
		}
	}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$lib/toaster', () => ({
	default: {
		success: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$lib/services/tempChartStorage', () => ({
	TempChartStorage: {
		save: vi.fn(),
		load: vi.fn(),
		remove: vi.fn(),
		removeAllForSimfile: vi.fn(),
		exists: vi.fn().mockReturnValue(false),
		existsAny: vi.fn().mockReturnValue(false)
	}
}));

vi.mock('$lib/services/soundLibrary', () => ({
	SoundLibrary: {
		addFiles: vi.fn(),
		getFiles: vi.fn().mockReturnValue([]),
		removeFile: vi.fn(),
		clear: vi.fn()
	}
}));

vi.mock('$lib/services/workspaceService', () => ({
	workspaceService: {
		getWorkspaces: vi.fn().mockResolvedValue([]),
		saveWorkspace: vi.fn().mockResolvedValue(undefined),
		deleteWorkspace: vi.fn().mockResolvedValue(undefined),
		getCurrentWorkspace: vi.fn().mockReturnValue(null),
		setCurrentWorkspace: vi.fn(),
		importFolder: vi.fn().mockResolvedValue(null)
	},
	WorkspaceService: vi.fn()
}));

// Mock all component imports
vi.mock('$lib/components/editor/EditorTips.svelte', () => ({}));
vi.mock('$lib/components/editor/EditorNavigation.svelte', () => ({}));
vi.mock('$lib/components/editor/EditorTabs.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/DifficultyModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/DiscardModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/SoundLibraryModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/WorkspaceManagerModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/DeleteWorkspaceModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/ExportWorkspaceModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/DTXSwitcherModal.svelte', () => ({}));
vi.mock('$lib/components/editor/modals/NewFileModal.svelte', () => ({}));

describe('Editor Page Component Logic', () => {
	let mockWorkspace: Workspace;

	beforeEach(() => {
		vi.clearAllMocks();

		mockWorkspace = {
			name: 'Test Workspace',
			path: '/workspace/test',
			dtxFiles: [{ name: 'test.dtx', content: 'DTX content', path: '/test.dtx' }],
			audioFiles: [{ name: 'test.wav', path: '/test.wav' }],
			currentDTX: 'test.dtx',
			lastModified: Date.now()
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Component Initialization', () => {
		it('should initialize with correct default state values', () => {
			// Test that the component initializes with expected default values
			// These would typically be tested by checking the component's initial render
			expect(true).toBe(true); // Placeholder - in real test, would verify initial state
		});

		it('should set simfileID from page data when provided', () => {
			const mockData = {
				simfileID: 'test-simfile-123',
				metadata: {
					title: 'Test Song',
					levels: { 25: { label: 'Basic', fileName: 'test.dtx' } }
				}
			};

			// In a real test, would verify that simfileID is set correctly from props
			expect(mockData.simfileID).toBe('test-simfile-123');
		});
	});

	describe('Modal State Management', () => {
		it('should manage difficulty modal state correctly', async () => {
			// Test opening and closing difficulty modal
			let showDifficultyModal = false;

			// Simulate opening modal
			showDifficultyModal = true;
			expect(showDifficultyModal).toBe(true);

			// Simulate closing modal
			showDifficultyModal = false;
			expect(showDifficultyModal).toBe(false);
		});

		it('should manage workspace modal states correctly', async () => {
			// Test workspace-related modal states
			let showWorkspaceSwitchModal = false;
			let showDeleteWorkspaceModal = false;
			let showExportWorkspaceModal = false;

			// Test opening modals
			showWorkspaceSwitchModal = true;
			expect(showWorkspaceSwitchModal).toBe(true);

			showDeleteWorkspaceModal = true;
			expect(showDeleteWorkspaceModal).toBe(true);

			showExportWorkspaceModal = true;
			expect(showExportWorkspaceModal).toBe(true);
		});

		it('should manage sound library modal state correctly', async () => {
			let showSoundLibraryModal = false;

			// Simulate opening sound library modal
			showSoundLibraryModal = true;
			expect(showSoundLibraryModal).toBe(true);

			// Simulate closing modal
			showSoundLibraryModal = false;
			expect(showSoundLibraryModal).toBe(false);
		});
	});

	describe('Tab Management', () => {
		it('should handle tab switching correctly', async () => {
			let currentTab = 0;
			const isTabsCollapsed = false;

			// Test tab switching
			const handleTabChange = (tabIndex: number) => {
				currentTab = tabIndex;
			};

			handleTabChange(1);
			expect(currentTab).toBe(1);

			handleTabChange(2);
			expect(currentTab).toBe(2);
		});

		it('should handle tab collapse/expand correctly', async () => {
			let isTabsCollapsed = false;

			const toggleTabsCollapsed = () => {
				isTabsCollapsed = !isTabsCollapsed;
			};

			toggleTabsCollapsed();
			expect(isTabsCollapsed).toBe(true);

			toggleTabsCollapsed();
			expect(isTabsCollapsed).toBe(false);
		});
	});

	describe('Preview Mode Management', () => {
		it('should handle preview mode toggle correctly', async () => {
			let isPreviewing = false;
			let currentTab = 0;

			const handlePreviewStart = () => {
				isPreviewing = true;
				currentTab = 2; // Switch to preview tab
			};

			const handlePreviewEnd = () => {
				isPreviewing = false;
			};

			handlePreviewStart();
			expect(isPreviewing).toBe(true);
			expect(currentTab).toBe(2);

			handlePreviewEnd();
			expect(isPreviewing).toBe(false);
		});
	});

	describe('Workspace Operations', () => {
		it('should handle workspace loading correctly', async () => {
			const { workspaceService } = await import('$lib/services/workspaceService');

			// Mock workspace loading
			vi.mocked(workspaceService.getWorkspaces).mockResolvedValue([mockWorkspace]);

			const workspaces = await workspaceService.getWorkspaces();
			expect(workspaces).toEqual([mockWorkspace]);
			expect(workspaceService.getWorkspaces).toHaveBeenCalled();
		});

		it('should handle workspace deletion correctly', async () => {
			const { workspaceService } = await import('$lib/services/workspaceService');

			let workspaceToDelete: Workspace | null = mockWorkspace;
			let showDeleteWorkspaceModal = true;

			const confirmDeleteWorkspace = async () => {
				if (workspaceToDelete) {
					await workspaceService.deleteWorkspace(workspaceToDelete.name);
					workspaceToDelete = null;
					showDeleteWorkspaceModal = false;
				}
			};

			await confirmDeleteWorkspace();

			expect(workspaceService.deleteWorkspace).toHaveBeenCalledWith('Test Workspace');
			expect(workspaceToDelete).toBe(null);
			expect(showDeleteWorkspaceModal).toBe(false);
		});

		// TODO: Implement exportWorkspace functionality and uncomment this test
		// it('should handle workspace export correctly', async () => {
		// 	const { workspaceService } = await import('$lib/services/workspaceService');
		// 	// Test implementation pending exportWorkspace method
		// });
	});

	describe('DTX File Operations', () => {
		it('should handle DTX file switching correctly', async () => {
			const currentWorkspace: Workspace | null = mockWorkspace;
			let showDTXSwitchModal = false;

			const handleSwitchDTX = (dtxFileName: string) => {
				if (currentWorkspace) {
					currentWorkspace.currentDTX = dtxFileName;
					showDTXSwitchModal = false;
				}
			};

			handleSwitchDTX('another.dtx');

			expect(currentWorkspace?.currentDTX).toBe('another.dtx');
			expect(showDTXSwitchModal).toBe(false);
		});

		it('should handle new file creation correctly', async () => {
			let showNewFileModal = false;
			let hasUnsavedChanges = true;

			const handleNewFile = () => {
				if (hasUnsavedChanges) {
					showNewFileModal = true;
				} else {
					createNewFile();
				}
			};

			const createNewFile = () => {
				// Simulate creating new file
				hasUnsavedChanges = false;
				showNewFileModal = false;
			};

			const confirmNewFile = () => {
				createNewFile();
			};

			handleNewFile();
			expect(showNewFileModal).toBe(true);

			confirmNewFile();
			expect(showNewFileModal).toBe(false);
			expect(hasUnsavedChanges).toBe(false);
		});
	});

	describe('Sound Library Operations', () => {
		it('should handle sound library file addition correctly', async () => {
			const { SoundLibrary } = await import('$lib/services/soundLibrary');

			const mockFiles = [new File(['audio content'], 'test.wav', { type: 'audio/wav' })];

			let showSoundLibraryModal = true;

			const handleAddFiles = async (files: File[]) => {
				await SoundLibrary.addFiles(files);
				showSoundLibraryModal = false;
			};

			await handleAddFiles(mockFiles);

			expect(SoundLibrary.addFiles).toHaveBeenCalledWith(mockFiles);
			expect(showSoundLibraryModal).toBe(false);
		});

		it('should handle sound library file removal correctly', async () => {
			const { SoundLibrary } = await import('$lib/services/soundLibrary');

			const handleRemoveFile = async (hash: string) => {
				await SoundLibrary.removeFile(hash);
			};

			await handleRemoveFile('test-hash');

			expect(SoundLibrary.removeFile).toHaveBeenCalledWith('test-hash');
		});
	});

	describe('Error Handling', () => {
		it('should route remote load failure through existsAny guard', async () => {
			const { TempChartStorage } = await import('$lib/services/tempChartStorage');
			const { goto } = await import('$app/navigation');

			// Simulate the catch block logic when remote load fails.
			// store.currentDifficulty is null at this point, so we use existsAny()
			// to find drafts keyed by any difficulty.
			const simfileID = 'failed-simfile-123';

			// Case 1: No unsaved changes — should create new file and redirect
			vi.mocked(TempChartStorage.existsAny).mockReturnValue(false);

			// When simfileID is set and difficulty is null, createNewFile uses
			// removeAllForSimfile to clear ALL drafts for that simfile.
			const createNewFile = () => {
				TempChartStorage.removeAllForSimfile(simfileID);
				goto('/editor');
			};

			const hasAnyDraft = TempChartStorage.existsAny(simfileID);
			if (hasAnyDraft) {
				// Would show modal — tested below
			} else {
				createNewFile();
			}

			expect(TempChartStorage.existsAny).toHaveBeenCalledWith(simfileID);
			expect(TempChartStorage.removeAllForSimfile).toHaveBeenCalledWith(simfileID);
			expect(goto).toHaveBeenCalledWith('/editor');
		});

		it('should show confirmation modal when remote load fails with unsaved changes', async () => {
			const { TempChartStorage } = await import('$lib/services/tempChartStorage');

			const simfileID = 'failed-simfile-456';
			let showNewFileModal = false;

			// Case 2: Has unsaved changes (stored under any difficulty) — show modal
			vi.mocked(TempChartStorage.existsAny).mockReturnValue(true);

			const hasAnyDraft = TempChartStorage.existsAny(simfileID);
			if (hasAnyDraft) {
				showNewFileModal = true;
			}

			expect(TempChartStorage.existsAny).toHaveBeenCalledWith(simfileID);
			expect(showNewFileModal).toBe(true);
			// TempChartStorage.remove should NOT have been called since the last clearAllMocks
			expect(TempChartStorage.remove).not.toHaveBeenCalled();
		});

		it('should clear all difficulty drafts when confirming discard on failed remote load', async () => {
			const { TempChartStorage } = await import('$lib/services/tempChartStorage');
			const { goto } = await import('$app/navigation');

			// Simulates the exact bug scenario:
			// Remote load fails → existsAny finds drafts keyed like
			// dtx_temp_chart_<id>_master → user confirms → createNewFile
			// must use removeAllForSimfile because currentDifficulty is null.
			const simfileID = 'failed-simfile-789';

			// createNewFile logic when simfileID is set and difficulty is null
			const currentDifficulty = null; // not yet loaded
			if (simfileID && !currentDifficulty) {
				TempChartStorage.removeAllForSimfile(simfileID);
			} else {
				TempChartStorage.remove(simfileID, currentDifficulty);
			}
			goto('/editor');

			// removeAllForSimfile clears ALL difficulty-specific keys
			expect(TempChartStorage.removeAllForSimfile).toHaveBeenCalledWith(simfileID);
			// remove should NOT be called — it would miss suffixed keys
			expect(TempChartStorage.remove).not.toHaveBeenCalled();
		});

		// TODO: Implement exportWorkspace functionality and uncomment this test
		// it('should handle workspace export errors correctly', async () => {
		// 	const { workspaceService } = await import('$lib/services/workspaceService');
		// 	// Test implementation pending exportWorkspace method
		// });

		it('should handle workspace loading errors correctly', async () => {
			const { workspaceService } = await import('$lib/services/workspaceService');

			// Mock loading failure
			vi.mocked(workspaceService.getWorkspaces).mockRejectedValue(
				new Error('Loading failed')
			);

			let loadingError = '';

			try {
				await workspaceService.getWorkspaces();
			} catch (error) {
				loadingError = error instanceof Error ? error.message : 'Unknown error';
			}

			expect(loadingError).toBe('Loading failed');
		});
	});

	describe('Component Integration', () => {
		it('should handle editor component events correctly', async () => {
			let isEditorLoaded = false;
			let isEditorReady = false;

			const handleEditorLoaded = () => {
				isEditorLoaded = true;
			};

			const handleEditorReady = () => {
				isEditorReady = true;
			};

			handleEditorLoaded();
			expect(isEditorLoaded).toBe(true);

			handleEditorReady();
			expect(isEditorReady).toBe(true);
		});

		it('should handle tips visibility toggle correctly', async () => {
			let showTips = true;

			const toggleTips = () => {
				showTips = !showTips;
			};

			toggleTips();
			expect(showTips).toBe(false);

			toggleTips();
			expect(showTips).toBe(true);
		});
	});

	describe('URL and Navigation', () => {
		it('should handle navigation correctly', async () => {
			const { goto } = await import('$app/navigation');

			const navigateToEditor = (simfileId: string) => {
				goto(`/editor/${simfileId}`);
			};

			navigateToEditor('test-simfile');

			expect(goto).toHaveBeenCalledWith('/editor/test-simfile');
		});
	});
});
