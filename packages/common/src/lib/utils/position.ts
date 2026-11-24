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
 * After 15-significant-digit rounding, a value within 1e-9 of a 2304-cell
 * grid fraction snaps to that exact fraction: 2304 is the LCM of every
 * grid a stored position can sit on (the pattern resolutions 4…576 plus
 * the widened 384/768 fallbacks and editor 192), so this restores the
 * exact double (e.g. 383/384 stays the value that rounds to the barline,
 * or 1/576 after copy/move arithmetic leaves ulp residue) instead of
 * leaving the canonical form a hair off it.
 *
 * Parsed patterns are not limited to that grid — a 40-cell quintuplet
 * pattern stores 1/40 = 0.025 — so a value that misses the snap but sits
 * within a few ulps of a shorter decimal collapses to it, keeping the
 * arithmetic and parsed forms of the same cell on one note key.
 */
/**
 * Maximum ULP budget used by {@link canonicalizeCellOffset} when collapsing
 * repeating decimals to shorter decimal forms.
 */
export const CELL_OFFSET_CANONICAL_ULP_BUDGET = 8;

/**
 * Budget (in ULPs) for occupancy comparisons between two canonicalized cell
 * offsets. Each canonicalization step (parsed source, copied/dragged note,
 * reference/target, wrapped arithmetic result) can introduce up to
 * {@link CELL_OFFSET_CANONICAL_ULP_BUDGET} ULPs of rounding error, so checking
 * occupancy must allow for several accumulated steps while remaining well below
 * the minimum spacing between distinct chart positions.
 */
export const CELL_OFFSET_OCCUPANCY_ULP_BUDGET = CELL_OFFSET_CANONICAL_ULP_BUDGET * 8;

/**
 * Returns true when two cell offsets represent the same logical position
 * within accumulated canonicalization rounding error.
 */
export const isSameCellOffset = (a: number, b: number): boolean =>
	a === b ||
	Math.abs(a - b) <=
		Number.EPSILON * CELL_OFFSET_OCCUPANCY_ULP_BUDGET * Math.max(1, Math.abs(a), Math.abs(b));

export const canonicalizeCellOffset = (cellOffset: number): number => {
	const canonical = Number(cellOffset.toPrecision(15));
	const grid = Math.round(canonical * 2304) / 2304;
	if (Math.abs(canonical - grid) < 1e-9) return grid;
	const ulpTolerance =
		Number.EPSILON * CELL_OFFSET_CANONICAL_ULP_BUDGET * Math.max(1, Math.abs(canonical));
	for (let digits = 1; digits < 15; digits++) {
		const shorter = Number(canonical.toPrecision(digits));
		if (Math.abs(shorter - canonical) <= ulpTolerance) return shorter;
	}
	return canonical;
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
