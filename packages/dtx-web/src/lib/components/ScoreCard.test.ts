import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('svelte-i18n');
import ScoreCard from './ScoreCard.svelte';
import type { ScoredSimfile } from '$lib/api/score';

const song: ScoredSimfile = {
	id: 42,
	title: 'Test Song',
	artist: 'Test Artist',
	charts: [
		{
			id: 10,
			label: 'BASIC',
			level: 50,
			chartScore: {
				playCount: 10,
				clearCount: 4,
				fullCombo: true,
				maxCombo: 903,
				bestAchievementRate: 96.25,
				bestRankLabel: 'SS',
				lastPlayedAt: '2026-08-14T13:00:00Z',
				best: {
					id: 1,
					isBest: true,
					score: 912380,
					achievementRate: null,
					rankLabel: null,
					cleared: null,
					perfect: 1300,
					great: 120,
					good: 20,
					poor: 5,
					miss: 5,
					performedAt: null,
					displayOrder: null
				},
				recent: [
					{
						id: 2,
						isBest: false,
						score: null,
						achievementRate: 82.4,
						rankLabel: 'A',
						cleared: false,
						perfect: null,
						great: null,
						good: null,
						poor: null,
						miss: null,
						performedAt: '2026-06-01T00:00:00Z',
						displayOrder: 1
					}
				]
			}
		},
		{ id: 11, label: 'EXTREME', level: 80, chartScore: null }
	]
};

describe('ScoreCard', () => {
	it('renders chart best achievement/rank separately from the best score', () => {
		render(ScoreCard, { props: { song } });
		expect(screen.getByText('Test Song')).toBeInTheDocument();
		expect(screen.getByText('Test Artist')).toBeInTheDocument();
		expect(screen.getByText('BASIC · score.level_short 5.00')).toBeInTheDocument();
		// The aggregate best row is labeled so it's clearly not a single play.
		expect(screen.getByText('score.chart_bests')).toBeInTheDocument();
		expect(screen.getByText('912,380')).toBeInTheDocument();
		expect(screen.getByText('96.25%')).toBeInTheDocument();
		expect(screen.getByText('SS')).toBeInTheDocument();
		expect(screen.getAllByText('score.max_combo 903')).toHaveLength(1);
		expect(screen.getAllByText('score.full_combo')).toHaveLength(1);
		expect(screen.getByText('score.perfect 1300')).toBeInTheDocument();
		expect(screen.getByText('score.great 120')).toBeInTheDocument();
		expect(screen.getByText('score.good 20')).toBeInTheDocument();
		expect(screen.getByText('score.poor 5')).toBeInTheDocument();
		expect(screen.getByText('score.miss 5')).toBeInTheDocument();
		// The best row has null rate/rank/result/time and therefore does not
		// render those values as if they belonged to the best score.
		expect(screen.queryByText('91.30%')).not.toBeInTheDocument();
		expect(screen.getByText('score.failed')).toBeInTheDocument();
	});

	it('renders clear, failed, and unknown recent results distinctly', () => {
		const songWithRecentResults: ScoredSimfile = {
			...song,
			charts: [
				{
					...song.charts[0],
					chartScore: {
						...song.charts[0].chartScore!,
						recent: [
							{ ...song.charts[0].chartScore!.recent[0], id: 2, cleared: true },
							{ ...song.charts[0].chartScore!.recent[0], id: 3, cleared: false },
							{ ...song.charts[0].chartScore!.recent[0], id: 4, cleared: null }
						]
					}
				}
			]
		};
		render(ScoreCard, { props: { song: songWithRecentResults } });
		expect(screen.getByText('score.cleared')).toBeInTheDocument();
		expect(screen.getByText('score.failed')).toBeInTheDocument();
		expect(screen.getByText('—')).toBeInTheDocument();
	});

	it('shows an empty best-score message for a chart with a score record but no best', () => {
		// A chart that has been played (chartScore present) but has no best
		// row yet still shows the "No best score" placeholder.
		const songWithPlayedNoBest: ScoredSimfile = {
			...song,
			charts: [
				{
					id: 11,
					label: 'EXTREME',
					level: 80,
					chartScore: {
						playCount: 2,
						clearCount: 0,
						fullCombo: false,
						maxCombo: 0,
						bestAchievementRate: null,
						bestRankLabel: null,
						lastPlayedAt: null,
						best: null,
						recent: []
					}
				}
			]
		};
		render(ScoreCard, { props: { song: songWithPlayedNoBest } });
		expect(screen.getByText('EXTREME · score.level_short 8.00')).toBeInTheDocument();
		expect(screen.getByText('score.no_best_score')).toBeInTheDocument();
	});

	it('does not render unscored charts at all', () => {
		// A never-played chart (chartScore null) is skipped entirely — no
		// badge, no empty shell, no "No best score" placeholder. This avoids
		// noise from unplayed difficulties on a song with many charts.
		render(ScoreCard, { props: { song } });
		expect(screen.queryByText('EXTREME · score.level_short 8.00')).not.toBeInTheDocument();
		expect(screen.queryByText('score.no_best_score')).not.toBeInTheDocument();
	});

	it('renders at most five recent plays even when more are provided', () => {
		const sixRecent = Array.from({ length: 6 }, (_, i) => ({
			id: 100 + i,
			isBest: false,
			score: null,
			achievementRate: 50,
			rankLabel: 'E',
			cleared: true,
			perfect: null,
			great: null,
			good: null,
			poor: null,
			miss: null,
			performedAt: `2026-06-0${i + 1}T00:00:00Z`,
			displayOrder: i + 1
		}));
		const songWithSix: ScoredSimfile = {
			...song,
			charts: [
				{
					id: 10,
					label: 'BASIC',
					level: 50,
					chartScore: {
						playCount: 6,
						clearCount: 6,
						fullCombo: false,
						maxCombo: 0,
						bestAchievementRate: null,
						bestRankLabel: null,
						lastPlayedAt: null,
						best: null,
						recent: sixRecent
					}
				}
			]
		};
		render(ScoreCard, { props: { song: songWithSix } });
		// Each recent play renders as a list item with "Cleared" text.
		// Only the first 5 of 6 should be rendered.
		const clearedItems = screen.getAllByText('score.cleared');
		expect(clearedItems).toHaveLength(5);
	});
});
