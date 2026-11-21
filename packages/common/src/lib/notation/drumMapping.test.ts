import { describe, it, expect } from 'vitest';
import { laneToStaff, staffKey, PLAYABLE_DRUM_LANES, GM_IMPORT_LANE } from './drumMapping';

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

	it('exports each of the 12 playable lanes at its canonical GM note', () => {
		const expected: Record<string, number> = {
			'11': 42, // closed hi-hat
			'12': 38, // snare
			'13': 36, // bass drum
			'14': 50, // high tom
			'15': 48, // low tom
			'16': 49, // crash
			'17': 43, // floor tom
			'18': 46, // open hi-hat
			'19': 51, // ride
			'1A': 57, // left crash
			'1B': 44, // pedal hi-hat
			'1C': 35 // left bass
		};
		for (const [lane, midi] of Object.entries(expected)) {
			expect(laneToStaff(lane)?.midi).toBe(midi);
		}
	});
});

describe('GM_IMPORT_LANE', () => {
	it('routes both GM kick notes to the main bass lane by default', () => {
		// 35 (acoustic bass drum) imports to '13', not the '1C' left-bass lane it
		// exports from — the importer prefers the common single-pedal lane.
		expect(GM_IMPORT_LANE[35]).toBe('13');
		expect(GM_IMPORT_LANE[36]).toBe('13');
	});

	it('aliases rim and alternate snare notes to the snare lane', () => {
		expect(GM_IMPORT_LANE[37]).toBe('12'); // side stick
		expect(GM_IMPORT_LANE[38]).toBe('12'); // acoustic snare
		expect(GM_IMPORT_LANE[40]).toBe('12'); // electric snare
	});

	it('aliases alternate toms to the nearest canonical tom lane', () => {
		expect(GM_IMPORT_LANE[41]).toBe('17'); // low floor tom
		expect(GM_IMPORT_LANE[43]).toBe('17'); // high floor tom
		expect(GM_IMPORT_LANE[45]).toBe('15'); // low tom
		expect(GM_IMPORT_LANE[47]).toBe('15'); // low-mid tom
		expect(GM_IMPORT_LANE[48]).toBe('15'); // hi-mid tom
		expect(GM_IMPORT_LANE[50]).toBe('14'); // high tom
	});

	it('keeps the hi-hat family on closed / pedal / open lanes', () => {
		expect(GM_IMPORT_LANE[42]).toBe('11');
		expect(GM_IMPORT_LANE[44]).toBe('1B');
		expect(GM_IMPORT_LANE[46]).toBe('18');
	});

	it('aliases cymbal variants to crash / ride / left-crash lanes', () => {
		expect(GM_IMPORT_LANE[49]).toBe('16'); // crash
		expect(GM_IMPORT_LANE[51]).toBe('19'); // ride
		expect(GM_IMPORT_LANE[52]).toBe('1A'); // chinese cymbal -> left crash
		expect(GM_IMPORT_LANE[53]).toBe('19'); // ride bell
		expect(GM_IMPORT_LANE[55]).toBe('16'); // splash cymbal
		expect(GM_IMPORT_LANE[57]).toBe('1A'); // crash 2
		expect(GM_IMPORT_LANE[59]).toBe('19'); // ride 2
	});

	it('only targets playable drum lanes, never control channels', () => {
		const playable = new Set(PLAYABLE_DRUM_LANES);
		expect(Object.keys(GM_IMPORT_LANE).length).toBeGreaterThan(0);
		for (const lane of Object.values(GM_IMPORT_LANE)) {
			expect(playable.has(lane)).toBe(true);
		}
	});

	it('leaves unmapped GM notes undefined so importers can report diagnostics', () => {
		expect(GM_IMPORT_LANE[39]).toBeUndefined(); // hand clap
		expect(GM_IMPORT_LANE[60]).toBeUndefined(); // middle C
	});
});
