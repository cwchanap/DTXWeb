import {
	getChartVisibilityBatch,
	upsertChartScoreAndReplaceScores,
	type ScoreRow,
	type ChartScoreRow,
	type ScoreInsert
} from '@dtx/common/server';
import type { KVNamespace } from '@cloudflare/workers-types';
import { GraphQLError } from 'graphql';
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

/// Max charts per uploadScores call. Each chart triggers a D1 batch
/// (upsert + delete + inserts); 100 × ~8 statements stays within Worker CPU.
const MAX_UPLOAD_CHARTS = 100;
/// Max score rows per chart. Short-circuits before validation to prevent a
/// pathologically large scores[] from consuming CPU.
const MAX_SCORES_PER_CHART = 10;
/// Concurrent D1 batch writes. Each chart's upsert is an independent atomic
/// batch, so bounded concurrency preserves per-chart write isolation while
/// overlapping I/O waits (no extra Worker CPU time).
const WRITE_CONCURRENCY = 8;

/// Max uploadScores calls per user per hour. Self-scoped (users write only
/// their own scores), so this is a cost/abuse guard, not an integrity guard.
/// Overridable via `MAX_UPLOADS_PER_HOUR` env var; falls back to default.
const DEFAULT_MAX_UPLOADS_PER_HOUR = 10;

const uploadHourlyLimit = (env: { MAX_UPLOADS_PER_HOUR?: string }): number => {
	const configured = Number(env.MAX_UPLOADS_PER_HOUR);
	if (Number.isSafeInteger(configured) && configured > 0) {
		return configured;
	}
	return DEFAULT_MAX_UPLOADS_PER_HOUR;
};

// KV has no CAS primitive, so this read-modify-write tolerates ±1 over the
// limit if concurrent calls land between get and put — acceptable for a
// cost-control guard on a low-volume mutation.
const checkUploadRateLimit = async (
	kv: KVNamespace,
	userId: string,
	hourlyLimit: number
): Promise<boolean> => {
	const hour = Math.floor(Date.now() / 3_600_000);
	const key = `uploadscores:${userId}:${hour}`;
	const currentRaw = await kv.get(key);
	const current = currentRaw ? Number(currentRaw) : 0;
	if (Number.isFinite(current) && current >= hourlyLimit) {
		return false;
	}
	await kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
		expirationTtl: 3600
	});
	return true;
};

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

// Validates a single chart payload. Returns a skip reason (chart-level
// violation) or the filtered valid score rows (per-row issues drop only the
// bad row, preserving valid rows including the best).
const VALID_RANK_LABELS = ['SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;

type InputScore = {
	isBest: boolean;
	score?: number | null;
	achievementRate?: number | null;
	rankLabel?: string | null;
	fullCombo: boolean;
	cleared: boolean;
	maxCombo?: number | null;
	perfect?: number | null;
	great?: number | null;
	good?: number | null;
	poor?: number | null;
	miss?: number | null;
	performedAt?: string | null;
	displayOrder?: number | null;
};

type ValidationResult = { ok: true; scores: InputScore[] } | { ok: false; reason: string };

// Per-row field validation. Returns a reason string for an invalid row, or
// null when valid. Structural checks (best/non-best coupling, displayOrder
// range/uniqueness) are handled by the caller.
const validateScoreFields = (s: InputScore): string | null => {
	if (s.score != null && (!Number.isInteger(s.score) || s.score < 0))
		return 'score must be a non-negative integer';
	if (
		s.achievementRate != null &&
		(!Number.isFinite(s.achievementRate) || s.achievementRate < 0 || s.achievementRate > 100)
	) {
		return 'achievementRate out of range';
	}
	// rankLabel is stripped to null before this runs when unknown; remaining
	// non-null values must be known tokens. DB CHECK constraint mirrors this.
	if (s.rankLabel != null && !(VALID_RANK_LABELS as readonly string[]).includes(s.rankLabel)) {
		return 'rankLabel must be one of SS/S/A/B/C/D/E/F';
	}
	// performedAt must be parseable and not in the future (prevents skewing
	// recency sorts). Mirrors the publishDate check in simfile.ts.
	if (s.performedAt != null) {
		const parsed = Date.parse(s.performedAt);
		if (Number.isNaN(parsed)) return 'invalid performedAt';
		if (parsed > Date.now() + 60_000) return 'performedAt cannot be in the future';
	}
	const counts = [s.maxCombo, s.perfect, s.great, s.good, s.poor, s.miss];
	for (const c of counts) {
		if (c != null && (!Number.isInteger(c) || c < 0)) {
			return 'judgment counts must be non-negative integers';
		}
	}
	return null;
};

const validateChartScores = (
	playCount: number,
	clearCount: number,
	scores: InputScore[]
): ValidationResult => {
	// Chart-level aggregate validation.
	if (!Number.isInteger(playCount) || playCount < 0)
		return { ok: false, reason: 'playCount must be a non-negative integer' };
	if (!Number.isInteger(clearCount) || clearCount < 0)
		return { ok: false, reason: 'clearCount must be a non-negative integer' };
	if (clearCount > playCount) return { ok: false, reason: 'clearCount cannot exceed playCount' };

	// An empty scores[] would wipe prior scores via the replace-all batch
	// (DELETE + INSERT none). Reject so a buggy client can't destroy data.
	if (scores.length === 0) return { ok: false, reason: 'no scores provided' };

	const bestCount = scores.filter((s) => s.isBest).length;
	if (bestCount > 1) return { ok: false, reason: 'more than one best score' };

	// Recent-row cap checked before per-row filtering so 6 valid recent rows
	// are rejected rather than silently truncated.
	const recentCount = scores.filter((s) => !s.isBest && s.displayOrder != null).length;
	if (recentCount > 5) return { ok: false, reason: 'more than 5 recent scores' };

	// Per-row filtering: invalid rows are dropped individually, valid rows
	// (including the best) are kept. The first drop reason is tracked so an
	// all-dropped chart reports a meaningful skip reason.
	//
	// DB asymmetry: 0002_scores.sql enforces only `display_order IS NULL OR
	// (1..5)` + a partial unique index. The best/non-best coupling (best rows
	// must be NULL, non-best must be non-null) lives only here — the app
	// validator is the source of truth for isBest↔displayOrder.
	let firstDropReason: string | null = null;
	const valid: InputScore[] = [];
	const seenOrders = new Set<number>();
	// If a best row is dropped, reject the whole chart — the replace-all
	// batch would erase the stored best score with only recent rows.
	let bestDropped = false;

	for (const s of scores) {
		// Best rows must not carry a displayOrder. Strip it rather than
		// dropping the row — a stray displayOrder is benign, the best score
		// is the most valuable row.
		let row: InputScore = s.isBest && s.displayOrder != null ? { ...s, displayOrder: null } : s;

		// Unknown rankLabel is cosmetic — strip to null, keep the row.
		if (
			row.rankLabel != null &&
			!(VALID_RANK_LABELS as readonly string[]).includes(row.rankLabel)
		) {
			row = { ...row, rankLabel: null };
		}

		const fieldError = validateScoreFields(row);
		if (fieldError) {
			if (row.isBest) bestDropped = true;
			if (firstDropReason === null) firstDropReason = fieldError;
			continue;
		}

		// Non-best rows must carry a displayOrder; an orphan is dropped.
		if (!row.isBest && row.displayOrder == null) {
			if (firstDropReason === null) firstDropReason = 'non-best score without displayOrder';
			continue;
		}

		if (
			row.displayOrder != null &&
			(!Number.isInteger(row.displayOrder) || row.displayOrder < 1 || row.displayOrder > 5)
		) {
			if (firstDropReason === null)
				firstDropReason = 'displayOrder out of range (expected 1..5)';
			continue;
		}
		if (row.displayOrder != null && seenOrders.has(row.displayOrder)) {
			if (firstDropReason === null) firstDropReason = 'duplicate displayOrder';
			continue;
		}
		if (row.displayOrder != null) seenOrders.add(row.displayOrder);

		valid.push(row);
	}

	if (valid.length === 0) {
		return { ok: false, reason: firstDropReason ?? 'no valid scores after filtering' };
	}

	if (bestDropped) {
		return { ok: false, reason: 'best score row invalid' };
	}

	return { ok: true, scores: valid };
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

			// Reject oversized payload before any I/O — cheap pure-JS check
			// that short-circuits without burning the hourly token or D1.
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

			// Batch visibility fetch so the loop doesn't issue one D1 round-trip
			// per chart. Charts that fail later validation are harmless extras.
			const validNumericIds = input.charts
				.map((c) => Number(c.chartId))
				.filter((id) => Number.isSafeInteger(id) && id > 0);
			const visibilityMap = await getChartVisibilityBatch(ctx.db, validNumericIds);
			const seenChartIds = new Set<number>();

			// Phase 1 — validate sequentially (builds the dedup set in order).
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
				// Defense-in-depth: client dedupes, but reject duplicates at the
				// server too so a bypassed payload can't double-upsert.
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

				const result = validateChartScores(
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
				if (!result.ok) {
					skipped.push({ chartId: String(chart.chartId), reason: result.reason });
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

				// Inserts are built from validated/filtered scores (result.scores),
				// not raw input. The actual D1 batch (upsert + delete + insert) is
				// atomic per chart — see upsertChartScoreAndReplaceScores.
				const inserts: ScoreInsert[] = result.scores.map((s) => ({
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

			// Rate-limit only when there is something to write — validation
			// failures must not burn an hourly token.
			if (writable.length === 0) {
				return { updatedCharts: 0, insertedScores: 0, skipped };
			}

			const allowed = await checkUploadRateLimit(
				ctx.kv,
				ctx.user!.id,
				uploadHourlyLimit(ctx.env)
			);
			if (!allowed) {
				throw new GraphQLError('Too Many Requests', {
					extensions: { code: 'RATE_LIMITED' }
				});
			}

			// Phase 2 — write in bounded-concurrency chunks. Each chart's batch
			// is independent; Promise.allSettled ensures one failure doesn't
			// abort the chunk.
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
