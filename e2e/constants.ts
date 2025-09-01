export const BASE_URL = 'http://localhost:5174';

export const PAGES = {
	BLOG: `${BASE_URL}/blog`,
	EDITOR: `${BASE_URL}/editor`,
	EDITOR_WITH_SIMFILE: (simfileId: string) => `${BASE_URL}/editor/${simfileId}`,
	TOOLS: `${BASE_URL}/tool`,
	MIDI_PREVIEW: `${BASE_URL}/tool/midi-preview`,
	DTX_CONVERTER: `${BASE_URL}/tool/converter`,
	MIDI_TO_DTX_CONVERTER: `${BASE_URL}/tool/midi-to-dtx`
} as const;
