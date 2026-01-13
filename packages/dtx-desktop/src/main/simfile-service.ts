import { type SimfileWithDtx, DTXFile, decodeFileWithEncodingDetection } from '@dtx/common/server';
import { ensureSupabaseAuth, getSupabaseClient, getCurrentSession } from './auth';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

// SimFile service functions
export interface SimFileServiceResult {
	data: SimfileWithDtx[];
	fromCache: boolean;
	error?: string;
}

export async function fetchUserSimFiles(): Promise<SimFileServiceResult> {
	try {
		// Ensure auth is initialized
		const isAuthReady = await ensureSupabaseAuth();
		if (!isAuthReady) {
			throw new Error('Authentication not available. Please log in first.');
		}

		const supabaseClient = getSupabaseClient();
		if (!supabaseClient) {
			throw new Error('Supabase client not available');
		}

		// Get authenticated user
		const {
			data: { user },
			error: authError
		} = await supabaseClient.auth.getUser();

		if (authError) {
			throw new Error(`Authentication error: ${authError.message}`);
		}

		if (!user) {
			throw new Error('User not authenticated');
		}

		// Fetch simFiles from Supabase - based on ChartList.svelte query
		const { data, error } = await supabaseClient
			.from('simfiles')
			.select(
				`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, publish_date, created_at, updated_at, user_id, video_preview_url, dtx_files(level, label)`
			)
			.eq('user_id', user.id)
			.order('publish_date', { ascending: false });

		if (error) {
			throw new Error(`Failed to fetch simFiles: ${error.message}`);
		}

		const simFiles = data || [];

		return {
			data: simFiles,
			fromCache: false
		};
	} catch (error) {
		console.error('Error fetching simFiles:', error);
		return {
			data: [],
			fromCache: false,
			error: error instanceof Error ? error.message : 'Unknown error occurred'
		};
	}
}

export function getPreviewUrl(preview_url: string): string {
	const bucketUrl = import.meta.env.PUBLIC_SIMFILE_BUCKET_URL;
	if (!bucketUrl) {
		throw new Error('PUBLIC_SIMFILE_BUCKET_URL environment variable is not set');
	}
	if (!preview_url) {
		throw new Error('preview_url is required');
	}
	const normalizedUrl = bucketUrl.replace(/\/$/, '');
	const normalizedPath = preview_url.replace(/^\//, '');
	return `${normalizedUrl}/${normalizedPath}`;
}

export function getSoundPreviewUrl(sound_preview_url: string | null): string | null {
	if (!sound_preview_url) return null;
	const bucketUrl = import.meta.env.PUBLIC_SIMFILE_BUCKET_URL;
	if (!bucketUrl) return null;
	const normalizedUrl = bucketUrl.replace(/\/$/, '');
	const normalizedPath = sound_preview_url.replace(/^\//, '');
	return `${normalizedUrl}/${normalizedPath}`;
}

/**
 * Helper function to upload a file to R2 via the upload API
 * @param buffer - File content as Buffer
 * @param simfileId - Simfile ID
 * @param filename - Filename (e.g., 'preview.jpg', 'preview.mp3')
 * @param contentType - MIME type (e.g., 'image/jpeg', 'audio/mpeg')
 * @param apiBaseUrl - Base URL for API
 * @returns The file path relative to the bucket, or empty string on failure
 */
async function uploadPreviewFile(
	buffer: Buffer,
	simfileId: number,
	filename: string,
	contentType: string,
	apiBaseUrl: string
): Promise<string> {
	try {
		// Get current session for authentication
		const session = getCurrentSession();
		if (!session?.access_token) {
			console.error('No valid session for file upload');
			return '';
		}

		// Create FormData using the form-data package
		const form = new FormData();
		form.append('file', buffer, { filename, contentType });
		form.append('simFileId', String(simfileId));

		// Set up timeout using AbortController
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const response = (await fetch(`${apiBaseUrl}/api/simFile/upload`, {
				method: 'POST',
				headers: {
					...form.getHeaders(),
					// Add authentication header with access token
					Authorization: `Bearer ${session.access_token}`,
					// Add desktop app identifiers to pass CSRF checks
					'User-Agent': 'DTXDesktopApp',
					'X-Requested-With': 'DTXDesktopApp'
				},
				body: form as any, // Type assertion for node-fetch
				signal: controller.signal
			})) as { ok: boolean; status: number };

			if (!response.ok) {
				console.error(`Failed to upload ${filename}: HTTP ${response.status}`);
				return '';
			}

			return `${simfileId}/${filename}`;
		} finally {
			clearTimeout(timeoutId);
		}
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === 'AbortError') {
				console.error(`Upload timeout for ${filename}`);
			} else {
				console.error(`Upload error for ${filename}:`, error.message);
			}
		} else {
			console.error(`Upload error for ${filename}:`, error);
		}
		return '';
	}
}

export interface CreateSimfileData {
	title: string;
	artist: string;
	bpm: number;
	displayId: number;
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

		const apiBaseUrl = import.meta.env.VITE_DTX_SERVER_URL;

		// Validate apiBaseUrl before creating simfile record
		if (!apiBaseUrl || !apiBaseUrl.startsWith('http')) {
			throw new Error('VITE_DTX_SERVER_URL must be set to a valid absolute URL');
		}

		// First, insert simfile data into the database to get the simfileId
		const insertData = {
			title: simfileData.title,
			artist: simfileData.artist,
			bpm: simfileData.bpm,
			preview_url: null,
			sound_preview_url: null,
			user_id: user.id,
			display_id: simfileData.displayId,
			is_published: simfileData.isPublished,
			publish_date: simfileData.publishDate,
			download_url: simfileData.downloadUrl,
			video_preview_url: simfileData.videoPreviewUrl
		};

		const { data: simFileData, error } = await supabaseClient
			.from('simfiles')
			.insert(insertData)
			.select()
			.single();

		if (error) {
			console.error('Error creating simfiles:', error.message);
			throw new Error(`Error creating simfile: ${error.message}`);
		}

		const simfileId = simFileData.id;

		// Upload preview files to R2 via API using the helper function
		let previewUrl = '';
		let soundPreviewUrl = '';

		if (previewBuffer) {
			previewUrl = await uploadPreviewFile(
				previewBuffer,
				simfileId,
				'preview.jpg',
				'image/jpeg',
				apiBaseUrl
			);
		}

		if (soundPreviewBuffer) {
			soundPreviewUrl = await uploadPreviewFile(
				soundPreviewBuffer,
				simfileId,
				'preview.mp3',
				'audio/mpeg',
				apiBaseUrl
			);
		}

		// Update the simfile record with preview URLs if they were uploaded
		if (previewUrl || soundPreviewUrl) {
			const { error: updateError } = await supabaseClient
				.from('simfiles')
				.update({
					preview_url: previewUrl || null,
					sound_preview_url: soundPreviewUrl || null
				})
				.eq('id', simfileId);

			if (updateError) {
				console.error('Error updating simfile with preview URLs:', updateError.message);
			}
		}

		// Insert dtx_files data into the database
		if (simfileData.levels && simfileData.levels.length > 0) {
			const { error: dtxError } = await supabaseClient.from('dtx_files').insert(
				simfileData.levels.map((level) => ({
					level: level.level,
					simfile_id: simfileId,
					label: level.label
				}))
			);

			if (dtxError) {
				console.error('Error creating dtx_files:', dtxError.message);
				throw new Error(`Error creating dtx_files: ${dtxError.message}`);
			}
		}

		return {
			success: true,
			simfileId: simfileId,
			data: {
				...simFileData,
				preview_url: previewUrl || null,
				sound_preview_url: soundPreviewUrl || null
			}
		};
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
			}
		}

		const result = {
			bpm: parsedBpm,
			artist: parsedArtist,
			levels: parsedLevels
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
