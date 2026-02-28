// Export server-only utilities that require Node.js environment

// Export server-safe chart classes (no browser/game dependencies)
export { DTXFile, SoundChip } from './chart/dtx';
export { SimFile } from './chart/simFile';
export { LaneMeasureNote } from './chart/note';
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding
} from './chart/encoding-utils';

// Export constants (server-safe)
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

// Export server-safe types
export type {
	Database,
	Tables,
	TablesInsert,
	TablesUpdate,
	Enums,
	CompositeTypes,
	DtxFile,
	SimfileWithDtx
} from './types/supabase.types';

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
	SimfileWithDtxFiles
} from './types/d1.types';
export { toSimfileWithDtx } from './types/d1.types';
