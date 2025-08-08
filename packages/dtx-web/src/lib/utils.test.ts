import { describe, it, expect } from 'vitest';
import { formatLevelDisplay, filterFiles } from './utils';
import type { Tables } from '@dtx/common';

describe('utils', () => {
	describe('formatLevelDisplay', () => {
		it('should format level display for normal levels', () => {
			const dtxFiles: Tables<'dtx_files'>[] = [
				{
					level: 25,
					id: '1',
					title: 'Test 1',
					artist: 'Artist 1',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 15,
					id: '2',
					title: 'Test 2',
					artist: 'Artist 2',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 35,
					id: '3',
					title: 'Test 3',
					artist: 'Artist 3',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50 / 3.50');
		});

		it('should format level display for high levels (> 100)', () => {
			const dtxFiles: Tables<'dtx_files'>[] = [
				{
					level: 150,
					id: '1',
					title: 'Test 1',
					artist: 'Artist 1',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 250,
					id: '2',
					title: 'Test 2',
					artist: 'Artist 2',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50');
		});

		it('should handle mixed level ranges', () => {
			const dtxFiles: Tables<'dtx_files'>[] = [
				{
					level: 25,
					id: '1',
					title: 'Test 1',
					artist: 'Artist 1',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 150,
					id: '2',
					title: 'Test 2',
					artist: 'Artist 2',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			// level 25 -> 25/10 = 2.50, level 150 -> 150/100 = 1.50
			// After sorting by level: 25 (2.50), 150 (1.50)
			expect(result).toBe('2.50 / 1.50');
		});

		it('should handle null levels', () => {
			const dtxFiles: Tables<'dtx_files'>[] = [
				{
					level: null,
					id: '1',
					title: 'Test 1',
					artist: 'Artist 1',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 25,
					id: '2',
					title: 'Test 2',
					artist: 'Artist 2',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('0.00 / 2.50');
		});

		it('should return N/A for empty or undefined array', () => {
			expect(formatLevelDisplay([])).toBe('N/A');
			expect(formatLevelDisplay(undefined as any)).toBe('N/A');
		});

		it('should sort levels correctly', () => {
			const dtxFiles: Tables<'dtx_files'>[] = [
				{
					level: 35,
					id: '3',
					title: 'Test 3',
					artist: 'Artist 3',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 15,
					id: '1',
					title: 'Test 1',
					artist: 'Artist 1',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				},
				{
					level: 25,
					id: '2',
					title: 'Test 2',
					artist: 'Artist 2',
					simfile_id: 'sim1',
					created_at: '',
					updated_at: '',
					preview_url: null,
					dlevel: null
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50 / 3.50');
		});
	});

	describe('filterFiles', () => {
		const createFile = (name: string): File => {
			return new File(['content'], name, { type: 'text/plain' });
		};

		it('should filter files by extension', () => {
			const files = [
				createFile('song.dtx'),
				createFile('audio.wav'),
				createFile('background.jpg'),
				createFile('chart.dtx')
			];

			const result = filterFiles(files, ['.dtx']);
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('song.dtx');
			expect(result[1].name).toBe('chart.dtx');
		});

		it('should handle multiple extensions', () => {
			const files = [
				createFile('song.dtx'),
				createFile('audio.wav'),
				createFile('audio.mp3'),
				createFile('background.jpg')
			];

			const result = filterFiles(files, ['.wav', '.mp3']);
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('audio.wav');
			expect(result[1].name).toBe('audio.mp3');
		});

		it('should be case insensitive', () => {
			const files = [
				createFile('song.DTX'),
				createFile('audio.WAV'),
				createFile('background.jpg')
			];

			const result = filterFiles(files, ['.dtx', '.wav']);
			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('song.DTX');
			expect(result[1].name).toBe('audio.WAV');
		});

		it('should handle files without extensions', () => {
			const files = [createFile('readme'), createFile('song.dtx')];

			const result = filterFiles(files, ['.dtx']);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('song.dtx');
		});

		it('should handle empty filter list', () => {
			const files = [createFile('song.dtx'), createFile('audio.wav')];

			const result = filterFiles(files, []);
			expect(result).toHaveLength(0);
		});

		it('should handle FileList input', () => {
			const files = [createFile('song.dtx'), createFile('audio.wav')] as any as FileList;

			const result = filterFiles(files, ['.dtx']);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('song.dtx');
		});
	});
});
