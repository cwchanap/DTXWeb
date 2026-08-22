import { describe, it, expect, vi } from 'vitest';
import { PreviewCalculations, generateDataHash } from './previewCalculations';
import type { LaneMeasureNote } from '../../chart/note';

type Notes = Record<string, LaneMeasureNote[]>;

const makeCalculations = (
	overrides: Partial<Parameters<typeof PreviewCalculations.prototype.update>[0]> & {
		cellHeight?: number;
		cellsPerMeasure?: number;
	} = {}
) => {
	return new PreviewCalculations({
		bpm: 120,
		notes: {},
		bpmNotes: {},
		measureCount: 5,
		measureLength: [],
		cellHeight: 50,
		cellsPerMeasure: 16,
		...overrides
	});
};

describe('generateDataHash', () => {
	it('produces the same hash for identical input', () => {
		const input = { bpm: 120, measureCount: 5, measureLength: [1, 1], bpmNotes: { '08': 120 } };
		expect(generateDataHash(input)).toBe(generateDataHash({ ...input }));
	});

	it('produces a different hash when bpm changes', () => {
		const base = { bpm: 120, measureCount: 5, measureLength: [], bpmNotes: {} };
		expect(generateDataHash(base)).not.toBe(generateDataHash({ ...base, bpm: 240 }));
	});

	it('produces a different hash when measureCount changes', () => {
		const base = { bpm: 120, measureCount: 5, measureLength: [], bpmNotes: {} };
		expect(generateDataHash(base)).not.toBe(generateDataHash({ ...base, measureCount: 6 }));
	});

	it('produces a different hash when measureLength changes', () => {
		const base = { bpm: 120, measureCount: 5, measureLength: [1], bpmNotes: {} };
		expect(generateDataHash(base)).not.toBe(generateDataHash({ ...base, measureLength: [2] }));
	});

	it('produces a different hash when bpmNotes changes', () => {
		const base = { bpm: 120, measureCount: 5, measureLength: [], bpmNotes: {} };
		expect(generateDataHash(base)).not.toBe(
			generateDataHash({ ...base, bpmNotes: { '08': 100 } })
		);
	});
});

describe('PreviewCalculations.getTimeElapsed', () => {
	it('returns 0 for measure 0 with no note offset', () => {
		const calc = makeCalculations();
		expect(calc.getTimeElapsed(0)).toBe(0);
	});

	it('calculates time for a single measure at 120 BPM (2 seconds)', () => {
		const calc = makeCalculations();
		expect(calc.getTimeElapsed(1)).toBeCloseTo(2, 5);
	});

	it('calculates time for multiple measures', () => {
		const calc = makeCalculations();
		expect(calc.getTimeElapsed(3)).toBeCloseTo(6, 5);
	});

	it('caches results and does not recompute on repeated calls', () => {
		const calc = makeCalculations();
		const first = calc.getTimeElapsed(2);
		const cache = (calc as any)['timeElapsedCache'] as Map<number, number>;
		expect(cache.has(2)).toBe(true);
		const cacheSizeAfterFirst = cache.size;
		const second = calc.getTimeElapsed(2);
		expect(second).toBe(first);
		expect(cache.size).toBe(cacheSizeAfterFirst);
	});

	it('calculates in-measure time when noteChipPosition is provided', () => {
		const calc = makeCalculations();
		expect(calc.getTimeElapsed(0, 0.5)).toBeCloseTo(1, 5);
	});

	it('does not read or write the cache when noteChipPosition is non-zero', () => {
		const calc = makeCalculations();
		calc.getTimeElapsed(0);
		const cache = (calc as any)['timeElapsedCache'] as Map<number, number>;
		const getSpy = vi.spyOn(cache, 'get');
		const setSpy = vi.spyOn(cache, 'set');

		calc.getTimeElapsed(0, 0.25);

		expect(getSpy).not.toHaveBeenCalled();
		expect(setSpy).not.toHaveBeenCalled();
	});

	it('handles BPM changes within a measure via bpmNotes', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm150', position: 0.5 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: { bpm150: 150 } });
		const elapsed = calc.getTimeElapsed(1);
		expect(elapsed).toBeCloseTo(1.8, 5);
	});

	it('mutates a bpmNote measureLength of 1 in place to the real measure length', () => {
		const bpmNote = {
			measure: 0,
			measureLength: 1,
			notes: [{ noteID: 'bpm150', position: 0.5 }]
		} as unknown as LaneMeasureNote;
		const notes: Notes = { '08': [bpmNote] };
		const calc = makeCalculations({
			notes,
			bpmNotes: { bpm150: 150 },
			measureLength: [3]
		});

		calc.getTimeElapsed(1);

		expect(bpmNote.measureLength).toBe(3);
	});

	it('does not overwrite an already-set (non-1) bpmNote measureLength', () => {
		const bpmNote = {
			measure: 0,
			measureLength: 7,
			notes: [{ noteID: 'bpm150', position: 0.5 }]
		} as unknown as LaneMeasureNote;
		const notes: Notes = { '08': [bpmNote] };
		const calc = makeCalculations({
			notes,
			bpmNotes: { bpm150: 150 },
			measureLength: [3]
		});

		calc.getTimeElapsed(1);

		expect(bpmNote.measureLength).toBe(7);
	});

	it('skips noteID 00 when calculating in-measure time up to noteChipPosition', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: '00', position: 0.25 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: {} });
		const elapsed = calc.getTimeElapsed(0, 0.5);
		expect(elapsed).toBeCloseTo(1.0, 5);
	});

	it('invalidates cache and recomputes when update() is called with new data', () => {
		const calc = makeCalculations();
		const originalTime = calc.getTimeElapsed(1);

		calc.update({
			bpm: 240,
			notes: {},
			bpmNotes: {},
			measureCount: 5,
			measureLength: []
		});

		const newTime = calc.getTimeElapsed(1);
		expect(newTime).toBeCloseTo(originalTime / 2, 5);
	});
});

describe('PreviewCalculations.getCellHeight', () => {
	it('returns scaled cellHeight when no bpm notes exist', () => {
		const calc = makeCalculations();
		expect(calc.getCellHeight(0, 0)).toBeCloseTo(50, 5);
	});

	it('returns half cellHeight at double BPM', () => {
		const calc = makeCalculations({ bpm: 240 });
		expect(calc.getCellHeight(0, 0)).toBeCloseTo(50 * 0.5, 5);
	});

	it('uses bpm from a previous measure bpm note', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm200', position: 0 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: { bpm200: 200 } });
		const result = calc.getCellHeight(1, 0);
		expect(result).toBeCloseTo(50 * (120 / 200), 5);
	});

	it('uses bpm from a current measure bpm note before the current cell', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm180', position: 0.25 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: { bpm180: 180 } });
		const cellsPerMeasure = 16;
		const cellAfterChange = Math.floor(0.5 * cellsPerMeasure);
		const result = calc.getCellHeight(0, cellAfterChange);
		expect(result).toBeCloseTo(50 * (120 / 180), 5);
	});

	it('does not apply a BPM change that occurs after the current cell', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm240', position: 0.75 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: { bpm240: 240 } });
		const cellsPerMeasure = 16;
		const cellBeforeChange = Math.floor(0.25 * cellsPerMeasure);
		const result = calc.getCellHeight(0, cellBeforeChange);
		expect(result).toBeCloseTo(50, 5);
	});

	it('handles two BPM notes sharing the same measure (sort comparator returns 0)', () => {
		const notes: Notes = {
			'08': [
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm150', position: 0.1 }]
				} as unknown as LaneMeasureNote,
				{
					measure: 0,
					measureLength: 1,
					notes: [{ noteID: 'bpm160', position: 0.9 }]
				} as unknown as LaneMeasureNote
			]
		};
		const calc = makeCalculations({ notes, bpmNotes: { bpm150: 150, bpm160: 160 } });
		expect(() => calc.getCellHeight(0, 15)).not.toThrow();
	});
});

describe('PreviewCalculations.getCachedMeasureOffset', () => {
	it('caches the result and only invokes compute once for the same measure', () => {
		const calc = makeCalculations();
		const compute = vi.fn().mockReturnValue(42);

		const first = calc.getCachedMeasureOffset(2, compute);
		const second = calc.getCachedMeasureOffset(2, compute);

		expect(first).toBe(42);
		expect(second).toBe(42);
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it('invokes compute again for a different measure', () => {
		const calc = makeCalculations();
		const compute = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2);

		expect(calc.getCachedMeasureOffset(1, compute)).toBe(1);
		expect(calc.getCachedMeasureOffset(2, compute)).toBe(2);
		expect(compute).toHaveBeenCalledTimes(2);
	});
});

describe('PreviewCalculations cache management', () => {
	it('validateCache updates lastDataHash and calculationsValid', () => {
		const calc = makeCalculations();
		expect((calc as any)['lastDataHash']).toBe('');

		(calc as any)['validateCache']();

		expect((calc as any)['lastDataHash']).not.toBe('');
		expect((calc as any)['calculationsValid']).toBe(true);
	});

	it('invalidate resets calculationsValid and lastDataHash', () => {
		const calc = makeCalculations();
		(calc as any)['validateCache']();
		expect((calc as any)['calculationsValid']).toBe(true);

		calc.invalidate();

		expect((calc as any)['calculationsValid']).toBe(false);
		expect((calc as any)['lastDataHash']).toBe('');
	});

	it('re-invalidates cache when data hash changes via update()', () => {
		const calc = makeCalculations();
		(calc as any)['validateCache']();
		const firstHash = (calc as any)['lastDataHash'];

		calc.update({ bpm: 200, notes: {}, bpmNotes: {}, measureCount: 5, measureLength: [] });
		(calc as any)['validateCache']();
		const secondHash = (calc as any)['lastDataHash'];

		expect(firstHash).not.toBe(secondHash);
	});
});
