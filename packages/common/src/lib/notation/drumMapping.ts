/** A drum piece's position on the 5-line drum staff, as a VexFlow key. */
export interface DrumStaff {
	/** VexFlow key, e.g. 'c/5' (normal notehead) or 'g/5/x2' (x notehead). */
	key: string;
	/** Short display name (matches the in-game lane label). */
	name: string;
}

/**
 * DTX drum lane id -> drum-staff position + notehead.
 * Key suffix selects the notehead glyph: '/x2' -> plain x (cymbals / closed hi-hat),
 * '/x3' -> circled x (open hi-hat).
 */
const LANE_TO_STAFF: Record<string, DrumStaff> = {
	'13': { key: 'f/4', name: 'BD' }, // bass drum
	'1C': { key: 'f/4', name: 'LB' }, // left bass (double pedal) -> same line as BD
	'12': { key: 'c/5', name: 'SN' }, // snare
	'14': { key: 'e/5', name: 'HT' }, // high tom
	'15': { key: 'd/5', name: 'LT' }, // low/mid tom
	'17': { key: 'a/4', name: 'FT' }, // floor tom
	'11': { key: 'g/5/x2', name: 'HHC' }, // closed hi-hat
	'18': { key: 'g/5/x3', name: 'HH' }, // open hi-hat (circled-x)
	'1B': { key: 'd/4/x2', name: 'LP' }, // pedal hi-hat (foot)
	'16': { key: 'a/5/x2', name: 'CY' }, // crash
	'1A': { key: 'b/5/x2', name: 'LC' }, // left crash / china
	'19': { key: 'f/5/x2', name: 'RD' } // ride
};

export const PLAYABLE_DRUM_LANES: string[] = Object.keys(LANE_TO_STAFF);

export const laneToStaff = (laneId: string): DrumStaff | undefined =>
	LANE_TO_STAFF[laneId.toUpperCase()];
