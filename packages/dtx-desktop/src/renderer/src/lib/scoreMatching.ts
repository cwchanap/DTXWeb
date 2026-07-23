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
 * at most once) to find those that maximize the number of matched charts.
 * Among assignments with the same match count, minimizes the total level delta,
 * then maximizes label matches as a tiebreaker. This avoids the greedy
 * pitfall where processing charts in source order can reserve a cloud chart
 * that a later, more constrained local chart needed, causing a valid complete
 * assignment to be discarded.
 *
 * A matched pair whose normalized level differs by more than `MAX_LEVEL_DELTA`
 * is never included — a distant "match" is likely the wrong chart and is left
 * for manual selection. When multiple equally optimal assignments exist (same
 * match count, total delta, and label count) that assign a local chart to
 * different cloud targets, that local chart yields null (ambiguous → manual
 * selection). This allows locally ambiguous ties to resolve once the global
 * assignment is fixed, rather than rejecting them prematurely.
 *
 * Problem size is guarded: the exhaustive search is used only for ≤6 local and
 * ≤6 cloud charts (at most 6! = 720 permutations). Larger sets fall back to a
 * greedy nearest-first assignment.
 */
export const matchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	if (local.length === 0) return [];

	if (local.length > 6 || cloud.length > 6) {
		return fallbackMatchCharts(local, cloud);
	}

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

	// Track the best score and ALL assignments that achieve it.
	let bestMatchCount = -1;
	let bestTotalDelta = Infinity;
	let bestLabelCount = -1;
	let bestAssignments: number[][] = [];

	const usedCloud = new Set<number>();
	const current: number[] = new Array(local.length).fill(-1);

	const evaluate = () => {
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
		const isBetter =
			matchCount > bestMatchCount ||
			(matchCount === bestMatchCount && totalDelta < bestTotalDelta - EPSILON) ||
			(matchCount === bestMatchCount &&
				Math.abs(totalDelta - bestTotalDelta) < EPSILON &&
				labelCount > bestLabelCount);
		const isTied =
			matchCount === bestMatchCount &&
			Math.abs(totalDelta - bestTotalDelta) < EPSILON &&
			labelCount === bestLabelCount;
		if (isBetter) {
			bestMatchCount = matchCount;
			bestTotalDelta = totalDelta;
			bestLabelCount = labelCount;
			bestAssignments = [[...current]];
		} else if (isTied) {
			bestAssignments.push([...current]);
		}
	};

	// Exhaustive search via backtracking. For each local chart, try every
	// available cloud chart (within MAX_LEVEL_DELTA) or leave it unmatched.
	const search = (i: number) => {
		if (i === local.length) {
			evaluate();
			return;
		}
		// Option 1: leave local[i] unmatched.
		current[i] = -1;
		search(i + 1);
		// Option 2: match local[i] to each valid, unused cloud chart.
		for (let j = 0; j < cloud.length; j++) {
			if (usedCloud.has(j) || !valid[i][j]) continue;
			usedCloud.add(j);
			current[i] = j;
			search(i + 1);
			usedCloud.delete(j);
		}
	};

	search(0);

	// For each local chart, if all optimal assignments agree on the target
	// (or unmatched), use that value. If they disagree, the chart is
	// ambiguous → null (manual selection).
	return local.map((_, i) => {
		const assigned = new Set<number>();
		for (const a of bestAssignments) {
			assigned.add(a[i]);
		}
		if (assigned.size === 1) {
			const j = bestAssignments[0][i];
			return j >= 0 ? cloud[j].id : null;
		}
		return null;
	});
};

/**
 * Greedy fallback for chart sets larger than the exhaustive-search guard.
 * Sorts candidate pairs by delta (then label match as tiebreaker) and assigns
 * the nearest available cloud chart to each local chart in order.
 */
const fallbackMatchCharts = (local: LocalChart[], cloud: CloudChart[]): (string | null)[] => {
	const targets = local.map((lc) => normalizeLevel(lc.drumLevel, lc.drumLevelDec));
	const localLabels = local.map((lc) => lc.difficultyLabel.trim().toLowerCase());
	const cloudLevels = cloud.map((c) => normalizeCloudLevel(c.level));
	const cloudLabels = cloud.map((c) => c.label.trim().toLowerCase());

	const candidates: { i: number; j: number; delta: number; label: boolean }[] = [];
	for (let i = 0; i < local.length; i++) {
		for (let j = 0; j < cloud.length; j++) {
			const delta = Math.abs(cloudLevels[j] - targets[i]);
			if (delta - MAX_LEVEL_DELTA <= EPSILON) {
				candidates.push({
					i,
					j,
					delta,
					label: !!localLabels[i] && localLabels[i] === cloudLabels[j]
				});
			}
		}
	}
	// Sort: lower delta first, label match preferred on ties.
	candidates.sort((a, b) =>
		a.delta - b.delta < -EPSILON
			? -1
			: a.delta - b.delta > EPSILON
				? 1
				: a.label === b.label
					? 0
					: a.label
						? -1
						: 1
	);

	const result: (string | null)[] = new Array(local.length).fill(null);
	const usedCloud = new Set<number>();
	const usedLocal = new Set<number>();
	for (const c of candidates) {
		if (usedLocal.has(c.i) || usedCloud.has(c.j)) continue;
		result[c.i] = cloud[c.j].id;
		usedLocal.add(c.i);
		usedCloud.add(c.j);
	}
	return result;
};
