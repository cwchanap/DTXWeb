// Reexport your entry components here
export { SimFile } from './chart/simFile.js';
export { DTXFile, SoundChip } from './chart/dtx.js';
export { LaneMeasureNote } from './chart/note.js';
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding,
	type ContentValidationCallback
} from './chart/encoding-utils.js';

// Export utilities
export { normalizePosition } from './utils/position.js';

// Export constants
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants.js';

// Export Supabase types
export type {
	Database,
	Tables,
	TablesInsert,
	TablesUpdate,
	Enums,
	CompositeTypes,
	DtxFile,
	SimfileWithDtx
} from './types/supabase.types.js';

// Export game classes
export { EventBus } from './game/EventBus.js';
export { default as EventType } from './game/EventType.js';
export { Editor } from './game/scenes/Editor.js';
export { Preview } from './game/scenes/Preview.js';
export { MainMenu } from './game/scenes/MainMenu.js';
export { Preloader } from './game/Preload.js';
export type { LaneConfig } from './game/interface.js';
