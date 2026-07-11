export interface LocalChart {
	/** DTXMania DrumLevel, stored ×10 (e.g. 55 == level 5.5). */
	drumLevel: number;
	difficultyLabel: string;
}

export interface CloudChart {
	id: string;
	label: string;
	/** Server dtx_files.level (e.g. 5.5). */
	level: number;
}

const EPSILON = 1e-9;

/**
 * Pair local DTXMania charts to a linked simfile's cloud charts by difficulty.
 * Returns, aligned to `local` by index, the matched cloud chart id or null.
 * Each cloud chart is used at most once (greedy, in local order); an equidistant
 * tie is broken by a non-empty, case-insensitive label match, and an unbroken
 * tie (or exhausted cloud charts) yields null for manual selection.
 */
export const matchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	const used = new Set<string>();

	return local.map((lc) => {
		const candidates = cloud.filter((c) => !used.has(c.id));
		if (candidates.length === 0) return null;

		const target = lc.drumLevel / 10;
		const diffs = candidates.map((c) => Math.abs(c.level - target));
		const minDiff = Math.min(...diffs);
		const tied = candidates.filter((_, i) => diffs[i] - minDiff < EPSILON);

		let chosen: CloudChart | null;
		if (tied.length === 1) {
			chosen = tied[0];
		} else {
			const label = lc.difficultyLabel.trim().toLowerCase();
			const labelMatches = label
				? tied.filter((c) => c.label.trim().toLowerCase() === label)
				: [];
			chosen = labelMatches.length === 1 ? labelMatches[0] : null;
		}

		if (!chosen) return null;
		used.add(chosen.id);
		return chosen.id;
	});
};
