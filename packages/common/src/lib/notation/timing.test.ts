import { describe, it, expect } from 'vitest';
import { buildChartTiming } from './timing';
import { LaneMeasureNote } from '../chart/note';

const noBpmChanges: LaneMeasureNote[] = [];

describe('buildChartTiming', () => {
	it('computes measure start times at constant bpm (4 measures, 120 bpm)', () => {
		// 120 bpm -> quarter = 0.5s -> 4/4 measure = 2s
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1, 1, 1, 1],
			measureCount: 4
		});
		expect(t.measureStartSeconds).toEqual([0, 2, 4, 6]);
		expect(t.totalDuration).toBe(8);
	});

	it('positionToTime is linear within a measure at constant bpm', () => {
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1, 1],
			measureCount: 2
		});
		expect(t.positionToTime(0, 0.5)).toBe(1); // half of a 2s measure
		expect(t.positionToTime(1, 0.25)).toBe(2.5); // 2s + 0.5s
	});

	it('timeToPosition inverts positionToTime', () => {
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1, 1],
			measureCount: 2
		});
		expect(t.timeToPosition(2.5)).toEqual({ measure: 1, fraction: 0.25 });
		expect(t.timeToPosition(0)).toEqual({ measure: 0, fraction: 0 });
	});

	it('clamps times past the end to the final position', () => {
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1],
			measureCount: 1
		});
		expect(t.timeToPosition(999)).toEqual({ measure: 0, fraction: 1 });
	});

	it('honors a mid-chart bpm change on channel 08', () => {
		// Measure 0 at 120 bpm (2s). Measure 1 switches to 240 bpm at its start (1s).
		const bpmChanges = [new LaneMeasureNote(1, '08', [{ noteID: 'AA', position: 0 }])];
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: { AA: 240 },
			bpmChanges,
			measureLengths: [1, 1],
			measureCount: 2
		});
		expect(t.measureStartSeconds).toEqual([0, 2]);
		expect(t.totalDuration).toBe(3); // 2s + 1s
	});
});
