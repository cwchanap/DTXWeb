// Reexport your entry components here
export { SimFile } from './chart/simFile';
export { DTXFile, SoundChip } from './chart/dtx';
export { LaneMeasureNote } from './chart/note';
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding,
	type ContentValidationCallback
} from './chart/encoding-utils';

// Export utilities
export { normalizePosition } from './utils/position';

// Export constants
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

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
} from './types/supabase.types';

// Export game classes
export { EventBus } from './game/EventBus';
export { default as EventType } from './game/EventType';
export { Editor } from './game/scenes/Editor';
export { Preview } from './game/scenes/Preview';
export { MainMenu } from './game/scenes/MainMenu';
export { Preloader } from './game/Preload';
export type { LaneConfig } from './game/interface';

// Export store
export { default as store } from './store';

// Export file provider interface (implementations stay in respective packages)
export type { IFileProvider } from './services/fileProvider';
export { setFileProvider, getFileProvider } from './services/fileProvider';
