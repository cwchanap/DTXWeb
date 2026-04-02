/**
 * Render tests for the Editor page Svelte component.
 * These ensure the component mounts and its initialization logic runs,
 * contributing to statement/line coverage of +page.svelte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('@dtx/common/game', () => ({
	default: vi.fn().mockReturnValue(null),
	Editor: { key: 'EditorScene' },
	Preview: { key: 'PreviewScene' },
	EventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
	EventType: {
		EDITOR_LOADED: 'EDITOR_LOADED',
		EDITOR_READY: 'EDITOR_READY',
		PREVIEW_START: 'PREVIEW_START',
		PREVIEW_END: 'PREVIEW_END'
	}
}));

vi.mock('@dtx/common', () => ({
	DTXFile: vi.fn(),
	SimFile: vi.fn(),
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
		remove: vi.fn(),
		exists: vi.fn().mockReturnValue(false)
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

const defaultData = { simfileID: null, metadata: null };

describe('Editor Page render', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
