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
