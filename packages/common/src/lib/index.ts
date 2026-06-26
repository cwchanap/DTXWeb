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

// Export constants
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

// Export Supabase types (for backward compatibility with auth)
export type { Database } from './types/supabase.types';

// Export D1 types
export type {
	SimfileRow,
	SimfileInsert,
	SimfileUpdate,
	DtxFileRow,
	DtxFileInsert,
	UserProfileRow,
	UserProfileInsert,
	UserProfileUpdate,
	SimfileWithDtxFiles,
	SimfileWithDtx
} from './types/d1.types';
export { toSimfileWithDtx } from './types/d1.types';

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
