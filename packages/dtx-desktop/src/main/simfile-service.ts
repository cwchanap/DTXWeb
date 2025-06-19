import { type SimfileWithDtx } from '@dtx/common';
import { ensureSupabaseAuth, getSupabaseClient } from './auth';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
				`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, publish_date, created_at, updated_at, user_id, video_preview_url, dtx_files(level)`
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
	const supabaseClient = getSupabaseClient();
	if (!supabaseClient) {
		throw new Error('Supabase client not initialized');
	}
	const PREVIEW_BUCKET_NAME = 'simfile-previews';
	return supabaseClient.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
		.publicUrl;
}

export function getSoundPreviewUrl(sound_preview_url: string | null): string | null {
	if (!sound_preview_url) return null;
	const supabaseClient = getSupabaseClient();
	if (!supabaseClient) {
		throw new Error('Supabase client not initialized');
	}
	const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';
	return supabaseClient.storage
		.from(SOUND_PREVIEW_BUCKET_NAME)
		.getPublicUrl(`${sound_preview_url}`).data.publicUrl;
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
	data?: any;
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

		const PREVIEW_BUCKET_NAME = 'simfile-previews';
		const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';

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

				// Find preview image file (jpg, jpeg, png)
				const imageFile = files.find((file) => {
					const ext = path.extname(file).toLowerCase();
					return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
				});

				// Find sound preview file (mp3, wav)
				const soundFile = files.find((file) => {
					const ext = path.extname(file).toLowerCase();
					return ext === '.mp3' || ext === '.wav';
				});

				// Read image file if found
				if (imageFile) {
					const imagePath = path.join(simfileData.songPath, imageFile);
					const imageBuffer = await fs.promises.readFile(imagePath);
					previewBuffer = imageBuffer;
					console.log(`Found and read preview image: ${imageFile}`);
				}

				// Read sound file if found
				if (soundFile) {
					const soundPath = path.join(simfileData.songPath, soundFile);
					const soundBuffer = await fs.promises.readFile(soundPath);
					soundPreviewBuffer = soundBuffer;
					console.log(`Found and read sound preview: ${soundFile}`);
				}
			} catch (error) {
				console.warn('Error reading preview files from directory:', error);
				// Continue without preview files
			}
		}

		// Upload preview image to Supabase storage
		let previewUrl = '';
		const previewHash = crypto.randomUUID();
		if (previewBuffer) {
			previewUrl = `${user.id}/${previewHash}.jpg`;

			const { error: uploadError } = await supabaseClient.storage
				.from(PREVIEW_BUCKET_NAME)
				.upload(previewUrl, previewBuffer, {
					contentType: 'image/jpeg'
				});

			if (uploadError) {
				console.error('Error uploading preview image:', uploadError.message);
				throw new Error(`Error uploading preview image: ${uploadError.message}`);
			}
		}

		// Upload sound preview file
		let soundPreviewUrl = '';
		if (soundPreviewBuffer) {
			soundPreviewUrl = `${user.id}/${previewHash}.mp3`;

			const { error: uploadError } = await supabaseClient.storage
				.from(SOUND_PREVIEW_BUCKET_NAME)
				.upload(soundPreviewUrl, soundPreviewBuffer, {
					contentType: 'audio/mp3'
				});

			if (uploadError) {
				console.error('Error uploading sound preview file:', uploadError.message);
				throw new Error(`Error uploading sound preview file: ${uploadError.message}`);
			}
		}

		// Insert simfile data into the database
		const { data: simFileData, error } = await supabaseClient
			.from('simfiles')
			.insert({
				title: simfileData.title,
				artist: simfileData.artist,
				bpm: simfileData.bpm,
				preview_url: previewUrl,
				sound_preview_url: soundPreviewUrl,
				user_id: user.id,
				display_id: simfileData.displayId,
				is_published: simfileData.isPublished,
				publish_date: simfileData.publishDate,
				download_url: simfileData.downloadUrl,
				video_preview_url: simfileData.videoPreviewUrl
			})
			.select()
			.single();

		if (error) {
			console.error('Error creating simfiles:', error.message);
			throw new Error(`Error creating simfile: ${error.message}`);
		}

		// Insert dtx_files data into the database
		if (simfileData.levels && simfileData.levels.length > 0) {
			const { error: dtxError } = await supabaseClient.from('dtx_files').insert(
				simfileData.levels.map((level) => ({
					level: level.level,
					simfile_id: simFileData.id,
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
			simfileId: simFileData.id,
			data: simFileData
		};
	} catch (error) {
		console.error('Error creating simfile record:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}
