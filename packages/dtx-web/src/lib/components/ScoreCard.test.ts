import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
		expect(screen.getByText('BASIC · Lv 5')).toBeInTheDocument();
		expect(screen.getByText('912,380')).toBeInTheDocument();
		expect(screen.getByText('91.30%')).toBeInTheDocument();
		expect(screen.getByText('S')).toBeInTheDocument();
		expect(screen.getByText('FC')).toBeInTheDocument();
		// The single recent play was a failure.
		expect(screen.getByText('Failed')).toBeInTheDocument();
	});

	it('shows an empty best-score message for a chart with no scores', () => {
		render(ScoreCard, { props: { song } });
		expect(screen.getByText('EXTREME · Lv 8')).toBeInTheDocument();
		expect(screen.getByText('No best score recorded.')).toBeInTheDocument();
	});
});
