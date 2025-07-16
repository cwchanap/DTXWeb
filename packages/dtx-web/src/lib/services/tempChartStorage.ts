import type { LaneMeasureNote } from '@dtx/common';

export interface SoundChipData {
	label: string;
	id: number;
	volume: number;
	position: number;
	fileName: string;
	filePath?: string; // Store file path instead of File object
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
}
