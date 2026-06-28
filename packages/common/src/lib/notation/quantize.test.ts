import { describe, it, expect } from 'vitest';
import {
	ticksToDurations,
	quantizeMeasure,
	groupNotesByLane,
	buildNotationChart
} from './quantize';
import { DTXFile } from '../chart/dtx';
import { LaneMeasureNote } from '../chart/note';

describe('ticksToDurations', () => {
	it('returns a single code for representable durations', () => {
		expect(ticksToDurations(192)).toEqual(['w']);
		expect(ticksToDurations(48)).toEqual(['q']);
		expect(ticksToDurations(24)).toEqual(['8']);
		expect(ticksToDurations(12)).toEqual(['16']);
	});

	it('decomposes a dotted-length span into two binary durations', () => {
		expect(ticksToDurations(72)).toEqual(['q', '8']); // 48 + 24
	});

	it('decomposes non-representable spans largest-first', () => {
		// 60 ticks = quarter(48) + sixteenth(12)
		expect(ticksToDurations(60)).toEqual(['q', '16']);
	});

	it('returns empty for zero or negative', () => {
		expect(ticksToDurations(0)).toEqual([]);
		expect(ticksToDurations(-5)).toEqual([]);
	});
});

describe('quantizeMeasure', () => {
	it('produces 4 quarter notes for an 8-slot snare-on-every-quarter pattern', () => {
		// positions 0, .25, .5, .75 -> quarter notes
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 0.25 },
			{ noteID: '01', position: 0.5 },
			{ noteID: '01', position: 0.75 }
		]);
		const measure = quantizeMeasure(0, [snare]);
		const notes = measure.entries.filter((e) => e.kind === 'note');
		expect(notes).toHaveLength(4);
		expect(notes.every((n) => n.durTicks === 48)).toBe(true);
		expect((notes[0] as { keys: string[] }).keys).toEqual(['c/5']);
	});

	it('merges simultaneous lanes into a chord', () => {
		const bass = new LaneMeasureNote(0, '13', [{ noteID: '01', position: 0 }]);
		const hat = new LaneMeasureNote(0, '11', [{ noteID: '01', position: 0 }]);
		const measure = quantizeMeasure(0, [bass, hat]);
		const first = measure.entries.find((e) => e.kind === 'note') as { keys: string[] };
		expect(first.keys.sort()).toEqual(['f/4', 'g/5/x2']);
	});

	it('emits a leading rest before the first onset', () => {
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '01', position: 0.5 }]);
		const measure = quantizeMeasure(0, [snare]);
		expect(measure.entries[0].kind).toBe('rest');
		expect(measure.entries[0].durTicks).toBe(96); // half-measure rest
	});

	it('produces a full-measure rest for an empty measure', () => {
		const measure = quantizeMeasure(0, []);
		expect(measure.entries).toHaveLength(1);
		expect(measure.entries[0]).toMatchObject({ kind: 'rest', durTicks: 192 });
	});

	it('ignores non-playable lanes (bpm/bgm)', () => {
		const bpm = new LaneMeasureNote(0, '08', [{ noteID: 'AA', position: 0 }]);
		const measure = quantizeMeasure(0, [bpm]);
		expect(measure.entries).toHaveLength(1);
		expect(measure.entries[0].kind).toBe('rest');
	});

	it('skips notes with noteID "00"', () => {
		// '00' is the DTX "no note" marker; it must not produce an onset.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '00', position: 0 },
			{ noteID: '01', position: 0.5 }
		]);
		const measure = quantizeMeasure(0, [snare]);
		const notes = measure.entries.filter((e) => e.kind === 'note');
		expect(notes).toHaveLength(1);
		expect((notes[0] as { startTick: number }).startTick).toBe(96);
	});

	it('fills the remainder of a span with rests after a note', () => {
		// Onsets at 0 and 0.25. The second onset spans 144 ticks (to the barline);
		// it takes a half note (96) and the 48-tick remainder becomes a rest.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 0.25 }
		]);
		const measure = quantizeMeasure(0, [snare]);
		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] },
			{ kind: 'note', startTick: 48, durTicks: 96, keys: ['c/5'] },
			{ kind: 'rest', startTick: 144, durTicks: 48 }
		]);
	});

	it('handles an onset span smaller than the smallest representable duration', () => {
		// Two onsets 1/64 apart -> span of 3 ticks (the minimum). codes.length === 1
		// here. Force the codes.length===0 fallback by making the span < 3 ticks is
		// impossible via rounding, so instead verify a 3-tick span yields a 64th
		// note with no remainder.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 1 / 64 }
		]);
		const measure = quantizeMeasure(0, [snare]);
		const notes = measure.entries.filter((e) => e.kind === 'note');
		expect(notes[0].durTicks).toBe(3);
	});
});

describe('groupNotesByLane', () => {
	it('groups flat notes by laneID', () => {
		const a = new LaneMeasureNote(0, '12', []);
		const b = new LaneMeasureNote(1, '12', []);
		const c = new LaneMeasureNote(0, '13', []);
		const grouped = groupNotesByLane([a, b, c]);
		expect(grouped['12']).toHaveLength(2);
		expect(grouped['13']).toHaveLength(1);
	});
});

// Build a minimal DTXFile with just the fields buildNotationChart reads.
const makeDtx = (lines: string[], bpm = 120): DTXFile => {
	const dtx = new DTXFile();
	dtx.lines = lines;
	dtx.bpm = bpm;
	return dtx;
};

describe('buildNotationChart', () => {
	it('builds one measure per parsed measure and wires timing from bpm', () => {
		// #00012: 0101 -> snare on beats 1 and 3 of measure 0 (positions 0, 0.5)
		const dtx = makeDtx(['#00012: 01010101'], 120);
		const { chart, timing, notesByLane, measureCount } = buildNotationChart(dtx);
		expect(measureCount).toBe(1);
		expect(chart.measures).toHaveLength(1);
		const notes = chart.measures[0].entries.filter((e) => e.kind === 'note');
		expect(notes).toHaveLength(4);
		// 120 bpm, 4/4 -> 2s per measure
		expect(timing.measureStartSeconds).toEqual([0]);
		expect(timing.totalDuration).toBe(2);
		// notesByLane groups by lane id; '12' is the snare lane.
		expect(notesByLane['12']).toHaveLength(1);
	});

	it('spans multiple measures and reports the highest measure index + 1', () => {
		// Measure 0 snare, measure 2 snare -> measureCount 3 (0,1,2)
		const dtx = makeDtx(['#00012: 01', '#00212: 01'], 120);
		const { chart, measureCount, timing } = buildNotationChart(dtx);
		expect(measureCount).toBe(3);
		expect(chart.measures).toHaveLength(3);
		// Measures 1 and 2 are empty -> single full-measure rest each.
		expect(chart.measures[1].entries).toHaveLength(1);
		expect(chart.measures[1].entries[0].kind).toBe('rest');
		expect(timing.measureStartSeconds).toEqual([0, 2, 4]);
	});

	it('forwards bpm changes on channel 08 into the timing', () => {
		// #BPMAA: 240 defines a bpm change value; #00108: AA triggers it at m1.
		const dtx = makeDtx(['#BPMAA: 240', '#00108: AA'], 120);
		const { timing } = buildNotationChart(dtx);
		// m0 at 120bpm = 2s; m1 switches to 240bpm = 1s -> total 3s.
		expect(timing.measureStartSeconds).toEqual([0, 2]);
		expect(timing.totalDuration).toBe(3);
	});

	it('defaults bpm to 120 when the dtx has none', () => {
		const dtx = makeDtx(['#00012: 01'], undefined as unknown as number);
		const { timing } = buildNotationChart(dtx);
		expect(timing.totalDuration).toBe(2); // 120 bpm -> 2s/measure
	});
});
