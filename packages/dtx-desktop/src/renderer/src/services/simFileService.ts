import type { SimfileModel } from '@dtx/common';
import { desktopHost } from './desktopHost';

// v2: current SimfileModel-shaped cache. The v1 keys ('simfiles_cache' /
// 'simfiles_cache_timestamp') held the legacy snake_case shape and are
// deliberately left untouched — no read, migration, or deletion.
const CACHE_KEY = 'simfiles_cache_v2';
const CACHE_TIMESTAMP_KEY = 'simfiles_cache_timestamp_v2';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export interface SimFileServiceResult {
	data: SimfileModel[];
	fromCache: boolean;
	error?: string;
}

class SimFileService {
	/**
	 * Fetches all simFiles for the authenticated user via the Rust backend
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

			// Call host process to fetch simFiles
			const result = await desktopHost.fetchUserSimfiles();

			if (result.success === false) {
				return {
					data: result.data,
					fromCache: result.fromCache,
					error: result.error
				};
			}

			// Cache the result
			this.setCachedData(result.data);

			return {
				data: result.data,
				fromCache: result.fromCache
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
	 * Gets cached simFiles data if it exists and is still valid
	 */
	private getCachedData(
		cacheKey: string = CACHE_KEY,
		timestampKey: string = CACHE_TIMESTAMP_KEY
	): SimfileModel[] | null {
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
			// Clear the corrupt entry so it self-heals on next call
			localStorage.removeItem(cacheKey);
			localStorage.removeItem(timestampKey);
			return null;
		}
	}

	/**
	 * Caches simFiles data in localStorage
	 */
	private setCachedData(
		data: SimfileModel[],
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
	}

	/**
	 * Forces a refresh by clearing cache and fetching new data
	 */
	async refreshUserSimFiles(): Promise<SimFileServiceResult> {
		this.clearCache();
		return this.fetchUserSimFiles();
	}

	async getNextDisplayId(): Promise<number> {
		const result = await desktopHost.getNextDisplayId();
		if (typeof result !== 'number' || !Number.isSafeInteger(result)) {
			throw new Error('Invalid next displayId response');
		}
		return result;
	}

	/**
	 * Gets preview URL for a simFile via Rust backend
	 * Always constructs R2 URL: {BUCKET_URL}/{simfileId}/preview.jpg
	 */
	async getPreviewUrl(simfileId: number): Promise<string> {
		try {
			return await desktopHost.getPreviewUrl(simfileId);
		} catch (error) {
			console.error('Failed to get preview URL for simfile', simfileId, error);
			return '';
		}
	}

	/**
	 * Gets sound preview URL for a simFile via Rust backend
	 * Always constructs R2 URL: {BUCKET_URL}/{simfileId}/preview.mp3
	 */
	async getSoundPreviewUrl(simfileId: number): Promise<string> {
		try {
			return await desktopHost.getSoundPreviewUrl(simfileId);
		} catch (error) {
			console.error('Failed to get sound preview URL for simfile', simfileId, error);
			return '';
		}
	}
}

// Export singleton instance
export const simFileService = new SimFileService();
