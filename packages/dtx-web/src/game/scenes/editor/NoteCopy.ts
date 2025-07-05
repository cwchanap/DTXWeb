import { LaneMeasureNote, normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';

/**
 * Represents a copied note with its position and properties
 */
export interface CopiedNoteData {
	/** Note key from the original note */
	noteKey: string;
	/** Lane index of the note */
	laneIndex: number;
	/** Measure number */
	measure: number;
	/** Cell offset within the measure (0.0 to 1.0) */
	cellOffset: number;
	/** Lane ID */
	laneId: string;
	/** Note ID (e.g., '01', '11', etc.) */
	noteId: string;
	/** Relative position from the reference note */
	relativeLaneIndex: number;
	/** Relative measure offset from reference note */
	relativeMeasure: number;
	/** Relative cell offset from reference note */
	relativeCellOffset: number;
}

/**
 * Manages note copy and paste operations in the DTX editor
 */
export class NoteCopy {
	private copiedNotes: CopiedNoteData[] = [];
	private hasClipboardData = false;

	/**
	 * Copy the selected notes to the clipboard
	 */
	copyNotes(selectedNotes: Set<string>, editor: Editor): boolean {
		if (selectedNotes.size === 0) {
			return false;
		}

		const notesToCopy: CopiedNoteData[] = [];
		const notes = editor.getNotes();

		// Find the reference note (lowest lane index, then lowest measure, then lowest cell offset)
		let referenceLaneIndex = Number.MAX_SAFE_INTEGER;
		let referenceMeasure = Number.MAX_SAFE_INTEGER;
		let referenceCellOffset = Number.MAX_SAFE_INTEGER;

		// First pass: find the reference position
		selectedNotes.forEach((noteKey) => {
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);

				if (
					laneIndex < referenceLaneIndex ||
					(laneIndex === referenceLaneIndex && measure < referenceMeasure) ||
					(laneIndex === referenceLaneIndex &&
						measure === referenceMeasure &&
						cellOffset < referenceCellOffset)
				) {
					referenceLaneIndex = laneIndex;
					referenceMeasure = measure;
					referenceCellOffset = cellOffset;
				}
			}
		});

		// Second pass: collect note data with relative positions
		selectedNotes.forEach((noteKey) => {
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);
				const laneId = editor.getLaneConfigs()[laneIndex].id;

				// Find the note data in the editor's data structure
				if (laneId in notes) {
					const existingNote = notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.001)
					);

					if (existingNote) {
						const noteChip = existingNote.notes.find(
							(n) => Math.abs(n.position - cellOffset) < 0.001
						);

						if (noteChip) {
							notesToCopy.push({
								noteKey,
								laneIndex,
								measure,
								cellOffset,
								laneId,
								noteId: noteChip.noteID,
								relativeLaneIndex: laneIndex - referenceLaneIndex,
								relativeMeasure: measure - referenceMeasure,
								relativeCellOffset: cellOffset - referenceCellOffset
							});
						}
					}
				}
			}
		});

		if (notesToCopy.length > 0) {
			this.copiedNotes = notesToCopy;
			this.hasClipboardData = true;
			return true;
		}

		return false;
	}

	/**
	 * Paste the copied notes at the specified position
	 */
	pasteNotes(
		targetLaneIndex: number,
		targetMeasure: number,
		targetCellOffset: number,
		editor: Editor
	): boolean {
		if (!this.hasClipboardData || this.copiedNotes.length === 0) {
			return false;
		}

		const notesToPaste: Array<{
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			noteId: string;
		}> = [];

		// Calculate target positions for each copied note
		this.copiedNotes.forEach((copiedNote) => {
			const newLaneIndex = targetLaneIndex + copiedNote.relativeLaneIndex;
			let newMeasure = targetMeasure + copiedNote.relativeMeasure;
			let newCellOffset = targetCellOffset + copiedNote.relativeCellOffset;

			// Handle measure boundary crossing for cellOffset
			while (newCellOffset >= 1.0) {
				newCellOffset -= 1.0;
				newMeasure += 1;
			}
			while (newCellOffset < 0.0) {
				newCellOffset += 1.0;
				newMeasure -= 1;
			}

			// Normalize the position to match what drawNote does
			newCellOffset = normalizePosition(newCellOffset, editor.getCellsPerMeasure());

			// Validate target position
			if (
				newLaneIndex >= 0 &&
				newLaneIndex < editor.getLaneConfigs().length &&
				newMeasure >= 0 &&
				newMeasure < editor.getMeasureCount() &&
				newCellOffset >= 0 &&
				newCellOffset <= 1
			) {
				const newLaneId = editor.getLaneConfigs()[newLaneIndex].id;
				const newKey = `note-${newLaneIndex}-${newMeasure}-${newCellOffset}`;

				// Check if position is already occupied
				const existingNote = editor.getPanelContainer().getByName(newKey);
				if (!existingNote) {
					notesToPaste.push({
						laneIndex: newLaneIndex,
						measure: newMeasure,
						cellOffset: newCellOffset,
						laneId: newLaneId,
						noteId: copiedNote.noteId
					});
				}
			}
		});

		if (notesToPaste.length === 0) {
			return false;
		}

		// Add each note to both display and data structure
		const addedNotes: string[] = [];
		notesToPaste.forEach(({ laneIndex, measure, cellOffset, laneId, noteId }) => {
			// Add to display
			const noteAdded = editor.drawNote(measure, laneIndex, cellOffset, noteId);

			if (noteAdded) {
				const newKey = `note-${laneIndex}-${measure}-${cellOffset}`;
				addedNotes.push(newKey);

				// Add to data structure
				const notes = editor.getNotes();
				if (!(laneId in notes)) {
					notes[laneId] = [];
				}

				// Check if a LaneMeasureNote already exists for this measure/lane
				const existingMeasureNote = notes[laneId].find((note) => note.measure === measure);

				if (existingMeasureNote) {
					// Add note to existing measure
					const patternLength = editor.getCellsPerMeasure();
					const notePosition = Math.round(cellOffset * patternLength);
					const startIndex = notePosition * 2;
					let pattern = existingMeasureNote.pattern;

					// Ensure pattern is long enough
					const expectedLength = patternLength * 2;
					if (pattern.length < expectedLength) {
						pattern = pattern.padEnd(expectedLength, '0');
					}

					// Place the note in the pattern
					pattern =
						pattern.substring(0, startIndex) +
						noteId +
						pattern.substring(startIndex + 2);

					existingMeasureNote.pattern = pattern;
					existingMeasureNote.parseNote(); // Reparse to update notes array
				} else {
					// Create a new LaneMeasureNote for this measure
					const patternLength = editor.getCellsPerMeasure();
					const notePosition = Math.round(cellOffset * patternLength);
					let pattern = '00'.repeat(patternLength);

					// Place the note at the correct position
					const startIndex = notePosition * 2;
					pattern =
						pattern.substring(0, startIndex) +
						noteId +
						pattern.substring(startIndex + 2);

					notes[laneId].push(new LaneMeasureNote(measure, laneId, pattern));
				}
			}
		});

		return addedNotes.length > 0;
	}

	/**
	 * Check if there are notes in the clipboard
	 */
	hasClipboard(): boolean {
		return this.hasClipboardData;
	}

	/**
	 * Clear the clipboard
	 */
	clearClipboard(): void {
		this.copiedNotes = [];
		this.hasClipboardData = false;
	}

	/**
	 * Get the number of notes in the clipboard
	 */
	getClipboardSize(): number {
		return this.copiedNotes.length;
	}
}
