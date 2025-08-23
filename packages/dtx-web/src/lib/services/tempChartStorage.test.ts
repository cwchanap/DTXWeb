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

		it('should handle localStorage errors gracefully', () => {
			mockLocalStorage.key.mockImplementation(() => {
				throw new Error('Storage error');
			});

			// Should not throw
			expect(() => {
				TempChartStorage.clearAll();
			}).not.toThrow();
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
