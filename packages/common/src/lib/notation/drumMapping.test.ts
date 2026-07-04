import { describe, it, expect } from 'vitest';
import { laneToStaff, PLAYABLE_DRUM_LANES } from './drumMapping';

describe('laneToStaff', () => {
	it('maps snare to a normal notehead on c/5', () => {
		expect(laneToStaff('12')).toEqual({ key: 'c/5', name: 'SN' });
	});

	it('maps closed hi-hat to an x notehead on g/5', () => {
		expect(laneToStaff('11')).toEqual({ key: 'g/5/x2', name: 'HHC' });
	});

	it('maps open hi-hat to a circled-x notehead on g/5 (distinct from closed)', () => {
		// /x3 suffix -> VexFlow noteheadCircleX; /x2 (closed) -> noteheadXBlack.
		expect(laneToStaff('18')).toEqual({ key: 'g/5/x3', name: 'HH' });
	});

	it('maps both bass-drum lanes (13, 1C) to f/4', () => {
		expect(laneToStaff('13')?.key).toBe('f/4');
		expect(laneToStaff('1C')?.key).toBe('f/4');
	});

	it('is case-insensitive on the lane id', () => {
		expect(laneToStaff('1c')?.key).toBe('f/4');
	});

	it('returns undefined for unknown / non-playable lanes', () => {
		expect(laneToStaff('08')).toBeUndefined();
		expect(laneToStaff('zz')).toBeUndefined();
	});

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
