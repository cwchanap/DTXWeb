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

	it('renders open hi-hat (lane 18) with the circled-x key g/5/x3', () => {
		const openHat = new LaneMeasureNote(0, '18', [{ noteID: '01', position: 0 }]);
		const measure = quantizeMeasure(0, [openHat]);
		const first = measure.entries.find((e) => e.kind === 'note') as { keys: string[] };
		expect(first.keys).toEqual(['g/5/x3']);
	});

	it('keeps open and closed hi-hat keys distinct in a single chord', () => {
		const closed = new LaneMeasureNote(0, '11', [{ noteID: '01', position: 0 }]);
		const open = new LaneMeasureNote(0, '18', [{ noteID: '01', position: 0 }]);
		const measure = quantizeMeasure(0, [closed, open]);
		const first = measure.entries.find((e) => e.kind === 'note') as { keys: string[] };
		expect(first.keys.sort()).toEqual(['g/5/x2', 'g/5/x3']);
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

	it('decomposes an empty non-4/4 measure into rests that sum to the bar', () => {
		// 3/4 = 0.75 * 192 = 144 ticks. A single 144-tick rest has no exact
		// VexFlow glyph (NotationView's TICK_CODE only knows binary values), so
		// it would fall back to a half rest (96) and misrepresent the bar length.
		// pushRests decomposes 144 -> 96 + 48 (half + quarter rest), filling the
		// whole 3/4 bar.
		const measure = quantizeMeasure(0, [], 0.75);
		expect(measure.measureTicks).toBe(144);
		expect(measure.entries).toEqual([
			{ kind: 'rest', startTick: 0, durTicks: 96 },
			{ kind: 'rest', startTick: 96, durTicks: 48 }
		]);
		expect(measure.tuplets).toEqual([]);
		const total = measure.entries.reduce((sum, e) => sum + e.durTicks, 0);
		expect(total).toBe(measure.measureTicks);
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

	it('drops a sub-3-tick remainder after a note instead of emitting a spurious rest', () => {
		// Two onsets 49 ticks apart: the first takes a quarter (48), leaving a
		// 1-tick gap no binary duration can represent. The remainder follows a
		// note (not a rest), so it can't be folded into the preceding entry.
		// Emitting a 1-tick rest would render as a quarter rest (ticksToRestCode
		// falls back to 'q' for values outside TICK_CODE), so the remainder is
		// dropped instead. The note keeps its clean binary duration and no
		// misleading rest glyph appears.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 49 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);
		const rests = measure.entries.filter((e) => e.kind === 'rest');
		// No rest carries a sub-3-tick (non-representable) duration.
		expect(rests.every((r) => r.durTicks >= 3)).toBe(true);
		// The first note keeps its binary quarter duration.
		const note0 = measure.entries.find((e) => e.kind === 'note' && e.startTick === 0);
		expect(note0?.durTicks).toBe(48);
	});

	it('detects an all-note eighth-triplet group', () => {
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
		// Per-tuplet tick sum: 3 slots × 16 ticks = 48.
		expect(measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0)).toBe(48);
	});

	it('emits rests inside detected triplet groups', () => {
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
			{ kind: 'rest', startTick: 16, durTicks: 16 },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
	});

	it('uses an observed group end to emit a trailing triplet rest', () => {
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 48 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 4)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
			{ kind: 'rest', startTick: 32, durTicks: 16 },
			{ kind: 'note', startTick: 48, durTicks: 96, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
	});

	it('detects a triplet group after a binary quarter note', () => {
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 48 / 192 },
			{ noteID: '01', position: 64 / 192 },
			{ noteID: '01', position: 80 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 4)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 48, keys: ['c/5'] },
			{ kind: 'note', startTick: 48, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 80, durTicks: 16, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 1,
				count: 3,
				slotTicks: 16
			}
		]);
	});

	it('detects a quarter-note triplet group (groupTicks=96, slotTicks=32)', () => {
		// 3 onsets spanning 96 ticks (one half note) at 32-tick slots:
		// positions 0, 32/192, 64/192 -> ticks 0, 32, 64. A quarter-note
		// triplet packs three quarter notes into the time of two (96 ticks).
		// baseDurTicks=48 (quarter, derived from slotTicks*3/2), slotTicks=32 (96/3).
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 32 / 192 },
			{ noteID: '01', position: 64 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 32, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 32
			}
		]);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
	});

	it('detects a half-note triplet group (groupTicks=192, slotTicks=64)', () => {
		// 3 onsets spanning the whole 4/4 bar (192 ticks) at 64-tick slots:
		// positions 0, 64/192, 128/192 -> ticks 0, 64, 128. groupEnd=192 equals
		// measureTicks so observedEnd is true. baseDurTicks=96 (derived from slotTicks*3/2).
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 64 / 192 },
			{ noteID: '01', position: 128 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 64, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 64, keys: ['c/5'] },
			{ kind: 'note', startTick: 128, durTicks: 64, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 64
			}
		]);
	});

	it('detects a 16th-note triplet group (groupTicks=24, slotTicks=8)', () => {
		// 3 onsets spanning 24 ticks (one eighth) at 8-tick slots:
		// positions 0, 8/192, 16/192 -> ticks 0, 8, 16. A 16th-note triplet
		// packs three 16ths into the time of one eighth (24 ticks). 8 is not in
		// DURATION_TABLE, so without the 24-group these fall back to 6-tick 32nds
		// with dropped 2-tick gaps. baseDurTicks=12 ('16') via slotTicks*3/2.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 8 / 192 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 24 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 8, keys: ['c/5'] },
			{ kind: 'note', startTick: 8, durTicks: 8, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 8, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 8
			}
		]);
		expect(measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0)).toBe(24);
	});

	it('detects a 16th-note triplet group without an observed end', () => {
		// 3 onsets at 0, 8, 16 with the next onset at 48 (not at 24). The third
		// slot is occupied, so the group is rhythmically complete even without
		// an onset marking groupEnd=24. The 24-group wins because the 48-group
		// sees tick 8 as an off-slot onset and is rejected.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 8 / 192 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 48 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 4)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 8, keys: ['c/5'] },
			{ kind: 'note', startTick: 8, durTicks: 8, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 8, keys: ['c/5'] },
			{ kind: 'rest', startTick: 24, durTicks: 24 }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 8
			}
		]);
	});

	it('does not mis-detect a 16th triplet when an eighth triplet is intended', () => {
		// Onsets at 0, 16, 32 (eighth-note triplet slots). The 24-group's slots
		// are 0, 8, 16: tick 32 is outside the group, tick 16 is on-slot, so
		// occupiedCount=2. The 48-group's slots 0, 16, 32 are all occupied
		// (occupiedCount=3) and wins the tie-break. Verifies adding 24 doesn't
		// shadow larger groups.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
	});

	it('tie-breaks between candidate group sizes by observedEnd when occupiedCount is equal', () => {
		// Onsets at 0, 32, 96. At cursor=0 two candidates qualify:
		//  - groupTicks=48: slots 0,16,32; occupiedCount=2, observedEnd=false
		//    (no onset at 48, 48 != measureTicks).
		//  - groupTicks=96: slots 0,32,64; occupiedCount=2, observedEnd=true
		//    (onset at 96 marks the group end). The third slot (64) is a rest.
		// Equal occupiedCount -> the observedEnd tie-breaker picks groupTicks=96.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 32 / 192 },
			{ noteID: '01', position: 96 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 4)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 32, keys: ['c/5'] },
			{ kind: 'rest', startTick: 64, durTicks: 32 },
			{ kind: 'note', startTick: 96, durTicks: 96, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 32
			}
		]);
	});

	it('detects two consecutive eighth-triplet groups in one measure', () => {
		// Two back-to-back triplet groups: onsets at 0,16,32 (group 1) and
		// 48,64,80 (group 2). After group 1 ends at cursor=48, the loop
		// re-enters findTripletCandidate and detects group 2. The remaining
		// 96 ticks (96->192) become a half rest.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 },
			{ noteID: '01', position: 48 / 192 },
			{ noteID: '01', position: 64 / 192 },
			{ noteID: '01', position: 80 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 48, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 80, durTicks: 16, keys: ['c/5'] },
			{ kind: 'rest', startTick: 96, durTicks: 96 }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			},
			{
				startIndex: 3,
				count: 3,
				slotTicks: 16
			}
		]);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
		// Per-tuplet tick sums: each group spans 48 ticks (3 × 16).
		for (const tuplet of measure.tuplets) {
			const sum = measure.entries
				.slice(tuplet.startIndex, tuplet.startIndex + tuplet.count)
				.reduce((s, e) => s + e.durTicks, 0);
			expect(sum).toBe(tuplet.slotTicks * 3);
		}
	});

	it('detects a triplet group after a leading rest', () => {
		// No onset at 0 -> the cursor emits a leading quarter rest (48 ticks),
		// then re-enters the loop at cursor=48 and detects an eighth-triplet
		// group at slots 48, 64, 80. The remaining 96 ticks become a half rest.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 48 / 192 },
			{ noteID: '01', position: 64 / 192 },
			{ noteID: '01', position: 80 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries).toEqual([
			{ kind: 'rest', startTick: 0, durTicks: 48 },
			{ kind: 'note', startTick: 48, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 80, durTicks: 16, keys: ['c/5'] },
			{ kind: 'rest', startTick: 96, durTicks: 96 }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 1,
				count: 3,
				slotTicks: 16
			}
		]);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
	});

	it('does not infer a trailing triplet rest from an isolated 16-tick pair', () => {
		// Onsets at 0 and 16. The 48-group's slots are 0, 16, 32: [T,T,F] with
		// the last slot empty and no observed end, so the guard rejects it — no
		// eighth-triplet-with-trailing-rest is inferred. The 24-group's slots are
		// 0, 8, 16: [T,F,T] with the last slot occupied, which the guard allows,
		// so a 16th-triplet-with-middle-rest IS detected (symmetric with the
		// 48-group's "emits rests inside detected triplet groups" behavior).
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 8
			}
		]);
		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 8, keys: ['c/5'] },
			{ kind: 'rest', startTick: 8, durTicks: 8 },
			{ kind: 'note', startTick: 16, durTicks: 8, keys: ['c/5'] }
		]);
	});

	it('fully consumes an off-grid onset span so entries sum to measureTicks', () => {
		// position 1/11 -> round(192/11) = 17 ticks, which is not a clean
		// binary/triplet boundary. A naive greedy decomposition (12 + 3) drops 2
		// ticks from the leading rest and 1 from the trailing span, leaving gaps.
		// Assert the leftover is absorbed so sum(durTicks) === measureTicks.
		const snare = new LaneMeasureNote(0, '12', [{ noteID: '01', position: 1 / 11 }]);
		const measure = quantizeMeasure(0, [snare]);
		expect(measure.measureTicks).toBe(192);
		const total = measure.entries.reduce((sum, e) => sum + e.durTicks, 0);
		expect(total).toBe(measure.measureTicks);
		// Every entry stays within the measure bounds.
		for (const e of measure.entries) {
			expect(e.startTick).toBeGreaterThanOrEqual(0);
			expect(e.startTick + e.durTicks).toBeLessThanOrEqual(measure.measureTicks);
		}
		// The off-grid position produced a leftover that had to be absorbed, so at
		// least one rest carries a non-standard (non power-of-two) tick count.
		expect(
			measure.entries.some(
				(e) => e.kind === 'rest' && ![192, 96, 48, 24, 12, 6, 3].includes(e.durTicks)
			)
		).toBe(true);
	});

	it('detects a triplet group in a 3/4 measure (96-tick group in 144 ticks)', () => {
		// 3/4 = 0.75 * 192 = 144 ticks. A 96-tick triplet group fits (96 ≤ 144):
		// slots at 0, 32, 64. The remaining 48 ticks become a quarter rest.
		// Positions are fractions of the measure, so 32/144 and 64/144 map to
		// ticks 32 and 64 via round(position * 144).
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 32 / 144 },
			{ noteID: '01', position: 64 / 144 }
		]);
		const measure = quantizeMeasure(0, [snare], 0.75);

		expect(measure.measureTicks).toBe(144);
		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 64, durTicks: 32, keys: ['c/5'] },
			{ kind: 'rest', startTick: 96, durTicks: 48 }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 32
			}
		]);
		// Per-tuplet tick sum: 3 slots × 32 ticks = 96 (the group span).
		const tupletSum = measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0);
		expect(tupletSum).toBe(96);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
	});

	it('detects a triplet group in a 2/4 measure (48-tick group in 96 ticks)', () => {
		// 2/4 = 0.5 * 192 = 96 ticks. A 48-tick triplet group fits (48 ≤ 96):
		// slots at 0, 16, 32. A 96-tick group would also fit (groupEnd=96=
		// measureTicks), but its slots (0, 32, 64) don't match the onsets
		// (0, 16, 32) — 16 is an off-slot onset → rejected. So the 48-tick
		// group is detected. The remaining 48 ticks become a quarter rest.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 96 },
			{ noteID: '01', position: 32 / 96 }
		]);
		const measure = quantizeMeasure(0, [snare], 0.5);

		expect(measure.measureTicks).toBe(96);
		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] },
			{ kind: 'rest', startTick: 48, durTicks: 48 }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
		// Per-tuplet tick sum: 3 slots × 16 ticks = 48 (the group span).
		const tupletSum = measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0);
		expect(tupletSum).toBe(48);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
	});

	it('renders a chord inside a triplet group', () => {
		// Two lanes (hi-hat 11 + snare 12) hitting the same triplet slots
		// should produce chord keys at each slot, not separate entries.
		const hat = new LaneMeasureNote(0, '11', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const measure = quantizeMeasure(0, [hat, snare]);

		// Key order depends on lane processing order (hat 11 before snare 12),
		// so sort before comparing — same pattern as the chord-merge test above.
		const notesWithKeys = measure.entries
			.slice(0, 3)
			.map((e) => (e.kind === 'note' ? { ...e, keys: [...e.keys].sort() } : e));
		expect(notesWithKeys).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 16, keys: ['c/5', 'g/5/x2'] },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5', 'g/5/x2'] },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5', 'g/5/x2'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
		// Per-tuplet tick sum: 3 slots × 16 ticks = 48.
		const tupletSum = measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0);
		expect(tupletSum).toBe(48);
	});

	it('detects a rest-note-note triplet group (slot 0 empty)', () => {
		// Onsets at slots 1 and 2 only (positions 16/192, 32/192). Slot 0
		// has no onset → a rest fills it. occupiedCount=2 with occupiedSlots[2]
		// =true satisfies the detection guard. This verifies the quantizer
		// accepts a triplet whose first slot is a rest.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 16 / 192 },
			{ noteID: '01', position: 32 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries.slice(0, 3)).toEqual([
			{ kind: 'rest', startTick: 0, durTicks: 16 },
			{ kind: 'note', startTick: 16, durTicks: 16, keys: ['c/5'] },
			{ kind: 'note', startTick: 32, durTicks: 16, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 0,
				count: 3,
				slotTicks: 16
			}
		]);
		// Per-tuplet tick sum: rest(16) + note(16) + note(16) = 48.
		const tupletSum = measure.entries.slice(0, 3).reduce((sum, e) => sum + e.durTicks, 0);
		expect(tupletSum).toBe(48);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
	});

	it('detects a 96-tick triplet group at the end of a 4/4 bar', () => {
		// A half note at 0 (96 ticks), then a 96-tick triplet group at
		// cursor=96: slots 96, 128, 160. groupEnd=192=measureTicks so
		// observedEnd=true. The 96-tick group wins over a 48-tick candidate
		// (occupiedCount 3 > 2). This covers the end-of-bar case for the
		// 96-tick group size.
		const snare = new LaneMeasureNote(0, '12', [
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 96 / 192 },
			{ noteID: '01', position: 128 / 192 },
			{ noteID: '01', position: 160 / 192 }
		]);
		const measure = quantizeMeasure(0, [snare]);

		expect(measure.entries).toEqual([
			{ kind: 'note', startTick: 0, durTicks: 96, keys: ['c/5'] },
			{ kind: 'note', startTick: 96, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 128, durTicks: 32, keys: ['c/5'] },
			{ kind: 'note', startTick: 160, durTicks: 32, keys: ['c/5'] }
		]);
		expect(measure.tuplets).toEqual([
			{
				startIndex: 1,
				count: 3,
				slotTicks: 32
			}
		]);
		// Per-tuplet tick sum: 3 slots × 32 ticks = 96 (the group span).
		const tuplet = measure.tuplets[0];
		const tupletSum = measure.entries
			.slice(tuplet.startIndex, tuplet.startIndex + tuplet.count)
			.reduce((sum, e) => sum + e.durTicks, 0);
		expect(tupletSum).toBe(96);
		expect(measure.entries.reduce((sum, e) => sum + e.durTicks, 0)).toBe(measure.measureTicks);
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

	it('groups sparse charts correctly (notes far apart, many empty measures between)', () => {
		// Exercises the O(n) measure-grouping: a note in measure 0 and one in
		// measure 5, with measures 1-4 empty. Each empty measure must still get a
		// full-measure rest, and the two notes must land in their correct measures
		// (not be dropped or mis-attributed by the grouping).
		const dtx = makeDtx(['#00012: 01', '#00512: 01'], 120);
		const { chart, measureCount } = buildNotationChart(dtx);
		expect(measureCount).toBe(6);
		expect(chart.measures).toHaveLength(6);
		// Measures 1-4 are empty -> one full-measure rest each.
		for (const m of [1, 2, 3, 4]) {
			expect(chart.measures[m].entries).toHaveLength(1);
			expect(chart.measures[m].entries[0]).toMatchObject({ kind: 'rest', durTicks: 192 });
		}
		// The two notes land in measures 0 and 5.
		const note0 = chart.measures[0].entries.filter((e) => e.kind === 'note');
		const note5 = chart.measures[5].entries.filter((e) => e.kind === 'note');
		expect(note0).toHaveLength(1);
		expect(note5).toHaveLength(1);
	});

	it('forwards bpm changes on channel 08 into the timing', () => {
		// #BPMAA: 240 defines a bpm change value; #00108: AA triggers it at m1.
		const dtx = makeDtx(['#BPMAA: 240', '#00108: AA'], 120);
		const { timing } = buildNotationChart(dtx);
		// m0 at 120bpm = 2s; m1 switches to 240bpm = 1s -> total 3s.
		expect(timing.measureStartSeconds).toEqual([0, 2]);
		expect(timing.totalDuration).toBe(3);
	});

	it('forwards legacy bpm changes on channel 03 into the timing', () => {
		// Channel 03 noteIDs are direct hex BPM values: 'F0' = 240 bpm.
		// #00103: F0 triggers a tempo change to 240 at the start of m1.
		const dtx = makeDtx(['#00103: F0'], 120);
		const { timing } = buildNotationChart(dtx);
		// m0 at 120bpm = 2s; m1 switches to 240bpm = 1s -> total 3s.
		expect(timing.measureStartSeconds).toEqual([0, 2]);
		expect(timing.totalDuration).toBe(3);
	});

	it('does not schedule channel 03 notes as audio in the notation', () => {
		// Channel 03 is tempo metadata, not a drum lane — it must not produce
		// note entries in the notation (laneToStaff returns undefined for '03').
		const dtx = makeDtx(['#00003: 78', '#00012: 01'], 120);
		const { chart } = buildNotationChart(dtx);
		const notes = chart.measures[0].entries.filter((e) => e.kind === 'note');
		// Only the snare (channel 12) should appear; channel 03 is filtered.
		expect(notes).toHaveLength(1);
	});

	it('defaults bpm to 120 when the dtx has none', () => {
		const dtx = makeDtx(['#00012: 01'], undefined as unknown as number);
		const { timing } = buildNotationChart(dtx);
		expect(timing.totalDuration).toBe(2); // 120 bpm -> 2s/measure
	});

	it('honors channel 02 measure-length changes in timing and notation', () => {
		// #00202: 0.5 -> measure 2 is 2/4 (half length). At 120bpm, a 4/4
		// measure is 2s; a 2/4 measure is 1s. Without channel 02 support,
		// measure 2 would be treated as 4/4 (2s), drifting the preview cursor
		// and scheduled audio from the actual chart.
		const dtx = makeDtx(['#00012: 01', '#00202: 0.5', '#00212: 01'], 120);
		const { chart, timing, measureCount } = buildNotationChart(dtx);
		expect(measureCount).toBe(3);
		// m0: 4/4 = 2s, m1: 4/4 = 2s, m2: 2/4 = 1s -> total 5s
		expect(timing.measureStartSeconds).toEqual([0, 2, 4]);
		expect(timing.totalDuration).toBe(5);
		// Notation: measure 2 has half the ticks (96) and 2 beats
		expect(chart.measures[0].measureTicks).toBe(192);
		expect(chart.measures[0].beatsPerMeasure).toBe(4);
		expect(chart.measures[2].measureTicks).toBe(96);
		expect(chart.measures[2].beatsPerMeasure).toBe(2);
	});

	it('channel 02 measure-length changes are sticky until the next change', () => {
		// In DTX (unlike BMS), a bar-length change persists for all subsequent
		// measures until another channel 02 line appears. #00102: 0.5 sets m1
		// to 2/4, and m2 stays 2/4. #00302: 1 restores 4/4 for m3+.
		const dtx = makeDtx(['#00012: 01', '#00102: 0.5', '#00302: 1', '#00412: 01'], 120);
		const { chart, timing, measureCount } = buildNotationChart(dtx);
		expect(measureCount).toBe(5);
		// m0: 4/4=2s, m1: 2/4=1s, m2: 2/4=1s, m3: 4/4=2s, m4: 4/4=2s
		expect(timing.measureStartSeconds).toEqual([0, 2, 3, 4, 6]);
		expect(timing.totalDuration).toBe(8);
		expect(chart.measures[1].measureTicks).toBe(96);
		expect(chart.measures[2].measureTicks).toBe(96);
		expect(chart.measures[3].measureTicks).toBe(192);
	});

	it('defaults all measures to 4/4 when no channel 02 lines are present', () => {
		// Backward compat: charts without channel 02 must behave exactly as
		// before — every measure is 4/4 (length 1).
		const dtx = makeDtx(['#00012: 01', '#00112: 01'], 120);
		const { chart, timing } = buildNotationChart(dtx);
		expect(timing.measureStartSeconds).toEqual([0, 2]);
		expect(timing.totalDuration).toBe(4);
		expect(chart.measures.every((m) => m.measureTicks === 192)).toBe(true);
	});
});
