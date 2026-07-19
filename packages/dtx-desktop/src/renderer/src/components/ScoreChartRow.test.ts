import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

import ScoreChartRow from './ScoreChartRow.svelte';
import type { LocalChartData } from '../lib/scoreTypes';

const makeChart = (overrides: Partial<LocalChartData> = {}): LocalChartData => ({
	difficultyLevel: 2,
	difficultyLabel: 'BASIC',
	drumLevel: 55,
	fileHash: 'hash-basic',
	aggregate: { playCount: 7, clearCount: 5 },
	best: {
		isBest: true,
		score: 950000,
		achievementRate: 75.0,
		rankLabel: 'A',
		fullCombo: false,
		cleared: true,
		maxCombo: 800,
		perfect: 500,
		great: 30,
		good: 10,
		poor: 5,
		miss: 2,
		performedAt: '2026-06-02',
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
// It should be a clean ` · `-joined list with no leading/trailing/duplicate
// separators, regardless of which optional fields (rankLabel, maxCombo,
// fullCombo) are present.
const bestLine = (): string => {
	const el = document.querySelector('div.text-dim.text-xs');
	return el?.textContent?.trim() ?? '';
};

describe('ScoreChartRow best-score separator', () => {
	beforeEach(() => {
		baseProps.onOverrideMatch.mockReset();
	});
	afterEach(() => cleanup());

	it('joins all present parts with single · separators', () => {
		render(ScoreChartRow, {
			props: { ...baseProps, chart: makeChart() }
		});
		// Best: 950,000 · A · 75% · combo 800
		expect(bestLine()).toBe('Best: 950,000 · A · 75% · combo 800');
	});

	it('does not emit a trailing · when maxCombo is null and fullCombo is false', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					best: {
						...makeChart().best!,
						maxCombo: null,
						fullCombo: false
					}
				})
			}
		});
		// Best: 950,000 · A · 75%  (no trailing ·)
		expect(bestLine()).toBe('Best: 950,000 · A · 75%');
	});

	it('does not emit a double · when maxCombo is null but fullCombo is true', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					best: {
						...makeChart().best!,
						maxCombo: null,
						fullCombo: true
					}
				})
			}
		});
		// Best: 950,000 · A · 75% · FC  (single · before FC, no double)
		expect(bestLine()).toBe('Best: 950,000 · A · 75% · FC');
	});

	it('appends fullCombo with a single · when maxCombo is also present', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					best: {
						...makeChart().best!,
						maxCombo: 800,
						fullCombo: true
					}
				})
			}
		});
		expect(bestLine()).toBe('Best: 950,000 · A · 75% · combo 800 · FC');
	});

	it('omits the rankLabel segment when rankLabel is null', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({
					best: {
						...makeChart().best!,
						rankLabel: null,
						maxCombo: null,
						fullCombo: false
					}
				})
			}
		});
		expect(bestLine()).toBe('Best: 950,000 · 75%');
	});

	it('renders the placeholder when best is null', () => {
		render(ScoreChartRow, {
			props: {
				...baseProps,
				chart: makeChart({ best: null })
			}
		});
		// The no_best_score placeholder lives in a different element
		// (text-faint, not text-dim), so bestLine() returns ''.
		expect(bestLine()).toBe('');
		// The svelte-i18n mock resolves score.no_best_score from en.json.
		expect(screen.getByText('No best score recorded.')).toBeInTheDocument();
	});
});
