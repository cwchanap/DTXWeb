import { describe, it, expect } from 'vitest';
import { matchCharts, type CloudChart, type LocalChart } from './scoreMatching';

const cloud = (id: string, level: number, label = ''): CloudChart => ({ id, level, label });
const local = (drumLevel: number, difficultyLabel = ''): LocalChart => ({
	drumLevel,
	difficultyLabel
});

describe('matchCharts', () => {
	it('matches each local chart to the nearest cloud level', () => {
		const result = matchCharts([local(55), local(88)], [cloud('a', 5.5), cloud('b', 8.8)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('assigns each cloud chart at most once (greedy in local order)', () => {
		const result = matchCharts([local(55), local(55)], [cloud('a', 5.5), cloud('b', 5.6)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('leaves an ambiguous tie unmatched when no label breaks it', () => {
		const result = matchCharts([local(50)], [cloud('a', 4.0), cloud('b', 6.0)]);
		expect(result).toEqual([null]);
	});

	it('breaks an equidistant tie by matching difficulty label', () => {
		const result = matchCharts(
			[local(50, 'ADVANCED')],
			[cloud('a', 4.0, 'BASIC'), cloud('b', 6.0, 'ADVANCED')]
		);
		expect(result).toEqual(['b']);
	});

	it('returns null for every local chart when there are no cloud charts', () => {
		expect(matchCharts([local(55), local(66)], [])).toEqual([null, null]);
	});

	it('leaves surplus local charts unmatched once cloud charts run out', () => {
		const result = matchCharts([local(55), local(56), local(57)], [cloud('a', 5.5)]);
		expect(result).toEqual(['a', null, null]);
	});
});
