import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from './Editor';
import { EventBus } from '../EventBus';
import EventType from '../EventType';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock the dependencies
vi.mock('../EventBus');
vi.mock('@dtx/common', () => ({
	store: {
		measureCount: {
			set: vi.fn()
		},
		activeNote: {
			subscribe: vi.fn((callback) => {
				// Call the callback with a mock value
				callback('01');
				// Return an unsubscribe function
				return vi.fn();
			})
		},
		editorNotes: {
			set: vi.fn()
		},
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
		},
		currentSimfileID: {
			subscribe: vi.fn((callback) => {
				callback(null);
				return vi.fn();
			})
		},
		currentDifficulty: {
			subscribe: vi.fn((callback) => {
				callback(null);
				return vi.fn();
			})
		}
	}
}));
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
});
