import { type SimfileWithDtx, DTXFile, decodeFileWithEncodingDetection } from '@dtx/common/server';
import { ensureSupabaseAuth, getSupabaseClient } from './auth';
import { listSimfiles, nextDisplayId, createSimfile } from './api-client';
import { uploadFile } from './upload';
import { SimfileScope, type CreateSimfileInput } from './graphql/generated/graphql';
import fs from 'fs';
import path from 'path';

/** Adapt a GraphQL Simfile (camelCase) to the desktop-facing SimfileWithDtx (snake_case) */
const toSimfileWithDtx = (s: {
	id: string;
	displayId: number | null;
	title: string;
	artist: string;
	bpm: number;
	userId: string | null;
	isPublished: boolean;
	downloadUrl: string | null;
	previewUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: { level: number; label: string }[];
}): SimfileWithDtx => {
	const numId = Number(s.id);
	if (!Number.isFinite(numId)) throw new Error(`Invalid simfile id: ${s.id}`);
	return {
		id: numId,
		display_id: s.displayId,
		title: s.title,
		artist: s.artist,
		bpm: s.bpm,
		user_id: s.userId ?? undefined,
		is_published: s.isPublished,
		download_url: s.downloadUrl,
		preview_url: s.previewUrl,
		video_preview_url: s.videoPreviewUrl,
		publish_date: s.publishDate,
		created_at: s.createdAt,
		updated_at: s.updatedAt,
		dtx_files: s.dtxFiles
	};
};

// SimFile service functions - using discriminated union type
export type SimFileServiceResult =
	| {
			success: true;
			data: SimfileWithDtx[];
			fromCache: boolean;
	  }
	| {
			success: false;
			error: string;
			data: SimfileWithDtx[];
			fromCache: boolean;
	  };

export async function fetchUserSimFiles(): Promise<SimFileServiceResult> {
	let allData: SimfileWithDtx[] = [];
	try {
		// Ensure auth is initialized
		const isAuthReady = await ensureSupabaseAuth();
		if (!isAuthReady) {
			throw new Error('Authentication not available. Please log in first.');
		}

		// Fetch simfiles from web API with pagination
		// API limits pageSize to 100, so we need to paginate
		const pageSize = 100;
		let page = 1;
		let totalCount = 0;

		// Fetch first page to get total count
		const firstPageResult = await listSimfiles({ scope: SimfileScope.Mine, page, pageSize });

		if (!firstPageResult.success) {
			throw new Error(firstPageResult.error);
		}

		const { data: page1Data, count } = firstPageResult.data;
		allData = (page1Data || []).map(toSimfileWithDtx);
		totalCount = count || 0;

		// Calculate total pages needed
		const totalPages = Math.ceil(totalCount / pageSize);

		// Fetch remaining pages if needed
		for (page = 2; page <= totalPages; page++) {
			const pageResult = await listSimfiles({ scope: SimfileScope.Mine, page, pageSize });

			if (!pageResult.success) {
				throw new Error(pageResult.error);
			}

			allData = allData.concat((pageResult.data.data || []).map(toSimfileWithDtx));
		}

		return {
			success: true,
			data: allData,
			fromCache: false
		};
	} catch (error) {
		console.error('Error fetching simFiles:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error occurred',
			data: allData,
			fromCache: false
		};
	}
}

export const getNextDisplayId = async (): Promise<number> => {
	const isAuthReady = await ensureSupabaseAuth();
	if (!isAuthReady) {
		throw new Error('Authentication not available. Please log in first.');
	}

	const result = await nextDisplayId();
	if (!result.success) {
		throw new Error(result.error);
	}
	if (typeof result.data !== 'number' || !Number.isFinite(result.data)) {
		throw new Error('Invalid nextDisplayId in API response');
	}
	return result.data;
};

export function getPreviewUrl(simfileId: number): string {
	const bucketUrl = import.meta.env.PUBLIC_SIMFILE_BUCKET_URL;
	if (!bucketUrl) {
		throw new Error('PUBLIC_SIMFILE_BUCKET_URL environment variable is not set');
	}
	// Always construct R2 URL: {BUCKET_URL}/{simfile_id}/preview.jpg
	const normalizedUrl = bucketUrl.replace(/\/$/, '');
	return `${normalizedUrl}/${simfileId}/preview.jpg`;
}

export function getSoundPreviewUrl(simfileId: number): string {
	const bucketUrl = import.meta.env.PUBLIC_SIMFILE_BUCKET_URL;
	if (!bucketUrl) {
		throw new Error('PUBLIC_SIMFILE_BUCKET_URL environment variable is not set');
	}
	// Always construct R2 URL: {BUCKET_URL}/{simfile_id}/preview.mp3
	const normalizedUrl = bucketUrl.replace(/\/$/, '');
	return `${normalizedUrl}/${simfileId}/preview.mp3`;
}

interface UploadPreviewFileResult {
	success: boolean;
	path?: string;
	error?: string;
}

/**
 * Helper function to upload a file to R2 via the upload API
 * @param buffer - File content as Buffer
 * @param simfileId - Simfile ID
 * @param filename - Filename (e.g., 'preview.jpg', 'preview.mp3')
 * @param contentType - MIME type (e.g., 'image/jpeg', 'audio/mpeg')
 * @returns Result object with success status and path or error
 */
async function uploadPreviewFile(
	buffer: Buffer,
	simfileId: number,
	filename: string,
	contentType: string
): Promise<UploadPreviewFileResult> {
	const form = new FormData();
	const fileBytes = new Uint8Array(buffer.byteLength);
	fileBytes.set(buffer);
	form.append('file', new Blob([fileBytes], { type: contentType }), filename);
	form.append('simFileId', String(simfileId));

	const uploadResult = await uploadFile(form);
	if (!uploadResult.success) {
		console.error(`Failed to upload ${filename}:`, uploadResult.error);
		return { success: false, error: uploadResult.error };
	}
	return { success: true, path: `${simfileId}/${filename}` };
}

export interface CreateSimfileData {
	title: string;
	artist: string;
	bpm: number;
	displayId: number | null;
	isPublished: boolean;
	publishDate: string;
	downloadUrl: string;
	videoPreviewUrl: string;
	levels: { label: string; level: number }[];
	songPath: string;
}

export interface CreateSimfileResult {
	success: boolean;
	simfileId?: string;
	data?: unknown;
	error?: string;
	warnings?: string[];
}

export async function createSimfileRecord(
	simfileData: CreateSimfileData
): Promise<CreateSimfileResult> {
	try {
		const supabaseClient = getSupabaseClient();
		if (!supabaseClient) {
			throw new Error('Supabase client not available');
		}

		const {
			data: { user },
			error: userError
		} = await supabaseClient.auth.getUser();

		if (userError || !user) {
			throw new Error('User not authenticated');
		}

		// Find and read preview files from the song directory
		let previewBuffer: Buffer | undefined;
		let soundPreviewBuffer: Buffer | undefined;

		if (simfileData.songPath) {
			try {
				// Read directory contents
				const entries = await fs.promises.readdir(simfileData.songPath, {
					withFileTypes: true
				});
				const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

				// Find preview image file (always preview.jpg)
				const imageFile = files.find((file) => {
					return file.toLowerCase() === 'preview.jpg';
				});

				// Find sound preview file (always preview.mp3)
				const soundFile = files.find((file) => {
					return file.toLowerCase() === 'preview.mp3';
				});

				// Read image file if found
				if (imageFile) {
					const imagePath = path.join(simfileData.songPath, imageFile);
					const imageBuffer = await fs.promises.readFile(imagePath);
					previewBuffer = imageBuffer;
				}

				// Read sound file if found
				if (soundFile) {
					const soundPath = path.join(simfileData.songPath, soundFile);
					const soundBuffer = await fs.promises.readFile(soundPath);
					soundPreviewBuffer = soundBuffer;
				}
			} catch (error) {
				console.warn('Error reading preview files from directory:', error);
				// Continue without preview files
			}
		}

		// Create simfile via web API (also creates dtx_files)
		const input: CreateSimfileInput = {
			title: simfileData.title,
			artist: simfileData.artist,
			bpm: simfileData.bpm,
			displayId: simfileData.displayId,
			isPublished: simfileData.isPublished ?? null,
			publishDate: simfileData.publishDate,
			downloadUrl: simfileData.downloadUrl,
			videoPreviewUrl: simfileData.videoPreviewUrl,
			dtxFiles: simfileData.levels?.map((l) => ({ label: l.label, level: l.level })) ?? null
		};
		const apiResult = await createSimfile(input);

		if (!apiResult.success) {
			throw new Error(apiResult.error);
		}

		const simfile = apiResult.data.createSimfile;
		const simfileId = Number(simfile.id);

		// Upload preview files to R2 via API using the helper function
		const uploadErrors: string[] = [];

		if (previewBuffer) {
			const result = await uploadPreviewFile(
				previewBuffer,
				simfileId,
				'preview.jpg',
				'image/jpeg'
			);
			if (!result.success && result.error) {
				uploadErrors.push(`Preview image: ${result.error}`);
			}
		}

		if (soundPreviewBuffer) {
			const result = await uploadPreviewFile(
				soundPreviewBuffer,
				simfileId,
				'preview.mp3',
				'audio/mpeg'
			);
			if (!result.success && result.error) {
				uploadErrors.push(`Sound preview: ${result.error}`);
			}
		}

		const result: CreateSimfileResult = {
			success: true,
			simfileId: String(simfileId),
			data: toSimfileWithDtx(simfile)
		};

		// Include warnings if preview uploads failed
		if (uploadErrors.length > 0) {
			result.warnings = uploadErrors;
		}

		return result;
	} catch (error) {
		console.error('Error creating simfile record:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

// DTX parsing result interface
export interface DtxParseResult {
	bpm: number | undefined;
	artist: string | undefined;
	levels: { label: string; level: number }[];
	parseFailures?: number;
}

// Parse DTX files to extract metadata
export async function parseDtxFiles(folderPath: string): Promise<DtxParseResult> {
	try {
		// First, try to find and parse SET.def file for level labels
		const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
		const setDefFile = entries.find(
			(entry) => entry.isFile() && entry.name.toLowerCase() === 'set.def'
		);

		const levelLabelsFromSetDef: Map<string, string> = new Map(); // Map DTX filename to label

		if (setDefFile) {
			try {
				const setDefPath = path.join(folderPath, setDefFile.name);
				const setDefBuffer = await fs.promises.readFile(setDefPath);
				const tempFile = new File([setDefBuffer], setDefFile.name);

				// SET.def file validation callback
				const validateSetDefContent = (content: string): boolean => {
					return (
						content.includes('#L') || // Level definitions
						content.includes('.dtx')
					);
				};

				const setDefResult = await decodeFileWithEncodingDetection(
					tempFile,
					validateSetDefContent,
					['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'],
					'utf-8'
				);

				// Parse SET.def content manually to extract filename-to-label mappings
				const lines = setDefResult.content.split(/\r?\n/);

				for (let level = 1; level <= 5; level++) {
					const labelLine = lines.find((line: string) =>
						line.startsWith(`#L${level}LABEL `)
					);
					const fileLine = lines.find((line: string) =>
						line.startsWith(`#L${level}FILE `)
					);

					if (labelLine && fileLine) {
						const label = labelLine.split(' ')[1];
						const fileName = fileLine.split(' ')[1];

						if (label && fileName) {
							levelLabelsFromSetDef.set(fileName.toLowerCase(), label);
						}
					}
				}
			} catch (error) {
				console.warn(
					'Failed to parse SET.def file for labels, will use DTX filenames:',
					error
				);
			}
		}

		// Parse individual DTX files for metadata (BPM, artist, levels)
		const dtxFiles = entries
			.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dtx'))
			.map((entry) => entry.name);

		if (dtxFiles.length === 0) {
			return {
				bpm: undefined,
				artist: undefined,
				levels: []
			};
		}

		let parsedBpm: number | undefined;
		let parsedArtist: string | undefined;
		const parsedLevels: { label: string; level: number }[] = [];
		let parseFailures = 0;

		// Parse each DTX file
		for (const fileName of dtxFiles) {
			try {
				const filePath = path.join(folderPath, fileName);
				const fileBuffer = await fs.promises.readFile(filePath);

				// Create a temporary File object from the buffer for the utility function
				const tempFile = new File([fileBuffer], fileName);

				// DTX file validation callback
				const validateDtxContent = (content: string): boolean => {
					return (
						content.includes('#TITLE:') ||
						content.includes('#ARTIST:') ||
						content.includes('#BPM:') ||
						content.includes('#WAV')
					);
				};

				const fileResult = await decodeFileWithEncodingDetection(
					tempFile,
					validateDtxContent,
					['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'],
					'shift-jis'
				);

				const dtx = new DTXFile(fileResult.content);
				await dtx.parse();

				// Use the first valid parsed values for BPM and artist from DTXFile
				if (!parsedBpm && dtx.bpm) {
					parsedBpm = dtx.bpm;
				}
				if (!parsedArtist && dtx.artist) {
					parsedArtist = dtx.artist;
				}

				// Add level information with proper label logic
				if (dtx.level) {
					// First try to get label from SET.def mapping
					const labelFromSetDef = levelLabelsFromSetDef.get(fileName.toLowerCase());

					let label: string;
					if (labelFromSetDef) {
						// Use the proper label from SET.def
						label = labelFromSetDef;
					} else {
						// Fallback to improved filename-based label
						const baseFileName = fileName.replace('.dtx', '');
						label = baseFileName.toUpperCase();
					}

					parsedLevels.push({
						label: label,
						level: dtx.level
					});
				}
			} catch (error) {
				console.warn(`Failed to parse DTX file ${fileName}:`, error);
				parseFailures++;
			}
		}

		const result = {
			bpm: parsedBpm,
			artist: parsedArtist,
			levels: parsedLevels,
			parseFailures: parseFailures > 0 ? parseFailures : undefined
		};

		return result;
	} catch (error) {
		console.error('Error parsing DTX files:', error);
		return {
			bpm: undefined,
			artist: undefined,
			levels: []
		};
	}
}
