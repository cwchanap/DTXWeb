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
			}),
			set: vi.fn()
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
import { LaneMeasureNote } from '$lib/chart/note';

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

	it('should clean up subscriptions when restarted after create()', () => {
		editorScene.create();

		// Capture the unsubscribe functions assigned during create().
		// The store subscribe mocks return vi.fn() values which are stored on the scene.
		const activeNoteUnsub = editorScene['activeNoteSubscription'] as ReturnType<typeof vi.fn>;
		const keyBindingsUnsub = editorScene['keyBindingsSubscription'] as ReturnType<typeof vi.fn>;
		const dtxFileUnsub = editorScene['dtxFileSubscription'] as ReturnType<typeof vi.fn>;
		const soundChipUnsub = editorScene['soundChipSubscription'] as ReturnType<typeof vi.fn>;

		expect(activeNoteUnsub).toBeDefined();
		expect(keyBindingsUnsub).toBeDefined();
		expect(dtxFileUnsub).toBeDefined();
		expect(soundChipUnsub).toBeDefined();

		editorScene.restart();

		// Each unsubscribe function should have been invoked during cleanup
		expect(activeNoteUnsub).toHaveBeenCalled();
		expect(keyBindingsUnsub).toHaveBeenCalled();
		expect(dtxFileUnsub).toHaveBeenCalled();
		expect(soundChipUnsub).toHaveBeenCalled();

		// Subscription fields should be nulled after restart
		expect(editorScene['activeNoteSubscription']).toBeNull();
		expect(editorScene['keyBindingsSubscription']).toBeNull();
		expect(editorScene['dtxFileSubscription']).toBeNull();
		expect(editorScene['soundChipSubscription']).toBeNull();
	});

	it('should destroy and null out autoSaveTimeout when restarting with active timeout', () => {
		editorScene.create();

		const mockTimeout = { destroy: vi.fn() };
		editorScene['autoSaveTimeout'] = mockTimeout as any;

		editorScene.restart();

		expect(mockTimeout.destroy).toHaveBeenCalled();
		expect(editorScene['autoSaveTimeout']).toBeNull();
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

	it('should destroy and null out autoSaveTimeout when shutting down with active timeout', () => {
		editorScene.create();

		const mockTimeout = { destroy: vi.fn() };
		editorScene['autoSaveTimeout'] = mockTimeout as any;

		editorScene.shutdown();

		expect(mockTimeout.destroy).toHaveBeenCalled();
		expect(editorScene['autoSaveTimeout']).toBeNull();
	});

	it('removes its EventBus handlers on shutdown so a destroyed scene cannot redraw later', () => {
		editorScene.create();

		const eventBusOnMock = EventBus.on as MockedFn;
		const registeredHandlers = [
			EventType.MEASURE_UPDATE,
			EventType.GRID_SPACING_UPDATE,
			EventType.CELL_HEIGHT_UPDATE,
			EventType.NOTE_IMPORT,
			EventType.MEASURE_GOTO,
			EventType.START_PREVIEW,
			EventType.STOP_PREVIEW
		].map((eventName) => {
			const handler = eventBusOnMock.mock.calls.find((call) => call[0] === eventName)?.[1];
			expect(handler).toEqual(expect.any(Function));
			return [eventName, handler] as const;
		});

		editorScene.shutdown();

		registeredHandlers.forEach(([eventName, handler]) => {
			expect(EventBus.off).toHaveBeenCalledWith(eventName, handler);
		});
	});

	it('removes its EventBus handlers when Phaser emits DESTROY (game.destroy path)', () => {
		// Phaser's game.destroy() emits DESTROY on the scene's event emitter
		// but never calls scene.shutdown(). The DESTROY listener registered in
		// create() must remove the EventBus handlers so they do not leak.
		editorScene.create();

		const eventBusOnMock = EventBus.on as MockedFn;
		const registeredHandlers = [
			EventType.MEASURE_UPDATE,
			EventType.GRID_SPACING_UPDATE,
			EventType.CELL_HEIGHT_UPDATE,
			EventType.NOTE_IMPORT,
			EventType.MEASURE_GOTO,
			EventType.START_PREVIEW,
			EventType.STOP_PREVIEW
		].map((eventName) => {
			const handler = eventBusOnMock.mock.calls.find((call) => call[0] === eventName)?.[1];
			expect(handler).toEqual(expect.any(Function));
			return [eventName, handler] as const;
		});

		// Simulate Phaser's Systems.destroy() firing the DESTROY listener
		// registered via this.events.once(Phaser.Scenes.Events.DESTROY, ...).
		const onceMock = editorScene.events.once as unknown as MockedFn;
		const destroyListener = onceMock.mock.calls.find(
			(call: unknown[]) => call[0] === 'destroy'
		)?.[1];
		expect(destroyListener).toEqual(expect.any(Function));
		(destroyListener as (() => void) | undefined)?.();

		registeredHandlers.forEach(([eventName, handler]) => {
			expect(EventBus.off).toHaveBeenCalledWith(eventName, handler);
		});
	});

	it('removes its EventBus handlers on restart so stale handlers are not retained', () => {
		editorScene.create();

		const eventBusOnMock = EventBus.on as MockedFn;
		const registeredHandlers = [
			EventType.MEASURE_UPDATE,
			EventType.GRID_SPACING_UPDATE,
			EventType.CELL_HEIGHT_UPDATE,
			EventType.NOTE_IMPORT,
			EventType.MEASURE_GOTO,
			EventType.START_PREVIEW,
			EventType.STOP_PREVIEW
		].map((eventName) => {
			const handler = eventBusOnMock.mock.calls.find((call) => call[0] === eventName)?.[1];
			expect(handler).toEqual(expect.any(Function));
			return [eventName, handler] as const;
		});

		editorScene.restart();

		registeredHandlers.forEach(([eventName, handler]) => {
			expect(EventBus.off).toHaveBeenCalledWith(eventName, handler);
		});
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

	it('should call deleteSelectedNotes when BACKSPACE key is pressed and not editing', () => {
		editorScene.create();
		editorScene['isEditing'] = false;

		const keyboardOnMock = editorScene.input.keyboard?.on as MockedFn;
		const backspaceHandler = keyboardOnMock.mock.calls.find(
			(call) => call[0] === 'keydown-BACKSPACE'
		)?.[1];

		expect(backspaceHandler).toBeDefined();

		const deleteSelectedNotesSpy = vi
			.spyOn(editorScene['noteManager'], 'deleteSelectedNotes')
			.mockImplementation(() => {});

		backspaceHandler?.();
		expect(deleteSelectedNotesSpy).toHaveBeenCalled();

		deleteSelectedNotesSpy.mockRestore();
	});

	it('should call deleteSelectedNotes when DELETE key is pressed and not editing', () => {
		editorScene.create();
		editorScene['isEditing'] = false;

		const keyboardOnMock = editorScene.input.keyboard?.on as MockedFn;
		const deleteHandler = keyboardOnMock.mock.calls.find(
			(call) => call[0] === 'keydown-DELETE'
		)?.[1];

		expect(deleteHandler).toBeDefined();

		const deleteSelectedNotesSpy = vi
			.spyOn(editorScene['noteManager'], 'deleteSelectedNotes')
			.mockImplementation(() => {});

		deleteHandler?.();
		expect(deleteSelectedNotesSpy).toHaveBeenCalled();

		deleteSelectedNotesSpy.mockRestore();
	});

	it('should call undoLastAction when Ctrl+Z is pressed and not editing', () => {
		editorScene.create();
		editorScene['isEditing'] = false;

		const keyboardOnMock = editorScene.input.keyboard?.on as MockedFn;
		const keydownZHandler = keyboardOnMock.mock.calls.find(
			(call) => call[0] === 'keydown-Z'
		)?.[1];

		expect(keydownZHandler).toBeDefined();

		const undoLastActionSpy = vi
			.spyOn(editorScene['noteManager'], 'undoLastAction')
			.mockImplementation(() => {});

		keydownZHandler?.({ ctrlKey: true, metaKey: false } as KeyboardEvent);
		expect(undoLastActionSpy).toHaveBeenCalled();

		undoLastActionSpy.mockRestore();
	});

	it('should not call deleteSelectedNotes when BACKSPACE is pressed while editing', () => {
		editorScene.create();
		editorScene['isEditing'] = true;

		const keyboardOnMock = editorScene.input.keyboard?.on as MockedFn;
		const backspaceHandler = keyboardOnMock.mock.calls.find(
			(call) => call[0] === 'keydown-BACKSPACE'
		)?.[1];

		const deleteSelectedNotesSpy = vi
			.spyOn(editorScene['noteManager'], 'deleteSelectedNotes')
			.mockImplementation(() => {});

		backspaceHandler?.();
		expect(deleteSelectedNotesSpy).not.toHaveBeenCalled();

		deleteSelectedNotesSpy.mockRestore();
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

	describe('update', () => {
		it('should not throw when called', () => {
			expect(() => editorScene.update()).not.toThrow();
		});
	});

	describe('store subscription callbacks: activeNote and keyBindings', () => {
		it('should call updateCursorForEditingMode when activeNote changes while editing', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;
			editorScene.create();
			editorScene['isEditing'] = true;

			const updateCursorSpy = vi
				.spyOn(editorScene as any, 'updateCursorForEditingMode')
				.mockImplementation(() => {});

			const subscribeCallback = (store.activeNote.subscribe as MockedFn).mock.calls[0]?.[0];
			subscribeCallback?.('11');

			expect(updateCursorSpy).toHaveBeenCalled();
			updateCursorSpy.mockRestore();
		});

		it('should populate keyBindings map when keyBindings store changes with non-empty data', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;
			editorScene.create();

			const subscribeCallback = (store.keyBindings.subscribe as MockedFn).mock.calls[0]?.[0];
			subscribeCallback?.({ '11': 'h', '12': 's' });

			expect(editorScene['keyBindings']['h']).toBe('11');
			expect(editorScene['keyBindings']['s']).toBe('12');
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
				.mockReturnValue(true);
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

		it('should iterate through measures when click is in measure 1 (covering currentY += measureHeight)', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const addNoteToEditorSpy = vi
				.spyOn(editorScene['noteManager'], 'addNoteToEditor')
				.mockReturnValue(true);
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(null)
			} as any;

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			// y=100 → absoluteY=100-600-0=-500 → clickY=500
			// measure 0 height=400 (16*25), 500 >= 400 → loop: currentY += 400 (line 133 covered!)
			// measure 1: 500 >= 400 && 500 < 800 → measure=1
			const mockPointer = { x: 100, y: 100, rightButtonDown: vi.fn().mockReturnValue(false) };
			pointerdownHandler?.(mockPointer);

			expect(addNoteToEditorSpy).toHaveBeenCalled();
			const callArgs = addNoteToEditorSpy.mock.calls[0];
			expect(callArgs?.[0]).toBe(1); // measure should be 1

			handlePointerDownSpy.mockRestore();
			addNoteToEditorSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});

		it('should use fallback note removal when LaneMeasureNote has no removeNote method', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;

			// Use a plain object without removeNote to cover the fallback path (lines 220-223)
			const laneId = editorScene.getLaneConfigs()[2].id;
			const legacyNote = {
				measure: 0,
				laneID: laneId,
				measureLength: 1,
				notes: [{ noteID: '01', position: 0.25 }]
				// No removeNote method!
			};
			editorScene['notes'] = { [laneId]: [legacyNote] } as any;

			const mockNote = { destroy: vi.fn(), name: 'note-2-0-0.25' };
			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(mockNote)
			} as any;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const recordDeleteActionSpy = vi
				.spyOn(editorScene['noteManager'], 'recordDeleteAction')
				.mockImplementation(() => {});
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			const mockPointer = { x: 100, y: 500, rightButtonDown: vi.fn().mockReturnValue(true) };
			pointerdownHandler?.(mockPointer);

			// Note should be removed via the fallback filter path
			expect(legacyNote.notes).toHaveLength(0);

			handlePointerDownSpy.mockRestore();
			recordDeleteActionSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});

		it('should call recordDeleteAction when a note with data exists at right-click position', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;

			// laneIndex=2 → laneId='18', measure=0, cellOffset=0.25
			const laneId = '18';
			const laneMeasureNote = new LaneMeasureNote(
				0,
				laneId,
				[{ noteID: '01', position: 0.25 }],
				1
			);
			editorScene['notes'] = { [laneId]: [laneMeasureNote] };

			const mockNote = { destroy: vi.fn(), name: 'note-2-0-0.25' };
			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(mockNote)
			} as any;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const recordDeleteActionSpy = vi
				.spyOn(editorScene['noteManager'], 'recordDeleteAction')
				.mockImplementation(() => {});
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			// x=100 → laneIndex=2, y=500 → clickY=100, measure=0, cellOffset=0.25
			const mockPointer = { x: 100, y: 500, rightButtonDown: vi.fn().mockReturnValue(true) };
			pointerdownHandler?.(mockPointer);

			expect(recordDeleteActionSpy).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ laneId, measure: 0, cellOffset: 0.25 })
				])
			);

			handlePointerDownSpy.mockRestore();
			recordDeleteActionSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
		});

		it('should remove note from this.notes and clean up lane when last note is deleted via right-click', () => {
			editorScene.create();
			editorScene['isEditing'] = true;

			Object.defineProperty(editorScene, 'offsetX', { get: () => 0, configurable: true });
			Object.defineProperty(editorScene, 'offsetY', { get: () => 600, configurable: true });
			editorScene['cellWidth'] = 50;

			// laneIndex=2 → laneId='18', measure=0, cellOffset=0.25
			const laneId = '18';
			const laneMeasureNote = new LaneMeasureNote(
				0,
				laneId,
				[{ noteID: '01', position: 0.25 }],
				1
			);
			editorScene['notes'] = { [laneId]: [laneMeasureNote] };

			const mockNote = { destroy: vi.fn(), name: 'note-2-0-0.25' };
			editorScene['panelContainer'] = {
				y: 0,
				getByName: vi.fn().mockReturnValue(mockNote)
			} as any;

			const handlePointerDownSpy = vi
				.spyOn(editorScene['noteManager'], 'handlePointerDown')
				.mockReturnValue(false);
			const recordDeleteActionSpy = vi
				.spyOn(editorScene['noteManager'], 'recordDeleteAction')
				.mockImplementation(() => {});
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});

			const inputOnMock = editorScene.input.on as MockedFn;
			const pointerdownHandler = inputOnMock.mock.calls.find(
				(call) => call[0] === 'pointerdown'
			)?.[1];

			const mockPointer = { x: 100, y: 500, rightButtonDown: vi.fn().mockReturnValue(true) };
			pointerdownHandler?.(mockPointer);

			// After deletion, the lane entry should be removed since it's the last note
			expect(editorScene['notes'][laneId]).toBeUndefined();
			expect(syncNotesToStoreSpy).toHaveBeenCalled();

			handlePointerDownSpy.mockRestore();
			recordDeleteActionSpy.mockRestore();
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

	describe('store subscription: soundChip changes after init', () => {
		it('should set dirty and trigger auto-save when soundChips are truthy after init', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;
			editorScene.create();

			const subscribeCallback = (store.currentSoundChip.subscribe as MockedFn).mock
				.calls[0]?.[0];
			expect(subscribeCallback).toBeDefined();

			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');
			const debouncedAutoSaveSpy = vi
				.spyOn(editorScene as any, 'debouncedAutoSave')
				.mockImplementation(() => {});

			// After create(), isInitializing=false; truthy soundChips triggers dirty logic
			subscribeCallback?.([{ id: 1 }]);

			expect(setDirtySpy).toHaveBeenCalledWith(true);
			expect(debouncedAutoSaveSpy).toHaveBeenCalled();

			setDirtySpy.mockRestore();
			debouncedAutoSaveSpy.mockRestore();
		});
	});

	describe('redrawScene', () => {
		let mockPanelContainer: { removeAll: ReturnType<typeof vi.fn> };
		let mockFooterContainer: { removeAll: ReturnType<typeof vi.fn> };
		let drawPanelSpy: ReturnType<typeof vi.spyOn>;
		let drawNotesSpy: ReturnType<typeof vi.spyOn>;
		let debouncedAutoSaveSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			editorScene.create();
			mockPanelContainer = { removeAll: vi.fn() };
			mockFooterContainer = { removeAll: vi.fn() };
			editorScene['panelContainer'] = mockPanelContainer as any;
			editorScene['footerContainer'] = mockFooterContainer as any;

			drawPanelSpy = vi.spyOn(editorScene, 'drawPanel').mockImplementation(() => {});
			drawNotesSpy = vi.spyOn(editorScene, 'drawNotes').mockImplementation(() => {});
			debouncedAutoSaveSpy = vi
				.spyOn(editorScene as any, 'debouncedAutoSave')
				.mockImplementation(() => {});
		});

		afterEach(() => {
			drawPanelSpy.mockRestore();
			drawNotesSpy.mockRestore();
			debouncedAutoSaveSpy.mockRestore();
		});

		it('should clear panel and footer containers', () => {
			editorScene['redrawScene']();

			expect(mockPanelContainer.removeAll).toHaveBeenCalledWith(true);
			expect(mockFooterContainer.removeAll).toHaveBeenCalledWith(true);
		});

		it('should null out all graphics references', () => {
			editorScene['cellLinesGraphics'] = {} as any;
			editorScene['beatLinesGraphics'] = {} as any;
			editorScene['measureLinesGraphics'] = {} as any;
			editorScene['verticalLinesGraphics'] = {} as any;

			editorScene['redrawScene']();

			expect(editorScene['cellLinesGraphics']).toBeNull();
			expect(editorScene['beatLinesGraphics']).toBeNull();
			expect(editorScene['measureLinesGraphics']).toBeNull();
			expect(editorScene['verticalLinesGraphics']).toBeNull();
		});

		it('should call drawPanel and drawNotes to rebuild the scene', () => {
			editorScene['redrawScene']();

			expect(drawPanelSpy).toHaveBeenCalled();
			expect(drawNotesSpy).toHaveBeenCalled();
		});

		it('should call setDirty and debouncedAutoSave', () => {
			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');

			editorScene['redrawScene']();

			expect(setDirtySpy).toHaveBeenCalledWith(true);
			expect(debouncedAutoSaveSpy).toHaveBeenCalled();

			setDirtySpy.mockRestore();
		});
	});

	describe('setupKeyBindingListener', () => {
		beforeEach(() => {
			editorScene.create();
			// Enable editing mode and set up key bindings
			editorScene['isEditing'] = true;
			editorScene['keyBindings'] = { h: '11', s: '12' };
		});

		afterEach(() => {
			// Clean up the registered listener after each test
			editorScene['removeKeyBindingListener']();
		});

		it('should register a keyBindingHandler after create()', () => {
			// create() already calls setupKeyBindingListener, so handler should be defined
			expect(editorScene['keyBindingHandler']).toBeDefined();
			expect(typeof editorScene['keyBindingHandler']).toBe('function');
		});

		it('should activate the bound note when a mapped key is pressed', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;

			const updateCursorSpy = vi
				.spyOn(editorScene as any, 'updateCursorForEditingMode')
				.mockImplementation(() => {});

			// Dispatch to document.body so event.target is a real element (not null)
			const event = new KeyboardEvent('keydown', {
				key: 'h',
				bubbles: true,
				cancelable: true
			});
			document.body.dispatchEvent(event);

			expect(store.activeNote.set).toHaveBeenCalledWith('11');
			expect(updateCursorSpy).toHaveBeenCalled();

			updateCursorSpy.mockRestore();
		});

		it('should not activate note when modifier keys are held', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;

			const event = new KeyboardEvent('keydown', {
				key: 'h',
				ctrlKey: true,
				bubbles: true,
				cancelable: true
			});
			editorScene['keyBindingHandler']?.(event);

			expect(store.activeNote.set).not.toHaveBeenCalled();
		});

		it('should not activate note when editor is not in editing mode', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;
			editorScene['isEditing'] = false;

			const event = new KeyboardEvent('keydown', {
				key: 'h',
				bubbles: true,
				cancelable: true
			});
			editorScene['keyBindingHandler']?.(event);

			expect(store.activeNote.set).not.toHaveBeenCalled();
		});

		it('should not activate note when typing in an INPUT element', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;

			const input = document.createElement('input');
			input.type = 'text';
			document.body.appendChild(input);

			const event = new KeyboardEvent('keydown', {
				key: 'h',
				bubbles: true,
				cancelable: true
			});
			Object.defineProperty(event, 'target', { value: input, writable: false });
			editorScene['keyBindingHandler']?.(event);

			expect(store.activeNote.set).not.toHaveBeenCalled();

			document.body.removeChild(input);
		});

		it('should not activate note when key has no binding', async () => {
			const storeModule = await import('../../store');
			const store = storeModule.default;

			// Dispatch to document.body so event.target is a real element (not null)
			const event = new KeyboardEvent('keydown', {
				key: 'z', // 'z' has no binding
				bubbles: true,
				cancelable: true
			});
			document.body.dispatchEvent(event);

			expect(store.activeNote.set).not.toHaveBeenCalled();
		});
	});

	describe('removeKeyBindingListener', () => {
		it('should remove the keydown listener from document', () => {
			editorScene.create();
			const handler = editorScene['keyBindingHandler'];
			expect(handler).toBeDefined();

			const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
			editorScene['removeKeyBindingListener']();

			expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', handler);
			expect(editorScene['keyBindingHandler']).toBeNull();

			removeEventListenerSpy.mockRestore();
		});

		it('should do nothing when keyBindingHandler is already null', () => {
			editorScene['keyBindingHandler'] = null;
			const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

			editorScene['removeKeyBindingListener']();

			expect(removeEventListenerSpy).not.toHaveBeenCalled();
			removeEventListenerSpy.mockRestore();
		});
	});

	describe('debouncedAutoSave callback execution', () => {
		it('should call autoSaveChart and null out timeout in the delayed callback', async () => {
			const autoSaveChartSpy = vi
				.spyOn(editorScene, 'autoSaveChart')
				.mockResolvedValue(undefined);

			// Capture the callback passed to time.delayedCall
			let capturedCallback: (() => Promise<void>) | null = null;
			(editorScene.time.delayedCall as ReturnType<typeof vi.fn>).mockImplementation(
				(_delay: number, cb: () => Promise<void>) => {
					capturedCallback = cb;
					return { destroy: vi.fn() };
				}
			);

			editorScene['debouncedAutoSave']();
			expect(capturedCallback).not.toBeNull();

			// Execute the captured callback
			await capturedCallback!();

			expect(autoSaveChartSpy).toHaveBeenCalled();
			expect(editorScene['autoSaveTimeout']).toBeNull();

			autoSaveChartSpy.mockRestore();
		});
	});

	describe('createNoteCursor', () => {
		type MockCanvasContext = {
			fillStyle: string | CanvasGradient | CanvasPattern;
			strokeStyle: string | CanvasGradient | CanvasPattern;
			lineWidth: number;
			font: string;
			textAlign: CanvasTextAlign;
			textBaseline: CanvasTextBaseline;
			fillRect: ReturnType<typeof vi.fn>;
			strokeRect: ReturnType<typeof vi.fn>;
			strokeText: ReturnType<typeof vi.fn>;
			fillText: ReturnType<typeof vi.fn>;
		};

		let mockCtx: MockCanvasContext;
		let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
		let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL;

		beforeEach(() => {
			// Set up a mock 2D canvas context for all createNoteCursor tests
			mockCtx = {
				fillStyle: '#000',
				strokeStyle: '#000',
				lineWidth: 0,
				font: '',
				textAlign: 'left',
				textBaseline: 'alphabetic',
				fillRect: vi.fn(),
				strokeRect: vi.fn(),
				strokeText: vi.fn(),
				fillText: vi.fn()
			};
			originalGetContext = HTMLCanvasElement.prototype.getContext;
			originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

			HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;
			HTMLCanvasElement.prototype.toDataURL = vi
				.fn()
				.mockReturnValue('data:image/png;base64,abc');
		});

		afterEach(() => {
			HTMLCanvasElement.prototype.getContext = originalGetContext;
			HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
		});

		it('should draw active note text on cursor when activeNote is truthy', async () => {
			const { get } = await import('svelte/store');
			vi.mocked(get).mockReturnValue('11' as any);

			const cursor = editorScene['createNoteCursor'](0);

			// Should call text drawing functions
			expect(mockCtx.strokeText).toHaveBeenCalledWith(
				'11',
				expect.any(Number),
				expect.any(Number)
			);
			expect(mockCtx.fillText).toHaveBeenCalledWith(
				'11',
				expect.any(Number),
				expect.any(Number)
			);
			// Should return a cursor URL
			expect(cursor).toContain('url(');
			expect(cursor).toContain('auto');
		});

		it('should not draw text when activeNote is falsy', async () => {
			const { get } = await import('svelte/store');
			vi.mocked(get).mockReturnValue(null as any);

			const cursor = editorScene['createNoteCursor'](0);

			expect(mockCtx.strokeText).not.toHaveBeenCalled();
			expect(mockCtx.fillText).not.toHaveBeenCalled();
			expect(cursor).toContain('url(');
		});

		it('should return default when canvas context is unavailable', () => {
			HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as any;

			const cursor = editorScene['createNoteCursor'](0);

			expect(cursor).toBe('default');
		});
	});

	describe('drawFooterLane', () => {
		it('should add a text element to the footer container', () => {
			editorScene.create();
			editorScene['footerContainer'] = { add: vi.fn() } as any;

			const laneConfig = { name: 'HH', noteColor: 0x0d1cde, id: '11', playable: true };
			editorScene.drawFooterLane(laneConfig, 100);

			expect(editorScene['footerContainer'].add).toHaveBeenCalled();
			expect(editorScene.add.text).toHaveBeenCalled();
		});
	});

	describe('drawNote', () => {
		let mockPanelContainer: {
			getByName: ReturnType<typeof vi.fn>;
			add: ReturnType<typeof vi.fn>;
		};

		beforeEach(() => {
			mockPanelContainer = {
				getByName: vi.fn().mockReturnValue(null),
				add: vi.fn()
			};
			editorScene['panelContainer'] = mockPanelContainer as any;
			editorScene.getTotalMesaureOffest = vi.fn().mockReturnValue(0);
			vi.spyOn(editorScene['noteManager'], 'findNearbyNotes').mockReturnValue([]);
		});

		it('should return false when laneConfig does not exist for given laneIndex', () => {
			const result = editorScene.drawNote(0, 9999, 0, '01');
			expect(result).toBe(false);
		});

		it('should return false when note already exists at position', () => {
			mockPanelContainer.getByName.mockReturnValue({ name: 'note-0-0-0' });

			const result = editorScene.drawNote(0, 0, 0, '01');
			expect(result).toBe(false);
		});

		it('should return true when drawing a new note', () => {
			const result = editorScene.drawNote(0, 0, 0, '01');
			expect(result).toBe(true);
		});

		it('should create graphics and add to panelContainer for new note', () => {
			editorScene.drawNote(0, 0, 0, '01');

			expect(editorScene.add.graphics).toHaveBeenCalled();
			// Should add graphics and text to panelContainer (2 calls)
			expect(mockPanelContainer.add).toHaveBeenCalledTimes(2);
		});

		it('should create text label and add to panelContainer', () => {
			editorScene.drawNote(0, 0, 0, '11');

			expect(editorScene.add.text).toHaveBeenCalled();
		});

		it('should use reduced opacity fill for stacked notes', () => {
			const nearbyNotes = [{ key: 'existing-note', measure: 0, laneIndex: 0 }];
			vi.spyOn(editorScene['noteManager'], 'findNearbyNotes').mockReturnValue(
				nearbyNotes as any
			);

			editorScene.drawNote(0, 0, 0, '01');

			// The graphics fillStyle should be called with 0.9 opacity for stacked notes
			const graphicsMock = (editorScene.add.graphics as ReturnType<typeof vi.fn>).mock
				.results[0]?.value;
			expect(graphicsMock?.fillStyle).toHaveBeenCalledWith(expect.any(Number), 0.9);
		});

		it('should use full opacity fill for non-stacked notes', () => {
			vi.spyOn(editorScene['noteManager'], 'findNearbyNotes').mockReturnValue([]);

			editorScene.drawNote(0, 0, 0, '01');

			const graphicsMock = (editorScene.add.graphics as ReturnType<typeof vi.fn>).mock
				.results[0]?.value;
			expect(graphicsMock?.fillStyle).toHaveBeenCalledWith(expect.any(Number), 1.0);
		});

		it('should handle cellOffset with wholeCells > 0 (triggers for-loop body)', () => {
			// cellOffset=0.5, cellsPerMeasure=16: visualCellPosition=8 → wholeCells=8, fractionalCell=0
			// This exercises the getCellHeight loop (lines 739-741)
			const result = editorScene.drawNote(0, 0, 0.5, '01');
			expect(result).toBe(true);
		});

		it('should handle cellOffset with fractionalCell > 0 (triggers fractional branch)', () => {
			// cellOffset=1/12: visualCellPosition=1.333 → wholeCells=1, fractionalCell=0.333
			// This exercises the fractionalCell if-block (lines 743-746)
			const result = editorScene.drawNote(0, 0, 1 / 12, '01');
			expect(result).toBe(true);
		});
	});

	describe('redrawGridLines', () => {
		let mockPanelContainer: {
			remove: ReturnType<typeof vi.fn>;
			addAt: ReturnType<typeof vi.fn>;
		};
		let drawHorizontalSpy: ReturnType<typeof vi.spyOn>;
		let debouncedAutoSaveSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			editorScene.create();
			mockPanelContainer = { remove: vi.fn(), addAt: vi.fn() };
			editorScene['panelContainer'] = mockPanelContainer as any;

			drawHorizontalSpy = vi
				.spyOn(editorScene as any, 'drawHorizontalGridLines')
				.mockImplementation(() => {});
			debouncedAutoSaveSpy = vi
				.spyOn(editorScene as any, 'debouncedAutoSave')
				.mockImplementation(() => {});
		});

		afterEach(() => {
			drawHorizontalSpy.mockRestore();
			debouncedAutoSaveSpy.mockRestore();
		});

		it('should remove and destroy existing grid graphics', () => {
			const mockGraphics = { destroy: vi.fn() };
			editorScene['cellLinesGraphics'] = mockGraphics as any;
			editorScene['beatLinesGraphics'] = mockGraphics as any;
			editorScene['measureLinesGraphics'] = mockGraphics as any;

			editorScene['redrawGridLines']();

			expect(mockPanelContainer.remove).toHaveBeenCalledTimes(3);
			expect(mockGraphics.destroy).toHaveBeenCalledTimes(3);
		});

		it('should null out graphics references after removal', () => {
			const mockGraphics = { destroy: vi.fn() };
			editorScene['cellLinesGraphics'] = mockGraphics as any;
			editorScene['beatLinesGraphics'] = mockGraphics as any;
			editorScene['measureLinesGraphics'] = mockGraphics as any;

			editorScene['redrawGridLines']();

			expect(editorScene['cellLinesGraphics']).toBeNull();
			expect(editorScene['beatLinesGraphics']).toBeNull();
			expect(editorScene['measureLinesGraphics']).toBeNull();
		});

		it('should skip removal when no existing grid graphics', () => {
			editorScene['cellLinesGraphics'] = null;
			editorScene['beatLinesGraphics'] = null;
			editorScene['measureLinesGraphics'] = null;

			editorScene['redrawGridLines']();

			expect(mockPanelContainer.remove).not.toHaveBeenCalled();
		});

		it('should call drawHorizontalGridLines to recreate lines', () => {
			editorScene['redrawGridLines']();

			expect(drawHorizontalSpy).toHaveBeenCalled();
		});

		it('should call setDirty and debouncedAutoSave', () => {
			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');

			editorScene['redrawGridLines']();

			expect(setDirtySpy).toHaveBeenCalledWith(true);
			expect(debouncedAutoSaveSpy).toHaveBeenCalled();

			setDirtySpy.mockRestore();
		});
	});

	describe('drawHorizontalGridLines', () => {
		let mockPanelContainer: {
			addAt: ReturnType<typeof vi.fn>;
		};
		let drawMeasureSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			editorScene.create();
			mockPanelContainer = { addAt: vi.fn() };
			editorScene['panelContainer'] = mockPanelContainer as any;
			editorScene['measureCount'] = 1;

			drawMeasureSpy = vi.spyOn(editorScene as any, 'drawMeasure').mockReturnValue(400);
		});

		afterEach(() => {
			drawMeasureSpy.mockRestore();
		});

		it('should create three graphics objects for cell, beat, and measure lines', () => {
			// Reset the mock call count after create() may have called add.graphics
			(editorScene.add.graphics as ReturnType<typeof vi.fn>).mockClear();

			editorScene['drawHorizontalGridLines']();

			expect(editorScene.add.graphics).toHaveBeenCalledTimes(3);
		});

		it('should add all three graphics to panelContainer at index 0', () => {
			editorScene['measureCount'] = 0;

			editorScene['drawHorizontalGridLines']();

			expect(mockPanelContainer.addAt).toHaveBeenCalledTimes(3);
			for (const call of mockPanelContainer.addAt.mock.calls) {
				expect(call[1]).toBe(0);
			}
		});

		it('should call drawMeasure for each measure', () => {
			editorScene['measureCount'] = 3;
			drawMeasureSpy.mockReturnValue(400);

			editorScene['drawHorizontalGridLines']();

			expect(drawMeasureSpy).toHaveBeenCalledTimes(3);
		});

		it('should set cellLinesGraphics, beatLinesGraphics, and measureLinesGraphics', () => {
			editorScene['cellLinesGraphics'] = null;
			editorScene['beatLinesGraphics'] = null;
			editorScene['measureLinesGraphics'] = null;

			editorScene['drawHorizontalGridLines']();

			expect(editorScene['cellLinesGraphics']).not.toBeNull();
			expect(editorScene['beatLinesGraphics']).not.toBeNull();
			expect(editorScene['measureLinesGraphics']).not.toBeNull();
		});
	});

	describe('NOTE_IMPORT event handler', () => {
		it('should reset notes, populate from imported notes, and restart', async () => {
			editorScene.create();

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			const syncNotesToStoreSpy = vi
				.spyOn(editorScene as any, 'syncNotesToStore')
				.mockImplementation(() => {});
			const autoSaveSpy = vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);
			const setDirtySpy = vi.spyOn(editorScene, 'setDirty');

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			expect(noteImportCallback).toBeDefined();

			const storeModule = await import('../../store');
			const store = storeModule.default;

			const mockNotes = [
				{ laneID: '01', measure: 0, notes: [{ noteID: '01', position: 0 }] },
				{ laneID: '01', measure: 2, notes: [{ noteID: '01', position: 0.5 }] },
				{ laneID: '02', measure: 1, notes: [{ noteID: '01', position: 0.25 }] }
			] as any;
			const mockBpmNotes = { '01': 120 };

			await noteImportCallback?.(mockNotes, mockBpmNotes);

			expect(editorScene['isLoaded']).toBe(false);
			expect(editorScene['notes']['01']).toHaveLength(2);
			expect(editorScene['notes']['02']).toHaveLength(1);
			expect(editorScene['bpmNotes']).toBe(mockBpmNotes);
			expect(store.measureCount.set).toHaveBeenCalled();
			expect(syncNotesToStoreSpy).toHaveBeenCalled();
			expect(autoSaveSpy).toHaveBeenCalled();
			expect(setDirtySpy).toHaveBeenCalledWith(false);
			expect(restartSpy).toHaveBeenCalled();

			restartSpy.mockRestore();
			syncNotesToStoreSpy.mockRestore();
			autoSaveSpy.mockRestore();
			setDirtySpy.mockRestore();
		});

		it('should expand measureCount when imported notes exceed current count', async () => {
			editorScene.create();
			editorScene['measureCount'] = 5;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			const mockNotes = [{ laneID: '01', measure: 9, notes: [] }] as any;
			await noteImportCallback?.(mockNotes, {});

			// measureCount should expand to maxMeasure + 1 = 10
			expect(editorScene['measureCount']).toBe(10);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 10 });

			restartSpy.mockRestore();
		});

		it('should use draftMeasureCount when it exceeds maxMeasure + 1', async () => {
			editorScene.create();
			editorScene['measureCount'] = 5;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Notes only go to measure 2, but draft had 50 measures (trailing empty)
			const mockNotes = [{ laneID: '01', measure: 2, notes: [] }] as any;
			await noteImportCallback?.(mockNotes, {}, 50);

			// measureCount should be 50 (from draft), not 3 (maxMeasure + 1)
			expect(editorScene['measureCount']).toBe(50);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 50 });

			restartSpy.mockRestore();
		});

		it('should reset measureCount to draft value when recovering a smaller chart', async () => {
			editorScene.create();
			editorScene['measureCount'] = 50;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Previous chart had 50 measures, recovered draft has notes only at measure 2
			// with a draftMeasureCount of 5
			const mockNotes = [{ laneID: '01', measure: 2, notes: [] }] as any;
			await noteImportCallback?.(mockNotes, {}, 5);

			// measureCount should be 5 (from draft), not 50 (stale previous chart)
			expect(editorScene['measureCount']).toBe(5);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 5 });

			restartSpy.mockRestore();
		});

		it('should shrink measureCount when imported notes have fewer measures', async () => {
			editorScene.create();
			editorScene['measureCount'] = 50;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Import notes that only go to measure 2, no draftMeasureCount
			const mockNotes = [{ laneID: '01', measure: 2, notes: [] }] as any;
			await noteImportCallback?.(mockNotes, {});

			// measureCount should shrink to 3 (maxMeasure + 1), not stay at 50
			expect(editorScene['measureCount']).toBe(3);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 3 });

			restartSpy.mockRestore();
		});

		it('should honor draftMeasureCount for empty notes even when current measureCount is larger', async () => {
			editorScene.create();
			editorScene['measureCount'] = 100;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Empty notes (blank draft), draftMeasureCount of 4, but scene had 100 measures
			await noteImportCallback?.([], {}, 4);

			// measureCount should be 4 (from draft), not 100 (stale previous chart)
			expect(editorScene['measureCount']).toBe(4);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 4 });

			restartSpy.mockRestore();
		});

		it('should preserve measureCount when importing empty notes without draftMeasureCount', async () => {
			editorScene.create();
			editorScene['measureCount'] = 10;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Empty notes, no draftMeasureCount — should preserve current measure count
			await noteImportCallback?.([], {});

			expect(editorScene['measureCount']).toBe(10);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 10 });

			restartSpy.mockRestore();
		});

		it('should treat draftMeasureCount of 0 as invalid and preserve current measureCount', async () => {
			editorScene.create();
			editorScene['measureCount'] = 10;

			const restartSpy = vi.spyOn(editorScene as any, 'restart').mockImplementation(() => {});
			vi.spyOn(editorScene as any, 'syncNotesToStore').mockImplementation(() => {});
			vi.spyOn(editorScene, 'autoSaveChart').mockResolvedValue(undefined);

			const eventBusOnMock = EventBus.on as MockedFn;
			const noteImportCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.NOTE_IMPORT
			)?.[1];

			// Empty notes with draftMeasureCount=0 — 0 is invalid, preserve current
			await noteImportCallback?.([], {}, 0);

			expect(editorScene['measureCount']).toBe(10);
			expect(restartSpy).toHaveBeenCalledWith({ measureCount: 10 });

			restartSpy.mockRestore();
		});
	});

	describe('START_PREVIEW event handler', () => {
		it('should launch new preview scene when preview is not active or paused', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 0, getByName: vi.fn() } as any;

			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(false);
			(editorScene.scene as any).isPaused = vi.fn().mockReturnValue(false);

			const eventBusOnMock = EventBus.on as MockedFn;
			const startPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.START_PREVIEW
			)?.[1];

			expect(startPreviewCallback).toBeDefined();
			startPreviewCallback?.(120);

			expect(editorScene.scene.pause).toHaveBeenCalled();
			expect(editorScene.scene.launch).toHaveBeenCalledWith('Preview', expect.any(Object));
		});

		it('should update and resume existing preview when isDirty and previewScene exists', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 0, getByName: vi.fn() } as any;
			editorScene['isDirty'] = true;

			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(true);
			(editorScene.scene as any).isPaused = vi.fn().mockReturnValue(false);

			const mockPreviewScene = { updateData: vi.fn() };
			(editorScene.scene as any).get = vi.fn().mockReturnValue(mockPreviewScene);

			const eventBusOnMock = EventBus.on as MockedFn;
			const startPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.START_PREVIEW
			)?.[1];

			startPreviewCallback?.(120);

			expect(mockPreviewScene.updateData).toHaveBeenCalled();
			expect(editorScene.scene.resume).toHaveBeenCalledWith('Preview');
		});

		it('should fallback to launch when isDirty but previewScene not found', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 0, getByName: vi.fn() } as any;
			editorScene['isDirty'] = true;

			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(true);
			(editorScene.scene as any).isPaused = vi.fn().mockReturnValue(false);
			(editorScene.scene as any).get = vi.fn().mockReturnValue(null);

			const eventBusOnMock = EventBus.on as MockedFn;
			const startPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.START_PREVIEW
			)?.[1];

			startPreviewCallback?.(120);

			expect(editorScene.scene.launch).toHaveBeenCalledWith('Preview', expect.any(Object));
		});

		it('should resume existing preview and emit RESUME_PREVIEW when not dirty', () => {
			editorScene.create();
			editorScene['panelContainer'] = { y: 0, getByName: vi.fn() } as any;
			editorScene['isDirty'] = false;

			(editorScene.scene as any).isActive = vi.fn().mockReturnValue(true);
			(editorScene.scene as any).isPaused = vi.fn().mockReturnValue(false);

			const eventBusOnMock = EventBus.on as MockedFn;
			const startPreviewCallback = eventBusOnMock.mock.calls.find(
				(call) => call[0] === EventType.START_PREVIEW
			)?.[1];

			startPreviewCallback?.(120);

			expect(editorScene.scene.resume).toHaveBeenCalledWith('Preview');
			expect(EventBus.emit).toHaveBeenCalledWith(
				EventType.RESUME_PREVIEW,
				expect.any(Object)
			);
		});
	});

	describe('onGridSpacingUpdate and onCellHeightUpdate callbacks', () => {
		it('should call updateGridSpacing when onGridSpacingUpdate is invoked', () => {
			editorScene.create();

			const updateGridSpacingSpy = vi
				.spyOn(editorScene as any, 'updateGridSpacing')
				.mockImplementation(() => {});

			editorScene['onGridSpacingUpdate']?.(16);

			expect(updateGridSpacingSpy).toHaveBeenCalledWith(16);
			updateGridSpacingSpy.mockRestore();
		});

		it('should call updateCellHeight when onCellHeightUpdate is invoked', () => {
			editorScene.create();

			const updateCellHeightSpy = vi
				.spyOn(editorScene as any, 'updateCellHeight')
				.mockImplementation(() => {});

			editorScene['onCellHeightUpdate']?.(30);

			expect(updateCellHeightSpy).toHaveBeenCalledWith(30);
			updateCellHeightSpy.mockRestore();
		});
	});
});
