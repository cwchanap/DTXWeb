/** A drum piece's position on the 5-line drum staff. */
export interface DrumStaff {
	/** Staff step letter A-G (uppercase); MusicXML <display-step>. */
	step: string;
	/** Staff octave; MusicXML <display-octave>. */
	octave: number;
	/** MusicXML <notehead> for non-standard glyphs: 'x' (cymbals/closed hats),
	 * 'circle-x' (open hi-hat). Undefined for a normal notehead. */
	notehead?: 'x' | 'circle-x';
	/** Short display name (matches the in-game lane label). */
	name: string;
	midi: number;
	instrumentName: string;
}

/**
 * The lane's VexFlow key, e.g. 'c/5' (normal notehead) or 'g/5/x2' (x
 * notehead). The suffix selects the notehead glyph: '/x2' -> plain x,
 * '/x3' -> circled x. Derived from the staff position so renderer-specific
 * key strings stay out of the model.
 */
export const staffKey = (staff: DrumStaff): string => {
	const suffix = staff.notehead === 'x' ? '/x2' : staff.notehead === 'circle-x' ? '/x3' : '';
	return `${staff.step.toLowerCase()}/${staff.octave}${suffix}`;
};

/**
 * DTX drum lane id -> drum-staff position + notehead.
 */
const LANE_TO_STAFF: Record<string, DrumStaff> = {
	'13': { step: 'F', octave: 4, name: 'BD', midi: 36, instrumentName: 'Bass' }, // bass drum
	'1C': { step: 'F', octave: 4, name: 'LB', midi: 35, instrumentName: 'Left Bass' }, // left bass (double pedal) -> same line as BD
	'12': { step: 'C', octave: 5, name: 'SN', midi: 38, instrumentName: 'Snare' }, // snare
	'14': { step: 'E', octave: 5, name: 'HT', midi: 50, instrumentName: 'High Tom' }, // high tom
	'15': { step: 'D', octave: 5, name: 'LT', midi: 48, instrumentName: 'Low Tom' }, // low/mid tom
	'17': { step: 'A', octave: 4, name: 'FT', midi: 43, instrumentName: 'Floor Tom' }, // floor tom
	'11': {
		step: 'G',
		octave: 5,
		notehead: 'x',
		name: 'HHC',
		midi: 42,
		instrumentName: 'Closed Hi-Hat'
	}, // closed hi-hat
	'18': {
		step: 'G',
		octave: 5,
		notehead: 'circle-x',
		name: 'HH',
		midi: 46,
		instrumentName: 'Open Hi-Hat'
	}, // open hi-hat (circled-x)
	'1B': {
		step: 'D',
		octave: 4,
		notehead: 'x',
		name: 'LP',
		midi: 44,
		instrumentName: 'Pedal Hi-Hat'
	}, // pedal hi-hat (foot)
	'16': { step: 'A', octave: 5, notehead: 'x', name: 'CY', midi: 49, instrumentName: 'Crash' }, // crash
	'1A': {
		step: 'B',
		octave: 5,
		notehead: 'x',
		name: 'LC',
		midi: 57,
		instrumentName: 'Left Crash'
	}, // left crash / china
	'19': { step: 'F', octave: 5, notehead: 'x', name: 'RD', midi: 51, instrumentName: 'Ride' } // ride
};

export const PLAYABLE_DRUM_LANES: string[] = Object.keys(LANE_TO_STAFF);

export const laneToStaff = (laneId: string): DrumStaff | undefined =>
	LANE_TO_STAFF[laneId.toUpperCase()];
