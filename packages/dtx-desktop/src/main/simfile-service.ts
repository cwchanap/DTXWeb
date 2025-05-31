import { type SimfileWithDtx } from '@dtx/common/node';
import { ensureSupabaseAuth, getSupabaseClient } from './auth';

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
