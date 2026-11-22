/**
 * Normalizes a cell offset to prevent floating point precision issues
 * @param cellOffset The position offset within a measure (0-1)
 * @param cellsPerMeasure Number of cells per measure (default: 16)
 * @returns Normalized position rounded to the nearest cell boundary
 */
export function normalizePosition(cellOffset: number, cellsPerMeasure: number = 16): number {
	const rounded = Math.round(cellOffset * cellsPerMeasure);
	return rounded / cellsPerMeasure;
}

/**
 * Collapse floating-point arithmetic noise to a canonical stored offset.
 * Two values differing only in the last ulps (e.g. 0.6666666666666666 vs
 * 0.666666666666667 from paste/move arithmetic) must produce one note key
 * and one stored position — without this, the same logical hit duplicates.
 *
 * After 15-significant-digit rounding, a value within 1e-9 of a 768-cell
 * grid fraction snaps to that exact fraction: every editor-grid and
 * widened-pattern position is a multiple of 1/768, so this restores the
 * exact double (e.g. 383/384 stays the value that rounds to the barline)
 * instead of leaving the canonical form a hair below it.
 */
export const canonicalizeCellOffset = (cellOffset: number): number => {
	const canonical = Number(cellOffset.toPrecision(15));
	const grid = Math.round(canonical * 768) / 768;
	return Math.abs(canonical - grid) < 1e-9 ? grid : canonical;
};

/**
 * Snap an offset within float-residue distance of a barline onto the
 * boundary exactly, so delta arithmetic that meant "the next measure's
 * first cell" stores 0/1 rather than 6.9e-18-style noise.
 */
export const snapCellOffsetToBarline = (cellOffset: number): number => {
	const rounded = Math.round(cellOffset);
	return Math.abs(cellOffset - rounded) < 1e-9 ? rounded + 0 : cellOffset;
};

/**
 * Parse a "note-{laneIndex}-{measure}-{cellOffset}" key. The offset is
 * everything after the third dash so exponent-notation offsets like
 * 6.9e-18 can't corrupt the split. Returns null for malformed keys.
 */
export const parseNoteKey = (
	noteKey: string
): { laneIndex: number; measure: number; cellOffset: number } | null => {
	const parts = noteKey.split('-');
	if (parts.length < 4 || parts[0] !== 'note') return null;
	const laneIndex = parseInt(parts[1]);
	const measure = parseInt(parts[2]);
	const cellOffset = parseFloat(parts.slice(3).join('-'));
	if (!Number.isFinite(laneIndex) || !Number.isFinite(measure) || !Number.isFinite(cellOffset)) {
		return null;
	}
	return { laneIndex, measure, cellOffset };
};
