import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '../Editor.js';

type MockedFn = ReturnType<typeof vi.fn>;

// Mock the NoteManager
vi.mock('../editor/NoteManager.js', () => ({
	NoteManager: class MockNoteManager {
		selectedNotes = new Set();
		initialize = vi.fn();
		handlePointerDown = vi.fn();
		handlePointerMove = vi.fn();
		handlePointerUp = vi.fn();
		highlightSelectedNote = vi.fn();
		deleteNoteByKey = vi.fn();
		findNearbyNotes = vi.fn(() => []);
	}
}));

describe('Editor Scene', () => {
	let editor: Editor;

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Create editor instance
		editor = new Editor(10);
	});

	afterEach(() => {
		// Clean up
		if (editor) {
			editor.destroy?.();
		}
	});

	it('should create an Editor instance', () => {
		expect(editor).toBeInstanceOf(Editor);
		expect(editor.measureCount).toBe(10);
	});

	it('should have correct static key', () => {
		expect(Editor.key).toBe('Editor');
	});

	it('should initialize with empty notes', () => {
		expect(editor.notes).toEqual({});
	});

	it('should have initial measure count', () => {
		expect(editor.measureCount).toBe(10);
	});

	it('should initialize selectedNotes set', () => {
		expect(editor.selectedNotes).toBeInstanceOf(Set);
		expect(editor.selectedNotes.size).toBe(0);
	});

	it('should provide getter methods for scene properties', () => {
		// Test that the getters exist and return expected types
		expect(typeof editor.getIsEditing).toBe('function');
		expect(typeof editor.getLaneConfigs).toBe('function');
		expect(typeof editor.getNotes).toBe('function');
		expect(typeof editor.getPanelContainer).toBe('function');
		expect(typeof editor.getOffsetX).toBe('function');
		expect(typeof editor.getOffsetY).toBe('function');
		expect(typeof editor.getCellWidth).toBe('function');
		expect(typeof editor.getCellHeightValue).toBe('function');
		expect(typeof editor.getCellMargin).toBe('function');
		expect(typeof editor.getCellsPerMeasure).toBe('function');
		expect(typeof editor.getNoteSize).toBe('function');
		expect(typeof editor.getMeasureCount).toBe('function');
	});

	it('should provide note management methods', () => {
		expect(typeof editor.clearSelection).toBe('function');
		expect(typeof editor.highlightSelectedNote).toBe('function');
		expect(typeof editor.deleteNoteByKey).toBe('function');
		expect(typeof editor.drawNote).toBe('function');
	});

	it('should handle init with data', () => {
		const initData = { measureCount: 20 };
		editor.init(initData);
		expect(editor.measureCount).toBe(20);
	});

	it('should handle init without data', () => {
		const originalCount = editor.measureCount;
		editor.init({});
		expect(editor.measureCount).toBe(originalCount);
	});
});
