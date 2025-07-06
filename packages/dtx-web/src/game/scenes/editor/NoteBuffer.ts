import { normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';
import type { NoteMove } from './NoteMove';

/**
 * Interface for tracking undo actions
 */
export interface UndoAction {
	type: 'delete';
	data: DeletedNoteData[];
}

export interface MoveUndoAction {
	type: 'move';
	data: MovedNoteData[];
}

export type AnyUndoAction = UndoAction | MoveUndoAction;

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
 * Interface for storing moved note data for restoration
 */
export interface MovedNoteData {
	// Original position
	originalNoteKey: string;
	originalLaneIndex: number;
	originalMeasure: number;
	originalCellOffset: number;
	originalLaneId: string;
	noteId: string;
	// New position
	newNoteKey: string;
	newLaneIndex: number;
	newMeasure: number;
	newCellOffset: number;
	newLaneId: string;
	// Pattern data for restoration
	originalPattern?: string;
	newPattern?: string;
}

/**
 * Manages undo/redo functionality for note operations in the DTX editor.
 * Provides a buffer system for tracking and reversing note operations.
 */
export class NoteBuffer {
	private undoHistory: AnyUndoAction[] = [];
	private readonly maxUndoSteps: number;
	private noteMove: NoteMove | null = null;

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
	 * Sets the NoteMove instance for shared note placement logic
	 */
	setNoteMove(noteMove: NoteMove): void {
		this.noteMove = noteMove;
	}

	/**
	 * Records an undo action for later restoration
	 * @param type The type of action being recorded
	 * @param data Array of note data for the action
	 */
	recordAction(type: 'delete', data: DeletedNoteData[]): void;
	recordAction(type: 'move', data: MovedNoteData[]): void;
	recordAction(type: 'delete' | 'move', data: DeletedNoteData[] | MovedNoteData[]): void {
		if (!data || data.length === 0) {
			return; // Don't record empty actions
		}

		// Add new action to undo history
		if (type === 'delete') {
			this.undoHistory.push({ type, data: [...(data as DeletedNoteData[])] });
		} else if (type === 'move') {
			this.undoHistory.push({ type, data: [...(data as MovedNoteData[])] });
		}

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
				case 'move':
					this.undoMove(lastAction.data, editor);
					return true;
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

		if (!this.noteMove) {
			throw new Error(
				'NoteMove instance not set. Call setNoteMove() before using undo functionality.'
			);
		}

		// Use the shared note placement logic to restore each note
		deletedNotes.forEach((deletedNote) => {
			const { measure, laneIndex, cellOffset, laneId, noteId } = deletedNote;

			// Normalize the position to ensure consistency
			const normalizedCellOffset = normalizePosition(cellOffset, editor.getCellsPerMeasure());

			// Use the shared logic to add the note back to both display and data structure
			this.noteMove!.addNoteToEditor(
				measure,
				laneIndex,
				normalizedCellOffset,
				laneId,
				noteId
			);
		});

		// Select all restored notes
		this.selectRestoredNotes(deletedNotes, editor);
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
	 * Undoes a move operation by moving notes back to their original positions
	 * @param movedNotes Array of moved note data to restore to original positions
	 * @param editor The editor instance to restore notes to
	 */
	private undoMove(movedNotes: MovedNoteData[], editor: Editor): void {
		if (!movedNotes || movedNotes.length === 0) {
			return;
		}

		if (!this.noteMove) {
			throw new Error(
				'NoteMove instance not set. Call setNoteMove() before using undo functionality.'
			);
		}

		// First, remove notes from their current (new) positions
		movedNotes.forEach((movedNote) => {
			// Remove visual note
			const noteGraphics = editor.getPanelContainer().getByName(movedNote.newNoteKey);
			if (noteGraphics) {
				noteGraphics.destroy();
			}

			// Remove text
			const keyParts = movedNote.newNoteKey.split('-');
			if (keyParts.length === 4) {
				const textKey = `text-${keyParts[1]}-${keyParts[2]}-${keyParts[3]}`;
				const noteText = editor.getPanelContainer().getByName(textKey);
				if (noteText) {
					noteText.destroy();
				}
			}

			// Remove from data structure
			this.removeNoteFromDataStructure(
				movedNote.newLaneId,
				movedNote.newMeasure,
				movedNote.newCellOffset,
				movedNote.noteId,
				editor
			);
		});

		// Then, restore notes to their original positions using shared logic
		movedNotes.forEach((movedNote) => {
			const {
				originalMeasure,
				originalLaneIndex,
				originalCellOffset,
				originalLaneId,
				noteId
			} = movedNote;

			// Normalize the position to ensure consistency
			const normalizedCellOffset = normalizePosition(
				originalCellOffset,
				editor.getCellsPerMeasure()
			);

			// Use the shared logic to add the note back to both display and data structure
			this.noteMove!.addNoteToEditor(
				originalMeasure,
				originalLaneIndex,
				normalizedCellOffset,
				originalLaneId,
				noteId
			);
		});

		// Select all restored notes at their original positions
		this.selectRestoredMovedNotes(movedNotes, editor);
	}

	/**
	 * Removes a note from the editor's data structure
	 */
	private removeNoteFromDataStructure(
		laneId: string,
		measure: number,
		cellOffset: number,
		noteId: string,
		editor: Editor
	): void {
		const notes = editor.notes;
		if (!(laneId in notes)) {
			return;
		}

		const measureNote = notes[laneId].find((note) => note.measure === measure);
		if (!measureNote) {
			return;
		}

		// Remove the note from the pattern
		const patternLength = editor.getCellsPerMeasure();
		const notePosition = Math.round(cellOffset * patternLength);
		const startIndex = notePosition * 2;

		if (startIndex >= 0 && startIndex < measureNote.pattern.length - 1) {
			const currentNote = measureNote.pattern.substring(startIndex, startIndex + 2);
			if (currentNote === noteId) {
				// Replace the note with '00'
				measureNote.pattern =
					measureNote.pattern.substring(0, startIndex) +
					'00' +
					measureNote.pattern.substring(startIndex + 2);
				measureNote.parseNote(); // Reparse to update notes array

				// If the measure is now empty, remove the entire LaneMeasureNote
				if (measureNote.notes.length === 0) {
					notes[laneId] = notes[laneId].filter((note) => note !== measureNote);

					// Clean up empty lane entries
					if (notes[laneId].length === 0) {
						delete notes[laneId];
					}
				}
			}
		}
	}

	/**
	 * Selects all restored notes at their original positions
	 */
	private selectRestoredMovedNotes(movedNotes: MovedNoteData[], editor: Editor): void {
		// Clear current selection and select all restored notes at original positions
		editor.clearSelection();
		movedNotes.forEach((movedNote) => {
			const noteGraphics = editor.getPanelContainer().getByName(movedNote.originalNoteKey);
			if (noteGraphics) {
				// Note highlighting will be handled by selection mechanism
				editor.selectedNotes.add(movedNote.originalNoteKey);
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
	getHistory(): AnyUndoAction[] {
		return [...this.undoHistory];
	}

	/**
	 * Checks if there are any actions available to undo
	 */
	canUndo(): boolean {
		return this.undoHistory.length > 0;
	}
}
