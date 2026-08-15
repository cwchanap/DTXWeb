import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

import ScoreChartRow from './ScoreChartRow.svelte';
import type { LocalChartData } from '../lib/scoreTypes';

const makeChart = (overrides: Partial<LocalChartData> = {}): LocalChartData => ({
	difficultyLevel: 2,
	difficultyLabel: 'BASIC',
	drumLevel: 55,
	drumLevelDec: 0,
	fileHash: 'hash-basic',
	aggregate: {
		playCount: 7,
		clearCount: 5,
		fullCombo: true,
		maxCombo: 800,
		bestAchievementRate: 75,
		bestRankLabel: 'A',
		lastPlayedAt: '2026-06-02T00:00:00Z'
	},
	best: {
		isBest: true,
		score: 950000,
		achievementRate: null,
		rankLabel: null,
		cleared: null,
		perfect: 500,
		great: 30,
		good: 10,
		poor: 5,
		miss: 2,
		performedAt: null,
		displayOrder: null
	},
	recent: [],
	...overrides
});

const baseProps = {
	chartIndex: 0,
	matchedId: null,
	cloudCharts: [],
	linked: false,
	onOverrideMatch: vi.fn()
};

// The best-score line is rendered inside `<div class="text-dim text-xs">`.
// It owns only the numeric best score, so removing chart-level records cannot
// leave doubled or trailing separators.
const bestLine = (): string => {
	const el = document.querySelector('div.text-dim.text-xs');
	return el?.textContent?.trim() ?? '';
};

describe('ScoreChartRow score ownership', () => {
	beforeEach(() => {
		baseProps.onOverrideMatch.mockReset();
	});
	afterEach(() => cleanup());

	it('renders the numeric best separately from chart-level records', () => {
		render(ScoreChartRow, {
			props: { ...baseProps, chart: makeChart() }
		});
		expect(bestLine()).toBe('Chart bests: 950,000');
		expect(screen.getByText('A')).toBeInTheDocument();
		expect(screen.getByText('75%')).toBeInTheDocument();
		expect(screen.getByText('combo 800')).toBeInTheDocument();
		expect(screen.getByText('FC')).toBeInTheDocument();
	});

	it('keeps the best row sparse when chart records are absent', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					aggregate: {
						...makeChart().aggregate,
						bestRankLabel: null,
						bestAchievementRate: null,
						fullCombo: false,
						maxCombo: 0
					}
				})
			}
		});
		expect(bestLine()).toBe('Chart bests: 950,000');
		expect(screen.queryByText('A')).not.toBeInTheDocument();
		expect(screen.queryByText('75%')).not.toBeInTheDocument();
		expect(screen.getByText('combo 0')).toBeInTheDocument();
		expect(screen.queryByText('FC')).not.toBeInTheDocument();
	});

	it('renders cleared, failed, and unknown recent results explicitly', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					recent: [
						{
							...makeChart().best!,
							isBest: false,
							score: null,
							cleared: true,
							displayOrder: 1
						},
						{
							...makeChart().best!,
							isBest: false,
							score: null,
							cleared: false,
							displayOrder: 2
						},
						{
							...makeChart().best!,
							isBest: false,
							score: null,
							cleared: null,
							displayOrder: 3
						}
					]
				})
			}
		});
		expect(screen.getByText('Cleared')).toBeInTheDocument();
		expect(screen.getByText('Failed')).toBeInTheDocument();
		expect(screen.getByText('—')).toBeInTheDocument();
	});

	it('renders the placeholder and hides aggregate records when a chart has never been played', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					best: null,
					aggregate: {
						playCount: 0,
						clearCount: 0,
						fullCombo: false,
						maxCombo: 0,
						bestAchievementRate: null,
						bestRankLabel: null,
						lastPlayedAt: null
					}
				})
			}
		});
		// The svelte-i18n mock resolves score.no_best_score from en.json.
		expect(screen.getByText('No best score recorded.')).toBeInTheDocument();
		// A never-played chart has no rank/rate/combo/FC to show — the zero
		// defaults are not evidence of a real achievement.
		expect(screen.queryByText('A')).not.toBeInTheDocument();
		expect(screen.queryByText(/%/)).not.toBeInTheDocument();
		expect(screen.queryByText(/combo/i)).not.toBeInTheDocument();
		expect(screen.queryByText('FC')).not.toBeInTheDocument();
	});
});
