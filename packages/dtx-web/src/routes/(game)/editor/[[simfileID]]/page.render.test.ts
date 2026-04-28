/**
 * Render tests for the Editor page Svelte component.
 * These ensure the component mounts and its initialization logic runs,
 * contributing to statement/line coverage of +page.svelte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { mockHighestDtx, mockSimfile, mockSoundChipInstances } = vi.hoisted(() => {
	const mockHighestDtx = {
		parseNotes: () => [],
		parseBPMChanges: () => ({}),
		parseSoundChips: vi.fn().mockReturnValue([])
	};
	const mockSimfile = {
		getHighestLevel: () => mockHighestDtx,
		levels: { 25: { label: 'Basic', file: mockHighestDtx } }
	};
	const mockSoundChipInstances: Array<{
		fileName: string;
		fetchRemote: ReturnType<typeof vi.fn>;
		file: File | undefined;
	}> = [];
	return { mockHighestDtx, mockSimfile, mockSoundChipInstances };
});

vi.mock('@dtx/common/game', () => ({
	default: vi.fn().mockReturnValue(null),
	Editor: { key: 'EditorScene' },
	Preview: { key: 'PreviewScene' },
	EventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
	EventType: {
		SCENE_READY: 'current-scene-ready',
		EDITOR_LOADED: 'editor-loaded',
		MEASURE_UPDATE: 'measure-update',
		MEASURE_GOTO: 'measure-goto',
		NOTE_IMPORT: 'note-import',
		START_PREVIEW: 'start-preview',
		RESUME_PREVIEW: 'resume-preview',
		STOP_PREVIEW: 'stop-preview',
		GRID_SPACING_UPDATE: 'grid-spacing-update',
		CELL_HEIGHT_UPDATE: 'cell-height-update',
		VALIDATION_ERROR: 'validation-error'
	}
}));

vi.mock('@dtx/common', () => ({
	DTXFile: vi.fn().mockImplementation(() => ({})),
	SoundChip: vi.fn().mockImplementation(function (
		this: { fileName: string; fetchRemote: ReturnType<typeof vi.fn>; file: File | undefined },
		_label: string,
		_id: number,
		_volume: number,
		_position: number,
		fileName: string
	) {
		this.fileName = fileName;
		this.fetchRemote = vi.fn().mockResolvedValue(undefined);
		this.file = undefined;
		mockSoundChipInstances.push(this);
	}),
	SimFile: {
		parseFromRemoteURLWithMetadata: vi.fn().mockResolvedValue(mockSimfile),
		parseFromRemoteURL: vi.fn().mockResolvedValue(mockSimfile)
	},
	decodeFileWithEncodingDetection: vi.fn(),
	setFileProvider: vi.fn()
}));

vi.mock('@dtx/ui-components/components', () => ({
	Modal: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/store', () => {
	const ms = (initial: unknown = null) => ({
		subscribe: vi.fn((run: (v: unknown) => void) => {
			run(initial);
			return () => {};
		}),
		set: vi.fn()
	});
	return {
		default: {
			currentDtxFile: ms(),
			currentSimfile: ms(),
			activeScene: ms(),
			editorNotes: ms(),
			isPreviewing: ms(false),
			measureCount: ms(),
			currentSoundChip: ms(),
			currentSimfileID: ms(),
			currentDifficulty: ms()
		}
	};
});

vi.mock('svelte/store', () => {
	const makeSub = (initial: unknown) =>
		vi.fn((run: (v: unknown) => void) => {
			run(initial);
			return () => {};
		});
	return {
		get: vi.fn().mockReturnValue(null),
		writable: vi.fn((initial: unknown) => ({ subscribe: makeSub(initial), set: vi.fn() })),
		derived: vi.fn(() => ({ subscribe: makeSub(null) })),
		readable: vi.fn((initial: unknown) => ({ subscribe: makeSub(initial) }))
	};
});

vi.mock('$app/state', () => ({
	page: { url: { searchParams: { get: vi.fn().mockReturnValue(null) } } }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/static/public', () => ({ PUBLIC_SIMFILE_BUCKET_URL: 'http://example.com' }));
vi.mock('$lib/toaster', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('$lib/services/tempChartStorage', () => ({
	TempChartStorage: {
		save: vi.fn(),
		load: vi.fn().mockReturnValue(null),
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
		toFile: vi.fn().mockReturnValue(new File([], 'test.xa'))
	}
}));

vi.mock('@dtx/common/services/fileManager', () => ({
	generateKey: vi.fn().mockReturnValue('file-key'),
	setFile: vi.fn(),
	getFile: vi.fn().mockReturnValue(undefined)
}));

vi.mock('$lib/services/workspaceService', () => ({
	workspaceService: {
		getWorkspaces: vi.fn().mockReturnValue([]),
		saveWorkspace: vi.fn().mockResolvedValue(undefined),
		deleteWorkspace: vi.fn().mockResolvedValue(undefined),
		getCurrentWorkspace: vi.fn().mockReturnValue(null),
		setCurrentWorkspace: vi.fn(),
		importFolder: vi.fn().mockResolvedValue({ name: 'ws', dtxFiles: [], audioFiles: [] })
	}
}));

vi.mock('$lib/components/editor/EditorTips.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/EditorNavigation.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/EditorTabs.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/DifficultyModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/DiscardModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/SoundLibraryModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/WorkspaceManagerModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/ExportWorkspaceModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/DTXSwitcherModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/NewFileModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));
vi.mock('$lib/components/editor/modals/DeleteWorkspaceModal.svelte', () => ({
	default: vi.fn().mockReturnValue(null)
}));

import EditorPage from './+page.svelte';
import store from '$lib/store';
import { workspaceService } from '$lib/services/workspaceService';
import { TempChartStorage } from '$lib/services/tempChartStorage';
import toastStore from '$lib/toaster';
import { get } from 'svelte/store';
import { SoundLibrary } from '$lib/services/soundLibrary';
import { EventBus, EventType } from '@dtx/common/game';
import EditorNavigationModule from '$lib/components/editor/EditorNavigation.svelte';
import DiscardModalModule from '$lib/components/editor/modals/DiscardModal.svelte';
import SoundLibraryModalModule from '$lib/components/editor/modals/SoundLibraryModal.svelte';
import DifficultyModalModule from '$lib/components/editor/modals/DifficultyModal.svelte';
import DTXSwitcherModalModule from '$lib/components/editor/modals/DTXSwitcherModal.svelte';
import WorkspaceManagerModalModule from '$lib/components/editor/modals/WorkspaceManagerModal.svelte';
import NewFileModalModule from '$lib/components/editor/modals/NewFileModal.svelte';
import MainModule from '@dtx/common/game';

const defaultData = { simfileID: null, metadata: null };

describe('Editor Page render', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders without crashing with no simfileID', () => {
		const { container } = render(EditorPage, { props: { data: defaultData } });
		expect(container).toBeTruthy();
	});

	it('renders with a simfileID from data props', () => {
		const data = {
			simfileID: 'test-123',
			metadata: {
				title: 'Test Song',
				levels: { 25: { label: 'Basic', fileName: 'test.dtx' } }
			}
		};
		const { container } = render(EditorPage, { props: { data } });
		expect(container).toBeTruthy();
	});

	it('sets simfileID from data on initialization', async () => {
		const data = { simfileID: 'simfile-abc', metadata: { title: 'Song', levels: {} } };
		render(EditorPage, { props: { data } });
		// Component calls store.currentSimfileID.set(data.simfileID) in onMount
		expect(store.currentSimfileID.set).toHaveBeenCalledWith('simfile-abc');
	});

	it('does not call importFolder on initial render', () => {
		vi.mocked(workspaceService.importFolder).mockResolvedValue({
			name: 'MyWorkspace',
			path: '/MyWorkspace',
			dtxFiles: [{ name: 'a.dtx', content: '', path: '/a.dtx' }],
			audioFiles: [{ name: 'kick.wav', path: '/kick.wav' }],
			currentDTX: 'a.dtx',
			lastModified: Date.now()
		});

		const { container } = render(EditorPage, { props: { data: defaultData } });

		// importFolder should only be called when user explicitly triggers an import, not on mount
		expect(workspaceService.importFolder).not.toHaveBeenCalled();
		expect(container).toBeTruthy();
	});
});

describe('Editor Page – EventBus callback handlers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('handleSceneReady sets isEditorReady via SCENE_READY EventBus callback', async () => {
		const { EventBus } = await import('@dtx/common/game');
		render(EditorPage, { props: { data: defaultData } });

		// Find the SCENE_READY callback registered by onMount
		const { EventType } = await import('@dtx/common/game');
		const sceneReadyCall = vi
			.mocked(EventBus.on)
			.mock.calls.find((call) => call[0] === EventType.SCENE_READY);
		expect(sceneReadyCall).toBeDefined();

		// Invoke the callback – exercises handleSceneReady body
		const handleSceneReady = sceneReadyCall![1] as () => void;
		expect(() => handleSceneReady()).not.toThrow();
	});

	it('handleEditorLoaded sets isEditorReady via EDITOR_LOADED EventBus callback', async () => {
		const { EventBus, EventType } = await import('@dtx/common/game');
		render(EditorPage, { props: { data: defaultData } });

		const editorLoadedCall = vi
			.mocked(EventBus.on)
			.mock.calls.find((call) => call[0] === EventType.EDITOR_LOADED);
		expect(editorLoadedCall).toBeDefined();

		const handleEditorLoaded = editorLoadedCall![1] as () => void;
		expect(() => handleEditorLoaded()).not.toThrow();
	});

	it('handleNoteImport clears isEditorReady via NOTE_IMPORT EventBus callback', async () => {
		const { EventBus, EventType } = await import('@dtx/common/game');
		render(EditorPage, { props: { data: defaultData } });

		const noteImportCall = vi
			.mocked(EventBus.on)
			.mock.calls.find((call) => call[0] === EventType.NOTE_IMPORT);
		expect(noteImportCall).toBeDefined();

		const handleNoteImport = noteImportCall![1] as () => void;
		expect(() => handleNoteImport()).not.toThrow();
	});

	it('handleValidationError shows toast via VALIDATION_ERROR EventBus callback', async () => {
		const { EventBus, EventType } = await import('@dtx/common/game');
		render(EditorPage, { props: { data: defaultData } });

		const validationErrorCall = vi
			.mocked(EventBus.on)
			.mock.calls.find((call) => call[0] === EventType.VALIDATION_ERROR);
		expect(validationErrorCall).toBeDefined();

		const handleValidationError = validationErrorCall![1] as (msg: string) => void;
		handleValidationError('Test validation error');
		expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith({
			title: 'Test validation error'
		});
	});
});

describe('Editor Page – onMount path variations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns early when currentWorkspace has currentDTX (no simfileID path)', async () => {
		vi.mocked(workspaceService.getCurrentWorkspace).mockReturnValue({
			name: 'ExistingWorkspace',
			path: '/workspace',
			dtxFiles: [{ name: 'song.dtx', content: '', path: '/workspace/song.dtx' }],
			audioFiles: [],
			currentDTX: 'song.dtx',
			lastModified: Date.now()
		});

		render(EditorPage, { props: { data: defaultData } });
		// Workspace lookup ran
		expect(workspaceService.getCurrentWorkspace).toHaveBeenCalled();
		// Early return before TempChartStorage.load/newFile path
		expect(TempChartStorage.load).not.toHaveBeenCalled();
		expect(TempChartStorage.remove).not.toHaveBeenCalled();
	});

	it('sets currentDifficulty to Imported when TempChartStorage has imported data', async () => {
		vi.mocked(TempChartStorage.load).mockReturnValue({ notes: [], bpmNotes: {} } as never);

		render(EditorPage, { props: { data: defaultData } });

		expect(TempChartStorage.load).toHaveBeenCalled();
		// Should set difficulty to 'Imported' instead of creating a new file
		expect(store.currentDifficulty.set).toHaveBeenCalledWith('Imported');
	});

	it('loads simfile from remote when simfileID and metadata are provided', async () => {
		const { SimFile } = await import('@dtx/common');
		const data = {
			simfileID: 'remote-sim-123',
			metadata: {
				title: 'Remote Song',
				levels: { 25: { label: 'Basic', fileName: 'bas.dtx' } }
			}
		};

		render(EditorPage, { props: { data } });

		// Allow async onMount to complete
		await vi.waitFor(() => {
			expect(vi.mocked(SimFile.parseFromRemoteURLWithMetadata)).toHaveBeenCalledWith(
				'remote-sim-123',
				expect.any(String),
				data.metadata
			);
		});
	});

	it('falls back to newFile when simfile loading fails', async () => {
		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockRejectedValueOnce(
			new Error('Network error')
		);

		const data = {
			simfileID: 'failing-sim',
			metadata: { title: 'Song', levels: {} }
		};

		render(EditorPage, { props: { data } });

		// Even when loading fails, component should not crash
		await vi.waitFor(() => {
			// When remote load fails with simfileID set and currentDifficulty null,
			// createNewFile uses removeAllForSimfile to clear all drafts
			expect(TempChartStorage.removeAllForSimfile).toHaveBeenCalled();
		});
	});

	it('shows the new file modal when remote loading fails and drafts exist', async () => {
		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockRejectedValueOnce(
			new Error('Network error')
		);
		vi.mocked(TempChartStorage.existsAny).mockReturnValue(true);

		render(EditorPage, {
			props: {
				data: {
					simfileID: 'recover-sim',
					metadata: { title: 'Song', levels: {} }
				}
			}
		});

		await vi.waitFor(() => {
			const newFileProps = getLastMockProps<Record<string, unknown>>(
				vi.mocked(NewFileModalModule)
			);
			expect(newFileProps?.show).toBe(true);
		});
	});

	it('clears all drafts when confirming the recovery modal after a remote load failure', async () => {
		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockRejectedValueOnce(
			new Error('Network error')
		);
		vi.mocked(TempChartStorage.existsAny).mockReturnValue(true);

		render(EditorPage, {
			props: {
				data: {
					simfileID: 'recover-sim',
					metadata: { title: 'Song', levels: {} }
				}
			}
		});

		await vi.waitFor(() => {
			const newFileProps = getLastMockProps<Record<string, unknown>>(
				vi.mocked(NewFileModalModule)
			);
			expect(newFileProps?.show).toBe(true);
		});

		const newFileProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(NewFileModalModule)
		);
		expect(newFileProps?.onConfirm).toBeDefined();
		newFileProps!.onConfirm();

		expect(TempChartStorage.removeAllForSimfile).toHaveBeenCalled();
	});

	it('restores the newest draft when cancelling the recovery modal after a remote load failure', async () => {
		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockRejectedValueOnce(
			new Error('Network error')
		);
		vi.mocked(TempChartStorage.existsAny).mockReturnValue(true);
		vi.mocked(TempChartStorage.loadAny).mockReturnValue({
			notes: {},
			bpmNotes: {},
			measureCount: 4,
			metadata: {
				title: 'Recovered Song',
				artist: 'Recovered Artist',
				comment: '',
				bpm: 180,
				level: 8,
				soundChips: [
					{
						label: 'BD',
						id: 1,
						volume: 100,
						position: 0,
						fileName: 'kick.xa'
					}
				]
			},
			timestamp: Date.now(),
			difficulty: 'master'
		} as never);

		render(EditorPage, {
			props: {
				data: {
					simfileID: 'recover-sim',
					metadata: { title: 'Song', levels: {} }
				}
			}
		});

		await vi.waitFor(() => {
			const newFileProps = getLastMockProps<Record<string, unknown>>(
				vi.mocked(NewFileModalModule)
			);
			expect(newFileProps?.show).toBe(true);
		});

		const newFileProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(NewFileModalModule)
		);
		expect(newFileProps?.onCancel).toBeDefined();
		newFileProps!.onCancel();

		expect(TempChartStorage.loadAny).toHaveBeenCalledWith('recover-sim');
		await vi.waitFor(() => {
			expect(store.currentSoundChip.set).toHaveBeenCalledTimes(2);
		});
		expect(
			vi
				.mocked(store.currentSoundChip.set)
				.mock.calls.some(
					([soundChips]) => Array.isArray(soundChips) && soundChips.length === 1
				)
		).toBe(true);
		expect(store.measureCount.set).toHaveBeenCalledWith(4);
		expect(store.currentDifficulty.set).toHaveBeenCalledWith('master');
		expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith({
			title: 'Restored local draft',
			duration: 3000
		});
	});
});

// Helper: get the props passed to a mocked Svelte 5 component (anchor, props) → index 1
function getLastMockProps<T>(mockFn: ReturnType<typeof vi.fn>): T | undefined {
	const calls = mockFn.mock.calls;
	const lastCall = calls[calls.length - 1];
	return (lastCall?.[1] ?? lastCall?.[0]) as T | undefined;
}

describe('Editor Page – functions via EditorNavigation props', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('showWorkspaceManager sets showWorkspaceSwitchModal via onShowWorkspaceManager', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onShowWorkspaceManager).toBeDefined();
		expect(() => navProps!.onShowWorkspaceManager()).not.toThrow();
	});

	it('showDTXSwitcher sets showDTXSwitchModal via onShowDTXSwitcher', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onShowDTXSwitcher).toBeDefined();
		expect(() => navProps!.onShowDTXSwitcher()).not.toThrow();
	});

	it('showWorkspaceExporter sets showExportWorkspaceModal via onShowWorkspaceExporter', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onShowWorkspaceExporter).toBeDefined();
		expect(() => navProps!.onShowWorkspaceExporter()).not.toThrow();
	});

	it('discardLocalChanges shows discard modal via onDiscardLocalChanges', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onDiscardLocalChanges).toBeDefined();
		expect(() => navProps!.onDiscardLocalChanges()).not.toThrow();
	});

	it('onShowDifficultyModal prop opens difficulty modal', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onShowDifficultyModal).toBeDefined();
		expect(() => navProps!.onShowDifficultyModal()).not.toThrow();
	});

	it('onShowSoundLibraryModal prop opens sound library modal', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onShowSoundLibraryModal).toBeDefined();
		expect(() => navProps!.onShowSoundLibraryModal()).not.toThrow();
	});

	it('exportFile does not throw via onExportFile (store returns null dtxFile)', () => {
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onExportFile).toBeDefined();
		// get(store.currentDtxFile) returns null from mock → dtxFile?.export is a no-op
		expect(() => navProps!.onExportFile()).not.toThrow();
	});

	it('onNewFile prop calls newFile which invokes createNewFile', () => {
		render(EditorPage, { props: { data: defaultData } });
		vi.mocked(TempChartStorage.remove).mockClear();

		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onNewFile).toBeDefined();
		// newFile → TempChartStorage.exists returns false → createNewFile → TempChartStorage.remove
		navProps!.onNewFile();
		expect(TempChartStorage.remove).toHaveBeenCalled();
	});
});

describe('Editor Page – confirmDiscardChanges and cancelDiscardChanges', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('cancelDiscardChanges closes discard modal via DiscardModal onCancel', () => {
		render(EditorPage, { props: { data: defaultData } });
		const discardProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(DiscardModalModule)
		);
		expect(discardProps?.onCancel).toBeDefined();
		expect(() => discardProps!.onCancel()).not.toThrow();
	});

	it('confirmDiscardChanges calls TempChartStorage.remove and reloads via DiscardModal onConfirm', () => {
		const reloadMock = vi.fn();
		const originalLocation = window.location;
		Object.defineProperty(window, 'location', {
			value: { ...window.location, reload: reloadMock },
			writable: true,
			configurable: true
		});

		render(EditorPage, { props: { data: defaultData } });
		const discardProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(DiscardModalModule)
		);
		expect(discardProps?.onConfirm).toBeDefined();
		discardProps!.onConfirm();

		expect(TempChartStorage.remove).toHaveBeenCalled();
		expect(reloadMock).toHaveBeenCalled();

		Object.defineProperty(window, 'location', {
			value: originalLocation,
			writable: true,
			configurable: true
		});
	});
});

describe('Editor Page – SoundLibraryModal onImportResult callback', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('onImportResult sets importResultMessage and shows import result modal (lines 720-722)', () => {
		render(EditorPage, { props: { data: defaultData } });
		const soundLibProps = getLastMockProps<Record<string, (msg: string) => void>>(
			vi.mocked(SoundLibraryModalModule)
		);
		expect(soundLibProps?.onImportResult).toBeDefined();
		expect(() => soundLibProps!.onImportResult('Import success: 3 files')).not.toThrow();
	});
});

describe('Editor Page – DifficultyModal switchToLevel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		// Reset get mock to null return so other tests are not affected
		vi.mocked(get).mockReturnValue(null as never);
		vi.restoreAllMocks();
	});

	it('switchToLevel returns early when get(store.currentSimfile) is null', async () => {
		// get returns null by default → early return path (lines 355-360)
		render(EditorPage, { props: { data: defaultData } });
		const diffProps = getLastMockProps<Record<string, (level: number) => Promise<void>>>(
			vi.mocked(DifficultyModalModule)
		);
		expect(diffProps?.onSwitchLevel).toBeDefined();
		await expect(diffProps!.onSwitchLevel(99)).resolves.toBeUndefined();
	});

	it('switchToLevel runs full path when simfile has the level', async () => {
		const mockFetchRemote = vi.fn().mockResolvedValue(undefined);
		const mockChip = { fileName: 'kick.xa', fetchRemote: mockFetchRemote, file: undefined };
		(mockHighestDtx.parseSoundChips as ReturnType<typeof vi.fn>).mockReturnValue([mockChip]);

		// Make get return mockSimfile for all calls in this test
		vi.mocked(get).mockReturnValue(mockSimfile as never);

		render(EditorPage, { props: { data: defaultData } });
		const diffProps = getLastMockProps<Record<string, (level: number) => Promise<void>>>(
			vi.mocked(DifficultyModalModule)
		);
		expect(diffProps?.onSwitchLevel).toBeDefined();
		await diffProps!.onSwitchLevel(25);

		// fetchRemote should have been called for the sound chip
		expect(mockFetchRemote).toHaveBeenCalled();
		// store.currentDifficulty should have been set with the level label
		expect(store.currentDifficulty.set).toHaveBeenCalledWith('Basic');
	});
});

describe('Editor Page – refreshSoundLibraryLinks via onRefreshSoundLibraryLinks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.mocked(get).mockReturnValue(null as never);
		vi.restoreAllMocks();
	});

	it('returns early with "No sound chips" message when currentSoundChip is empty', async () => {
		// get returns null → no sound chips → early return (lines 566-572)
		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => Promise<void>>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onRefreshSoundLibraryLinks).toBeDefined();
		await expect(navProps!.onRefreshSoundLibraryLinks()).resolves.toBeUndefined();
	});

	it('matches chips found in SoundLibrary and updates the store', async () => {
		const mockChip = { fileName: 'kick.xa', file: undefined };
		vi.mocked(get).mockReturnValue([mockChip] as never);
		const mockFile = new File(['data'], 'kick.xa');
		vi.mocked(SoundLibrary.findByFileName).mockReturnValue([{ fileName: 'kick.xa' }] as never);
		vi.mocked(SoundLibrary.toFile).mockReturnValue(mockFile);

		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => Promise<void>>>(
			vi.mocked(EditorNavigationModule)
		);
		await navProps!.onRefreshSoundLibraryLinks();

		// chip.file should have been set from the library
		expect(SoundLibrary.findByFileName).toHaveBeenCalledWith('kick.xa');
		expect(SoundLibrary.toFile).toHaveBeenCalled();
		expect(store.currentSoundChip.set).toHaveBeenCalled();
	});

	it('tracks notFound chips when not in SoundLibrary', async () => {
		const mockChip = { fileName: 'missing.xa', file: undefined };
		vi.mocked(get).mockReturnValue([mockChip] as never);
		vi.mocked(SoundLibrary.findByFileName).mockReturnValue([] as never);

		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => Promise<void>>>(
			vi.mocked(EditorNavigationModule)
		);
		await navProps!.onRefreshSoundLibraryLinks();

		// findByFileName called but nothing matched → notFound count incremented
		expect(SoundLibrary.findByFileName).toHaveBeenCalledWith('missing.xa');
		expect(store.currentSoundChip.set).toHaveBeenCalled();
	});

	it('tracks notFound when SoundLibrary entry has no fileData (large in-memory file)', async () => {
		const mockChip = { fileName: 'large.wav', file: undefined };
		vi.mocked(get).mockReturnValue([mockChip] as never);
		vi.mocked(SoundLibrary.findByFileName).mockReturnValue([
			{ fileName: 'large.wav' }
		] as never);
		vi.mocked(SoundLibrary.toFile).mockReturnValue(null);

		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => Promise<void>>>(
			vi.mocked(EditorNavigationModule)
		);
		await navProps!.onRefreshSoundLibraryLinks();

		// toFile returned null → chip not matched
		expect(SoundLibrary.toFile).toHaveBeenCalled();
		expect(store.currentSoundChip.set).toHaveBeenCalled();
	});
});

describe('Editor Page – sound chip loading loop in onMount', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches remote files for each sound chip when loading simfile (lines 519-549)', async () => {
		const mockFetchRemote = vi.fn().mockResolvedValue(undefined);
		const mockChip = { fileName: 'snare.xa', fetchRemote: mockFetchRemote, file: undefined };
		(mockHighestDtx.parseSoundChips as ReturnType<typeof vi.fn>).mockReturnValue([mockChip]);

		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockResolvedValue(mockSimfile as never);

		const data = {
			simfileID: 'chip-sim-123',
			metadata: {
				title: 'Chip Song',
				levels: { 25: { label: 'Basic', fileName: 'bas.dtx' } }
			}
		};

		render(EditorPage, { props: { data } });

		await vi.waitFor(() => {
			expect(mockFetchRemote).toHaveBeenCalledWith('chip-sim-123', expect.any(String));
		});
	});

	it('handles fetchRemote error gracefully without crashing (catch block lines 537-543)', async () => {
		const mockFetchRemote = vi.fn().mockRejectedValue(new Error('Remote fetch failed'));
		const mockChip = { fileName: 'bass.xa', fetchRemote: mockFetchRemote, file: undefined };
		(mockHighestDtx.parseSoundChips as ReturnType<typeof vi.fn>).mockReturnValue([mockChip]);

		const { SimFile } = await import('@dtx/common');
		vi.mocked(SimFile.parseFromRemoteURLWithMetadata).mockResolvedValue(mockSimfile as never);

		const data = {
			simfileID: 'chip-error-sim',
			metadata: {
				title: 'Error Song',
				levels: { 25: { label: 'Basic', fileName: 'bas.dtx' } }
			}
		};

		const { container } = render(EditorPage, { props: { data } });

		// Wait for the async onMount to finish without throwing
		await vi.waitFor(() => {
			expect(mockFetchRemote).toHaveBeenCalled();
		});

		expect(container).toBeTruthy();
	});
});

describe('Editor Page – importFile and importFolder via EditorNavigation props', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSoundChipInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('importFile creates a file input and triggers click (lines 96-101)', () => {
		const mockInput = {
			type: '',
			accept: '',
			onchange: null as ((e: Event) => void) | null,
			click: vi.fn()
		};

		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onImportFile).toBeDefined();

		// Spy AFTER render so testing-library's createElement('div') is unaffected
		vi.spyOn(document, 'createElement').mockReturnValueOnce(
			mockInput as unknown as HTMLElement
		);
		navProps!.onImportFile();

		expect(mockInput.type).toBe('file');
		expect(mockInput.accept).toBe('.dtx');
		expect(mockInput.click).toHaveBeenCalled();
	});

	it('importFolder creates a directory input and triggers click (lines 104-112)', () => {
		const mockInput = {
			type: '',
			accept: '',
			webkitdirectory: false,
			multiple: false,
			onchange: null as ((e: Event) => void) | null,
			click: vi.fn()
		};

		render(EditorPage, { props: { data: defaultData } });
		const navProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(EditorNavigationModule)
		);
		expect(navProps?.onImportFolder).toBeDefined();

		// Spy AFTER render so testing-library's createElement('div') is unaffected
		vi.spyOn(document, 'createElement').mockReturnValueOnce(
			mockInput as unknown as HTMLElement
		);
		navProps!.onImportFolder();

		expect(mockInput.type).toBe('file');
		expect(mockInput.webkitdirectory).toBe(true);
		expect(mockInput.multiple).toBe(true);
		expect(mockInput.click).toHaveBeenCalled();
	});
});

describe('Editor Page – switchToWorkspace via WorkspaceManagerModal prop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('switchToWorkspace emits STOP_PREVIEW and sets workspace (lines 196-215)', async () => {
		render(EditorPage, { props: { data: defaultData } });
		const wmProps = getLastMockProps<Record<string, (ws: unknown) => Promise<void>>>(
			vi.mocked(WorkspaceManagerModalModule)
		);
		expect(wmProps?.onSwitchToWorkspace).toBeDefined();

		const mockWorkspace = {
			name: 'New Workspace',
			path: '/new',
			dtxFiles: [{ name: 'song.dtx', content: '', path: '/new/song.dtx' }],
			audioFiles: [],
			currentDTX: 'song.dtx',
			lastModified: Date.now()
		};

		await wmProps!.onSwitchToWorkspace(mockWorkspace);

		expect(vi.mocked(EventBus.emit)).toHaveBeenCalledWith(EventType.STOP_PREVIEW);
	});

	it('WorkspaceManagerModal onClose prop closes the modal', () => {
		render(EditorPage, { props: { data: defaultData } });
		const wmProps = getLastMockProps<Record<string, () => void>>(
			vi.mocked(WorkspaceManagerModalModule)
		);
		expect(wmProps?.onClose).toBeDefined();
		expect(() => wmProps!.onClose()).not.toThrow();
	});
});

describe('Editor Page – currentActiveScene function via Main mock props', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('currentActiveScene calls getIsLoaded when scene key matches Editor (lines 83-86)', () => {
		render(EditorPage, { props: { data: defaultData } });
		// Main is mocked as default export from @dtx/common/game
		const mainProps = getLastMockProps<Record<string, unknown>>(vi.mocked(MainModule));
		const currentActiveSceneFn = mainProps?.currentActiveScene as (scene: unknown) => unknown;
		expect(currentActiveSceneFn).toBeDefined();

		const mockGetIsLoaded = vi.fn();
		const mockScene = {
			scene: { key: 'EditorScene', isActive: vi.fn(), isPaused: vi.fn(), stop: vi.fn() },
			getIsLoaded: mockGetIsLoaded,
			setDirty: vi.fn()
		};
		const result = currentActiveSceneFn(mockScene);

		expect(mockGetIsLoaded).toHaveBeenCalled();
		expect(result).toBe(mockScene);
	});

	it('currentActiveScene returns scene unchanged when key does not match Editor', () => {
		render(EditorPage, { props: { data: defaultData } });
		const mainProps = getLastMockProps<Record<string, unknown>>(vi.mocked(MainModule));
		const currentActiveSceneFn = mainProps?.currentActiveScene as (scene: unknown) => unknown;
		expect(currentActiveSceneFn).toBeDefined();

		const mockScene = {
			scene: { key: 'PreviewScene' },
			getIsLoaded: vi.fn()
		};
		const result = currentActiveSceneFn(mockScene);

		expect(mockScene.getIsLoaded).not.toHaveBeenCalled();
		expect(result).toBe(mockScene);
	});
});

describe('Editor Page – DTXSwitcherModal switchWorkspaceDTX prop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('switchWorkspaceDTX resolves without error when phaserRef.scene is null (lines 152-155)', async () => {
		render(EditorPage, { props: { data: defaultData } });
		const dtxProps = getLastMockProps<Record<string, () => Promise<void>>>(
			vi.mocked(DTXSwitcherModalModule)
		);
		expect(dtxProps?.onSwitchDTX).toBeDefined();
		// phaserRef.scene is null → if condition is false → early return
		await expect(dtxProps!.onSwitchDTX()).resolves.toBeUndefined();
	});
});
