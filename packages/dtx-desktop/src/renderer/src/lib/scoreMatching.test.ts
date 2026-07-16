import { describe, it, expect } from 'vitest';
import { matchCharts, type CloudChart, type LocalChart } from './scoreMatching';

const cloud = (id: string, level: number, label = ''): CloudChart => ({ id, level, label });
const local = (drumLevel: number, difficultyLabel = ''): LocalChart => ({
	drumLevel,
	difficultyLabel
});

describe('matchCharts', () => {
	it('matches each local chart to the nearest cloud level (×10 encoded)', () => {
		const result = matchCharts([local(55), local(88)], [cloud('a', 55), cloud('b', 88)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('matches each local chart to the nearest cloud level (×100 encoded)', () => {
		const result = matchCharts([local(55), local(88)], [cloud('a', 550), cloud('b', 880)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('matches mixed ×10 and ×100 encoded cloud levels', () => {
		const result = matchCharts([local(55), local(88)], [cloud('a', 55), cloud('b', 880)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('assigns each cloud chart at most once (greedy in local order)', () => {
		const result = matchCharts([local(55), local(55)], [cloud('a', 55), cloud('b', 56)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('leaves an ambiguous tie unmatched when no label breaks it', () => {
		const result = matchCharts([local(50)], [cloud('a', 40), cloud('b', 60)]);
		expect(result).toEqual([null]);
	});

	it('breaks an equidistant tie by matching difficulty label', () => {
		const result = matchCharts(
			[local(50, 'ADVANCED')],
			[cloud('a', 40, 'BASIC'), cloud('b', 60, 'ADVANCED')]
		);
		expect(result).toEqual(['b']);
	});

	it('returns null for every local chart when there are no cloud charts', () => {
		expect(matchCharts([local(55), local(66)], [])).toEqual([null, null]);
	});

	it('leaves surplus local charts unmatched once cloud charts run out', () => {
		const result = matchCharts([local(55), local(56), local(57)], [cloud('a', 55)]);
		expect(result).toEqual(['a', null, null]);
	});

	it('matches the e2e seed level (50 == 5.0) against a local drumLevel of 50', () => {
		const result = matchCharts([local(50)], [cloud('seed', 50, 'BASIC')]);
		expect(result).toEqual(['seed']);
	});
});
