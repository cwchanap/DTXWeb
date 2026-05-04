import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TempChartStorage, type ChartMetadata, type SoundChipData } from './tempChartStorage';
import { LaneMeasureNote } from '@dtx/common';

// Mock localStorage
const mockLocalStorage = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	length: 0,
	key: vi.fn()
};

Object.defineProperty(window, 'localStorage', {
	value: mockLocalStorage
});

describe('TempChartStorage', () => {
	const mockNotes: Record<string, LaneMeasureNote[]> = {
		'0': [
			new LaneMeasureNote(
				0, // measure
				'BD', // laneID
				[{ noteID: '1', position: 0 }] // notes array
			)
		]
	};

	const mockBpmNotes: Record<string, number> = {
		'0': 120
	};

	const mockSoundChips: SoundChipData[] = [
		{
			label: 'BD',
			id: 1,
			volume: 100,
			position: 0,
			fileName: 'kick.wav'
		}
	];

	const mockMetadata: ChartMetadata = {
		title: 'Test Song',
		artist: 'Test Artist',
		comment: 'Test Comment',
		bpm: 120,
		level: 5,
		soundChips: mockSoundChips
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockLocalStorage.getItem.mockReturnValue(null);
		mockLocalStorage.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('save', () => {
		it('should save chart data with simFileID and difficulty', () => {
			TempChartStorage.save(
				'test-simfile',
				'master',
				mockNotes,
				mockBpmNotes,
				4,
				mockMetadata
			);

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master',
				expect.stringContaining('"notes"')
			);

			const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
			expect(savedData).toMatchObject({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata
			});
			expect(savedData.timestamp).toBeTypeOf('number');
		});

		it('should save chart data with simFileID only', () => {
			TempChartStorage.save('test-simfile', null, mockNotes, mockBpmNotes, 4, mockMetadata);

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile',
				expect.any(String)
			);
		});

		it('should save chart data with default key when no simFileID', () => {
			TempChartStorage.save(null, 'master', mockNotes, mockBpmNotes, 4, mockMetadata);

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dtx_temp_chart_temp',
				expect.any(String)
			);
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.setItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			// Should not throw
			expect(() => {
				TempChartStorage.save(
					'test-simfile',
					'master',
					mockNotes,
					mockBpmNotes,
					4,
					mockMetadata
				);
			}).not.toThrow();
		});
	});

	describe('load', () => {
		it('should load chart data successfully', () => {
			const savedData = {
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			};

			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedData));

			const result = TempChartStorage.load('test-simfile', 'master');

			expect(mockLocalStorage.getItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master'
			);
			expect(result).toEqual(savedData);
		});

		it('should return null when no data exists', () => {
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = TempChartStorage.load('test-simfile', 'master');

			expect(result).toBeNull();
		});

		it('should return null and remove expired data', () => {
			const expiredData = {
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days ago
			};

			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(expiredData));

			const result = TempChartStorage.load('test-simfile', 'master');

			expect(result).toBeNull();
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master'
			);
		});

		it('should handle JSON parse errors gracefully', () => {
			mockLocalStorage.getItem.mockReturnValue('invalid json');

			const result = TempChartStorage.load('test-simfile', 'master');

			expect(result).toBeNull();
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const result = TempChartStorage.load('test-simfile', 'master');

			expect(result).toBeNull();
		});
	});

	describe('remove', () => {
		it('should remove chart data', () => {
			TempChartStorage.remove('test-simfile', 'master');

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master'
			);
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.removeItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			// Should not throw
			expect(() => {
				TempChartStorage.remove('test-simfile', 'master');
			}).not.toThrow();
		});
	});

	describe('exists', () => {
		it('should return true when data exists and is valid', () => {
			const validData = {
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			};

			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(validData));

			const result = TempChartStorage.exists('test-simfile', 'master');

			expect(result).toBe(true);
		});

		it('should return false when data does not exist', () => {
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = TempChartStorage.exists('test-simfile', 'master');

			expect(result).toBe(false);
		});

		it('should return false when data is expired', () => {
			const expiredData = {
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days ago
			};

			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(expiredData));

			const result = TempChartStorage.exists('test-simfile', 'master');

			expect(result).toBe(false);
		});
	});

	describe('existsAny', () => {
		it('should return true when data exists for simFileID with a difficulty suffix', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_master');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(true);
		});

		it('should return true when data exists for simFileID without difficulty', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile') return validData;
				return null;
			});

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(true);
		});

		it('should return false when no data exists for simFileID', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_other-simfile');
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(false);
		});

		it('should return false when all matching data is expired', () => {
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_basic');
			mockLocalStorage.getItem.mockReturnValue(expiredData);

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(false);
		});

		it('removes expired and invalid matching entries while scanning', () => {
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 3;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_expired')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_broken')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_expired') return expiredData;
				if (key === 'dtx_temp_chart_test-simfile_broken') return 'invalid json';
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(true);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_expired'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_broken'
			);
		});

		it('should return false when simFileID is null and no temp data exists', () => {
			mockLocalStorage.length = 0;

			const result = TempChartStorage.existsAny(null);

			expect(result).toBe(false);
		});

		it('should return true when simFileID is null and temp data exists', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.getItem.mockReturnValue(validData);

			const result = TempChartStorage.existsAny(null);

			expect(result).toBe(true);
		});

		it('should skip invalid JSON entries', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_broken');
			mockLocalStorage.getItem.mockReturnValue('invalid json');

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(false);
		});

		it('should throw on localStorage errors so callers can handle storage failures', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => TempChartStorage.existsAny('test-simfile')).toThrow('Storage error');
		});

		it('should throw on localStorage errors for null simFileID (not swallow via load)', () => {
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => TempChartStorage.existsAny(null)).toThrow('Storage error');
		});

		it('should not skip keys when expired entries are removed mid-scan', () => {
			// This test verifies the collect-then-iterate pattern:
			// If we iterated by index while removing entries, removing an expired
			// entry would shift later keys left and cause the next valid entry to
			// be skipped. The fix collects all matching keys first, then iterates.
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			// Simulate real localStorage: keys shift after removal.
			// After removing 'expired' at index 0, 'master' would shift to index 0,
			// but index 1 (the old position) returns null. With the fix, both are
			// collected upfront so the shift doesn't matter.
			let keys = [
				'dtx_temp_chart_test-simfile_expired',
				'dtx_temp_chart_test-simfile_master'
			];
			mockLocalStorage.length = 2;
			mockLocalStorage.key.mockImplementation((i: number) => keys[i] ?? null);
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_expired') return expiredData;
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});
			mockLocalStorage.removeItem.mockImplementation((key: string) => {
				keys = keys.filter((k) => k !== key);
			});

			const result = TempChartStorage.existsAny('test-simfile');

			expect(result).toBe(true);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_expired'
			);
		});
	});

	describe('loadAny', () => {
		it('should return the available draft with difficulty for a simFileID', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_master');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBe('master');
			expect(result?.notes).toEqual(mockNotes);
			expect(result?.measureCount).toBe(4);
		});

		it('should return draft with null difficulty when key has no suffix', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile') return validData;
				return null;
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBeNull();
		});

		it('should return null when no data exists for simFileID', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_other-simfile');
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).toBeNull();
		});

		it('should skip expired entries', () => {
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});

			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_basic');
			mockLocalStorage.getItem.mockReturnValue(expiredData);

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).toBeNull();
		});

		it('removes expired and invalid matching entries while loading the newest draft', () => {
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 6,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 3;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_expired')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_broken')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_expired') return expiredData;
				if (key === 'dtx_temp_chart_test-simfile_broken') return 'invalid json';
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result?.difficulty).toBe('master');
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_expired'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_broken'
			);
		});

		it('should return null for null simFileID when no temp data exists', () => {
			mockLocalStorage.getItem.mockReturnValue(null);

			const result = TempChartStorage.loadAny(null);

			expect(result).toBeNull();
		});

		it('should return temp data for null simFileID when it exists', () => {
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.getItem.mockReturnValue(validData);

			const result = TempChartStorage.loadAny(null);

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBeNull();
		});

		it('should throw on localStorage errors so callers can handle storage failures', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => TempChartStorage.loadAny('test-simfile')).toThrow('Storage error');
		});

		it('should throw on localStorage errors for null simFileID (not swallow via load)', () => {
			mockLocalStorage.getItem.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => TempChartStorage.loadAny(null)).toThrow('Storage error');
		});

		it('should not skip keys when expired entries are removed mid-scan', () => {
			// Verifies the collect-then-iterate pattern prevents key-skipping
			// when readStoredData removes expired/corrupt entries.
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 6,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			let keys = [
				'dtx_temp_chart_test-simfile_expired',
				'dtx_temp_chart_test-simfile_master'
			];
			mockLocalStorage.length = 2;
			mockLocalStorage.key.mockImplementation((i: number) => keys[i] ?? null);
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_expired') return expiredData;
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});
			mockLocalStorage.removeItem.mockImplementation((key: string) => {
				keys = keys.filter((k) => k !== key);
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBe('master');
			expect(result?.measureCount).toBe(6);
		});

		it('should skip invalid JSON entries', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockReturnValue('dtx_temp_chart_test-simfile_broken');
			mockLocalStorage.getItem.mockReturnValue('invalid json');

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).toBeNull();
		});

		it('should return the newest matching draft when multiple drafts exist', () => {
			const olderTimestamp = Date.now() - 1000;
			const newerTimestamp = Date.now();

			const olderData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: { ...mockMetadata, title: 'Older Draft' },
				timestamp: olderTimestamp
			});
			const newerData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 8,
				metadata: { ...mockMetadata, title: 'Newer Draft' },
				timestamp: newerTimestamp
			});

			mockLocalStorage.length = 3;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_basic')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master')
				.mockReturnValueOnce('dtx_temp_chart_other-simfile_ext');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_basic') return olderData;
				if (key === 'dtx_temp_chart_test-simfile_master') return newerData;
				return null;
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBe('master');
			expect(result?.metadata.title).toBe('Newer Draft');
			expect(result?.measureCount).toBe(8);
		});

		it('should return the only valid draft when others are expired', () => {
			const expiredData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 4,
				metadata: mockMetadata,
				timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000
			});
			const validData = JSON.stringify({
				notes: mockNotes,
				bpmNotes: mockBpmNotes,
				measureCount: 6,
				metadata: mockMetadata,
				timestamp: Date.now()
			});

			mockLocalStorage.length = 2;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_basic')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master');
			mockLocalStorage.getItem.mockImplementation((key: string) => {
				if (key === 'dtx_temp_chart_test-simfile_basic') return expiredData;
				if (key === 'dtx_temp_chart_test-simfile_master') return validData;
				return null;
			});

			const result = TempChartStorage.loadAny('test-simfile');

			expect(result).not.toBeNull();
			expect(result?.difficulty).toBe('master');
			expect(result?.measureCount).toBe(6);
		});
	});

	describe('removeAllForSimfile', () => {
		it('should remove all difficulty-specific drafts for a simFileID', () => {
			mockLocalStorage.length = 4;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_basic')
				.mockReturnValueOnce('dtx_temp_chart_other-simfile_master')
				.mockReturnValueOnce('dtx_temp_chart_test-simfile');

			TempChartStorage.removeAllForSimfile('test-simfile');

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_basic'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test-simfile');
			expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith(
				'dtx_temp_chart_other-simfile_master'
			);
		});

		it('should remove the default temp key when simFileID is null', () => {
			TempChartStorage.removeAllForSimfile(null);

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_temp');
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage error');
			});

			expect(() => {
				TempChartStorage.removeAllForSimfile('test-simfile');
			}).not.toThrow();
		});

		it('should skip null keys while iterating', () => {
			mockLocalStorage.length = 3;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_master')
				.mockReturnValueOnce(null)
				.mockReturnValueOnce('dtx_temp_chart_test-simfile_basic');

			TempChartStorage.removeAllForSimfile('test-simfile');

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_master'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
				'dtx_temp_chart_test-simfile_basic'
			);
			expect(mockLocalStorage.removeItem).toHaveBeenCalledTimes(2);
		});
	});

	describe('clearAll', () => {
		it('should clear all temporary chart data', () => {
			// Mock localStorage with some keys
			mockLocalStorage.length = 5;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test1')
				.mockReturnValueOnce('other_key')
				.mockReturnValueOnce('dtx_temp_chart_test2')
				.mockReturnValueOnce('another_key')
				.mockReturnValueOnce('dtx_temp_chart_test3');

			TempChartStorage.clearAll();

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test1');
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test2');
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test3');
			expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('other_key');
			expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('another_key');
		});

		it('should ignore null keys while iterating localStorage', () => {
			mockLocalStorage.length = 3;
			mockLocalStorage.key
				.mockReturnValueOnce('dtx_temp_chart_test1')
				.mockReturnValueOnce(null)
				.mockReturnValueOnce('dtx_temp_chart_test2');

			TempChartStorage.clearAll();

			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test1');
			expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('dtx_temp_chart_test2');
			expect(mockLocalStorage.removeItem).toHaveBeenCalledTimes(2);
		});

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage error');
			});

			// Should not throw
			expect(() => {
				TempChartStorage.clearAll();
			}).not.toThrow();
		});

		it('should handle localStorage errors gracefully when length is non-zero', () => {
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			mockLocalStorage.length = 1;
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage unavailable');
			});
			expect(() => TempChartStorage.clearAll()).not.toThrow();
			expect(consoleSpy).toHaveBeenCalledWith(
				'Failed to clear temporary chart data:',
				expect.any(Error)
			);
			consoleSpy.mockRestore();
		});
	});

	describe('getStorageKey', () => {
		it('should return storage key with prefix for simFileID and difficulty', () => {
			const key = TempChartStorage.getStorageKey('song123', 'master');
			expect(key).toBe('dtx_temp_chart_song123_master');
		});

		it('should return default temp key when simFileID is null', () => {
			const key = TempChartStorage.getStorageKey(null, 'master');
			expect(key).toBe('dtx_temp_chart_temp');
		});
	});

	describe('buildStorageKey (via public methods)', () => {
		it('should handle various simFileID and difficulty combinations', () => {
			// Test through save method to verify internal buildStorageKey logic
			const testCases = [
				{
					simFileID: 'song123',
					difficulty: 'master',
					expected: 'dtx_temp_chart_song123_master'
				},
				{ simFileID: 'song123', difficulty: null, expected: 'dtx_temp_chart_song123' },
				{ simFileID: null, difficulty: 'master', expected: 'dtx_temp_chart_temp' },
				{ simFileID: '', difficulty: 'master', expected: 'dtx_temp_chart_temp' },
				{ simFileID: 'song123', difficulty: '', expected: 'dtx_temp_chart_song123' }
			];

			testCases.forEach(({ simFileID, difficulty, expected }) => {
				TempChartStorage.save(
					simFileID,
					difficulty,
					mockNotes,
					mockBpmNotes,
					4,
					mockMetadata
				);

				expect(mockLocalStorage.setItem).toHaveBeenCalledWith(expected, expect.any(String));

				mockLocalStorage.setItem.mockClear();
			});
		});
	});

	describe('integration tests', () => {
		it('should save and load data correctly', () => {
			const storage: Record<string, string> = {};
			mockLocalStorage.setItem.mockImplementation((key, value) => {
				storage[key] = value;
			});
			mockLocalStorage.getItem.mockImplementation((key) => {
				return storage[key] || null;
			});

			// Save data
			TempChartStorage.save(
				'integration-test',
				'extreme',
				mockNotes,
				mockBpmNotes,
				8,
				mockMetadata
			);

			// Load data
			const loadedData = TempChartStorage.load('integration-test', 'extreme');

			expect(loadedData).toBeTruthy();
			expect(loadedData?.notes).toEqual(mockNotes);
			expect(loadedData?.bpmNotes).toEqual(mockBpmNotes);
			expect(loadedData?.measureCount).toBe(8);
			expect(loadedData?.metadata).toEqual(mockMetadata);
		});

		it('should handle complete workflow with exists check', () => {
			const storage: Record<string, string> = {};
			mockLocalStorage.setItem.mockImplementation((key, value) => {
				storage[key] = value;
			});
			mockLocalStorage.getItem.mockImplementation((key) => {
				return storage[key] || null;
			});
			mockLocalStorage.removeItem.mockImplementation((key) => {
				delete storage[key];
			});

			const simFileID = 'workflow-test';
			const difficulty = 'advanced';

			// Initially should not exist
			expect(TempChartStorage.exists(simFileID, difficulty)).toBe(false);

			// Save data
			TempChartStorage.save(simFileID, difficulty, mockNotes, mockBpmNotes, 4, mockMetadata);

			// Should now exist
			expect(TempChartStorage.exists(simFileID, difficulty)).toBe(true);

			// Remove data
			TempChartStorage.remove(simFileID, difficulty);

			// Should no longer exist
			expect(TempChartStorage.exists(simFileID, difficulty)).toBe(false);
		});
	});
});
