import type { LaneMeasureNote } from '@dtx/common';

interface TempChartData {
	notes: Record<string, LaneMeasureNote[]>;
	bpmNotes: Record<string, number>;
	measureCount: number;
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
		notes: Record<string, LaneMeasureNote[]>,
		bpmNotes: Record<string, number>,
		measureCount: number
	): void {
		try {
			const key = simFileID || this.DEFAULT_KEY;
			const storageKey = this.STORAGE_KEY_PREFIX + key;

			const data: TempChartData = {
				notes,
				bpmNotes,
				measureCount,
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
	static load(simFileID: string | null): TempChartData | null {
		try {
			const key = simFileID || this.DEFAULT_KEY;
			const storageKey = this.STORAGE_KEY_PREFIX + key;

			const stored = localStorage.getItem(storageKey);
			if (!stored) {
				return null;
			}

			const data: TempChartData = JSON.parse(stored);

			// Check if data is too old
			if (Date.now() - data.timestamp > this.MAX_AGE_MS) {
				this.remove(simFileID);
				return null;
			}

			return data;
		} catch (error) {
			console.warn('Failed to load temporary chart data:', error);
			return null;
		}
	}

	/**
	 * Remove chart data from localStorage
	 */
	static remove(simFileID: string | null): void {
		try {
			const key = simFileID || this.DEFAULT_KEY;
			const storageKey = this.STORAGE_KEY_PREFIX + key;
			localStorage.removeItem(storageKey);
		} catch (error) {
			console.warn('Failed to remove temporary chart data:', error);
		}
	}

	/**
	 * Check if temporary data exists for the given simFileID
	 */
	static exists(simFileID: string | null): boolean {
		const data = this.load(simFileID);
		return data !== null;
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
	 * Get the storage key for a given simFileID (for debugging)
	 */
	static getStorageKey(simFileID: string | null): string {
		const key = simFileID || this.DEFAULT_KEY;
		return this.STORAGE_KEY_PREFIX + key;
	}
}
