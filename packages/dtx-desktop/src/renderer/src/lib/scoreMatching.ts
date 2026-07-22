import { normalizeLevel } from '@dtx/common';

export interface LocalChart {
	/** DTXMania DrumLevel (e.g. 55 == level 5.5 when DrumLevelDec = 0). */
	drumLevel: number;
	/** DTXMania DrumLevelDec — decimal part (0-99). Combined with drumLevel via normalizeLevel. */
	drumLevelDec: number;
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
 * Maximum normalized-level difference allowed for an auto-matched chart. A
 * uniquely selected candidate whose level is farther than this from the local
 * target is rejected (returns null for manual selection) — a "nearest" match
 * that's still multiple levels away is likely the wrong chart. Levels are on
 * the 0-10 display scale (e.g. 5.5), so 0.5 == half a level.
 */
const MAX_LEVEL_DELTA = 0.5;

/**
 * Decode a raw `dtx_files.level` to the display scale, using the shared
 * `normalizeLevel` from `@dtx/common` which matches DTXManiaCX's canonical
 * encoding:
 *
 *   level >= 100 → level / 100
 *   level <  100 → level / 10 + levelDec / 100
 *
 * The cloud `dtx_files.level` column has no separate decimal component, so
 * levelDec defaults to 0. A non-integer (stray display-scale decimal) is
 * returned as-is.
 */
const normalizeCloudLevel = (level: number): number => normalizeLevel(level);

/**
 * Format a raw `dtx_files.level` for display (e.g. the manual-target dropdown),
 * applying the same encoded-integer decode as `normalizeCloudLevel` and rendering
 * to two decimal places, matching the web `formatLevelDisplay` output.
 */
export const formatCloudLevel = (level: number): string => normalizeCloudLevel(level).toFixed(2);

/**
 * Pair local DTXMania charts to a linked simfile's cloud charts by difficulty.
 * Returns, aligned to `local` by index, the matched cloud chart id or null.
 * Each cloud chart is used at most once (greedy, in local order); an equidistant
 * tie is broken by a non-empty, case-insensitive label match, and an unbroken
 * tie (or exhausted cloud charts) yields null for manual selection. A selected
 * chart whose normalized level differs from the local target by more than
 * `MAX_LEVEL_DELTA` is also rejected — a distant "nearest" match is likely the
 * wrong chart and is left for manual selection.
 */
export const matchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	const used = new Set<string>();

	return local.map((lc) => {
		const candidates = cloud.filter((c) => !used.has(c.id));
		if (candidates.length === 0) return null;

		const target = normalizeLevel(lc.drumLevel, lc.drumLevelDec);
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
		// Reject any selected chart whose normalized level is too far from the
		// target — whether uniquely nearest or label-disambiguated — so a
		// distant "match" is left for manual selection instead of silently
		// pairing the wrong chart.
		const chosenDiff = Math.abs(normalizeCloudLevel(chosen.level) - target);
		if (chosenDiff - MAX_LEVEL_DELTA > EPSILON) return null;
		used.add(chosen.id);
		return chosen.id;
	});
};
