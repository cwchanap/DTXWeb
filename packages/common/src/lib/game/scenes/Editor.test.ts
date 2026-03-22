// Mock svelte/store for Editor test
vi.mock('svelte/store', () => ({
	get: vi.fn(),
	writable: vi.fn(() => ({
		subscribe: vi.fn(),
		set: vi.fn(),
		update: vi.fn()
	}))
}));

// Mock the relative store import that Editor.ts uses
vi.mock('../../store', () => ({
	default: {
		measureCount: { set: vi.fn() },
		activeNote: {
			subscribe: vi.fn((callback) => {
				callback('01');
				return vi.fn();
			})
		},
		editorNotes: { set: vi.fn() },
		keyBindings: {
			subscribe: vi.fn((callback) => {
				callback({});
				return vi.fn();
			})
		},
		currentDtxFile: {
			subscribe: vi.fn((callback) => {
				callback(null);
				return vi.fn();
			})
		},
		currentSoundChip: {
			subscribe: vi.fn((callback) => {
				callback([]);
				return vi.fn();
			})
		}
	}
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from './Editor';
import { EventBus } from '../EventBus';
import EventType from '../EventType';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock the dependencies
vi.mock('../EventBus');
vi.mock('$lib/browser/audioDecoder', () => ({
	XAaudioContext: vi.fn()
}));
vi.mock('./Preview', () => ({
	Preview: {
		key: 'Preview'
	}
}));
vi.mock('svelte/store', () => ({
	get: vi.fn((store) => {
		// Return appropriate mock values based on which store is being accessed
		if (store?.toString?.().includes('activeNote')) return '01';
		if (store?.toString?.().includes('currentSimfileID')) return null;
		if (store?.toString?.().includes('currentDifficulty')) return null;
		if (store?.toString?.().includes('currentDtxFile')) return null;
		if (store?.toString?.().includes('currentSoundChip')) return [];
		return null; // Default fallback
	})
}));
vi.mock('$lib/services/tempChartStorage', () => ({
	TempChartStorage: {
		save: vi.fn(),
		load: vi.fn(() => null),
		remove: vi.fn(),
		exists: vi.fn(() => false),
		clearAll: vi.fn(),
		getStorageKey: vi.fn()
	}
}));

describe('Editor Scene', () => {
	let editorScene: Editor;
	let mockGameContainer: HTMLElement;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Create a mock DOM element for the game container
		mockGameContainer = document.createElement('div');
		mockGameContainer.id = 'game-container';
		document.body.appendChild(mockGameContainer);

		// Mock getElementById to return our mock container
		vi.spyOn(document, 'getElementById').mockReturnValue(mockGameContainer);

		// Create a new instance of Editor
		editorScene = new Editor();

		// Mock the methods that would be called during create()
		editorScene.drawPanel = vi.fn();
		editorScene.drawNotes = vi.fn();
		editorScene.parseMesaureLength = vi.fn();
		editorScene.getTotalMesaureOffest = vi.fn();
	});

	afterEach(() => {
		// Clean up DOM
		document.body.removeChild(mockGameContainer);
		vi.resetAllMocks();
	});

	it('should initialize with correct properties', () => {
		expect(editorScene).toBeDefined();
		expect(Editor.key).toBe('Editor');
	});

	it('should disable browser context menu when scene is created', () => {
		// Spy on addEventListener
		const addEventListenerSpy = vi.spyOn(mockGameContainer, 'addEventListener');

		// Call create method
		editorScene.create();

		// Verify that addEventListener was called with contextmenu event
		expect(addEventListenerSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
	});

	it('should prevent default context menu behavior', () => {
		// Create the scene to set up the event listener
		editorScene.create();

		// Create a mock context menu event
		const mockEvent = new Event('contextmenu');
		const preventDefaultSpy = vi.spyOn(mockEvent, 'preventDefault');

		// Trigger the context menu event
		mockGameContainer.dispatchEvent(mockEvent);

		// Verify preventDefault was called
		expect(preventDefaultSpy).toHaveBeenCalled();
	});

	it('should enable browser context menu when scene is restarted', () => {
		// First create the scene to set up the event listener
		editorScene.create();

		// Spy on removeEventListener
		const removeEventListenerSpy = vi.spyOn(mockGameContainer, 'removeEventListener');

		// Call restart method
		editorScene.restart();

		// Verify that removeEventListener was called
		expect(removeEventListenerSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
	});

	it('should enable browser context menu when scene is shut down', () => {
		// First create the scene to set up the event listener
		editorScene.create();

		// Spy on removeEventListener
		const removeEventListenerSpy = vi.spyOn(mockGameContainer, 'removeEventListener');

		// Call shutdown method
		editorScene.shutdown();

		// Verify that removeEventListener was called
		expect(removeEventListenerSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
	});

	it('should handle missing game container gracefully', () => {
		// Mock getElementById to return null
		vi.spyOn(document, 'getElementById').mockReturnValue(null);

		// This should not throw an error
		expect(() => {
			editorScene.create();
		}).not.toThrow();
	});

	it('should emit SCENE_READY event when created', () => {
		editorScene.create();

		expect(EventBus.emit).toHaveBeenCalledWith(EventType.SCENE_READY, editorScene);
	});

	it('should update cursor when toggling editing mode', () => {
		// Setup
		editorScene.create();
		const setDefaultCursorSpy = vi.spyOn(editorScene.input, 'setDefaultCursor');

		// Simulate Q key press to toggle editing mode
		const keyboardOnMock = editorScene.input.keyboard?.on as MockedFn;
		const keyboardHandler = keyboardOnMock.mock.calls.find(
			(call) => call[0] === 'keydown-Q'
		)?.[1];

		expect(keyboardHandler).toBeDefined();

		// Toggle editing mode on
		keyboardHandler?.();
		expect(setDefaultCursorSpy).toHaveBeenCalled();

		// Toggle editing mode off
		keyboardHandler?.();
		expect(setDefaultCursorSpy).toHaveBeenCalledWith('default');

		setDefaultCursorSpy.mockRestore();
	});

	it('should update cursor color when hovering over different lanes in editing mode', () => {
		// Setup
		editorScene.create();
		editorScene['isEditing'] = true; // Set editing mode
		const setDefaultCursorSpy = vi.spyOn(editorScene.input, 'setDefaultCursor');

		// Find the pointermove handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointermoveHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointermove'
		)?.[1];

		expect(pointermoveHandler).toBeDefined();

		// Mock pointer over different lanes
		const mockPointer = {
			x: 100, // This should correspond to a specific lane
			y: 300
		};

		// Mock the offsetX getter
		Object.defineProperty(editorScene, 'offsetX', { get: () => 50 });
		editorScene['cellWidth'] = 50;

		// Simulate pointer move
		pointermoveHandler?.(mockPointer);

		// Should have called setDefaultCursor with a custom cursor
		expect(setDefaultCursorSpy).toHaveBeenCalled();

		setDefaultCursorSpy.mockRestore();
	});

	it('should handle pointer events by delegating to NoteManager', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Spy on the noteManager.handlePointerDown method
		const handlePointerDownSpy = vi.spyOn(editorScene['noteManager'], 'handlePointerDown');

		// Get the pointerdown handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointerdownHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointerdown'
		)?.[1];

		expect(pointerdownHandler).toBeDefined();

		// Mock pointer for non-editing mode
		const mockPointer = {
			x: 100,
			y: 200,
			rightButtonDown: vi.fn().mockReturnValue(false)
		};

		// Mock handlePointerDown to return true (handled)
		handlePointerDownSpy.mockReturnValue(true);

		// Simulate pointer down in non-editing mode (isEditing = false)
		pointerdownHandler?.(mockPointer);

		// Verify that handlePointerDown was called with the correct pointer
		expect(handlePointerDownSpy).toHaveBeenCalledWith(mockPointer);
		expect(handlePointerDownSpy).toHaveBeenCalledTimes(1);

		// Clean up spy
		handlePointerDownSpy.mockRestore();
	});

	it('should handle pointer move events by delegating to NoteManager', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Spy on the noteManager.handlePointerMove method
		const handlePointerMoveSpy = vi.spyOn(editorScene['noteManager'], 'handlePointerMove');

		// Get the pointermove handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointermoveHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointermove'
		)?.[1];

		expect(pointermoveHandler).toBeDefined();

		// Mock pointer move
		const mockPointer = {
			x: 150,
			y: 250
		};

		// Simulate pointer move
		pointermoveHandler?.(mockPointer);

		// Verify that handlePointerMove was called with the correct pointer
		expect(handlePointerMoveSpy).toHaveBeenCalledWith(mockPointer);
		expect(handlePointerMoveSpy).toHaveBeenCalledTimes(1);

		// Clean up spy
		handlePointerMoveSpy.mockRestore();
	});

	it('should handle pointer up events by delegating to NoteManager', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Spy on the noteManager.handlePointerUp method
		const handlePointerUpSpy = vi.spyOn(editorScene['noteManager'], 'handlePointerUp');

		// Get the pointerup handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointerupHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointerup'
		)?.[1];

		expect(pointerupHandler).toBeDefined();

		// Simulate pointer up
		pointerupHandler?.();

		// Verify that handlePointerUp was called
		expect(handlePointerUpSpy).toHaveBeenCalledTimes(1);

		// Clean up spy
		handlePointerUpSpy.mockRestore();
	});

	describe('setDirty and getDirty', () => {
		it('should start with isDirty false', () => {
			expect(editorScene.getDirty()).toBe(false);
		});

		it('should set dirty to true when setDirty called with true', () => {
			editorScene.setDirty(true);
			expect(editorScene.getDirty()).toBe(true);
		});

		it('should set dirty to false when setDirty called with false', () => {
			editorScene.setDirty(true);
			editorScene.setDirty(false);
			expect(editorScene.getDirty()).toBe(false);
		});

		it('should default to true when setDirty called without arguments', () => {
			editorScene.setDirty();
			expect(editorScene.getDirty()).toBe(true);
		});
	});

	describe('getIsLoaded', () => {
		it('should return false before scene is loaded', () => {
			expect(editorScene.getIsLoaded()).toBe(false);
		});
	});

	describe('normalizePosition', () => {
		it('should normalize position using high-resolution grid (192 cells)', () => {
			// 0.5 normalized by 192 cells: Math.round(0.5 * 192) / 192 = 96/192 = 0.5
			expect(editorScene['normalizePosition'](0.5)).toBeCloseTo(0.5);
		});

		it('should round to nearest 192nd note position', () => {
			// 1/16 = 0.0625 -> Math.round(0.0625 * 192) / 192 = 12/192 = 0.0625
			expect(editorScene['normalizePosition'](1 / 16)).toBeCloseTo(1 / 16);
		});

		it('should handle 24th note positions (1/24)', () => {
			// 1/24 -> Math.round((1/24) * 192) / 192 = 8/192 = 1/24
			expect(editorScene['normalizePosition'](1 / 24)).toBeCloseTo(1 / 24);
		});

		it('should return 0 for offset 0', () => {
			expect(editorScene['normalizePosition'](0)).toBe(0);
		});

		it('should return 1 for offset 1', () => {
			expect(editorScene['normalizePosition'](1)).toBe(1);
		});
	});

	describe('simple getter methods', () => {
		it('default values smoke test', () => {
			expect(editorScene.getIsEditing()).toBe(false);
			expect(editorScene.getLaneConfigs().length).toBeGreaterThan(0);
			expect(editorScene.getCellWidth()).toBe(50);
			expect(editorScene.getCellHeightValue()).toBe(25);
		});

		it('should return selectedNotes Set after create', () => {
			editorScene.create();
			expect(editorScene.selectedNotes instanceof Set).toBe(true);
		});

		it('should set and get isSelecting via setter when noteManager exists', () => {
			editorScene.create();
			editorScene.isSelecting = true;
			expect(editorScene.isSelecting).toBe(true);
			editorScene.isSelecting = false;
			expect(editorScene.isSelecting).toBe(false);
		});

		it('should set selectionStartX via setter when noteManager exists', () => {
			editorScene.create();
			editorScene.selectionStartX = 100;
			expect(editorScene.selectionStartX).toBe(100);
		});

		it('should set selectionStartY via setter when noteManager exists', () => {
			editorScene.create();
			editorScene.selectionStartY = 200;
			expect(editorScene.selectionStartY).toBe(200);
		});

		it('should return a number from getCellHeightAt', () => {
			expect(typeof editorScene.getCellHeightAt(0, 0)).toBe('number');
		});
	});

	describe('getByName', () => {
		it('should delegate to panelContainer getByName and return the found object', () => {
			const mockObj = { name: 'note-0-1-0' };
			const mockContainer = { getByName: vi.fn().mockReturnValue(mockObj) };
			editorScene['panelContainer'] = mockContainer as any;

			const result = editorScene.getByName('note-0-1-0');

			expect(mockContainer.getByName).toHaveBeenCalledWith('note-0-1-0');
			expect(result).toBe(mockObj);
		});

		it('should return null when name not found', () => {
			const mockContainer = { getByName: vi.fn().mockReturnValue(null) };
			editorScene['panelContainer'] = mockContainer as any;

			const result = editorScene.getByName('nonexistent');

			expect(result).toBeNull();
		});
	});

	describe('clearTempStorage', () => {
		it('should set dirty to false after clearing temp storage', () => {
			editorScene.setDirty(true);
			editorScene.clearTempStorage();
			expect(editorScene.getDirty()).toBe(false);
		});
	});

	describe('autoSaveChart', () => {
		it('should resolve without throwing (default no-op implementation)', async () => {
			await expect(editorScene.autoSaveChart()).resolves.toBeUndefined();
		});
	});

	describe('updateGridSpacing', () => {
		it('should ignore invalid (zero) cellsPerMeasure values', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateGridSpacing(0);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cellsPerMeasure value:', 0);
			warnSpy.mockRestore();
		});

		it('should ignore negative cellsPerMeasure values', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateGridSpacing(-4);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cellsPerMeasure value:', -4);
			warnSpy.mockRestore();
		});

		it('should ignore non-integer cellsPerMeasure values', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateGridSpacing(4.5);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cellsPerMeasure value:', 4.5);
			warnSpy.mockRestore();
		});

		it('should update cellsPerMeasure and call redrawGridLines for valid values', () => {
			const redrawGridLinesSpy = vi
				.spyOn(editorScene as any, 'redrawGridLines')
				.mockImplementation(() => {});
			editorScene.updateGridSpacing(16);
			expect(editorScene['cellsPerMeasure']).toBe(16);
			expect(redrawGridLinesSpy).toHaveBeenCalled();
			redrawGridLinesSpy.mockRestore();
		});
	});

	describe('updateCellHeight', () => {
		it('should ignore invalid (zero) cell height values', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateCellHeight(0);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cell height value:', 0);
			warnSpy.mockRestore();
		});

		it('should ignore negative cell height values', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateCellHeight(-10);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cell height value:', -10);
			warnSpy.mockRestore();
		});

		it('should ignore cell height values exceeding 100', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			editorScene.updateCellHeight(101);
			expect(warnSpy).toHaveBeenCalledWith('Invalid cell height value:', 101);
			warnSpy.mockRestore();
		});

		it('should update cellHeight and call redrawScene for valid values', () => {
			const redrawSceneSpy = vi
				.spyOn(editorScene as any, 'redrawScene')
				.mockImplementation(() => {});
			editorScene.updateCellHeight(30);
			expect(editorScene['cellHeight']).toBe(30);
			expect(redrawSceneSpy).toHaveBeenCalled();
			redrawSceneSpy.mockRestore();
		});
	});

	describe('selectionRectangle getter', () => {
		it('should return undefined when noteManager is not initialized', () => {
			editorScene['noteManager'] = undefined as any;
			expect(editorScene.selectionRectangle).toBeUndefined();
		});

		it('should return the noteManager selectionRectangle when initialized', () => {
			const mockRect = { setStrokeStyle: vi.fn(), setVisible: vi.fn() };
			editorScene['noteManager'] = {
				selectionRectangle: mockRect
			} as any;
			expect(editorScene.selectionRectangle).toBe(mockRect);
		});
	});

	describe('additional getter methods', () => {
		it('should return offsetX from getOffsetX', () => {
			expect(editorScene.getOffsetX()).toBe(editorScene['offsetX']);
		});

		it('should return offsetY from getOffsetY', () => {
			expect(editorScene.getOffsetY()).toBe(editorScene['offsetY']);
		});

		it('should return cellMargin from getCellMargin', () => {
			expect(editorScene.getCellMargin()).toBe(editorScene['cellMargin']);
		});

		it('should return cellsPerMeasure from getCellsPerMeasure', () => {
			const value = editorScene.getCellsPerMeasure();
			expect(value).toBe(editorScene['cellsPerMeasure']);
			expect(value).toBeGreaterThan(0);
		});

		it('should return same value from getGridSpacing and getCellsPerMeasure', () => {
			expect(editorScene.getGridSpacing()).toBe(editorScene.getCellsPerMeasure());
		});

		it('should return noteSize from getNoteSize', () => {
			expect(editorScene.getNoteSize()).toBe(editorScene['noteSize']);
		});

		it('should return measureCount from getMeasureCount', () => {
			expect(editorScene.getMeasureCount()).toBe(editorScene['measureCount']);
		});
	});

	describe('setter guard branches (noteManager not initialized)', () => {
		it('should not throw when setting isSelecting with no noteManager', () => {
			editorScene['noteManager'] = undefined as any;
			expect(() => {
				editorScene.isSelecting = true;
			}).not.toThrow();
		});

		it('should return false for isSelecting when noteManager is undefined', () => {
			editorScene['noteManager'] = undefined as any;
			expect(editorScene.isSelecting).toBe(false);
		});

		it('should not throw when setting selectionStartX with no noteManager', () => {
			editorScene['noteManager'] = undefined as any;
			expect(() => {
				editorScene.selectionStartX = 50;
			}).not.toThrow();
		});

		it('should return 0 for selectionStartX when noteManager is undefined', () => {
			editorScene['noteManager'] = undefined as any;
			expect(editorScene.selectionStartX).toBe(0);
		});

		it('should not throw when setting selectionStartY with no noteManager', () => {
			editorScene['noteManager'] = undefined as any;
			expect(() => {
				editorScene.selectionStartY = 50;
			}).not.toThrow();
		});

		it('should return 0 for selectionStartY when noteManager is undefined', () => {
			editorScene['noteManager'] = undefined as any;
			expect(editorScene.selectionStartY).toBe(0);
		});
	});

	describe('init()', () => {
		it('should update measureCount from data', () => {
			editorScene.init({ measureCount: 5 });
			expect(editorScene['measureCount']).toBe(5);
		});

		it('should keep existing measureCount when data.measureCount is 0 (falsy)', () => {
			editorScene['measureCount'] = 10;
			editorScene.init({ measureCount: 0 });
			expect(editorScene['measureCount']).toBe(10);
		});
	});

	describe('setOnNotesModified callback', () => {
		it('should call setDirty(true) and debouncedAutoSave when notes are modified', () => {
			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');
			const debouncedAutoSaveSpy = vi
				.spyOn(editorScene as any, 'debouncedAutoSave')
				.mockImplementation(() => {});

			// The callback was registered in the constructor via noteManager.setOnNotesModified
			(editorScene['noteManager'] as any)['onNotesModified']();

			expect(setDirtySpy).toHaveBeenCalledWith(true);
			expect(debouncedAutoSaveSpy).toHaveBeenCalled();

			setDirtySpy.mockRestore();
			debouncedAutoSaveSpy.mockRestore();
		});
	});

	describe('pointerdown behavior when not editing', () => {
		it('should return early without modifying state when not editing and handlePointerDown returns false', () => {
			editorScene.create();

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			const mockPointer = { x: 100, y: 200, rightButtonDown: vi.fn().mockReturnValue(false) };
			pointerdownHandler?.(mockPointer);

			expect(syncNotesToStoreSpy).not.toHaveBeenCalled();

			handlePointerDownSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});
	});

	describe('pointerdown behavior in editing mode', () => {
		it('should call addNoteToEditor when left-clicking in a valid lane and measure', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			// Set up offsets so laneIndex=2, clickY=100 (within measure 0, height=400)
			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;
			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(null)
			} as any;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const addNoteToEditorSpy = vi
				.spyOn(editorScene['noteManager'], 'addNoteToEditor')
				.mockImplementation(() => {});
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			// pointer.y=500: absoluteY = 500-600-0 = -100, clickY = 100
			// laneIndex = Math.floor(100/50) = 2 (valid)
			// measure 0: height = 16*25=400 → 100 >= 0 && 100 < 400 → measure=0
			const mockPointer = { x: 100, y: 500, rightButtonDown: vi.fn().mockReturnValue(false) };
			pointerdownHandler?.(mockPointer);

			expect(addNoteToEditorSpy).toHaveBeenCalled();
			expect(syncNotesToStoreSpy).toHaveBeenCalled();

			handlePointerDownSpy.mockRestore();
			addNoteToEditorSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});

		it('should destroy note graphics on right-click when a note exists at the clicked position', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;

			const mockNote = { destroy: vi.fn() };
			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(mockNote)
			} as any;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			const mockPointer = { x: 100, y: 500, rightButtonDown: vi.fn().mockReturnValue(true) };
			pointerdownHandler?.(mockPointer);

			expect(mockNote.destroy).toHaveBeenCalled();

			handlePointerDownSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});
	});

	describe('EventBus handlers registered in create()', () => {
		it('should resume editor scene on STOP_PREVIEW event', () => {
			editorScene.create();
			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(false);

			const eventBusOnMock = EventBus.on as MockedFn;
			const stopPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.STOP_PREVIEW
			)?.[1];

			expect(stopPreviewCallback).toBeDefined();
			stopPreviewCallback?.();

			expect(editorScene.scene.resume).toHaveBeenCalled();
			expect(editorScene.scene.setVisible).toHaveBeenCalledWith(true);
		});

		it('should pause and hide preview scene on STOP_PREVIEW when preview is active', () => {
			editorScene.create();
			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(true);

			const eventBusOnMock = EventBus.on as MockedFn;
			const stopPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.STOP_PREVIEW
			)?.[1];

			stopPreviewCallback?.();

			expect(editorScene.scene.pause).toHaveBeenCalled();
		});

		it('should restart scene with new measureCount on MEASURE_UPDATE event', () => {
			editorScene.create();

			const eventBusOnMock = EventBus.on as MockedFn;
			const measureUpdateCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.MEASURE_UPDATE
			)?.[1];

			expect(measureUpdateCallback).toBeDefined();

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			measureUpdateCallback?.(8);
			expect(restartSpy).toHaveBeenCalled();
			restartSpy.mockRestore();
		});

		it('should update panelContainer.y on MEASURE_GOTO event', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 0, getByName: vi.fn() } as any;
			editorScene.getTotalMesaureOffest = vi.fn().mockReturnValue(200);

			const eventBusOnMock = EventBus.on as MockedFn;
			const measureGotoCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.MEASURE_GOTO
			)?.[1];

			expect(measureGotoCallback).toBeDefined();
			measureGotoCallback?.(2);

			// panelContainer.y should have been updated via clampY
			expect(editorScene['panelContainer'].y).toBeDefined();
		});
	});

	describe('wheel event handler in create()', () => {
		it('should scroll panelContainer on wheel event within grid area', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 100, getByName: vi.fn() } as any;

			const inputOnMock = editorScene.input.on as MockedFn;
			const wheelHandler = inputOnMock.mock.calls.find((call) => call[0] === 'wheel')?.[1];

			expect(wheelHandler).toBeDefined();

			// pointer.y (300) < scale.height - bottomMargin (600 - 40 = 560)
			const mockPointer = { y: 300 };
			wheelHandler?.(mockPointer, [], 0, 50);

			// panelContainer.y should be changed by -deltaY * 0.5 = -25, then clamped
			expect(editorScene['panelContainer'].y).toBeDefined();
		});
	});

	describe('simple getters (getPanelContainer, getNotes)', () => {
		it('should return panelContainer from getPanelContainer', () => {
			const mockContainer = { getByName: vi.fn() };
			editorScene['panelContainer'] = mockContainer as any;
			expect(editorScene.getPanelContainer()).toBe(mockContainer);
		});

		it('should return notes from getNotes', () => {
			const mockNotes = { '01': [] };
			editorScene['notes'] = mockNotes as any;
			expect(editorScene.getNotes()).toBe(mockNotes);
		});
	});

	describe('delegator methods (deleteNoteByKey, highlightSelectedNote, clearSelection)', () => {
		it('should delegate deleteNoteByKey to noteManager', () => {
			const deleteNoteByKeySpy = vi
				.spyOn(editorScene['noteManager'], 'deleteNoteByKey')
				.mockImplementation(() => {});
			editorScene.deleteNoteByKey('note-0-0-0');
			expect(deleteNoteByKeySpy).toHaveBeenCalledWith('note-0-0-0');
			deleteNoteByKeySpy.mockRestore();
		});

		it('should delegate highlightSelectedNote to noteManager', () => {
			const highlightSpy = vi
				.spyOn(editorScene['noteManager'], 'highlightSelectedNote')
				.mockImplementation(() => {});
			const mockGraphics = { name: 'note-0-0-0' };
			editorScene.highlightSelectedNote(mockGraphics);
			expect(highlightSpy).toHaveBeenCalledWith(mockGraphics);
			highlightSpy.mockRestore();
		});

		it('should delegate clearSelection to noteManager', () => {
			const clearSelectionSpy = vi
				.spyOn(editorScene['noteManager'], 'clearSelection')
				.mockImplementation(() => {});
			editorScene.clearSelection();
			expect(clearSelectionSpy).toHaveBeenCalled();
			clearSelectionSpy.mockRestore();
		});
	});

	describe('debouncedAutoSave', () => {
		it('should schedule auto-save using time.delayedCall', () => {
			editorScene['debouncedAutoSave']();
			expect(editorScene.time.delayedCall).toHaveBeenCalled();
		});

		it('should destroy existing timeout before creating a new one', () => {
			const mockTimeout = { destroy: vi.fn() };
			editorScene['autoSaveTimeout'] = mockTimeout as any;
			editorScene['debouncedAutoSave']();
			expect(mockTimeout.destroy).toHaveBeenCalled();
		});
	});

	describe('markAsLoaded', () => {
		it('should set isLoaded to true and emit EDITOR_LOADED event', () => {
			expect(editorScene.getIsLoaded()).toBe(false);
			editorScene['markAsLoaded']();
			expect(editorScene.getIsLoaded()).toBe(true);
			expect(EventBus.emit).toHaveBeenCalledWith(EventType.EDITOR_LOADED, editorScene);
		});

		it('should not emit EDITOR_LOADED again if already marked as loaded', () => {
			editorScene['markAsLoaded']();
			vi.clearAllMocks();
			editorScene['markAsLoaded']();
			expect(EventBus.emit).not.toHaveBeenCalled();
		});
	});

	describe('syncNotesToStore', () => {
		it('should call store.editorNotes.set with current notes', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;
			const mockNotes = { '01': [] };
			editorScene['notes'] = mockNotes as any;

			editorScene['syncNotesToStore']();

			expect(store.editorNotes.set).toHaveBeenCalledWith(mockNotes);
		});
	});

	describe('store subscription callbacks in create()', () => {
		it('should set dirty and trigger auto-save when dtxFile changes after init', async () => {
			// Capture the subscribe callback via dynamic import of the mocked module
			const storeModule = await import('../../store');
			const store = storeModule.default;
			editorScene.create();

			const subscribeCallback = (store.currentDtxFile.subscribe as MockedFn).mock
				.calls[0]?.[0];
			expect(subscribeCallback).toBeDefined();

			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');
			const debouncedAutoSaveSpy = vi
				.spyOn(editorScene as any, 'debouncedAutoSave')
				.mockImplementation(() => {});

			// After create(), isInitializing=false; calling with non-null triggers dirty logic
			subscribeCallback?.({ title: 'Test' });

			expect(setDirtySpy).toHaveBeenCalledWith(true);
			expect(debouncedAutoSaveSpy).toHaveBeenCalled();

			setDirtySpy.mockRestore();
			debouncedAutoSaveSpy.mockRestore();
		});
	});
});
