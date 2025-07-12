/**
 * Utility functions for high-resolution note positioning calculations
 * Used by both BaseGame and Preview scenes for precise note placement
 */

/**
 * High-resolution cell count used for precise positioning
 * This is the LCM (Least Common Multiple) of 16, 24, 32, 48, and 64
 * allowing for accurate representation of all subdivision levels
 */
export const HIGH_RESOLUTION_CELLS = 192;

/**
 * Calculate visual cell position using high-resolution grid
 * This allows for proper positioning of 24th, 32nd, 48th, and 64th notes
 *
 * @param cellOffset - Normalized position within measure (0-1)
 * @param cellsPerMeasure - Number of visual cells per measure (typically 16)
 * @returns Object containing cell position calculations
 */
export function calculateHighResolutionPosition(cellOffset: number, cellsPerMeasure: number) {
	// Calculate the position within the measure based on a higher resolution grid
	const cellPosition = Math.floor(cellOffset * HIGH_RESOLUTION_CELLS);

	// Convert high-resolution position to actual visual position
	const visualCellPosition = (cellPosition / HIGH_RESOLUTION_CELLS) * cellsPerMeasure;

	// Split into whole cells and fractional part
	const wholeCells = Math.floor(visualCellPosition);
	const fractionalCell = visualCellPosition - wholeCells;

	return {
		cellPosition,
		visualCellPosition,
		wholeCells,
		fractionalCell
	};
}
