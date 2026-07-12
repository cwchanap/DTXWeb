import {
	getChartVisibility,
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

const SkippedChartRef = builder
	.objectRef<{ chartId: string; reason: string }>('SkippedChart')
	.implement({
		fields: (t) => ({
			chartId: t.exposeID('chartId'),
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
const validateChartScores = (
	playCount: number,
	clearCount: number,
	scores: {
		isBest: boolean;
		score?: number | null;
		achievementRate?: number | null;
		maxCombo?: number | null;
		perfect?: number | null;
		great?: number | null;
		good?: number | null;
		poor?: number | null;
		miss?: number | null;
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
	// Best rows must not carry a displayOrder (they are not recent plays).
	for (const s of scores) {
		if (s.isBest && s.displayOrder != null) return 'best score with displayOrder';
	}
	// Every non-null displayOrder must be a unique integer in 1..5.
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

			for (const chart of input.charts) {
				const numericId = Number(chart.chartId);
				if (!Number.isSafeInteger(numericId) || numericId <= 0) {
					skipped.push({ chartId: String(chart.chartId), reason: 'invalid chart id' });
					continue;
				}

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
						maxCombo: s.maxCombo,
						perfect: s.perfect,
						great: s.great,
						good: s.good,
						poor: s.poor,
						miss: s.miss,
						displayOrder: s.displayOrder
					}))
				);
				if (invalid) {
					skipped.push({ chartId: String(chart.chartId), reason: invalid });
					continue;
				}

				const visibility = await getChartVisibility(ctx.db, numericId);
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
				// Per-chart write isolation: a D1 failure on one chart must not
				// abort the whole mutation and lose already-committed results for
				// prior charts. Record the failure as skipped and continue.
				try {
					await upsertChartScoreAndReplaceScores(ctx.db, {
						chartId: numericId,
						userId: ctx.user!.id,
						playCount: chart.playCount,
						clearCount: chart.clearCount,
						scores: inserts
					});
					updatedCharts += 1;
					insertedScores += inserts.length;
				} catch {
					skipped.push({ chartId: String(chart.chartId), reason: 'write failed' });
				}
			}

			return { updatedCharts, insertedScores, skipped };
		}
	})
);
