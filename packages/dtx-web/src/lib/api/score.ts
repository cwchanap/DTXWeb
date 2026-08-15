import { MyScoredSimfilesDocument, type MyScoredSimfilesQuery } from './generated/graphql';
import { getClient, type ClientCtx } from './client';

export type ScoreView = {
	id: number;
	isBest: boolean;
	score: number | null;
	achievementRate: number | null;
	rankLabel: string | null;
	cleared: boolean | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performedAt: string | null;
	displayOrder: number | null;
};

export type ChartScoreView = {
	playCount: number;
	clearCount: number;
	fullCombo: boolean;
	maxCombo: number;
	bestAchievementRate: number | null;
	bestRankLabel: string | null;
	lastPlayedAt: string | null;
	best: ScoreView | null;
	recent: ScoreView[];
};

export type ScoredChart = {
	id: number;
	label: string;
	level: number;
	chartScore: ChartScoreView | null;
};

export type ScoredSimfile = {
	id: number;
	title: string;
	artist: string;
	charts: ScoredChart[];
};

export type ScoredSimfilesResult = { data: ScoredSimfile[]; count: number };

export type MyScoredSimfilesParams = { page?: number; pageSize?: number };

// Shapes derived from the generated query type so the adapter tracks the schema.
type RawSimfile = MyScoredSimfilesQuery['myScoredSimfiles']['data'][number];
type RawChart = RawSimfile['dtxFiles'][number];
type RawChartScore = NonNullable<RawChart['myChartScore']>;
type RawScore = RawChartScore['scores'][number];

const toScoreView = (s: RawScore): ScoreView => {
	const numId = Number(s.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid score id: ${s.id}`);
	return {
		id: numId,
		isBest: s.isBest,
		score: s.score ?? null,
		achievementRate: s.achievementRate ?? null,
		rankLabel: s.rankLabel ?? null,
		cleared: s.cleared ?? null,
		perfect: s.perfect ?? null,
		great: s.great ?? null,
		good: s.good ?? null,
		poor: s.poor ?? null,
		miss: s.miss ?? null,
		performedAt: s.performedAt ?? null,
		displayOrder: s.displayOrder ?? null
	};
};

// The API orders scores best-first (is_best DESC) then display_order ASC, so
// `recent` preserves that order after filtering out the best row.
const toChartScoreView = (cs: RawChartScore): ChartScoreView => {
	const scores = cs.scores.map(toScoreView);
	return {
		playCount: cs.playCount,
		clearCount: cs.clearCount,
		fullCombo: cs.fullCombo,
		maxCombo: cs.maxCombo,
		bestAchievementRate: cs.bestAchievementRate ?? null,
		bestRankLabel: cs.bestRankLabel ?? null,
		lastPlayedAt: cs.lastPlayedAt ?? null,
		best: scores.find((s) => s.isBest) ?? null,
		recent: scores.filter((s) => !s.isBest)
	};
};

const toScoredChart = (c: RawChart): ScoredChart => {
	const numId = Number(c.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid chart id: ${c.id}`);
	return {
		id: numId,
		label: c.label,
		level: c.level,
		chartScore: c.myChartScore ? toChartScoreView(c.myChartScore) : null
	};
};

const toScoredSimfile = (s: RawSimfile): ScoredSimfile => {
	const numId = Number(s.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${s.id}`);
	return {
		id: numId,
		title: s.title,
		artist: s.artist,
		charts: s.dtxFiles.map(toScoredChart)
	};
};

export const myScoredSimfiles = async (
	params: MyScoredSimfilesParams = {},
	ctx?: ClientCtx
): Promise<ScoredSimfilesResult> => {
	const client = await getClient(ctx);
	const result = await client.request(MyScoredSimfilesDocument, {
		page: params.page ?? 1,
		pageSize: params.pageSize ?? 20
	});
	return {
		data: result.myScoredSimfiles.data.map(toScoredSimfile),
		count: result.myScoredSimfiles.count
	};
};
