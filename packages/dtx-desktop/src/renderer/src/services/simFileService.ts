import { supabase } from './supabaseService';
import type { SimfileWithDtx } from '@dtx/common';

const CACHE_KEY = 'simfiles_cache';
const CACHE_TIMESTAMP_KEY = 'simfiles_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export interface SimFileServiceResult {
	data: SimfileWithDtx[];
	fromCache: boolean;
	error?: string;
}

class SimFileService {
	/**
	 * Fetches all simFiles for the authenticated user from Supabase
	 * Includes caching logic similar to CharList.svelte
	 */
	async fetchUserSimFiles(): Promise<SimFileServiceResult> {
		try {
			// Check cache first
			const cachedResult = this.getCachedData();
			if (cachedResult) {
				return {
					data: cachedResult,
					fromCache: true
				};
			}

			// Get authenticated user
			const {
				data: { user },
				error: authError
			} = await supabase.auth.getUser();

			if (authError) {
				throw new Error(`Authentication error: ${authError.message}`);
			}

			if (!user) {
				throw new Error('User not authenticated');
			}

			// Fetch simFiles from Supabase - based on ChartList.svelte query
			const { data, error } = await supabase
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

			// Cache the result
			this.setCachedData(simFiles);

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

	/**
	 * Fetches published simFiles for blog/public view
	 */
	async fetchPublishedSimFiles(): Promise<SimFileServiceResult> {
		try {
			// Check cache first (using different cache key for published)
			const cacheKey = 'published_simfiles_cache';
			const timestampKey = 'published_simfiles_cache_timestamp';
			const cachedResult = this.getCachedData(cacheKey, timestampKey);
			if (cachedResult) {
				return {
					data: cachedResult,
					fromCache: true
				};
			}

			// Fetch published simFiles from Supabase
			const { data, error } = await supabase
				.from('simfiles')
				.select(
					`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, publish_date, created_at, updated_at, user_id, video_preview_url, dtx_files(level)`
				)
				.eq('is_published', true)
				.order('publish_date', { ascending: false });

			if (error) {
				throw new Error(`Failed to fetch published simFiles: ${error.message}`);
			}

			const simFiles = data || [];

			// Cache the result
			this.setCachedData(simFiles, cacheKey, timestampKey);

			return {
				data: simFiles,
				fromCache: false
			};
		} catch (error) {
			console.error('Error fetching published simFiles:', error);
			return {
				data: [],
				fromCache: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			};
		}
	}

	/**
	 * Gets cached simFiles data if it exists and is still valid
	 */
	private getCachedData(
		cacheKey: string = CACHE_KEY,
		timestampKey: string = CACHE_TIMESTAMP_KEY
	): SimfileWithDtx[] | null {
		try {
			const cachedData = localStorage.getItem(cacheKey);
			const cacheTimestamp = localStorage.getItem(timestampKey);

			if (!cachedData || !cacheTimestamp) {
				return null;
			}

			const timestamp = parseInt(cacheTimestamp, 10);
			const now = Date.now();

			// Check if cache is still valid
			if (now - timestamp > CACHE_DURATION) {
				// Cache expired, remove it
				localStorage.removeItem(cacheKey);
				localStorage.removeItem(timestampKey);
				return null;
			}

			return JSON.parse(cachedData);
		} catch (error) {
			console.error('Error reading cache:', error);
			return null;
		}
	}

	/**
	 * Caches simFiles data in localStorage
	 */
	private setCachedData(
		data: SimfileWithDtx[],
		cacheKey: string = CACHE_KEY,
		timestampKey: string = CACHE_TIMESTAMP_KEY
	): void {
		try {
			localStorage.setItem(cacheKey, JSON.stringify(data));
			localStorage.setItem(timestampKey, Date.now().toString());
		} catch (error) {
			console.error('Error caching data:', error);
		}
	}

	/**
	 * Clears cached simFiles data
	 */
	clearCache(): void {
		localStorage.removeItem(CACHE_KEY);
		localStorage.removeItem(CACHE_TIMESTAMP_KEY);
		localStorage.removeItem('published_simfiles_cache');
		localStorage.removeItem('published_simfiles_cache_timestamp');
	}

	/**
	 * Forces a refresh by clearing cache and fetching new data
	 */
	async refreshUserSimFiles(): Promise<SimFileServiceResult> {
		this.clearCache();
		return this.fetchUserSimFiles();
	}

	/**
	 * Gets preview URL for a simFile (similar to ChartList.svelte)
	 */
	getPreviewUrl(preview_url: string): string {
		const PREVIEW_BUCKET_NAME = 'simfile-previews';
		return supabase.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
			.publicUrl;
	}

	/**
	 * Gets sound preview URL for a simFile (similar to ChartList.svelte)
	 */
	getSoundPreviewUrl(sound_preview_url: string | null): string | null {
		if (!sound_preview_url) return null;
		const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';
		return supabase.storage.from(SOUND_PREVIEW_BUCKET_NAME).getPublicUrl(`${sound_preview_url}`)
			.data.publicUrl;
	}
}

// Export singleton instance
export const simFileService = new SimFileService();
