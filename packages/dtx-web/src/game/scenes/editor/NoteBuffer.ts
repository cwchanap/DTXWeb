import { LaneMeasureNote, normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';

/**
 * Interface for tracking undo actions
 */
export interface UndoAction {
	type: 'delete' | 'add' | 'move';
	data: DeletedNoteData[];
}

/**
 * Interface for storing deleted note data for restoration
 */
export interface DeletedNoteData {
	noteKey: string;
	laneIndex: number;
	measure: number;
	cellOffset: number;
	laneId: string;
	noteId: string;
	// Store pattern data instead of object reference to avoid stale references
	originalPattern?: string;
	measureLength?: number;
}

/**
 * Manages undo/redo functionality for note operations in the DTX editor.
 * Provides a buffer system for tracking and reversing note operations.
 */
export class NoteBuffer {
	private undoHistory: UndoAction[] = [];
	private readonly maxUndoSteps: number;

	/**
	 * Creates a new NoteBuffer instance
	 * @param maxUndoSteps Maximum number of undo steps to keep in memory (default: 50)
	 */
	constructor(maxUndoSteps: number = 50) {
		if (maxUndoSteps <= 0) {
			throw new Error('maxUndoSteps must be greater than 0');
		}
		this.maxUndoSteps = maxUndoSteps;
	}

	/**
	 * Records an undo action for later restoration
	 * @param type The type of action being recorded
	 * @param data Array of note data for the action
	 */
	recordAction(type: UndoAction['type'], data: DeletedNoteData[]): void {
		if (!data || data.length === 0) {
			return; // Don't record empty actions
		}

		// Add new action to undo history
		this.undoHistory.push({ type, data: [...data] }); // Create a copy of the data

		// Limit undo history to prevent memory issues
		if (this.undoHistory.length > this.maxUndoSteps) {
			this.undoHistory.shift(); // Remove oldest entry
		}
	}

	/**
	 * Undoes the last recorded action
	 * @param editor The Editor instance that contains all the necessary methods and properties
	 * @returns true if an action was undone, false if no actions available
	 */
	undoLastAction(editor: Editor): boolean {
		if (this.undoHistory.length === 0) {
			return false;
		}

		const lastAction = this.undoHistory.pop();
		if (!lastAction) {
			return false;
		}

		try {
			switch (lastAction.type) {
				case 'delete':
					this.undoDelete(lastAction.data, editor);
					return true;
				case 'add':
				case 'move':
					// TODO: Implement undo for add and move operations if needed
					return false;
				default:
					return false;
			}
		} catch (error) {
			// If undo fails, put the action back in history
			this.undoHistory.push(lastAction);
			throw error;
		}
	}

	/**
	 * Restores deleted notes by recreating them in the editor
	 * @param deletedNotes Array of deleted note data to restore
	 * @param editor The editor instance to restore notes to
	 */
	private undoDelete(deletedNotes: DeletedNoteData[], editor: Editor): void {
		if (!deletedNotes || deletedNotes.length === 0) {
			return;
		}

		// Group deleted notes by laneId and measure for efficient restoration
		const notesByLaneAndMeasure = this.groupNotesByLaneAndMeasure(deletedNotes);

		// Restore notes grouped by lane and measure
		this.restoreNotesToEditor(notesByLaneAndMeasure, editor);

		// Select all restored notes
		this.selectRestoredNotes(deletedNotes, editor);
	}

	/**
	 * Groups deleted notes by lane ID and measure for efficient processing
	 */
	private groupNotesByLaneAndMeasure(
		deletedNotes: DeletedNoteData[]
	): Map<string, Map<number, DeletedNoteData[]>> {
		const notesByLaneAndMeasure = new Map<string, Map<number, DeletedNoteData[]>>();

		deletedNotes.forEach((deletedNote) => {
			const { laneId, measure } = deletedNote;

			if (!notesByLaneAndMeasure.has(laneId)) {
				notesByLaneAndMeasure.set(laneId, new Map());
			}

			const laneMap = notesByLaneAndMeasure.get(laneId)!;
			if (!laneMap.has(measure)) {
				laneMap.set(measure, []);
			}

			laneMap.get(measure)!.push(deletedNote);
		});

		return notesByLaneAndMeasure;
	}

	/**
	 * Restores notes to the editor's data structure and visual display
	 */
	private restoreNotesToEditor(
		notesByLaneAndMeasure: Map<string, Map<number, DeletedNoteData[]>>,
		editor: Editor
	): void {
		// CRITICAL: First restore the data structure, then redraw visuals from the restored data
		// This prevents conflicts between visual and data restoration
		notesByLaneAndMeasure.forEach((measureMap, laneId) => {
			measureMap.forEach((notesInMeasure, measure) => {
				// First, update the data structure
				this.updateNoteDataStructure(laneId, measure, notesInMeasure, editor);
			});
		});

		// Then, redraw all visual notes from the restored data structure
		notesByLaneAndMeasure.forEach((measureMap, laneId) => {
			measureMap.forEach((notesInMeasure, measure) => {
				this.redrawVisualNotes(notesInMeasure, editor);
			});
		});
	}

	/**
	 * Redraws visual notes in the editor
	 */
	private redrawVisualNotes(notesInMeasure: DeletedNoteData[], editor: Editor): void {
		notesInMeasure.forEach((deletedNote) => {
			const { laneIndex, noteId, measure } = deletedNote;
			// Use normalized cellOffset for consistency
			const normalizedCellOffset = normalizePosition(
				deletedNote.cellOffset,
				editor.getCellsPerMeasure()
			);
			editor.drawNote(measure, laneIndex, normalizedCellOffset, noteId);
			// Update the deletedNote for consistency with other operations
			deletedNote.cellOffset = normalizedCellOffset;
		});
	}

	/**
	 * Updates the editor's note data structure with restored notes
	 */
	private updateNoteDataStructure(
		laneId: string,
		measure: number,
		notesInMeasure: DeletedNoteData[],
		editor: Editor
	): void {
		// Ensure lane exists in notes structure
		if (!(laneId in editor.notes)) {
			editor.notes[laneId] = [];
		}

		// Check if there's already a LaneMeasureNote for this measure
		const existingMeasureNote = editor.notes[laneId].find(
			(note: LaneMeasureNote) => note.measure === measure
		);

		if (existingMeasureNote) {
			this.updateExistingMeasureNote(existingMeasureNote, notesInMeasure, editor);
		} else {
			// IMPORTANT: The measure note may have been deleted during the deletion process if it became empty
			// Always create a new measure note for undo operations to ensure data consistency
			this.createNewMeasureNote(laneId, measure, notesInMeasure, editor);
		}
	}

	/**
	 * Updates an existing measure note with restored notes by reconstructing the pattern from original data
	 */
	private updateExistingMeasureNote(
		existingMeasureNote: LaneMeasureNote,
		notesInMeasure: DeletedNoteData[],
		editor: Editor
	): void {
		const patternLength = editor.getCellsPerMeasure();
		const expectedPatternStringLength = patternLength * 2; // Each position takes 2 characters

		// Strategy: Reconstruct the pattern by merging the current pattern with the original patterns
		// This ensures we don't lose any existing notes while properly restoring deleted ones

		let reconstructedPattern = existingMeasureNote.pattern;

		// Ensure the pattern is the correct length
		if (reconstructedPattern.length < expectedPatternStringLength) {
			reconstructedPattern = reconstructedPattern.padEnd(expectedPatternStringLength, '0');
		}

		// For each note to restore, check if we have original pattern data
		notesInMeasure.forEach((deletedNote) => {
			const { cellOffset, noteId, originalPattern } = deletedNote;
			const normalizedCellOffset = normalizePosition(cellOffset, patternLength);
			const notePosition = Math.round(normalizedCellOffset * patternLength);
			const startIndex = notePosition * 2;

			if (startIndex >= 0 && startIndex < reconstructedPattern.length - 1) {
				const currentNoteAtPosition = reconstructedPattern.substring(
					startIndex,
					startIndex + 2
				);

				// If position is empty or we're restoring the exact same note, restore it
				if (currentNoteAtPosition === '00' || currentNoteAtPosition === noteId) {
					reconstructedPattern =
						reconstructedPattern.substring(0, startIndex) +
						noteId +
						reconstructedPattern.substring(startIndex + 2);
				} else {
					// There's a different note at this position
					// If we have original pattern data, use it to make a decision
					if (originalPattern && originalPattern.length >= startIndex + 2) {
						const originalNoteAtPosition = originalPattern.substring(
							startIndex,
							startIndex + 2
						);

						// If the original pattern had our note at this position, restore it
						if (originalNoteAtPosition === noteId) {
							reconstructedPattern =
								reconstructedPattern.substring(0, startIndex) +
								noteId +
								reconstructedPattern.substring(startIndex + 2);
						}
					}
				}
			}
		});

		existingMeasureNote.pattern = reconstructedPattern;
		existingMeasureNote.parseNote(); // Reparse to update notes array
	}

	/**
	 * Creates a new measure note with restored notes
	 */
	private createNewMeasureNote(
		laneId: string,
		measure: number,
		notesInMeasure: DeletedNoteData[],
		editor: Editor
	): void {
		const patternLength = editor.getCellsPerMeasure();
		let pattern = '00'.repeat(patternLength);

		// Add each note to the pattern
		notesInMeasure.forEach((deletedNote) => {
			const { cellOffset, noteId } = deletedNote;
			// Normalize the position to prevent precision issues
			const normalizedCellOffset = normalizePosition(cellOffset, patternLength);
			const notePosition = Math.round(normalizedCellOffset * patternLength);
			const startIndex = notePosition * 2;
			pattern = pattern.substring(0, startIndex) + noteId + pattern.substring(startIndex + 2);

			// Update the deletedNote's cellOffset to the normalized value for consistency
			deletedNote.cellOffset = normalizedCellOffset;
		});

		const newMeasureNote = new LaneMeasureNote(measure, laneId, pattern);
		editor.notes[laneId].push(newMeasureNote);
	}

	/**
	 * Selects all restored notes in the editor
	 */
	private selectRestoredNotes(deletedNotes: DeletedNoteData[], editor: Editor): void {
		// Clear current selection and select all restored notes
		editor.clearSelection();
		deletedNotes.forEach((deletedNote) => {
			const noteGraphics = editor.getByName(deletedNote.noteKey);
			if (noteGraphics) {
				// Note highlighting will be handled by selection mechanism
				editor.selectedNotes.add(deletedNote.noteKey);
			}
		});
	}

	/**
	 * Clears all undo history
	 */
	clearHistory(): void {
		this.undoHistory = [];
	}

	/**
	 * Gets the current number of undo actions available
	 */
	getHistoryLength(): number {
		return this.undoHistory.length;
	}

	/**
	 * Gets a copy of the undo history for testing purposes
	 */
	getHistory(): UndoAction[] {
		return [...this.undoHistory];
	}

	/**
	 * Checks if there are any actions available to undo
	 */
	canUndo(): boolean {
		return this.undoHistory.length > 0;
	}
}
