import { describe, it, expect } from 'vitest';
import { matchCharts, type CloudChart, type LocalChart } from './scoreMatching';

const cloud = (id: string, level: number, label = ''): CloudChart => ({ id, level, label });
const local = (drumLevel: number, difficultyLabel = '', drumLevelDec = 0): LocalChart => ({
	drumLevel,
	drumLevelDec,
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

	it('uses DrumLevelDec for local chart level (DTXManiaCX formula)', () => {
		// DrumLevel=78 + DrumLevelDec=33 → 7.8 + 0.33 = 8.13
		// Cloud level 813 (×100) → 8.13
		const result = matchCharts([local(78, '', 33)], [cloud('a', 813)]);
		expect(result).toEqual(['a']);
	});

	it('matches a local chart with DrumLevelDec to the nearest ×10 cloud level', () => {
		// DrumLevel=78 + DrumLevelDec=33 → 8.13
		// Cloud level 81 (×10) → 8.1, cloud level 82 (×10) → 8.2
		// 8.13 is closer to 8.1 (diff 0.03) than 8.2 (diff 0.07)
		const result = matchCharts([local(78, '', 33)], [cloud('a', 81), cloud('b', 82)]);
		expect(result).toEqual(['a']);
	});

	it('assigns each cloud chart at most once (greedy in local order)', () => {
		// Two local charts at different levels, two cloud charts at matching
		// levels. Each local chart has a uniquely nearest cloud chart, so the
		// assignment is unambiguous and each cloud chart is used at most once.
		const result = matchCharts([local(55), local(56)], [cloud('a', 55), cloud('b', 56)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('returns null for identical local charts with interchangeable cloud targets', () => {
		// Two identical local charts (both 5.5) and two valid cloud charts
		// (5.5 and 5.6). Both [a,b] and [b,a] are equally optimal — the local
		// charts are indistinguishable, so the assignment is ambiguous → null.
		const result = matchCharts([local(55), local(55)], [cloud('a', 55), cloud('b', 56)]);
		expect(result).toEqual([null, null]);
	});

	it('finds the optimal assignment when greedy would discard a valid match', () => {
		// Local: 5.0, 5.4. Cloud: 5.2, 4.5.
		// Greedy in source order: 5.0→5.2 (diff 0.2), 5.4→4.5 (diff 0.9 > 0.5 → null).
		// Optimal: 5.0→4.5 (diff 0.5), 5.4→5.2 (diff 0.2) — both matched.
		const result = matchCharts([local(50), local(54)], [cloud('a', 52), cloud('b', 45)]);
		expect(result).toEqual(['b', 'a']);
	});

	it('resolves a locally ambiguous tie via global assignment', () => {
		// Local: 5.0, 5.6. Cloud: 4.5, 5.5.
		// For local 5.0, both cloud 4.5 and 5.5 are equidistant (delta 0.5).
		// The old isPairable check rejected both as an unbreakable tie.
		// But once 5.6→5.5 is assigned (delta 0.1, the only valid pair for 5.6),
		// the remaining 5.0→4.5 is unambiguous. The exhaustive matcher should
		// find the globally optimal 2-match assignment.
		const result = matchCharts([local(50), local(56)], [cloud('a', 45), cloud('b', 55)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('returns null for a genuinely ambiguous tie with no global resolution', () => {
		// Local: 5.0. Cloud: 4.5, 5.5. Both equidistant, no labels to break
		// the tie. Two equally optimal assignments exist (5.0→4.5 and 5.0→5.5)
		// that disagree on the target → null.
		const result = matchCharts([local(50)], [cloud('a', 45), cloud('b', 55)]);
		expect(result).toEqual([null]);
	});

	it('leaves an ambiguous tie unmatched when no label breaks it', () => {
		const result = matchCharts([local(50)], [cloud('a', 40), cloud('b', 60)]);
		expect(result).toEqual([null]);
	});

	it('breaks an equidistant tie by matching difficulty label', () => {
		const result = matchCharts(
			[local(50, 'ADVANCED')],
			[cloud('a', 48, 'BASIC'), cloud('b', 52, 'ADVANCED')]
		);
		expect(result).toEqual(['b']);
	});

	it('rejects a uniquely nearest candidate whose level is beyond MAX_LEVEL_DELTA', () => {
		// target 5.0; the only cloud chart is at 6.0 (diff 1.0 > 0.5) — even
		// though it's uniquely nearest, it's too far away to auto-match.
		const result = matchCharts([local(50)], [cloud('a', 60)]);
		expect(result).toEqual([null]);
	});

	it('rejects a label-disambiguated tie winner beyond MAX_LEVEL_DELTA', () => {
		// Both candidates are 1.0 away (tie); label breaks the tie toward 'b',
		// but 'b' is still beyond the threshold so it's rejected for manual
		// selection.
		const result = matchCharts(
			[local(50, 'ADVANCED')],
			[cloud('a', 40, 'BASIC'), cloud('b', 60, 'ADVANCED')]
		);
		expect(result).toEqual([null]);
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

	it('treats a stray decimal cloud level as already display-scale (not ÷10)', () => {
		// The GraphQL schema exposes `level` as Float, so a decimal like 5.5 can
		// reach us even though the canonical form is the encoded integer 55.
		// Dividing 5.5 by 10 would yield 0.55 and match the wrong local chart.
		const result = matchCharts([local(55)], [cloud('a', 5.5)]);
		expect(result).toEqual(['a']);
	});

	it('does not cross-match decimal and encoded levels for different charts', () => {
		// 5.5 (display) and 55 (encoded == 5.5) both decode to 5.5; local 55 and 88
		// must still pair to their own cloud chart, not get swapped by the heuristic.
		const result = matchCharts([local(55), local(88)], [cloud('a', 5.5), cloud('b', 88)]);
		expect(result).toEqual(['a', 'b']);
	});

	it('decodes a bare single-digit cloud level as ×10 (0.5), which fails to match a real local chart', () => {
		// With the DTXManiaCX formula, a bare 5 decodes as 0.5 (×10 branch:
		// 5 / 10 + 0 / 100 = 0.5). DTX levels range 0.1–9.99, so 0.5 is a
		// valid but very low level. A real local chart at level 5.0
		// (drumLevel 50) is 4.5 away — well beyond MAX_LEVEL_DELTA — so the
		// match is rejected for manual selection. The raw #DLEVEL value is
		// stored directly (no encoding), so a bare 1–9 in the cloud is a
		// genuine sub-1.0 level, not a legacy display-scale value.
		const result = matchCharts([local(50)], [cloud('a', 5)]);
		expect(result).toEqual([null]);
	});

	it('falls back to greedy matching when chart sets exceed the exhaustive guard', () => {
		// 7 local charts exceeds the ≤6 guard — the greedy fallback should be
		// used. Each local chart has an exact cloud match, so greedy still
		// pairs them all.
		const localCharts = Array.from({ length: 7 }, (_, i) => local(50 + i));
		const cloudCharts = Array.from({ length: 7 }, (_, i) => cloud(`c${i}`, 50 + i));
		const result = matchCharts(localCharts, cloudCharts);
		expect(result).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
	});
});
