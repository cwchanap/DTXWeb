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
 *
 * Uses exhaustive search over all injective assignments (each cloud chart used
 * at most once) to find the one that maximizes the number of matched charts.
 * Among assignments with the same match count, minimizes the total level delta,
 * then maximizes label matches as a tiebreaker. This avoids the greedy
 * pitfall where processing charts in source order can reserve a cloud chart
 * that a later, more constrained local chart needed, causing a valid complete
 * assignment to be discarded.
 *
 * A matched pair whose normalized level differs by more than `MAX_LEVEL_DELTA`
 * is never included — a distant "match" is likely the wrong chart and is left
 * for manual selection. An equidistant tie that cannot be broken by label
 * match yields null for that local chart (manual selection).
 *
 * Problem size is tiny (≤5 local, ≤5 cloud per song), so the exhaustive search
 * (at most 5! = 120 permutations) is trivially fast.
 */
export const matchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	if (local.length === 0) return [];

	// Precompute targets and label-normalized strings.
	const targets = local.map((lc) => normalizeLevel(lc.drumLevel, lc.drumLevelDec));
	const localLabels = local.map((lc) => lc.difficultyLabel.trim().toLowerCase());
	const cloudLevels = cloud.map((c) => normalizeCloudLevel(c.level));
	const cloudLabels = cloud.map((c) => c.label.trim().toLowerCase());

	// Cost matrix: deltas[i][j] = |normalizeCloudLevel(cloud[j]) - target[i]|.
	// A pair is valid only if delta <= MAX_LEVEL_DELTA.
	const deltas: number[][] = local.map((_, i) =>
		cloud.map((_, j) => Math.abs(cloudLevels[j] - targets[i]))
	);
	const valid: boolean[][] = deltas.map((row) => row.map((d) => d - MAX_LEVEL_DELTA <= EPSILON));

	// Label match matrix: labelsMatch[i][j] = true if labels are non-empty and equal.
	const labelsMatch: boolean[][] = local.map((_, i) =>
		cloud.map((_, j) => !!localLabels[i] && localLabels[i] === cloudLabels[j])
	);

	// Best assignment found so far: array of cloud indices (or -1 for unmatched).
	let bestAssignment: number[] = new Array(local.length).fill(-1);
	let bestMatchCount = -1;
	let bestTotalDelta = Infinity;
	let bestLabelCount = -1;

	// Exhaustive search via backtracking. For each local chart, try every
	// available cloud chart (within MAX_LEVEL_DELTA) or leave it unmatched.
	const usedCloud = new Set<number>();
	const current: number[] = new Array(local.length).fill(-1);

	const search = (i: number) => {
		if (i === local.length) {
			// Evaluate the current assignment.
			let matchCount = 0;
			let totalDelta = 0;
			let labelCount = 0;
			for (let k = 0; k < local.length; k++) {
				if (current[k] >= 0) {
					matchCount++;
					totalDelta += deltas[k][current[k]];
					if (labelsMatch[k][current[k]]) labelCount++;
				}
			}
			// Prefer: more matches → less total delta → more label matches.
			if (
				matchCount > bestMatchCount ||
				(matchCount === bestMatchCount && totalDelta < bestTotalDelta - EPSILON) ||
				(matchCount === bestMatchCount &&
					Math.abs(totalDelta - bestTotalDelta) < EPSILON &&
					labelCount > bestLabelCount)
			) {
				bestMatchCount = matchCount;
				bestTotalDelta = totalDelta;
				bestLabelCount = labelCount;
				bestAssignment = [...current];
			}
			return;
		}

		// Option 1: leave local[i] unmatched.
		current[i] = -1;
		search(i + 1);

		// Option 2: match local[i] to each valid, unused cloud chart.
		for (let j = 0; j < cloud.length; j++) {
			if (usedCloud.has(j) || !valid[i][j]) continue;
			// Skip equidistant ties that can't be label-broken — the original
			// algorithm returned null for unbroken ties, and we preserve that
			// behavior by only matching when the candidate is either uniquely
			// nearest or label-disambiguated among equidistant candidates.
			if (!isPairable(i, j)) continue;

			usedCloud.add(j);
			current[i] = j;
			search(i + 1);
			usedCloud.delete(j);
		}
	};

	// Check whether local[i] can be paired with cloud[j]: either uniquely
	// nearest, or label-disambiguated among equidistant candidates (excluding
	// already-used cloud charts, which are not in the search at this point).
	const isPairable = (i: number, j: number): boolean => {
		const d = deltas[i][j];
		// Find equidistant candidates among all cloud charts (not just unused,
		// since the search handles availability separately).
		const tied = cloud
			.map((_, j2) => ({ j: j2, d: deltas[i][j2] }))
			.filter((c) => valid[i][c.j] && Math.abs(c.d - d) < EPSILON);

		if (tied.length === 1) return true; // uniquely nearest

		// Tie: break by label match. Only pair if this cloud chart is the
		// unique label match among the tied candidates.
		if (!labelsMatch[i][j]) return false;
		const labelTied = tied.filter((c) => labelsMatch[i][c.j]);
		return labelTied.length === 1;
	};

	search(0);

	return bestAssignment.map((j) => (j >= 0 ? cloud[j].id : null));
};
