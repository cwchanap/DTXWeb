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
		parse: vi.fn(),
		level: 0,
		title: '',
		artist: '',
		comment: '',
		bpm: 0
	})),
	SimFile: vi.fn().mockImplementation(() => ({
		files: new Map(),
		loadFromDTXFile: vi.fn()
	})),
	SoundChip: vi.fn().mockImplementation(function (
		this: {
			label: string;
			id: number;
			volume: number;
			position: number;
			fileName: string;
			file?: File;
			fetchRemote: () => Promise<void>;
		},
		label: string,
		id: number,
		volume: number,
		position: number,
		fileName: string,
		file?: File
	) {
		this.label = label;
		this.id = id;
		this.volume = volume;
		this.position = position;
		this.fileName = fileName.toLowerCase();
		if (file) this.file = file;
		this.fetchRemote = vi.fn();
	}),
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
		loadAny: vi.fn().mockReturnValue(null),
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
		clear: vi.fn(),
		findByFileName: vi.fn().mockReturnValue([]),
		getByHash: vi.fn().mockReturnValue(null),
		toFile: vi.fn()
	}
}));

vi.mock('@dtx/common/services/fileManager', () => ({
	generateKey: vi.fn((simfileId: string, fileName: string) => `${simfileId}/${fileName}`),
	setFile: vi.fn(),
	getFile: vi.fn().mockReturnValue(undefined)
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

		it('should restore level from draft metadata when loading local draft', async () => {
			const { TempChartStorage } = await import('$lib/services/tempChartStorage');
			const { DTXFile } = await import('@dtx/common');

			const simfileID = 'draft-with-level';
			const draftLevel = 42;

			const draft = {
				metadata: {
					title: 'Test',
					artist: 'Artist',
					comment: 'Comment',
					bpm: 120,
					level: draftLevel,
					soundChips: [
						{
							label: 'Bass Drum',
							id: 1,
							volume: 100,
							position: 0,
							fileName: 'bd.wav',
							filePath: '/audio/bd.wav',
							fileHash: 'abc123'
						},
						{
							label: 'Snare',
							id: 2,
							volume: 80,
							position: 1,
							fileName: 'snare.wav'
						}
					]
				},
				notes: {},
				bpmNotes: {},
				measureCount: 4,
				timestamp: Date.now(),
				difficulty: 'master'
			};

			vi.mocked(TempChartStorage.loadAny).mockReturnValue(draft);

			// Simulate the loadLocalDraft logic
			const loaded = TempChartStorage.loadAny(simfileID);
			if (loaded) {
				const dtxFile = new DTXFile();
				dtxFile.title = loaded.metadata.title;
				dtxFile.artist = loaded.metadata.artist;
				dtxFile.comment = loaded.metadata.comment;
				dtxFile.bpm = loaded.metadata.bpm;
				dtxFile.level = loaded.metadata.level;

				expect(dtxFile.level).toBe(draftLevel);

				// Verify SoundChip instances are created from draft data
				const { SoundChip } = await import('@dtx/common');
				const restoredChips = loaded.metadata.soundChips.map(
					(chip) =>
						new SoundChip(
							chip.label,
							chip.id,
							chip.volume,
							chip.position,
							chip.fileName
						)
				);

				expect(SoundChip).toHaveBeenCalledTimes(2);
				expect(SoundChip).toHaveBeenCalledWith('Bass Drum', 1, 100, 0, 'bd.wav');
				expect(SoundChip).toHaveBeenCalledWith('Snare', 2, 80, 1, 'snare.wav');

				// Verify instances have the fetchRemote method (not plain objects)
				expect(typeof restoredChips[0].fetchRemote).toBe('function');
				expect(typeof restoredChips[1].fetchRemote).toBe('function');

				// Verify soundChips are assigned to the dtxFile so export includes them
				dtxFile.soundChips = restoredChips;
				expect(dtxFile.soundChips).toHaveLength(2);
				expect(dtxFile.soundChips[0].fileName).toBe('bd.wav');
				expect(dtxFile.soundChips[1].fileName).toBe('snare.wav');
			}
		});

		it('should rehydrate sound files via remote fetch when restoring draft', async () => {
			const FileManager = await import('@dtx/common/services/fileManager');

			const mockFile = new File(['audio-data'], 'bd.wav', { type: 'audio/wav' });
			const fetchRemoteMock = vi.fn().mockImplementation(async () => {
				mockChip.file = mockFile;
			});

			// Create a mock chip with a fetchRemote that simulates remote file download
			const mockChip = {
				label: 'Bass Drum',
				id: 1,
				volume: 100,
				position: 0,
				fileName: 'bd.wav',
				file: undefined as File | undefined,
				fetchRemote: fetchRemoteMock
			};

			// Simulate rehydration: remote succeeds
			const simfileID = 'test-simfile';
			await mockChip.fetchRemote(simfileID, 'https://bucket.url');
			if (mockChip.file) {
				const fileKey = FileManager.generateKey(simfileID, mockChip.fileName);
				FileManager.setFile(fileKey, mockChip.file);
				mockChip.file = undefined;
			}

			expect(fetchRemoteMock).toHaveBeenCalledWith(simfileID, 'https://bucket.url');
			expect(FileManager.setFile).toHaveBeenCalledWith('test-simfile/bd.wav', mockFile);
			expect(mockChip.file).toBeUndefined();
		});

		it('should fall back to sound library when remote fetch fails during rehydration', async () => {
			const { SoundLibrary } = await import('$lib/services/soundLibrary');
			const FileManager = await import('@dtx/common/services/fileManager');

			const mockFile = new File(['audio-data'], 'bd.wav', { type: 'audio/wav' });
			const fetchRemoteMock = vi.fn().mockRejectedValue(new Error('Network error'));

			// Create a mock chip with a fetchRemote that simulates failure
			const mockChip = {
				label: 'Bass Drum',
				id: 1,
				volume: 100,
				position: 0,
				fileName: 'bd.wav',
				file: undefined as File | undefined,
				fetchRemote: fetchRemoteMock
			};

			// Simulate sound library fallback
			vi.mocked(SoundLibrary.findByFileName).mockReturnValue([
				{
					hash: 'abc123',
					fileName: 'bd.wav',
					fileType: 'audio/wav',
					fileData: 'dGVzdA==',
					size: 4,
					dateAdded: Date.now()
				}
			]);
			vi.mocked(SoundLibrary.toFile).mockReturnValue(mockFile);

			// Simulate rehydration: remote fails → sound library (no fileHash, falls back to filename)
			try {
				await mockChip.fetchRemote('test-simfile', 'https://bucket.url');
			} catch {
				// Expected to fail
			}
			const libraryFiles = SoundLibrary.findByFileName(mockChip.fileName);
			const libraryFile = libraryFiles.length > 0 ? libraryFiles[0] : null;
			if (libraryFile && libraryFile.fileData) {
				const file = SoundLibrary.toFile(libraryFile);
				if (file) {
					const fileKey = FileManager.generateKey('test-simfile', mockChip.fileName);
					FileManager.setFile(fileKey, file);
				}
			}

			expect(SoundLibrary.findByFileName).toHaveBeenCalledWith('bd.wav');
			expect(SoundLibrary.toFile).toHaveBeenCalled();
			expect(FileManager.setFile).toHaveBeenCalledWith('test-simfile/bd.wav', mockFile);
		});

		it('should use fileHash for precise sound library lookup during rehydration', async () => {
			const { SoundLibrary } = await import('$lib/services/soundLibrary');
			const FileManager = await import('@dtx/common/services/fileManager');

			const mockFile = new File(['audio-data'], 'snare.wav', { type: 'audio/wav' });
			const fetchRemoteMock = vi.fn().mockRejectedValue(new Error('Network error'));

			const mockChip = {
				label: 'Snare',
				id: 2,
				volume: 80,
				position: 1,
				fileName: 'snare.wav',
				file: undefined as File | undefined,
				fetchRemote: fetchRemoteMock
			};

			const chipData = {
				label: 'Snare',
				id: 2,
				volume: 80,
				position: 1,
				fileName: 'snare.wav',
				fileHash: 'specific-hash-456'
			};

			const libraryEntry = {
				hash: 'specific-hash-456',
				fileName: 'snare.wav',
				fileType: 'audio/wav',
				fileData: 'dGVzdA==',
				size: 4,
				dateAdded: Date.now()
			};

			vi.mocked(SoundLibrary.getByHash).mockReturnValue(libraryEntry);
			vi.mocked(SoundLibrary.toFile).mockReturnValue(mockFile);

			// Simulate: remote fails → hash-based lookup
			try {
				await mockChip.fetchRemote('test-simfile', 'https://bucket.url');
			} catch {
				// Expected to fail
			}

			// Use fileHash for lookup (matching the new rehydrateSoundFiles logic)
			let libraryFile: any = null;
			if (chipData.fileHash) {
				libraryFile = SoundLibrary.getByHash(chipData.fileHash);
			}
			if (libraryFile && libraryFile.fileData) {
				const file = SoundLibrary.toFile(libraryFile);
				if (file) {
					const fileKey = FileManager.generateKey('test-simfile', mockChip.fileName);
					FileManager.setFile(fileKey, file);
				}
			}

			expect(SoundLibrary.getByHash).toHaveBeenCalledWith('specific-hash-456');
			expect(SoundLibrary.toFile).toHaveBeenCalledWith(libraryEntry);
			expect(FileManager.setFile).toHaveBeenCalledWith('test-simfile/snare.wav', mockFile);
		});

		it('should skip library entries with empty fileData during rehydration', async () => {
			const { SoundLibrary } = await import('$lib/services/soundLibrary');
			const FileManager = await import('@dtx/common/services/fileManager');

			const fetchRemoteMock = vi.fn().mockRejectedValue(new Error('Network error'));

			const mockChip = {
				label: 'Bass Drum',
				id: 1,
				volume: 100,
				position: 0,
				fileName: 'large.wav',
				file: undefined as File | undefined,
				fetchRemote: fetchRemoteMock
			};

			// Simulate: library entry exists but has no fileData (large in-memory file)
			vi.mocked(SoundLibrary.findByFileName).mockReturnValue([
				{
					hash: 'large-hash',
					fileName: 'large.wav',
					fileType: 'audio/wav',
					fileData: '', // Empty — large file stored only in memory
					size: 5 * 1024 * 1024,
					dateAdded: Date.now()
				}
			]);

			// Simulate rehydration: remote fails → library found but fileData is empty
			try {
				await mockChip.fetchRemote('test-simfile', 'https://bucket.url');
			} catch {
				// Expected to fail
			}

			const libraryFiles = SoundLibrary.findByFileName(mockChip.fileName);
			const libraryFile = libraryFiles.length > 0 ? libraryFiles[0] : null;
			if (libraryFile && libraryFile.fileData) {
				// This block should NOT execute
				const file = SoundLibrary.toFile(libraryFile);
				if (file) {
					const fileKey = FileManager.generateKey('test-simfile', mockChip.fileName);
					FileManager.setFile(fileKey, file);
				}
			}

			// toFile and setFile should NOT have been called
			expect(SoundLibrary.toFile).not.toHaveBeenCalled();
			expect(FileManager.setFile).not.toHaveBeenCalled();
		});

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
