/**
 * High-resolution grid support for precise note positioning
 * Supports standard intervals: 4th, 8th, 16th, 24th, 32nd, 48th, and 64th notes
 * Uses 192 subdivisions per measure (LCM of common note intervals)
 */
export const HIGH_RESOLUTION_CELLS = 192;

/**
 * Calculate high-resolution position for precise note placement
 * @param cellOffset - The position within a measure (0-1)
 * @param cellsPerMeasure - Number of cells per measure (typically 16)
 * @returns Object with whole cells and fractional cell position
 */
export function calculateHighResolutionPosition(
	cellOffset: number,
	cellsPerMeasure: number
): { wholeCells: number; fractionalCell: number } {
	// Convert to high-resolution position
	const highResPosition = cellOffset * HIGH_RESOLUTION_CELLS;

	// Convert back to regular cell grid
	const cellsPerHighResCell = HIGH_RESOLUTION_CELLS / cellsPerMeasure;

	// Calculate whole cells and fractional part
	const wholeCells = Math.floor(highResPosition / cellsPerHighResCell);
	const remainingHighRes = highResPosition % cellsPerHighResCell;
	const fractionalCell = remainingHighRes / cellsPerHighResCell;

	return { wholeCells, fractionalCell };
}
