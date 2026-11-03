import { describe, it, expect } from 'vitest';
import { laneToStaff, PLAYABLE_DRUM_LANES } from './drumMapping';

describe('laneToStaff', () => {
	it('maps snare to a normal notehead on c/5', () => {
		expect(laneToStaff('12')).toEqual({
			key: 'c/5',
			name: 'SN',
			midi: 38,
			instrumentName: 'Snare'
		});
	});

	it('maps closed hi-hat to an x notehead on g/5', () => {
		expect(laneToStaff('11')).toEqual({
			key: 'g/5/x2',
			name: 'HHC',
			midi: 42,
			instrumentName: 'Closed Hi-Hat'
		});
	});

	it('maps open hi-hat to a circled-x notehead on g/5 (distinct from closed)', () => {
		// /x3 suffix -> VexFlow noteheadCircleX; /x2 (closed) -> noteheadXBlack.
		expect(laneToStaff('18')).toEqual({
			key: 'g/5/x3',
			name: 'HH',
			midi: 46,
			instrumentName: 'Open Hi-Hat'
		});
	});

	it('maps both bass-drum lanes (13, 1C) to f/4 with distinct GM pitches', () => {
		expect(laneToStaff('13')?.key).toBe('f/4');
		expect(laneToStaff('1C')?.key).toBe('f/4');
		expect(laneToStaff('13')?.midi).toBe(36);
		expect(laneToStaff('1C')?.midi).toBe(35);
	});

	it('is case-insensitive on the lane id', () => {
		expect(laneToStaff('1c')?.key).toBe('f/4');
	});

	it('returns undefined for unknown / non-playable lanes', () => {
		expect(laneToStaff('08')).toBeUndefined();
		expect(laneToStaff('zz')).toBeUndefined();
	});

	it('exposes the GM pitch and MusicXML instrument name for every playable lane', () => {
		const expected: Record<string, { midi: number; instrumentName: string }> = {
			'11': { midi: 42, instrumentName: 'Closed Hi-Hat' },
			'18': { midi: 46, instrumentName: 'Open Hi-Hat' },
			'1B': { midi: 44, instrumentName: 'Pedal Hi-Hat' },
			'12': { midi: 38, instrumentName: 'Snare' },
			'13': { midi: 36, instrumentName: 'Bass' },
			'1C': { midi: 35, instrumentName: 'Left Bass' },
			'14': { midi: 50, instrumentName: 'High Tom' },
			'15': { midi: 48, instrumentName: 'Low Tom' },
			'17': { midi: 43, instrumentName: 'Floor Tom' },
			'16': { midi: 49, instrumentName: 'Crash' },
			'1A': { midi: 57, instrumentName: 'Left Crash' },
			'19': { midi: 51, instrumentName: 'Ride' }
		};
		for (const lane of PLAYABLE_DRUM_LANES) {
			expect(laneToStaff(lane)).toMatchObject(expected[lane]);
		}
		expect(Object.keys(expected)).toHaveLength(PLAYABLE_DRUM_LANES.length);
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
