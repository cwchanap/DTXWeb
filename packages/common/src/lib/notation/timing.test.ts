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

	it('round-trips positionToTime/timeToPosition through a mid-measure bpm change', () => {
		// Channel 08 changes tempo at position 0.5 inside measure 0: the first
		// half runs at 120 bpm (1s) and the second at 240 bpm (0.5s), so the whole
		// measure is 1.5s, not the 2s a constant-tempo measure would be. A linear
		// (elapsed/duration) inverse maps the half-way time back to the wrong
		// fraction; the piecewise inverse must recover the exact position.
		const bpmChanges = [new LaneMeasureNote(0, '08', [{ noteID: 'AA', position: 0.5 }])];
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: { AA: 240 },
			bpmChanges,
			measureLengths: [1],
			measureCount: 1
		});
		// measure is 1.5s: 1s at 120 + 0.5s at 240.
		expect(t.totalDuration).toBeCloseTo(1.5, 6);
		// The boundary time (1s) corresponds to fraction 0.5 exactly.
		expect(t.positionToTime(0, 0.5)).toBeCloseTo(1, 6);
		expect(t.timeToPosition(1)).toEqual({ measure: 0, fraction: 0.5 });
		// A point in the fast second half: position 0.75 -> 1s + 0.25*0.5s of 240bpm span.
		const timeAt75 = t.positionToTime(0, 0.75);
		const back = t.timeToPosition(timeAt75);
		expect(back.measure).toBe(0);
		expect(back.fraction).toBeCloseTo(0.75, 6);
	});

	it('timeToPosition stops scanning once a later measure starts after t (break path)', () => {
		// 3 measures at 120 bpm -> starts [0,2,4]. A time inside measure 1 must
		// break out of the loop at measure 2's start (4 > t) rather than run past.
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1, 1, 1],
			measureCount: 3
		});
		expect(t.timeToPosition(2.5)).toEqual({ measure: 1, fraction: 0.25 });
	});

	it('falls back to measureLength 1 when measureLengths is shorter than measureCount', () => {
		// Only one length provided but two measures; measure 1 must default to 1.
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1],
			measureCount: 2
		});
		expect(t.measureStartSeconds).toEqual([0, 2]);
		expect(t.totalDuration).toBe(4);
	});

	it('keeps the current bpm when a bpm-change noteID is not in the value map', () => {
		// A bpm change references noteID 'ZZ' which was never defined via #BPMZZ;
		// the change must be a no-op (bpm stays at 120 for the whole chart).
		const bpmChanges = [new LaneMeasureNote(1, '08', [{ noteID: 'ZZ', position: 0 }])];
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges,
			measureLengths: [1, 1],
			measureCount: 2
		});
		expect(t.totalDuration).toBe(4); // both measures at 120 bpm
	});

	it('round-trips through a bpm change at measure position 0 (downbeat change)', () => {
		// Channel 08 changes tempo at the downbeat of measure 1 (position 0).
		// measureBpmAtStart[1] holds the entering bpm (120), and positionToTime
		// applies the position-0 change for the segment starting at 0, so it uses
		// the new bpm (240) across [0, fraction]. timeToPosition must invert with
		// the same bpm or the seek<->cursor round-trip diverges within the measure.
		const bpmChanges = [new LaneMeasureNote(1, '08', [{ noteID: 'AA', position: 0 }])];
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: { AA: 240 },
			bpmChanges,
			measureLengths: [1, 1],
			measureCount: 2
		});
		// m0 = 2s at 120; m1 = 1s at 240 (change applies from the downbeat).
		expect(t.measureStartSeconds).toEqual([0, 2]);
		expect(t.totalDuration).toBe(3);
		// Halfway through m1 at 240bpm = 0.5s -> absolute 2.5s.
		expect(t.positionToTime(1, 0.5)).toBeCloseTo(2.5, 6);
		// The inverse must recover fraction 0.5, not the 120bpm-linear 0.25.
		const back = t.timeToPosition(2.5);
		expect(back.measure).toBe(1);
		expect(back.fraction).toBeCloseTo(0.5, 6);
	});

	it('positionToTime clamps an out-of-range measure to the end + falls back to base bpm', () => {
		const t = buildChartTiming({
			bpm: 120,
			bpmValueMap: {},
			bpmChanges: noBpmChanges,
			measureLengths: [1],
			measureCount: 1
		});
		// measure 99 has no recorded start time or starting bpm; both fall back.
		expect(t.positionToTime(99, 0)).toBe(t.totalDuration);
		// A non-zero fraction must STILL clamp to the end, not add a phantom
		// (fallback-length) measure on top of totalDuration. Without the clamp
		// this would return 3 (= 2s total + 1s for half a 120bpm measure).
		expect(t.positionToTime(99, 0.5)).toBe(t.totalDuration);
	});
});
