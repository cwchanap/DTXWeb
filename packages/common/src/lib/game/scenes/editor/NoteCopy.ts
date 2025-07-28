import type { Editor } from '../Editor';
import type { NoteMove } from './NoteMove';

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
	private isCutOperation = false; // Track if clipboard contains cut (vs copied) notes
	private noteMove: NoteMove;
	private findReferenceNote: (
		noteKeys: Set<string>
	) => { laneIndex: number; measure: number; cellOffset: number } | null;

	constructor(
		noteMove: NoteMove,
		findReferenceNote: (
			noteKeys: Set<string>
		) => { laneIndex: number; measure: number; cellOffset: number } | null
	) {
		this.noteMove = noteMove;
		this.findReferenceNote = findReferenceNote;
	}

	/**
	 * Copy the selected notes to the clipboard
	 */
	copyNotes(selectedNotes: Set<string>, editor: Editor, isCut: boolean = false): boolean {
		if (selectedNotes.size === 0) {
			return false;
		}

		const notesToCopy: CopiedNoteData[] = [];
		const notes = editor.getNotes();

		// Find the reference note using the shared logic
		const referenceNote = this.findReferenceNote(selectedNotes);

		if (!referenceNote) {
			return false;
		}

		const {
			laneIndex: referenceLaneIndex,
			measure: referenceMeasure,
			cellOffset: referenceCellOffset
		} = referenceNote;

		// Second pass: collect note data with relative positions
		selectedNotes.forEach((noteKey) => {
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]); // This is already normalized from note key
				const laneId = editor.getLaneConfigs()[laneIndex].id;

				// Find the note data in the editor's data structure
				if (laneId in notes) {
					const existingNote = notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.0001)
					);

					if (existingNote) {
						const noteChip = existingNote.notes.find(
							(n) => Math.abs(n.position - cellOffset) < 0.0001
						);

						if (noteChip) {
							notesToCopy.push({
								noteKey,
								laneIndex,
								measure,
								cellOffset, // Keep the normalized position from note key
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
			this.isCutOperation = isCut;
			return true;
		}

		return false;
	}

	/**
	 * Cut the selected notes to the clipboard (copy + delete originals)
	 */
	cutNotes(
		selectedNotes: Set<string>,
		editor: Editor,
		deleteNoteByKey: (noteKey: string) => void,
		recordCutAction?: (
			cutNotes: Array<{
				noteKey: string;
				laneIndex: number;
				measure: number;
				cellOffset: number;
				laneId: string;
				noteId: string;
				measureLength?: number;
			}>
		) => void
	): boolean {
		// First copy the notes with cut flag
		const copySuccess = this.copyNotes(selectedNotes, editor, true);

		if (copySuccess) {
			// Collect cut note data before deletion for undo functionality
			const cutNotesData: Array<{
				noteKey: string;
				laneIndex: number;
				measure: number;
				cellOffset: number;
				laneId: string;
				noteId: string;
				measureLength?: number;
			}> = [];

			const notes = editor.getNotes();

			// Gather note data before deletion
			selectedNotes.forEach((noteKey) => {
				const parts = noteKey.split('-');
				if (parts.length === 4) {
					const laneIndex = parseInt(parts[1]);
					const measure = parseInt(parts[2]);
					const cellOffset = parseFloat(parts[3]); // This is already normalized from note key
					const laneId = editor.getLaneConfigs()[laneIndex].id;

					// Find the note data in the editor's data structure
					if (laneId in notes) {
						const existingNote = notes[laneId].find(
							(note) =>
								note.measure === measure &&
								note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.0001)
						);

						if (existingNote) {
							const noteChip = existingNote.notes.find(
								(n) => Math.abs(n.position - cellOffset) < 0.0001
							);

							if (noteChip) {
								cutNotesData.push({
									noteKey,
									laneIndex,
									measure,
									cellOffset, // Use the normalized position from note key (same as noteChip.position)
									laneId,
									noteId: noteChip.noteID,
									measureLength: existingNote.measureLength
								});
							}
						}
					}
				}
			});

			// Record cut action for undo functionality if callback provided
			if (cutNotesData.length > 0 && recordCutAction) {
				recordCutAction(cutNotesData);
			}

			// Then delete the original notes
			selectedNotes.forEach((noteKey) => {
				deleteNoteByKey(noteKey);
			});
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
		editor: Editor,
		recordPasteAction?: (
			pastedNotes: Array<{
				noteKey: string;
				laneIndex: number;
				measure: number;
				cellOffset: number;
				laneId: string;
				noteId: string;
			}>
		) => void
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

			// Keep the exact calculated position to preserve high-resolution positioning
			// No normalization needed as the relative offsets preserve the original precision

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

		// Add each note using the shared logic from NoteMove
		const addedNotes: Array<{
			noteKey: string;
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			noteId: string;
		}> = [];

		notesToPaste.forEach(({ laneIndex, measure, cellOffset, laneId, noteId }) => {
			const noteAdded = this.noteMove.addNoteToEditor(
				measure,
				laneIndex,
				cellOffset,
				laneId,
				noteId
			);

			if (noteAdded) {
				const newKey = `note-${laneIndex}-${measure}-${cellOffset}`;
				addedNotes.push({
					noteKey: newKey,
					laneIndex,
					measure,
					cellOffset,
					laneId,
					noteId
				});
			}
		});

		// Record paste action for undo functionality if callback provided
		if (addedNotes.length > 0 && recordPasteAction) {
			recordPasteAction(addedNotes);
		}

		// If this was a cut operation, clear the clipboard after successful paste
		if (addedNotes.length > 0 && this.isCutOperation) {
			this.clearClipboard();
		}

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
		this.isCutOperation = false;
	}

	/**
	 * Get the number of notes in the clipboard
	 */
	getClipboardSize(): number {
		return this.copiedNotes.length;
	}

	/**
	 * Check if the clipboard contains cut (vs copied) notes
	 */
	isCutClipboard(): boolean {
		return this.isCutOperation;
	}
}
