/** A drum piece's position on the 5-line drum staff, as a VexFlow key. */
export interface DrumStaff {
	/** VexFlow key, e.g. 'c/5' (normal notehead) or 'g/5/x2' (x notehead). */
	key: string;
	/** Short display name (matches the in-game lane label). */
	name: string;
	/** General MIDI drum pitch (e.g. 36 = bass drum). */
	midi: number;
	/** Full instrument name for MusicXML export. */
	instrumentName: string;
}

/**
 * DTX drum lane id -> drum-staff position + notehead.
 * Key suffix selects the notehead glyph: '/x2' -> plain x (cymbals / closed hi-hat),
 * '/x3' -> circled x (open hi-hat).
 */
const LANE_TO_STAFF: Record<string, DrumStaff> = {
	'13': { key: 'f/4', name: 'BD', midi: 36, instrumentName: 'Bass' }, // bass drum
	'1C': { key: 'f/4', name: 'LB', midi: 35, instrumentName: 'Left Bass' }, // left bass (double pedal) -> same line as BD
	'12': { key: 'c/5', name: 'SN', midi: 38, instrumentName: 'Snare' }, // snare
	'14': { key: 'e/5', name: 'HT', midi: 50, instrumentName: 'High Tom' }, // high tom
	'15': { key: 'd/5', name: 'LT', midi: 48, instrumentName: 'Low Tom' }, // low/mid tom
	'17': { key: 'a/4', name: 'FT', midi: 43, instrumentName: 'Floor Tom' }, // floor tom
	'11': { key: 'g/5/x2', name: 'HHC', midi: 42, instrumentName: 'Closed Hi-Hat' }, // closed hi-hat
	'18': { key: 'g/5/x3', name: 'HH', midi: 46, instrumentName: 'Open Hi-Hat' }, // open hi-hat (circled-x)
	'1B': { key: 'd/4/x2', name: 'LP', midi: 44, instrumentName: 'Pedal Hi-Hat' }, // pedal hi-hat (foot)
	'16': { key: 'a/5/x2', name: 'CY', midi: 49, instrumentName: 'Crash' }, // crash
	'1A': { key: 'b/5/x2', name: 'LC', midi: 57, instrumentName: 'Left Crash' }, // left crash / china
	'19': { key: 'f/5/x2', name: 'RD', midi: 51, instrumentName: 'Ride' } // ride
};

export const PLAYABLE_DRUM_LANES: string[] = Object.keys(LANE_TO_STAFF);

export const laneToStaff = (laneId: string): DrumStaff | undefined =>
	LANE_TO_STAFF[laneId.toUpperCase()];
