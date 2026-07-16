export interface LocalChart {
	/** DTXMania DrumLevel, stored ×10 (e.g. 55 == level 5.5). */
	drumLevel: number;
	difficultyLabel: string;
}

export interface CloudChart {
	id: string;
	label: string;
	/** Raw server dtx_files.level — encoded integer (×10 or ×100 scale). */
	level: number;
}

const EPSILON = 1e-9;

/**
 * Decode a raw `dtx_files.level` integer to the display scale used by local
 * `drumLevel / 10`. The D1 column is `INTEGER` and stores levels on either the
 * ×10 scale (e.g. 55 == 5.5, the e2e seed uses 50 for 5.0) or the ×100 scale
 * (values > 100, e.g. 550 == 5.5). This mirrors the heuristic in the web
 * `formatLevelDisplay` so cloud and local levels are compared on the same scale.
 */
const normalizeCloudLevel = (level: number): number => (level > 100 ? level / 100 : level / 10);

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
		const diffs = candidates.map((c) => Math.abs(normalizeCloudLevel(c.level) - target));
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
