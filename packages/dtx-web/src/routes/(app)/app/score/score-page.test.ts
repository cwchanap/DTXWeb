import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

vi.mock('svelte-i18n');

const { myScoredSimfilesMock } = vi.hoisted(() => ({ myScoredSimfilesMock: vi.fn() }));
vi.mock('$lib/api', () => ({ myScoredSimfiles: myScoredSimfilesMock }));

import ScorePage from './+page.svelte';
import type { ScoredSimfile } from '$lib/api/score';

const song: ScoredSimfile = {
	id: 42,
	title: 'Dashboard Song',
	artist: 'Artist',
	charts: [
		{
			id: 10,
			label: 'BASIC',
			level: 5,
			chartScore: {
				playCount: 5,
				clearCount: 2,
				fullCombo: false,
				maxCombo: 800,
				bestAchievementRate: 90,
				bestRankLabel: 'S',
				lastPlayedAt: '2026-08-14T13:00:00Z',
				best: {
					id: 1,
					isBest: true,
					score: 900000,
					achievementRate: null,
					rankLabel: null,
					cleared: null,
					perfect: 1,
					great: 1,
					good: 1,
					poor: 1,
					miss: 1,
					performedAt: null,
					displayOrder: null
				},
				recent: []
			}
		}
	]
};

beforeEach(() => {
	myScoredSimfilesMock.mockReset();
});

describe('Score Page', () => {
	it('renders the heading and the user scores', async () => {
		myScoredSimfilesMock.mockResolvedValue({ data: [song], count: 1 });
		render(ScorePage);
		expect(screen.getByRole('heading', { name: 'score.my_scores' })).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText('Dashboard Song')).toBeInTheDocument());
	});

	it('shows the empty state when there are no scores', async () => {
		myScoredSimfilesMock.mockResolvedValue({ data: [], count: 0 });
		render(ScorePage);
		await waitFor(() => expect(screen.getByText('score.no_scores')).toBeInTheDocument());
	});
});
