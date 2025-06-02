import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from './Editor';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { GameObjects } from 'phaser';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock the dependencies
vi.mock('../EventBus');
vi.mock('$lib/store', () => ({
	default: {
		measureCount: {
			set: vi.fn()
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
		expect(editorScene.constructor.name).toBe('Editor');
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

	it('should start selection when dragging in non-editing mode', () => {
		const editorScene = new Editor();
		editorScene.create();

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

		// Simulate pointer down in non-editing mode (isEditing = false)
		pointerdownHandler?.(mockPointer);

		// Should have started selection
		expect(editorScene['isSelecting']).toBe(true);
		expect(editorScene['selectionStartX']).toBe(100);
		expect(editorScene['selectionStartY']).toBe(200);
	});

	it('should update selection rectangle during drag', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Start selection first
		editorScene['isSelecting'] = true;
		editorScene['selectionStartX'] = 100;
		editorScene['selectionStartY'] = 200;

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

		// Simulate pointer move during selection
		pointermoveHandler?.(mockPointer);

		// Should have updated selection rectangle
		expect(editorScene['selectionRectangle'].setSize).toHaveBeenCalled();
		expect(editorScene['selectionRectangle'].setPosition).toHaveBeenCalled();
	});

	it('should end selection on pointer up', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Start selection first
		editorScene['isSelecting'] = true;

		// Get the pointerup handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointerupHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointerup'
		)?.[1];

		expect(pointerupHandler).toBeDefined();

		// Simulate pointer up
		pointerupHandler?.();

		// Should have ended selection
		expect(editorScene['isSelecting']).toBe(false);
		expect(editorScene['selectionRectangle'].setVisible).toHaveBeenCalledWith(false);
	});

	it('should select single note when clicking on it in non-editing mode', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Create a proper mock note that will pass the instanceof check
		const mockNote = {
			name: 'note-1-0-0.5',
			// Add the methods that Graphics objects need
			lineStyle: vi.fn().mockReturnThis(),
			strokeRect: vi.fn().mockReturnThis(),
			constructor: { name: 'Graphics' }
		} as unknown as Phaser.GameObjects.Graphics;
		// Make it pass the instanceof check
		Object.setPrototypeOf(mockNote, GameObjects.Graphics.prototype);

		editorScene['panelContainer'].list = [mockNote];

		// Mock the calculateNoteBounds method to return bounds for our test note
		const calculateNoteBoundsSpy = vi.spyOn(editorScene as never, 'calculateNoteBounds');
		calculateNoteBoundsSpy.mockReturnValue({
			x: 100,
			y: 200,
			width: 46,
			height: 21
		});

		// Get the pointerdown handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointerdownHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointerdown'
		)?.[1];

		expect(pointerdownHandler).toBeDefined();

		// Mock pointer clicking on the note
		const mockPointer = {
			x: 120, // Within note bounds (100-146)
			y: 210, // Within note bounds (200-221)
			rightButtonDown: vi.fn().mockReturnValue(false)
		};

		// Simulate pointer down on the note in non-editing mode
		pointerdownHandler?.(mockPointer);

		// Should have selected the note
		expect(editorScene['selectedNotes'].has('note-1-0-0.5')).toBe(true);
		expect(editorScene['isSelecting']).toBe(false); // Should not start drag selection

		calculateNoteBoundsSpy.mockRestore();
	});

	it('should start drag selection when clicking on empty area in non-editing mode', () => {
		const editorScene = new Editor();
		editorScene.create();

		// Mock empty panelContainer
		editorScene['panelContainer'].list = [];

		// Get the pointerdown handler
		const inputOnMock = editorScene.input.on as MockedFn;
		const pointerdownHandler = inputOnMock.mock.calls.find(
			(call) => call[0] === 'pointerdown'
		)?.[1];

		expect(pointerdownHandler).toBeDefined();

		// Mock pointer clicking on empty area
		const mockPointer = {
			x: 300,
			y: 400,
			rightButtonDown: vi.fn().mockReturnValue(false)
		};

		// Simulate pointer down on empty area in non-editing mode
		pointerdownHandler?.(mockPointer);

		// Should have started drag selection
		expect(editorScene['isSelecting']).toBe(true);
		expect(editorScene['selectionStartX']).toBe(300);
		expect(editorScene['selectionStartY']).toBe(400);
	});
});
