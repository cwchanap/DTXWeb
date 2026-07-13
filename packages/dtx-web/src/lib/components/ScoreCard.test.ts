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
			level: 5,
			chartScore: {
				playCount: 10,
				clearCount: 4,
				best: {
					id: 1,
					isBest: true,
					score: 912380,
					achievementRate: 91.3,
					rankLabel: 'S',
					fullCombo: true,
					cleared: true,
					maxCombo: 903,
					perfect: 1300,
					great: 120,
					good: 20,
					poor: 5,
					miss: 5,
					performedAt: '2026-06-02T00:00:00Z',
					displayOrder: null
				},
				recent: [
					{
						id: 2,
						isBest: false,
						score: null,
						achievementRate: 82.4,
						rankLabel: 'A',
						fullCombo: false,
						cleared: false,
						maxCombo: null,
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
		{ id: 11, label: 'EXTREME', level: 8, chartScore: null }
	]
};

describe('ScoreCard', () => {
	it('renders the song, chart, best score, badges, and recent plays', () => {
		render(ScoreCard, { props: { song } });
		expect(screen.getByText('Test Song')).toBeInTheDocument();
		expect(screen.getByText('Test Artist')).toBeInTheDocument();
		expect(screen.getByText('BASIC · score.level_short 5')).toBeInTheDocument();
		expect(screen.getByText('912,380')).toBeInTheDocument();
		expect(screen.getByText('91.30%')).toBeInTheDocument();
		expect(screen.getByText('S')).toBeInTheDocument();
		expect(screen.getByText('FC')).toBeInTheDocument();
		// The single recent play was a failure.
		expect(screen.getByText('score.failed')).toBeInTheDocument();
	});

	it('shows an empty best-score message for a chart with no scores', () => {
		render(ScoreCard, { props: { song } });
		expect(screen.getByText('EXTREME · score.level_short 8')).toBeInTheDocument();
		expect(screen.getByText('score.no_best_score')).toBeInTheDocument();
	});

	it('renders at most five recent plays even when more are provided', () => {
		const sixRecent = Array.from({ length: 6 }, (_, i) => ({
			id: 100 + i,
			isBest: false,
			score: null,
			achievementRate: 50,
			rankLabel: 'E',
			fullCombo: false,
			cleared: true,
			maxCombo: null,
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
					level: 5,
					chartScore: {
						playCount: 6,
						clearCount: 6,
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
