// Export server-only utilities that require Node.js environment

// Export server-safe chart classes (no browser/game dependencies)
export { DTXFile, SoundChip } from './chart/dtx';
export { SimFile } from './chart/simFile';
export { LaneMeasureNote } from './chart/note';
export {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding,
	decodeArrayBufferWithBomDetection
} from './chart/encoding-utils';

// Export constants (server-safe)
export { VALID_DTX_FILE_EXTENSIONS, isValidDtxFileExtension, isValidDtxFile } from './constants';

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
	SimfileWithDtx,
	ChartScoreRow,
	ChartScoreInsert,
	ScoreRow,
	ScoreInsert
} from './types/d1.types';
export { toSimfileWithDtx } from './types/d1.types';

// Shared logging utility
export { default as logger } from './server/logger';

// Rate limiting utilities
export { getClientIp, tryConsumeRateLimit, type RateLimitResult } from './server/rateLimiter';

// R2 storage utilities
export { isPreviewKey, listAllR2Objects, type R2ObjectMeta } from './server/r2';

// ZIP streaming utilities
export {
	buildZipStream,
	createZipSources,
	validateZipSources,
	type ZipEntry,
	type ZipSource
} from './server/zipBuilder';

// Drizzle schema
export { simfiles, dtxFiles, userProfiles, chartScores, scores } from './server/db/schema';

// D1 queries + mock factory
export {
	createDrizzleDb,
	createMockD1Database,
	escapeLikePattern,
	getSimfile,
	getSimfileOwner,
	getChartVisibility,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile,
	upsertChartScoreAndReplaceScores,
	getUserChartScore,
	listUserScoredSimfiles,
	listUserChartScores,
	type ListSimfilesOptions,
	type SearchSimfilesOptions,
	type SearchSimfileResult
} from './server/db';

// Workers-safe logger (use this from any code running in a Cloudflare Worker)
export { workerLogger, type WorkerLogger } from './server/workerLogger';
