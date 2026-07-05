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
		STOP_PREVIEW: 'stop-preview',
		START_PREVIEW: 'start-preview',
		CELL_HEIGHT_UPDATE: 'cell-height-update'
	},
	Editor: { key: 'Editor' },
	Preloader: { key: 'Preloader' },
	MainMenu: { key: 'MainMenu' }
}));

vi.mock('@dtx/common/components', () => ({
	MainTab: vi.fn(),
	SoundTab: vi.fn(),
	PreviewTab: vi.fn()
}));

const mockPhaserGame = vi.hoisted(() => {
	let destroyCallback: (() => void) | null = null;
	return {
		events: {
			once: vi.fn((event: string, cb: () => void) => {
				if (event === 'ready') {
					setTimeout(cb, 0);
				} else if (event === 'destroy') {
					destroyCallback = cb;
				}
			})
		},
		destroy: vi.fn(),
		scene: {
			getScene: vi.fn(() => null)
		},
		_takeDestroyCallback: () => {
			const cb = destroyCallback;
			destroyCallback = null;
			return cb;
		}
	};
});

const mockPhaserState = vi.hoisted(() => ({
	isDestroying: false,
	successfulGames: 0
}));

vi.mock('phaser', () => ({
	default: {
		Game: vi.fn(() => {
			if (mockPhaserState.isDestroying) {
				throw new Error('Previous Phaser game is still destroying');
			}
			mockPhaserState.successfulGames += 1;
			return mockPhaserGame;
		}),
		AUTO: 0
	},
	Game: vi.fn(() => {
		if (mockPhaserState.isDestroying) {
			throw new Error('Previous Phaser game is still destroying');
		}
		mockPhaserState.successfulGames += 1;
		return mockPhaserGame;
	}),
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
	currentDtxFile: {
		set: vi.fn(),
		subscribe: vi.fn((cb: (v: unknown) => void) => {
			cb(null);
			return () => {};
		})
	},
	editorNotes: { set: vi.fn() },
	currentSoundChip: { set: vi.fn() },
	measureCount: {
		set: vi.fn(),
		subscribe: vi.fn((cb: (v: unknown) => void) => {
			cb(10);
			return () => {};
		})
	},
	currentSimfile: { set: vi.fn() },
	activeScene: { set: vi.fn() },
	isPreviewing: {
		set: vi.fn(),
		subscribe: vi.fn((cb: (v: unknown) => void) => {
			cb(false);
			return () => {};
		})
	}
}));

vi.mock('@dtx/common', () => ({
	store: mockStore,
	DTXFile: vi.fn(function (this: object, input?: unknown) {
		Object.assign(this, {
			title: 'Mock',
			artist: 'Mock Artist',
			comment: '',
			bpm: 120,
			level: 1,
			parse: vi.fn(async () => {}),
			parseSoundChips: vi.fn(() => []),
			parseNotes: vi.fn(() => []),
			parseBPMChanges: vi.fn(() => ({}))
		});
	}),
	LaneMeasureNote: vi.fn(),
	SimFile: vi.fn(function (this: object, files?: unknown[]) {
		Object.assign(this, {
			title: 'Mock SimFile',
			parseHeader: vi.fn(async () => {})
		});
	}),
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
import { editorMappingStore } from '../stores/editorMappingStore';
import Phaser from 'phaser';

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
};

describe('DesktopEditor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventBus._reset();
		mockPhaserState.isDestroying = false;
		mockPhaserState.successfulGames = 0;
		mockPhaserGame.destroy.mockImplementation(() => {
			mockPhaserState.isDestroying = true;
			setTimeout(() => {
				mockPhaserState.isDestroying = false;
				// Simulate Phaser's DESTROY event firing after async teardown.
				const cb = mockPhaserGame._takeDestroyCallback();
				if (cb) cb();
			}, 0);
		});
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

	it('renders the back button', () => {
		render(DesktopEditor);
		expect(screen.getByRole('button', { name: 'Back to library' })).toBeInTheDocument();
	});

	it('navigates back to workspace when Back button is clicked', async () => {
		render(DesktopEditor);
		await fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));
		expect(window.location.hash).toBe('');
	});

	it('registers a validation error event listener on mount', () => {
		render(DesktopEditor);
		expect(mockEventBus.on).toHaveBeenCalledWith('validation-error', expect.any(Function));
	});

	it('displays validation error when event is emitted and auto-hides it', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render(DesktopEditor);

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

	it('does not finish a stale editor initialization after unmount', async () => {
		vi.spyOn(localStorage, 'getItem').mockReturnValue('/test/workspace');
		const pendingWorkspaceLoad = createDeferred<{ files: []; error: null }>();
		mockDesktopHost.listFiles.mockReturnValueOnce(pendingWorkspaceLoad.promise);

		const { unmount } = render(DesktopEditor);
		await waitFor(() => {
			expect(mockDesktopHost.listFiles).toHaveBeenCalledWith(
				'/test/workspace',
				'/test/workspace'
			);
		});

		unmount();
		pendingWorkspaceLoad.resolve({ files: [], error: null });
		await Promise.resolve();
		await Promise.resolve();

		expect(Phaser.Game).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it('waits for a previous Phaser game teardown before booting a remounted editor', async () => {
		const firstRender = render(DesktopEditor);
		await waitFor(() => {
			expect(mockPhaserState.successfulGames).toBe(1);
		});

		firstRender.unmount();
		const secondRender = render(DesktopEditor);
		await waitFor(() => {
			expect(mockPhaserState.successfulGames).toBe(2);
		});
		expect(screen.queryByText(/Initializing editor/)).toBeNull();

		secondRender.unmount();
	});

	it('collapses and expands the sidebar via keyboard', async () => {
		render(DesktopEditor);
		const resizeHandle = screen.getByLabelText('Resize sidebar');

		// Press Enter to collapse
		await fireEvent.keyDown(resizeHandle, { key: 'Enter' });
		// Now Chart Info button should be hidden (collapsed state)
		expect(screen.queryByRole('button', { name: /Chart Info/i })).toBeNull();

		// Click on collapsed sidebar to expand
		const collapsedHandle = screen.getByTitle('Expand dock');
		await fireEvent.click(collapsedHandle);
		expect(screen.getByRole('button', { name: /Chart Info/i })).toBeInTheDocument();
	});

	it('lets the editor sidebar be dragged to a compact width before collapsing', async () => {
		render(DesktopEditor);
		const resizeHandle = screen.getByLabelText('Resize sidebar');

		await fireEvent.mouseDown(resizeHandle, { clientX: 320 });
		await fireEvent.mouseMove(document, { clientX: 120 });
		await fireEvent.mouseUp(document);

		expect(resizeHandle.parentElement?.style.width).toBe('120px');
		expect(screen.getByRole('button', { name: /Chart Info/i })).toBeInTheDocument();
	});

	it('handles initialization error gracefully without crashing', async () => {
		mockDesktopHost.listFiles.mockRejectedValue(new Error('IPC failed'));
		render(DesktopEditor);
		// Should not throw, just log error
		await waitFor(() => {
			expect(screen.queryByText(/Initializing editor/)).toBeNull();
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

	describe('loadFromSimFileId', () => {
		it('loads SET.def and DTX files from the mapped folder path', async () => {
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/test-song',
				songName: 'Test Song'
			});
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath.includes('SET.def')) {
					return { kind: 'text', error: null, content: '#TITLE Test Song' };
				}
				if (filePath.endsWith('.dtx')) {
					return {
						kind: 'text',
						error: null,
						content: '#TITLE Test Song\n#ARTIST Artist'
					};
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({
				files: [{ fileName: 'ext.dtx' }, { fileName: 'mas.dtx' }],
				error: null
			});

			render(DesktopEditor, { props: { simFileId: 'test-song-42' } });

			await waitFor(() => {
				expect(mockDesktopHost.readFile).toHaveBeenCalledWith(
					'/songs/test-song/SET.def',
					'/songs/test-song'
				);
			});
			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'note-import',
					expect.any(Array),
					expect.any(Object)
				);
			});
		});

		it('falls back to lowercase set.def when uppercase fails', async () => {
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/test-song',
				songName: 'Test Song'
			});
			let setDefCallCount = 0;
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath === '/songs/test-song/SET.def') {
					setDefCallCount++;
					return { kind: 'error', error: 'not found', content: '' };
				}
				if (filePath === '/songs/test-song/set.def') {
					return { kind: 'text', error: null, content: '#TITLE Lowercase' };
				}
				if (filePath.endsWith('.dtx')) {
					return { kind: 'text', error: null, content: '#TITLE Test' };
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: null });

			render(DesktopEditor, { props: { simFileId: 'test-song-42' } });

			await waitFor(() => {
				expect(mockDesktopHost.readFile).toHaveBeenCalledWith(
					'/songs/test-song/set.def',
					'/songs/test-song'
				);
			});
		});

		it('loads DTX files with binary content using toUtf8String', async () => {
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/binary',
				songName: 'Binary Song'
			});
			const dtxContent = new Uint8Array([0x23, 0x54, 0x49, 0x54, 0x4c, 0x45]); // "#TITLE"
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath.endsWith('.dtx')) {
					return { kind: 'binary', error: null, content: dtxContent };
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: null });

			render(DesktopEditor, { props: { simFileId: 'binary-song' } });

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'note-import',
					expect.any(Array),
					expect.any(Object)
				);
			});
		});

		it('accepts ArrayBuffer binary content (distinct from Uint8Array) for DTX files', async () => {
			// toUtf8String → toArrayBuffer has two branches: pass-through for
			// ArrayBuffer and copy for Uint8Array. The previous test exercises
			// the Uint8Array path; this one ensures the ArrayBuffer instanceof
			// branch (which returns content unchanged) is also covered.
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/arraybuffer',
				songName: 'ArrayBuffer Song'
			});
			// Build a real ArrayBuffer (not a Uint8Array view) so the
			// `content instanceof ArrayBuffer` branch is taken.
			const buffer = new Uint8Array([0x23, 0x54, 0x49, 0x54, 0x4c, 0x45]).buffer;
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath.endsWith('.dtx')) {
					return { kind: 'binary', error: null, content: buffer };
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: null });

			render(DesktopEditor, { props: { simFileId: 'arraybuffer-song' } });

			await waitFor(() => {
				expect(mockEventBus.emit).toHaveBeenCalledWith(
					'note-import',
					expect.any(Array),
					expect.any(Object)
				);
			});
		});

		it('handles errors in loadFromSimFileId and sets default metadata', async () => {
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue(null);
			vi.mocked(editorMappingStore.getFolderPath).mockReturnValue(null);
			mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: null });

			render(DesktopEditor, { props: { simFileId: 'error-song' } });

			// Should not crash, should show the editor
			await waitFor(() => {
				expect(screen.queryByText(/Initializing editor/)).toBeNull();
			});
		});
	});

	describe('switchChartDifficulty', () => {
		it('switches difficulty and loads the new DTX file when selector changes', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/multi',
				songName: 'Multi Song'
			});
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath.endsWith('.dtx')) {
					return { kind: 'text', error: null, content: '#TITLE Multi Song' };
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({
				files: [{ fileName: 'ext.dtx' }, { fileName: 'adv.dtx' }],
				error: null
			});

			render(DesktopEditor, { props: { simFileId: 'multi-song' } });

			// Wait for chart to load and difficulty selector to appear
			await waitFor(() => {
				expect(screen.queryByRole('combobox')).not.toBeNull();
			});

			const selector = screen.queryByRole('combobox');
			expect(selector).not.toBeNull();

			await fireEvent.change(selector!, { target: { value: 'adv.dtx' } });

			// Verify STOP_PREVIEW was emitted immediately
			expect(mockEventBus.emit).toHaveBeenCalledWith('stop-preview');

			// Advance timers to trigger the NOTE_IMPORT setTimeout
			vi.advanceTimersByTime(150);
			expect(mockEventBus.emit).toHaveBeenCalledWith(
				'note-import',
				expect.any(Array),
				expect.any(Object)
			);

			// Advance timers for the preview cleanup
			vi.advanceTimersByTime(250);

			vi.useRealTimers();
		});

		it('handles readFile error during difficulty switch', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			vi.mocked(editorMappingStore.getSongMetadata).mockReturnValue({
				folderPath: '/songs/multi',
				songName: 'Multi Song'
			});
			mockDesktopHost.readFile.mockImplementation(async (filePath: string) => {
				if (filePath.endsWith('.dtx')) {
					return { kind: 'text', error: null, content: '#TITLE Multi Song' };
				}
				return { kind: 'error', error: 'not found', content: '' };
			});
			mockDesktopHost.listFiles.mockResolvedValue({
				files: [{ fileName: 'ext.dtx' }, { fileName: 'adv.dtx' }],
				error: null
			});

			render(DesktopEditor, { props: { simFileId: 'multi-song' } });

			await waitFor(() => {
				expect(screen.queryByRole('combobox')).not.toBeNull();
			});

			// Make readFile return error for the difficulty switch
			mockDesktopHost.readFile.mockResolvedValue({
				kind: 'error',
				error: 'denied',
				content: ''
			});

			const selector = screen.getByRole('combobox');
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			await fireEvent.change(selector, { target: { value: 'adv.dtx' } });

			await waitFor(() => {
				expect(consoleError).toHaveBeenCalledWith('Failed to load DTX file:', 'adv.dtx');
			});
			consoleError.mockRestore();
			vi.useRealTimers();
		});
	});

	describe('loadChartFromPath error handling', () => {
		it('surfaces error when listFiles returns an error', async () => {
			vi.spyOn(localStorage, 'getItem').mockReturnValue('/test/workspace');
			mockDesktopHost.listFiles.mockResolvedValue({ files: [], error: 'access-denied' });

			render(DesktopEditor);

			await waitFor(() => {
				expect(screen.getByText(/Could not load chart files/)).toBeInTheDocument();
			});
		});

		it('catches errors from listFiles rejection gracefully', async () => {
			vi.spyOn(localStorage, 'getItem').mockReturnValue('/test/workspace');
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockDesktopHost.listFiles.mockRejectedValue(new Error('network failure'));

			render(DesktopEditor);

			await waitFor(() => {
				expect(consoleError).toHaveBeenCalledWith(
					'Error loading chart from path:',
					expect.any(Error)
				);
			});
			consoleError.mockRestore();
		});
	});
});
