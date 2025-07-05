import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteCopy } from './NoteCopy';
import { LaneMeasureNote } from '@dtx/common';
import type { Editor } from '../Editor';

// Mock Editor type
const createMockEditor = () => {
	return {
		getNotes: vi.fn(),
		getLaneConfigs: vi.fn(),
		getCellsPerMeasure: vi.fn().mockReturnValue(16),
		getMeasureCount: vi.fn().mockReturnValue(100),
		drawNote: vi.fn().mockReturnValue(true),
		getPanelContainer: vi.fn().mockReturnValue({
			getByName: vi.fn().mockReturnValue(null)
		})
	} as unknown as Editor;
};

describe('NoteCopy', () => {
	let noteCopy: NoteCopy;
	let mockEditor: Editor;

	beforeEach(() => {
		noteCopy = new NoteCopy();
		mockEditor = createMockEditor();

		// Set up default lane configs
		vi.mocked(mockEditor.getLaneConfigs).mockReturnValue([
			{ id: 'lane1', name: 'Lane 1', noteColor: 0xffffff, playable: true },
			{ id: 'lane2', name: 'Lane 2', noteColor: 0xffffff, playable: true },
			{ id: 'lane3', name: 'Lane 3', noteColor: 0xffffff, playable: true }
		]);

		// Set up default notes structure with properly parsed notes
		const lane1Note = new LaneMeasureNote(1, 'lane1', '11000000000000000000000000000000');
		const lane2Note = new LaneMeasureNote(1, 'lane2', '12000000000000000000000000000000');
		lane1Note.parseNote();
		lane2Note.parseNote();

		vi.mocked(mockEditor.getNotes).mockReturnValue({
			lane1: [lane1Note],
			lane2: [lane2Note]
		});
	});

	describe('constructor', () => {
		it('should create with empty clipboard', () => {
			expect(noteCopy.hasClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(0);
		});
	});

	describe('copyNotes', () => {
		it('should copy selected notes successfully', () => {
			// Make sure the notes are properly parsed
			const lane1Note = new LaneMeasureNote(1, 'lane1', '11000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', '12000000000000000000000000000000');
			lane1Note.parseNote();
			lane2Note.parseNote();

			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(true);
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(2);
		});

		it('should return false when no notes are selected', () => {
			const selectedNotes = new Set<string>();

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(false);
			expect(noteCopy.hasClipboard()).toBe(false);
		});

		it('should calculate relative positions correctly', () => {
			// Test with notes at different positions to verify relative calculation
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			noteCopy.copyNotes(selectedNotes, mockEditor);

			// The first note (note-0-1-0) should be the reference with relative position (0, 0, 0)
			// The second note should have relative position (1, 0, 0)
			expect(noteCopy.hasClipboard()).toBe(true);
		});

		it('should handle notes that do not exist in data structure', () => {
			const selectedNotes = new Set(['note-0-1-0', 'note-2-2-0.5']); // Second note doesn't exist

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			// Should still succeed with the notes that exist
			expect(result).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(1); // Only one note copied
		});

		it('should find the correct reference note (lowest coordinates)', () => {
			// Add a note that should become the reference
			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [
					new LaneMeasureNote(0, 'lane1', '11000000000000000000000000000000') // measure 0
				],
				lane2: [
					new LaneMeasureNote(1, 'lane2', '12000000000000000000000000000000') // measure 1
				]
			});

			const selectedNotes = new Set(['note-1-1-0', 'note-0-0-0']); // Second note should be reference

			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(2);
		});
	});

	describe('pasteNotes', () => {
		beforeEach(() => {
			// Set up some copied notes - copy notes at positions (0,1,0) and (1,1,0)
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);
		});

		it('should paste notes successfully at target position', () => {
			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(true);
			expect(mockEditor.drawNote).toHaveBeenCalledTimes(2);
			// First note should be pasted at the target position
			expect(mockEditor.drawNote).toHaveBeenCalledWith(2, 0, 0, '11');
			// Second note should maintain relative position (1 lane over)
			expect(mockEditor.drawNote).toHaveBeenCalledWith(2, 1, 0, '12');
		});

		it('should return false when no notes are in clipboard', () => {
			noteCopy.clearClipboard();

			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(false);
			expect(mockEditor.drawNote).not.toHaveBeenCalled();
		});

		it('should handle measure boundary crossing', () => {
			// Test pasting near the end of a measure - paste at position 0.9
			// First note will be at (0, 1, 0.9), second note at (1, 1, 0.9)
			// Since our copied notes are at relative positions (0,0,0) and (1,0,0)
			// Note: 0.9 gets normalized to 0.875 (14/16)
			const result = noteCopy.pasteNotes(0, 1, 0.9, mockEditor);

			expect(result).toBe(true);
			// Both notes should be within bounds
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.875, '11');
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 1, 0.875, '12');
		});

		it('should validate target positions and skip invalid ones', () => {
			// Try to paste at an invalid lane
			const result = noteCopy.pasteNotes(10, 2, 0, mockEditor); // Lane 10 doesn't exist

			expect(result).toBe(false);
			expect(mockEditor.drawNote).not.toHaveBeenCalled();
		});

		it('should skip positions that are already occupied', () => {
			// Mock an existing note at the target position
			const mockGetByName = vi.fn().mockReturnValue({ name: 'existing-note' });
			vi.mocked(mockEditor.getPanelContainer).mockReturnValue({
				getByName: mockGetByName
			} as never);

			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(false); // No notes pasted due to collision
		});

		it('should update data structure when pasting notes', () => {
			const mockNotes = {
				lane1: [],
				lane2: []
			};
			vi.mocked(mockEditor.getNotes).mockReturnValue(mockNotes);

			noteCopy.pasteNotes(0, 2, 0, mockEditor);

			// Should have created new LaneMeasureNote entries
			expect(mockNotes['lane1']).toHaveLength(1);
			expect(mockNotes['lane2']).toHaveLength(1);
		});

		it('should add to existing measure when one already exists', () => {
			const mockNotes = {
				lane1: [new LaneMeasureNote(2, 'lane1', '00000000000000000000000000000000')],
				lane2: []
			};
			vi.mocked(mockEditor.getNotes).mockReturnValue(mockNotes);

			noteCopy.pasteNotes(0, 2, 0, mockEditor);

			// Should have updated existing measure instead of creating new one
			expect(mockNotes['lane1']).toHaveLength(1);
			expect(mockNotes['lane1'][0].pattern).toContain('11'); // Note was added
		});
	});

	describe('clipboard management', () => {
		it('should clear clipboard correctly', () => {
			const selectedNotes = new Set(['note-0-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.hasClipboard()).toBe(true);

			noteCopy.clearClipboard();

			expect(noteCopy.hasClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(0);
		});

		it('should report correct clipboard size', () => {
			expect(noteCopy.getClipboardSize()).toBe(0);

			// Add a third lane note for this test
			const lane3Note = new LaneMeasureNote(2, 'lane3', '13000000000000000000000000000000');
			lane3Note.parseNote();

			const notesWithThird = {
				...vi.mocked(mockEditor.getNotes).getMockImplementation()?.(),
				lane3: [lane3Note]
			};
			vi.mocked(mockEditor.getNotes).mockReturnValue(notesWithThird);

			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0', 'note-2-2-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.getClipboardSize()).toBe(3);
		});
	});

	describe('edge cases', () => {
		it('should handle negative relative positions correctly', () => {
			// Set up notes where the reference is not the first in order
			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [new LaneMeasureNote(2, 'lane1', '11000000000000000000000000000000')],
				lane2: [new LaneMeasureNote(1, 'lane2', '12000000000000000000000000000000')]
			});

			const selectedNotes = new Set(['note-0-2-0', 'note-1-1-0']); // Second note is reference
			noteCopy.copyNotes(selectedNotes, mockEditor);

			// Paste at position where negative offsets would occur
			const result = noteCopy.pasteNotes(1, 1, 0, mockEditor);

			expect(result).toBe(true);
		});

		it('should handle empty notes structure', () => {
			vi.mocked(mockEditor.getNotes).mockReturnValue({});

			const selectedNotes = new Set(['note-0-1-0']);
			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(false);
		});

		it('should handle malformed note keys', () => {
			const selectedNotes = new Set(['invalid-key', 'note-0-1-0']);
			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			// Should still process valid keys
			expect(result).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(1);
		});
	});
});
