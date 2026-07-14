import {
	getChartVisibilityBatch,
	upsertChartScoreAndReplaceScores,
	type ScoreRow,
	type ChartScoreRow,
	type ScoreInsert
} from '@dtx/common/server';
import { builder } from './builder';

export const ScoreRef = builder.objectRef<ScoreRow>('Score').implement({
	fields: (t) => ({
		id: t.id({ resolve: (s) => String(s.id) }),
		isBest: t.boolean({ resolve: (s) => s.is_best === 1 }),
		score: t.int({ nullable: true, resolve: (s) => s.score }),
		achievementRate: t.float({ nullable: true, resolve: (s) => s.achievement_rate }),
		rankLabel: t.string({ nullable: true, resolve: (s) => s.rank_label }),
		fullCombo: t.boolean({ resolve: (s) => s.full_combo === 1 }),
		cleared: t.boolean({ resolve: (s) => s.cleared === 1 }),
		maxCombo: t.int({ nullable: true, resolve: (s) => s.max_combo }),
		perfect: t.int({ nullable: true, resolve: (s) => s.perfect }),
		great: t.int({ nullable: true, resolve: (s) => s.great }),
		good: t.int({ nullable: true, resolve: (s) => s.good }),
		poor: t.int({ nullable: true, resolve: (s) => s.poor }),
		miss: t.int({ nullable: true, resolve: (s) => s.miss }),
		performedAt: t.string({ nullable: true, resolve: (s) => s.performed_at }),
		displayOrder: t.int({ nullable: true, resolve: (s) => s.display_order })
	})
});

export type ChartScoreParent = { chartScore: ChartScoreRow; scores: ScoreRow[] };

export const ChartScoreRef = builder.objectRef<ChartScoreParent>('ChartScore').implement({
	fields: (t) => ({
		id: t.id({ resolve: (c) => String(c.chartScore.id) }),
		playCount: t.int({ resolve: (c) => c.chartScore.play_count }),
		clearCount: t.int({ resolve: (c) => c.chartScore.clear_count }),
		scores: t.field({ type: [ScoreRef], resolve: (c) => c.scores })
	})
});

const ScoreInput = builder.inputType('ScoreInput', {
	fields: (t) => ({
		isBest: t.boolean({ required: true }),
		score: t.int({ required: false }),
		achievementRate: t.float({ required: false }),
		rankLabel: t.string({ required: false }),
		fullCombo: t.boolean({ required: true }),
		cleared: t.boolean({ required: true }),
		maxCombo: t.int({ required: false }),
		perfect: t.int({ required: false }),
		great: t.int({ required: false }),
		good: t.int({ required: false }),
		poor: t.int({ required: false }),
		miss: t.int({ required: false }),
		performedAt: t.string({ required: false }),
		displayOrder: t.int({ required: false })
	})
});

const ChartScoresInput = builder.inputType('ChartScoresInput', {
	fields: (t) => ({
		chartId: t.id({ required: true }),
		playCount: t.int({ required: true }),
		clearCount: t.int({ required: true }),
		scores: t.field({ type: [ScoreInput], required: true })
	})
});

const UploadScoresInput = builder.inputType('UploadScoresInput', {
	fields: (t) => ({
		charts: t.field({ type: [ChartScoresInput], required: true })
	})
});

/// Maximum number of charts accepted in a single uploadScores mutation. Each
/// chart triggers a D1 batch (upsert + delete + inserts), so an unbounded
/// charts[] could exhaust Worker CPU/D1 budget. 100 charts × ~8 statements
/// per batch stays well within the Worker CPU time limit.
const MAX_UPLOAD_CHARTS = 100;
/// Maximum number of score rows per chart. The invariant validator already
/// rejects >5 recent + >1 best, but this cap short-circuits before validation
/// to prevent a pathologically large scores[] from consuming CPU.
const MAX_SCORES_PER_CHART = 10;
/// Maximum number of concurrent D1 batch writes. Each chart's upsert is an
/// independent atomic batch, so bounded concurrency preserves per-chart write
/// isolation (a failure in one chart does not abort others) while cutting
/// wall-clock time for large imports. D1 concurrent operations overlap I/O
/// waits without increasing Worker CPU time, so this is safe within the
/// Worker CPU budget. 8 keeps concurrent D1 round-trips modest.
const WRITE_CONCURRENCY = 8;

const SkippedChartRef = builder
	.objectRef<{ chartId: string; reason: string }>('SkippedChart')
	.implement({
		description:
			'A chart that was excluded from the upload. chartId is the requested ' +
			'chart ID, or the sentinel "*" when the entire payload was rejected ' +
			'(e.g. too many charts) rather than a single chart.',
		fields: (t) => ({
			chartId: t.exposeID('chartId', {
				description:
					'The skipped chart ID, or "*" (sentinel) when the skip applies ' +
					'to the whole upload batch rather than a specific chart.'
			}),
			reason: t.exposeString('reason')
		})
	});

const UploadScoresResultRef = builder
	.objectRef<{
		updatedCharts: number;
		insertedScores: number;
		skipped: { chartId: string; reason: string }[];
	}>('UploadScoresResult')
	.implement({
		fields: (t) => ({
			updatedCharts: t.exposeInt('updatedCharts'),
			insertedScores: t.exposeInt('insertedScores'),
			skipped: t.field({ type: [SkippedChartRef], resolve: (r) => r.skipped })
		})
	});

// Validates a single chart payload. Returns a skip reason string, or null when valid.
const VALID_RANK_LABELS = ['SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;

const validateChartScores = (
	playCount: number,
	clearCount: number,
	scores: {
		isBest: boolean;
		score?: number | null;
		achievementRate?: number | null;
		rankLabel?: string | null;
		fullCombo?: boolean | null;
		cleared?: boolean | null;
		maxCombo?: number | null;
		perfect?: number | null;
		great?: number | null;
		good?: number | null;
		poor?: number | null;
		miss?: number | null;
		performedAt?: string | null;
		displayOrder?: number | null;
	}[]
): string | null => {
	// Chart-level aggregate validation: counts must be non-negative integers
	// and clearCount cannot exceed playCount (can't clear more times than played).
	if (!Number.isInteger(playCount) || playCount < 0)
		return 'playCount must be a non-negative integer';
	if (!Number.isInteger(clearCount) || clearCount < 0)
		return 'clearCount must be a non-negative integer';
	if (clearCount > playCount) return 'clearCount cannot exceed playCount';

	const bestCount = scores.filter((s) => s.isBest).length;
	if (bestCount > 1) return 'more than one best score';
	const recentRows = scores.filter((s) => s.displayOrder != null);
	if (recentRows.length > 5) return 'more than 5 recent scores';
	// Non-best rows must carry a displayOrder (they are recent plays).
	// A row with isBest=false and displayOrder=null is an orphan — reject it.
	for (const s of scores) {
		if (!s.isBest && s.displayOrder == null) return 'non-best score without displayOrder';
	}
	// Best rows must not carry a displayOrder (they are not recent plays).
	for (const s of scores) {
		if (s.isBest && s.displayOrder != null) return 'best score with displayOrder';
	}
	// Every non-null displayOrder must be a unique integer in 1..5.
	// NOTE on app-validator/DB asymmetry: the DB (0002_scores.sql) enforces
	// only `display_order IS NULL OR (1..5)` plus a partial unique index over
	// non-null values. It does NOT enforce the best/non-best coupling below
	// (best rows must be NULL, non-best rows must be non-null) — that stricter
	// invariant lives only here. The DB constraints are a backstop for range
	// and uniqueness; the app validator is the source of truth for the
	// isBest↔displayOrder relationship.
	const seenOrders = new Set<number>();
	for (const s of recentRows) {
		const order = s.displayOrder as number;
		if (!Number.isInteger(order) || order < 1 || order > 5) {
			return 'displayOrder out of range (expected 1..5)';
		}
		if (seenOrders.has(order)) return 'duplicate displayOrder';
		seenOrders.add(order);
	}
	for (const s of scores) {
		if (s.score != null && (!Number.isInteger(s.score) || s.score < 0))
			return 'score must be a non-negative integer';
		if (
			s.achievementRate != null &&
			(!Number.isFinite(s.achievementRate) ||
				s.achievementRate < 0 ||
				s.achievementRate > 100)
		) {
			return 'achievementRate out of range';
		}
		// rankLabel, when present, must be one of the known DTXMania rank tokens.
		// The DB CHECK constraint (0002_scores.sql) mirrors this as a backstop.
		if (
			s.rankLabel != null &&
			!(VALID_RANK_LABELS as readonly string[]).includes(s.rankLabel)
		) {
			return 'rankLabel must be one of SS/S/A/B/C/D/E/F';
		}
		// performedAt, when present, must be a parseable date string. Mirrors
		// the publishDate check in simfile.ts so a garbage timestamp can't
		// reach the DB's performed_at TEXT column.
		if (s.performedAt != null && Number.isNaN(Date.parse(s.performedAt))) {
			return 'invalid performedAt';
		}
		// Judgment counts and maxCombo must be non-negative integers when present.
		const counts = [s.maxCombo, s.perfect, s.great, s.good, s.poor, s.miss];
		for (const c of counts) {
			if (c != null && (!Number.isInteger(c) || c < 0)) {
				return 'judgment counts must be non-negative integers';
			}
		}
	}
	return null;
};

builder.mutationField('uploadScores', (t) =>
	t.field({
		type: UploadScoresResultRef,
		args: { input: t.arg({ type: UploadScoresInput, required: true }) },
		authScopes: { user: true },
		resolve: async (_root, { input }, ctx) => {
			const skipped: { chartId: string; reason: string }[] = [];
			let updatedCharts = 0;
			let insertedScores = 0;

			if (input.charts.length > MAX_UPLOAD_CHARTS) {
				return {
					updatedCharts: 0,
					insertedScores: 0,
					skipped: [
						{
							chartId: '*',
							reason: `too many charts (max ${MAX_UPLOAD_CHARTS})`
						}
					]
				};
			}

			// Pre-fetch visibility for all charts with valid numeric IDs in a
			// single batched D1 query, so the loop below does not issue one
			// round-trip per chart. Charts that fail later validation are
			// harmless extra rows in the batch.
			const validNumericIds = input.charts
				.map((c) => Number(c.chartId))
				.filter((id) => Number.isSafeInteger(id) && id > 0);
			const visibilityMap = await getChartVisibilityBatch(ctx.db, validNumericIds);
			const seenChartIds = new Set<number>();

			// Phase 1 — validate all charts sequentially. Validation is cheap
			// (pure JS, no I/O) and builds the `seenChartIds` dedup set, so it
			// must run in order. Charts that pass are collected for the write
			// phase; charts that fail are recorded in `skipped`.
			const writable: {
				chartId: string;
				numericId: number;
				playCount: number;
				clearCount: number;
				inserts: ScoreInsert[];
			}[] = [];

			for (const chart of input.charts) {
				const numericId = Number(chart.chartId);
				if (!Number.isSafeInteger(numericId) || numericId <= 0) {
					skipped.push({ chartId: String(chart.chartId), reason: 'invalid chart id' });
					continue;
				}
				// Defense-in-depth: the client (buildUpload) already dedupes chart
				// matches, but reject a duplicate chartId at the server too so a
				// bypassed/malformed payload can't double-upsert one chart.
				if (seenChartIds.has(numericId)) {
					skipped.push({ chartId: String(chart.chartId), reason: 'duplicate chart id' });
					continue;
				}
				seenChartIds.add(numericId);

				if (chart.scores.length > MAX_SCORES_PER_CHART) {
					skipped.push({
						chartId: String(chart.chartId),
						reason: `too many scores (max ${MAX_SCORES_PER_CHART})`
					});
					continue;
				}

				const invalid = validateChartScores(
					chart.playCount,
					chart.clearCount,
					chart.scores.map((s) => ({
						isBest: s.isBest,
						score: s.score,
						achievementRate: s.achievementRate,
						rankLabel: s.rankLabel,
						fullCombo: s.fullCombo,
						cleared: s.cleared,
						maxCombo: s.maxCombo,
						perfect: s.perfect,
						great: s.great,
						good: s.good,
						poor: s.poor,
						miss: s.miss,
						performedAt: s.performedAt,
						displayOrder: s.displayOrder
					}))
				);
				if (invalid) {
					skipped.push({ chartId: String(chart.chartId), reason: invalid });
					continue;
				}

				const visibility = visibilityMap.get(numericId);
				const visible =
					visibility != null &&
					(visibility.is_published === 1 || visibility.user_id === ctx.user!.id);
				if (!visible) {
					skipped.push({ chartId: String(chart.chartId), reason: 'chart not found' });
					continue;
				}

				// Single atomic D1 batch: upsert the chart_scores aggregate, delete
				// old scores, and insert new ones in one transaction so no partial
				// replacement can commit.
				const inserts: ScoreInsert[] = chart.scores.map((s) => ({
					is_best: s.isBest,
					score: s.score ?? null,
					achievement_rate: s.achievementRate ?? null,
					rank_label: s.rankLabel ?? null,
					full_combo: s.fullCombo,
					cleared: s.cleared,
					max_combo: s.maxCombo ?? null,
					perfect: s.perfect ?? null,
					great: s.great ?? null,
					good: s.good ?? null,
					poor: s.poor ?? null,
					miss: s.miss ?? null,
					performed_at: s.performedAt ?? null,
					display_order: s.displayOrder ?? null
				}));
				writable.push({
					chartId: String(chart.chartId),
					numericId,
					playCount: chart.playCount,
					clearCount: chart.clearCount,
					inserts
				});
			}

			// Phase 2 — write validated charts in bounded-concurrency chunks.
			// Per-chart write isolation is preserved: each chart's batch is
			// independent, and Promise.allSettled ensures one failure does not
			// abort the chunk. Overlapping the D1 I/O waits cuts wall-clock time
			// for large imports (up to 100 charts) without increasing Worker
			// CPU time.
			for (let i = 0; i < writable.length; i += WRITE_CONCURRENCY) {
				const chunk = writable.slice(i, i + WRITE_CONCURRENCY);
				const results = await Promise.allSettled(
					chunk.map((w) =>
						upsertChartScoreAndReplaceScores(ctx.db, {
							chartId: w.numericId,
							userId: ctx.user!.id,
							playCount: w.playCount,
							clearCount: w.clearCount,
							scores: w.inserts
						}).then(() => w.inserts.length)
					)
				);
				for (let j = 0; j < results.length; j++) {
					const w = chunk[j];
					const result = results[j];
					if (result.status === 'fulfilled') {
						updatedCharts += 1;
						insertedScores += result.value;
					} else {
						ctx.logger.error('Score upload write failed for chart', {
							chartId: w.chartId,
							userId: ctx.user!.id,
							error:
								result.reason instanceof Error
									? result.reason.message
									: String(result.reason)
						});
						skipped.push({ chartId: w.chartId, reason: 'write failed' });
					}
				}
			}

			return { updatedCharts, insertedScores, skipped };
		}
	})
);
