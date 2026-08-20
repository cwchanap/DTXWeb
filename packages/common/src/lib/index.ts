// Reexport your entry components here
export { SimFile } from './chart/simFile';
export { DTXFile, SoundChip } from './chart/dtx';
export { LaneMeasureNote } from './chart/note';
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding
} from './chart/encoding-utils';

// Export utilities
export { normalizePosition } from './utils/position';
export { formatLevel, normalizeLevel } from './utils/level';

// Export constants
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

// Export current simfile model (D1 row types stay server-only under '@dtx/common/server')
export type { SimfileModel, SimfileDtxFile, SimfileAssetFile } from './types/simfile';

// Game classes are exported in './game' to avoid SSR issues with Phaser
// Import from '@dtx/common/game' instead of '@dtx/common' for game classes

// Export store
export { default as store } from './store';

// Export file provider interface (implementations stay in respective packages)
export type { IFileProvider } from './services/fileProvider';
export { setFileProvider, getFileProvider } from './services/fileProvider';

// Notation model (pure; safe for SSR — no Phaser/Svelte)
export { laneToStaff, PLAYABLE_DRUM_LANES, type DrumStaff } from './notation/drumMapping';
export {
	TICKS_PER_WHOLE,
	type NotationNoteEntry,
	type NotationRestEntry,
	type NotationEntry,
	type NotationTuplet,
	type NotationMeasure,
	type NotationChart
} from './notation/model';
export { buildChartTiming, type ChartTiming, type TimingInput } from './notation/timing';
export {
	ticksToDurations,
	quantizeMeasure,
	groupNotesByLane,
	buildNotationChart
} from './notation/quantize';

// PreviewAudioEngine lives in the `./audio` subpath export to keep the main
// barrel free of browser-only audio modules. Re-exporting it here would pull
// `audioDecoder` (and its top-level `new XAAudioContext()`) into every page
// that imports anything from `@dtx/common`, constructing an AudioContext before
// the user reaches a preview/gameplay route. Import from `@dtx/common/audio`.
