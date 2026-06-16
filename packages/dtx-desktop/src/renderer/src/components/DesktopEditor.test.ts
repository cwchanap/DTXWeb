import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const mockEventBus = vi.hoisted(() => {
	const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
	return {
		on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(cb);
		}),
		off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			const arr = handlers.get(event);
			if (arr) {
				const idx = arr.indexOf(cb);
				if (idx >= 0) arr.splice(idx, 1);
			}
		}),
		emit: vi.fn((event: string, ...args: unknown[]) => {
			const arr = handlers.get(event);
			if (arr) arr.forEach((cb) => cb(...args));
		}),
		_reset: () => handlers.clear()
	};
});

vi.mock('@dtx/common/game', () => ({
	EventBus: mockEventBus,
	EventType: {
		VALIDATION_ERROR: 'validation-error',
		NOTE_IMPORT: 'note-import',
		STOP_PREVIEW: 'stop-preview'
	},
	Editor: { key: 'Editor' },
	Preloader: { key: 'Preloader' },
	MainMenu: { key: 'MainMenu' }
}));

const mockPhaserGame = vi.hoisted(() => ({
	events: {
		once: vi.fn((event: string, cb: () => void) => {
			if (event === 'ready') {
				setTimeout(cb, 0);
			}
		})
	},
	destroy: vi.fn(),
	scene: {
		getScene: vi.fn(() => null)
	}
}));

vi.mock('phaser', () => ({
	default: {
		Game: vi.fn(() => mockPhaserGame),
		AUTO: 0
	},
	Game: vi.fn(() => mockPhaserGame),
	AUTO: 0
}));

vi.mock('../scenes/DesktopPreview', () => ({
	DesktopPreview: { key: 'Preview' }
}));

const mockDesktopHost = vi.hoisted(() => ({
	readFile: vi.fn(),
	listFiles: vi.fn()
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

const mockStore = vi.hoisted(() => ({
	currentSimfileID: { set: vi.fn() },
	currentDifficulty: { set: vi.fn() },
	currentDtxFile: { set: vi.fn() },
	editorNotes: { set: vi.fn() },
	currentSoundChip: { set: vi.fn() },
	measureCount: { set: vi.fn() },
	currentSimfile: { set: vi.fn() },
	activeScene: { set: vi.fn() }
}));

vi.mock('@dtx/common', () => ({
	store: mockStore,
	DTXFile: vi.fn(function (this: object, input?: unknown) {
		Object.assign(this, {
			title: 'Mock',
			artist: 'Mock Artist',
			comment: '',
			bpm: 120,
			level: 1
		});
	}),
	LaneMeasureNote: vi.fn(),
	SimFile: vi.fn(),
	SoundChip: vi.fn(),
	setFileProvider: vi.fn(),
	isValidDtxFile: vi.fn().mockReturnValue(true)
}));

const mockFileProvider = vi.hoisted(() => ({
	DesktopFileProvider: vi.fn(function (this: object, workspaceRoot?: string) {
		Object.assign(this, {
			setWorkspaceRoot: vi.fn(),
			getWorkspaceRoot: vi.fn(() => workspaceRoot || '')
		});
	})
}));

vi.mock('../services/desktopFileProvider', () => mockFileProvider);

vi.mock('../stores/editorMappingStore', () => ({
	editorMappingStore: {
		getSongMetadata: vi.fn(),
		getFolderPath: vi.fn()
	}
}));

import DesktopEditor from './DesktopEditor.svelte';

describe('DesktopEditor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventBus._reset();
		mockDesktopHost.readFile.mockResolvedValue({ error: 'not found', content: '' });
		mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: null });
		vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it('renders the editor header with New Chart when no simFileId', () => {
		render(DesktopEditor);
		expect(screen.getByText(/New Chart/)).toBeInTheDocument();
	});

	it('renders Back to Workspace button', () => {
		render(DesktopEditor);
		expect(screen.getByRole('button', { name: /Back to Workspace/i })).toBeInTheDocument();
	});

	it('navigates back to workspace when Back button is clicked', async () => {
		render(DesktopEditor);
		await fireEvent.click(screen.getByRole('button', { name: /Back to Workspace/i }));
		expect(window.location.hash).toBe('');
	});

	it('registers a validation error event listener on mount', () => {
		render(DesktopEditor);
		expect(mockEventBus.on).toHaveBeenCalledWith('validation-error', expect.any(Function));
	});

	it('displays validation error when event is emitted and auto-hides it', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render(DesktopEditor);
		// Wait for loading to finish so the main tab is visible
		await waitFor(() => {
			expect(screen.getByText('Main')).toBeInTheDocument();
		});

		mockEventBus.emit('validation-error', 'Invalid note position');
		await waitFor(() => {
			expect(screen.getByText('Invalid note position')).toBeInTheDocument();
		});

		vi.advanceTimersByTime(5000);
		await waitFor(() => {
			expect(screen.queryByText('Invalid note position')).toBeNull();
		});
		vi.useRealTimers();
	});

	it('can dismiss validation error manually', async () => {
		render(DesktopEditor);
		await waitFor(() => {
			expect(screen.getByText('Main')).toBeInTheDocument();
		});

		mockEventBus.emit('validation-error', 'Something went wrong');
		await waitFor(() => {
			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		});

		const dismissBtn = screen.getByRole('button', { name: '×' });
		await fireEvent.click(dismissBtn);
		await waitFor(() => {
			expect(screen.queryByText('Something went wrong')).toBeNull();
		});
	});

	it('removes the validation error listener on destroy', () => {
		const { unmount } = render(DesktopEditor);
		unmount();
		expect(mockEventBus.off).toHaveBeenCalledWith('validation-error', expect.any(Function));
	});

	it('initializes the Phaser game on mount', async () => {
		render(DesktopEditor);
		await waitFor(() => {
			expect(mockStore.activeScene.set).toHaveBeenCalledWith('Editor');
		});
	});

	it('destroys the Phaser game on unmount', async () => {
		const { unmount } = render(DesktopEditor);
		await waitFor(() => {
			expect(vi.mocked(mockPhaserGame.events.once)).toHaveBeenCalled();
		});
		unmount();
		expect(mockPhaserGame.destroy).toHaveBeenCalledWith(true);
	});

	it('switches to the Sound tab when clicked', async () => {
		render(DesktopEditor);
		await waitFor(() => expect(screen.queryByText('Sound')).toBeInTheDocument());
		await fireEvent.click(screen.getByText('Sound'));
		// Sound tab click should not throw
		expect(screen.getByText('Sound')).toBeInTheDocument();
	});

	it('switches to the Preview tab when clicked', async () => {
		render(DesktopEditor);
		await waitFor(() => expect(screen.queryByText('Preview')).toBeInTheDocument());
		await fireEvent.click(screen.getByText('Preview'));
		expect(screen.getByText('Preview')).toBeInTheDocument();
	});

	it('collapses and expands the sidebar via keyboard', async () => {
		render(DesktopEditor);
		const resizeHandle = screen.getByLabelText('Resize sidebar');

		// Press Enter to collapse
		await fireEvent.keyDown(resizeHandle, { key: 'Enter' });
		// Now tabs should be hidden (collapsed state)
		expect(screen.queryByText('Main')).toBeNull();

		// Click on collapsed sidebar to expand
		const collapsedHandle = screen.getByTitle('Drag to expand sidebar');
		await fireEvent.click(collapsedHandle);
		expect(screen.getByText('Main')).toBeInTheDocument();
	});

	it('handles initialization error gracefully without crashing', async () => {
		mockDesktopHost.listFiles.mockRejectedValue(new Error('IPC failed'));
		render(DesktopEditor);
		// Should not throw, just log error
		await waitFor(() => {
			expect(screen.queryByText('Initializing editor...')).toBeNull();
		});
	});

	it('surfaces a visible chart load error when list-files returns an error', async () => {
		// A workspace path in storage triggers loadChartFromPath on mount.
		// Spy on the localStorage instance (not the prototype) so it shadows
		// the beforeEach prototype spy cleanly.
		vi.spyOn(localStorage, 'getItem').mockReturnValue('/test/workspace');
		mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: 'permission-denied' });
		render(DesktopEditor);

		await waitFor(() => {
			expect(screen.getByText(/Could not load chart files/)).toBeInTheDocument();
		});
	});

	it('shows simFileId in header when provided', () => {
		render(DesktopEditor, { props: { simFileId: 'test-song-42' } });
		expect(screen.getByText(/test-song-42/)).toBeInTheDocument();
	});
});
