interface LinkageData {
	linkedSimFileId: string;
	linkedAt: string;
	cloudSongData: Record<string, unknown>;
}

interface LinkageCache {
	[songPath: string]: LinkageData;
}

const LINKAGE_CACHE_KEY = 'dtx_linkage_cache';

export const linkageCacheService = {
	/**
	 * Save linkage data for a song path to localStorage
	 */
	saveLinkage: (
		songPath: string,
		cloudSongId: string | number,
		cloudSongData: Record<string, unknown>
	): void => {
		try {
			const cache = linkageCacheService.getCache();

			const linkageData: LinkageData = {
				linkedSimFileId: String(cloudSongId), // Ensure it's always a string
				linkedAt: new Date().toISOString(),
				cloudSongData
			};

			cache[songPath] = linkageData;
			localStorage.setItem(LINKAGE_CACHE_KEY, JSON.stringify(cache));
		} catch (error) {
			console.warn('Failed to save linkage data to localStorage:', error);
		}
	},

	/**
	 * Get linkage data for a song path from localStorage
	 */
	getLinkage: (songPath: string): LinkageData | null => {
		try {
			const cache = linkageCacheService.getCache();
			return cache[songPath] || null;
		} catch (error) {
			console.warn('Failed to get linkage data from localStorage:', error);
			return null;
		}
	},

	/**
	 * Remove linkage data for a song path from localStorage
	 */
	removeLinkage: (songPath: string): void => {
		try {
			const cache = linkageCacheService.getCache();
			delete cache[songPath];
			localStorage.setItem(LINKAGE_CACHE_KEY, JSON.stringify(cache));

			console.log('Removed linkage from localStorage:', songPath);
		} catch (error) {
			console.warn('Failed to remove linkage data from localStorage:', error);
		}
	},

	/**
	 * Get all linkage data from localStorage
	 */
	getCache: (): LinkageCache => {
		try {
			const cacheData = localStorage.getItem(LINKAGE_CACHE_KEY);
			return cacheData ? JSON.parse(cacheData) : {};
		} catch (error) {
			console.warn('Failed to parse linkage cache from localStorage:', error);
			return {};
		}
	},

	/**
	 * Clear all linkage data from localStorage
	 */
	clearCache: (): void => {
		try {
			localStorage.removeItem(LINKAGE_CACHE_KEY);
		} catch (error) {
			console.warn('Failed to clear linkage cache from localStorage:', error);
		}
	},

	/**
	 * Check if a song path has cached linkage data
	 */
	hasLinkage: (songPath: string): boolean => {
		const linkage = linkageCacheService.getLinkage(songPath);
		return linkage !== null;
	},

	/**
	 * Get all song paths that have cached linkage data
	 */
	getLinkedSongPaths: (): string[] => {
		const cache = linkageCacheService.getCache();
		return Object.keys(cache);
	},

	/**
	 * Debug: Get all linkage data with details
	 */
	getAllLinkageData: (): LinkageCache => {
		console.log('=== DEBUG: All Linkage Data ===');
		const cache = linkageCacheService.getCache();
		console.log('Cache keys:', Object.keys(cache));
		for (const [path, data] of Object.entries(cache)) {
			console.log(`Path: "${path}"`);
			console.log(`Data:`, data);
			console.log('---');
		}
		console.log('=== END DEBUG ===');
		return cache;
	},

	/**
	 * Debug: Test localStorage availability and content
	 */
	debugLocalStorage: (): void => {
		console.log('=== localStorage Debug ===');
		console.log('localStorage available:', typeof localStorage !== 'undefined');
		console.log('Cache key:', LINKAGE_CACHE_KEY);
		console.log('Raw localStorage item:', localStorage.getItem(LINKAGE_CACHE_KEY));

		try {
			const parsed = JSON.parse(localStorage.getItem(LINKAGE_CACHE_KEY) || '{}');
			console.log('Parsed data:', parsed);
			console.log('Keys count:', Object.keys(parsed).length);
		} catch (error) {
			console.log('Parse error:', error);
		}
		console.log('=== End localStorage Debug ===');
	}
};
