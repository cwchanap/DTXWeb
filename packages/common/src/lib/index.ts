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

// Export game types and utilities (non-Phaser dependent)
export type { LaneConfig } from './game/interface.js';
export { AssetName } from './game/interface.js';
export {
	calculateHighResolutionPosition,
	HIGH_RESOLUTION_CELLS
} from './game/utils/notePositioning.js';

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
