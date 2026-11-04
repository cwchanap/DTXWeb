import { describe, it, expect } from 'vitest';
import { laneToStaff, staffKey, PLAYABLE_DRUM_LANES } from './drumMapping';

describe('laneToStaff', () => {
	it('maps snare to a normal notehead on C5', () => {
		expect(laneToStaff('12')).toEqual({
			step: 'C',
			octave: 5,
			name: 'SN',
			midi: 38,
			instrumentName: 'Snare'
		});
	});

	it('maps closed hi-hat to an x notehead on G5', () => {
		expect(laneToStaff('11')).toEqual({
			step: 'G',
			octave: 5,
			notehead: 'x',
			name: 'HHC',
			midi: 42,
			instrumentName: 'Closed Hi-Hat'
		});
	});

	it('maps open hi-hat to a circled-x notehead on G5 (distinct from closed)', () => {
		expect(laneToStaff('18')).toEqual({
			step: 'G',
			octave: 5,
			notehead: 'circle-x',
			name: 'HH',
			midi: 46,
			instrumentName: 'Open Hi-Hat'
		});
	});

	it('maps both bass-drum lanes (13, 1C) to F4 with distinct GM pitches', () => {
		expect(laneToStaff('13')).toMatchObject({ step: 'F', octave: 4, midi: 36 });
		expect(laneToStaff('1C')).toMatchObject({ step: 'F', octave: 4, midi: 35 });
	});

	it('is case-insensitive on the lane id', () => {
		expect(laneToStaff('1c')).toMatchObject({ step: 'F', octave: 4 });
	});

	it('returns undefined for unknown / non-playable lanes', () => {
		expect(laneToStaff('08')).toBeUndefined();
		expect(laneToStaff('zz')).toBeUndefined();
	});
});

describe('staffKey', () => {
	it('derives VexFlow keys from the staff position and notehead', () => {
		// The '/x2' suffix selects VexFlow's x notehead; '/x3' the circled-x used
		// for open hi-hat; a normal head carries no suffix.
		expect(staffKey(laneToStaff('12')!)).toBe('c/5');
		expect(staffKey(laneToStaff('11')!)).toBe('g/5/x2');
		expect(staffKey(laneToStaff('18')!)).toBe('g/5/x3');
	});
});

describe('PLAYABLE_DRUM_LANES', () => {
	it('lists exactly the playable drum lanes', () => {
		expect(PLAYABLE_DRUM_LANES).toEqual(
			expect.arrayContaining([
				'11',
				'12',
				'13',
				'14',
				'15',
				'16',
				'17',
				'18',
				'19',
				'1A',
				'1B',
				'1C'
			])
		);
		expect(PLAYABLE_DRUM_LANES).toHaveLength(12);
		expect(PLAYABLE_DRUM_LANES).not.toContain('01');
		expect(PLAYABLE_DRUM_LANES).not.toContain('08');
	});
});
