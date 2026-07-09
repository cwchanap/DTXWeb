import type { ScoreRow, ChartScoreRow } from '@dtx/common/server';
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
