import { describe, it, expect } from 'vitest';
import { ticksToDurations, quantizeMeasure, groupNotesByLane } from './quantize';
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
