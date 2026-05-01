import type { LaneMeasureNote } from '@dtx/common';

export interface SoundChipData {
	label: string;
	id: number;
	volume: number;
	position: number;
	fileName: string;
	filePath?: string; // Store file path instead of File object (for remote files)
	fileHash?: string; // Hash reference to sound library file (for imported files)
}

export interface ChartMetadata {
	title: string;
	artist: string;
	comment: string;
	bpm: number;
	level: number;
	soundChips: SoundChipData[];
}

interface TempChartData {
	notes: Record<string, LaneMeasureNote[]>;
	bpmNotes: Record<string, number>;
	measureCount: number;
	metadata: ChartMetadata;
	timestamp: number;
}

/**
 * Service for temporarily storing chart data in localStorage
 * Maps chart data by simFileID or uses 'temp' for charts without ID
 */
export class TempChartStorage {
	private static readonly STORAGE_KEY_PREFIX = 'dtx_temp_chart_';
	private static readonly DEFAULT_KEY = 'temp';
	private static readonly MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

	/**
	 * Save chart data to localStorage
	 */
	static save(
		simFileID: string | null,
		difficulty: string | null,
		notes: Record<string, LaneMeasureNote[]>,
		bpmNotes: Record<string, number>,
		measureCount: number,
		metadata: ChartMetadata
	): void {
		try {
			const key = this.buildStorageKey(simFileID, difficulty);
			const storageKey = this.STORAGE_KEY_PREFIX + key;

			const data: TempChartData = {
				notes,
				bpmNotes,
				measureCount,
				metadata,
				timestamp: Date.now()
			};

			localStorage.setItem(storageKey, JSON.stringify(data));
		} catch (error) {
			console.warn('Failed to save temporary chart data:', error);
		}
	}

	/**
	 * Load chart data from localStorage
	 */
	static load(simFileID: string | null, difficulty: string | null): TempChartData | null {
		try {
			const key = this.buildStorageKey(simFileID, difficulty);
			const storageKey = this.STORAGE_KEY_PREFIX + key;
			return this.readStoredData(storageKey, true);
		} catch (error) {
			console.warn('Failed to load temporary chart data:', error);
			return null;
		}
	}

	/**
	 * Remove chart data from localStorage
	 */
	static remove(simFileID: string | null, difficulty: string | null): void {
		try {
			const key = this.buildStorageKey(simFileID, difficulty);
			const storageKey = this.STORAGE_KEY_PREFIX + key;
			localStorage.removeItem(storageKey);
		} catch (error) {
			console.warn('Failed to remove temporary chart data:', error);
		}
	}

	/**
	 * Check if temporary data exists for the given simFileID and difficulty
	 */
	static exists(simFileID: string | null, difficulty: string | null): boolean {
		const data = this.load(simFileID, difficulty);
		return data !== null;
	}

	/**
	 * Check if any temporary data exists for a given simFileID, regardless of difficulty.
	 * Scans localStorage keys matching the prefix pattern for this simFileID.
	 */
	static existsAny(simFileID: string | null): boolean {
		try {
			if (!simFileID) {
				// Check the default temp key
				return this.load(null, null) !== null;
			}

			const prefix = this.STORAGE_KEY_PREFIX + simFileID;
			const matchingKeys: string[] = [];

			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key === prefix || key?.startsWith(prefix + '_')) {
					matchingKeys.push(key);
				}
			}

			for (const key of matchingKeys) {
				const data = this.readStoredData(key);
				if (data) {
					return true;
				}
			}
			return false;
		} catch (error) {
			console.warn('Failed to check for temporary chart data:', error);
			return false;
		}
	}

	/**
	 * Load the newest available draft for a given simfileID, regardless of difficulty.
	 * Scans all matching entries and returns the one with the latest timestamp.
	 * Returns the draft data and its difficulty key, or null if none found.
	 */
	static loadAny(
		simFileID: string | null
	): (TempChartData & { difficulty: string | null }) | null {
		try {
			if (!simFileID) {
				const data = this.load(null, null);
				return data ? { ...data, difficulty: null } : null;
			}

			const prefix = this.STORAGE_KEY_PREFIX + simFileID;
			const matchingKeys: string[] = [];

			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key === prefix || key?.startsWith(prefix + '_')) {
					matchingKeys.push(key);
				}
			}

			let bestMatch: (TempChartData & { difficulty: string | null }) | null = null;

			for (const key of matchingKeys) {
				const data = this.readStoredData(key);
				if (data && (!bestMatch || data.timestamp > bestMatch.timestamp)) {
					// Extract difficulty from the key
					const suffix = key.slice(prefix.length + 1); // +1 for the underscore
					bestMatch = { ...data, difficulty: suffix || null };
				}
			}
			return bestMatch;
		} catch (error) {
			console.warn('Failed to load any temporary chart data:', error);
			return null;
		}
	}

	/**
	 * Remove all temporary chart data for a given simfileID, regardless of difficulty.
	 * Scans localStorage and removes every matching key.
	 */
	static removeAllForSimfile(simFileID: string | null): void {
		try {
			if (!simFileID) {
				this.remove(null, null);
				return;
			}

			const prefix = this.STORAGE_KEY_PREFIX + simFileID;
			const keysToRemove: string[] = [];

			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key === prefix || key?.startsWith(prefix + '_')) {
					keysToRemove.push(key);
				}
			}

			keysToRemove.forEach((key) => localStorage.removeItem(key));
		} catch (error) {
			console.warn('Failed to remove temporary chart data for simfile:', error);
		}
	}

	/**
	 * Clear all temporary chart data (useful for cleanup)
	 */
	static clearAll(): void {
		try {
			const keysToRemove: string[] = [];

			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && key.startsWith(this.STORAGE_KEY_PREFIX)) {
					keysToRemove.push(key);
				}
			}

			keysToRemove.forEach((key) => localStorage.removeItem(key));
		} catch (error) {
			console.warn('Failed to clear temporary chart data:', error);
		}
	}

	/**
	 * Get the storage key for a given simFileID and difficulty (for debugging)
	 */
	static getStorageKey(simFileID: string | null, difficulty: string | null): string {
		const key = this.buildStorageKey(simFileID, difficulty);
		return this.STORAGE_KEY_PREFIX + key;
	}

	/**
	 * Build storage key combining simFileID and difficulty
	 */
	private static buildStorageKey(simFileID: string | null, difficulty: string | null): string {
		if (!simFileID) {
			return this.DEFAULT_KEY;
		}

		if (!difficulty) {
			return simFileID;
		}

		// Format: "simFileID_difficulty" (e.g., "mysong_mas" or "mysong_ext")
		return `${simFileID}_${difficulty}`;
	}

	private static readStoredData(storageKey: string, warnOnInvalid = false): TempChartData | null {
		const stored = localStorage.getItem(storageKey);
		if (!stored) {
			return null;
		}

		try {
			const data: TempChartData = JSON.parse(stored);
			if (Date.now() - data.timestamp > this.MAX_AGE_MS) {
				localStorage.removeItem(storageKey);
				return null;
			}

			return data;
		} catch (error) {
			localStorage.removeItem(storageKey);
			if (warnOnInvalid) {
				console.warn('Failed to load temporary chart data:', error);
			}
			return null;
		}
	}
}
