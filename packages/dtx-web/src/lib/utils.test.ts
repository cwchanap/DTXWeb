import { describe, it, expect } from 'vitest';
import { formatLevel, formatLevelDisplay, filterFiles, buildPreviewUrl } from './utils';
import type { DtxFileRow } from '@dtx/common';

describe('utils', () => {
	describe('formatLevel', () => {
		it('decodes an encoded ×10 integer to two decimals', () => {
			expect(formatLevel(50)).toBe('5.00');
			expect(formatLevel(55)).toBe('5.50');
		});

		it('decodes an encoded ×100 integer (values > 100)', () => {
			expect(formatLevel(550)).toBe('5.50');
			expect(formatLevel(880)).toBe('8.80');
		});

		it('decodes a bare single-digit integer on the ×10 scale', () => {
			// With the DTXManiaCX formula, 1–9 decode as 0.1–0.9 (×10 branch:
			// level < 100 → level/10 + 0/100). Migration 0004 and
			// normalizeLegacyLevel convert bare 1–9 to ×100 (100–900) at the
			// DB/API boundary, so bare 1–9 reaching this function are
			// un-migrated legacy rows or data-entry errors.
			expect(formatLevel(1)).toBe('0.10');
			expect(formatLevel(5)).toBe('0.50');
			expect(formatLevel(9)).toBe('0.90');
		});

		it('decodes level = 100 as ×100 scale (1.00), not ×10 scale (10.00)', () => {
			// DTXManiaCX formula: level >= 100 → level / 100.
			// Fixes the migration 0004 boundary error.
			expect(formatLevel(100)).toBe('1.00');
		});

		it('treats a stray decimal as already display-scale (not ÷10)', () => {
			// The GraphQL schema exposes `level` as Float, so 5.5 can arrive even
			// though the canonical form is the encoded integer 55. Dividing again
			// would yield 0.55 — the ScoreCard/ChartListItem P2 bug.
			expect(formatLevel(5.5)).toBe('5.50');
			expect(formatLevel(8.75)).toBe('8.75');
		});

		it('parses string levels and treats non-finite as zero', () => {
			expect(formatLevel('20')).toBe('2.00');
			expect(formatLevel('invalid')).toBe('0.00');
			expect(formatLevel(undefined)).toBe('0.00');
			expect(formatLevel(null)).toBe('0.00');
		});
	});

	describe('formatLevelDisplay', () => {
		it('should format level display for normal levels', () => {
			const dtxFiles: DtxFileRow[] = [
				{
					level: 25,
					id: 1,
					label: 'Test 1',
					simfile_id: 1
				},
				{
					level: 15,
					id: 2,
					label: 'Test 2',
					simfile_id: 1
				},
				{
					level: 35,
					id: 3,
					label: 'Test 3',
					simfile_id: 1
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50 / 3.50');
		});

		it('should format level display for high levels (> 100)', () => {
			const dtxFiles: DtxFileRow[] = [
				{
					level: 150,
					id: 1,
					label: 'Test 1',
					simfile_id: 1
				},
				{
					level: 250,
					id: 2,
					label: 'Test 2',
					simfile_id: 1
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50');
		});

		it('should handle mixed level ranges', () => {
			const dtxFiles: DtxFileRow[] = [
				{
					level: 25,
					id: 1,
					label: 'Test 1',
					simfile_id: 1
				},
				{
					level: 150,
					id: 2,
					label: 'Test 2',
					simfile_id: 1
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			// level 25 -> 25/10 = 2.50, level 150 -> 150/100 = 1.50
			// After sorting by level: 25 (2.50), 150 (1.50)
			expect(result).toBe('2.50 / 1.50');
		});

		it('should handle zero levels', () => {
			const dtxFiles: DtxFileRow[] = [
				{
					level: 0,
					id: 1,
					label: 'Test 1',
					simfile_id: 1
				},
				{
					level: 25,
					id: 2,
					label: 'Test 2',
					simfile_id: 1
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
			const dtxFiles: DtxFileRow[] = [
				{
					level: 35,
					id: 3,
					label: 'Test 3',
					simfile_id: 1
				},
				{
					level: 15,
					id: 1,
					label: 'Test 1',
					simfile_id: 1
				},
				{
					level: 25,
					id: 2,
					label: 'Test 2',
					simfile_id: 1
				}
			];

			const result = formatLevelDisplay(dtxFiles);
			expect(result).toBe('1.50 / 2.50 / 3.50');
		});

		it('should not mutate the original dtx_files array order', () => {
			const dtxFiles: DtxFileRow[] = [
				{ level: 35, id: 3, label: 'Third', simfile_id: 1 },
				{ level: 15, id: 1, label: 'First', simfile_id: 1 },
				{ level: 25, id: 2, label: 'Second', simfile_id: 1 }
			];

			formatLevelDisplay(dtxFiles);

			expect(dtxFiles.map((file) => file.label)).toEqual(['Third', 'First', 'Second']);
		});

		it('should treat non-finite string levels as zero during sorting', () => {
			const dtxFiles: Array<{ level?: string | number }> = [
				{ level: 'invalid' },
				{ level: '20' },
				{ level: undefined }
			];

			const result = formatLevelDisplay(dtxFiles);

			expect(result).toBe('0.00 / 0.00 / 2.00');
		});

		// Regression guard: the GraphQL schema exposes `level` as a Float, so a
		// stray decimal (e.g. 5.5) can arrive even though the canonical form is
		// the encoded integer 55. formatLevel treats a non-integer as already
		// display-scale (returns it as-is rather than ÷10). This pins that
		// formatLevelDisplay inherits that passthrough — a future "fix" to
		// formatLevel that always divides must not silently regress
		// ChartListItem/ScoreCard rendering. Without this assertion, all other
		// formatLevelDisplay tests use integer levels and would still pass.
		it('passes stray decimal levels through as display-scale (not ÷10)', () => {
			const dtxFiles: Array<{ level?: string | number }> = [{ level: 5.5 }, { level: 8.75 }];

			const result = formatLevelDisplay(dtxFiles);

			expect(result).toBe('5.50 / 8.75');
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

		it('should use the last extension segment for multi-dot filenames', () => {
			const files = [createFile('archive.tar.gz'), createFile('song.backup.dtx')];

			const result = filterFiles(files, ['.gz', '.dtx']);

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('archive.tar.gz');
			expect(result[1].name).toBe('song.backup.dtx');
		});
	});

	describe('buildPreviewUrl', () => {
		it('should construct correct preview URL for valid inputs', () => {
			const result = buildPreviewUrl('https://example.com/bucket', 1, 'jpg');
			expect(result).toBe('https://example.com/bucket/1/preview.jpg');
		});

		it('should construct correct preview URL for mp3 extension', () => {
			const result = buildPreviewUrl('https://example.com/bucket', 1, 'mp3');
			expect(result).toBe('https://example.com/bucket/1/preview.mp3');
		});

		it('should normalize trailing slash in bucket URL', () => {
			const result = buildPreviewUrl('https://example.com/bucket/', 1, 'jpg');
			expect(result).toBe('https://example.com/bucket/1/preview.jpg');
		});

		it('should return null for undefined itemId', () => {
			const result = buildPreviewUrl('https://example.com/bucket', undefined, 'jpg');
			expect(result).toBeNull();
		});

		it('should return null for zero itemId', () => {
			const result = buildPreviewUrl('https://example.com/bucket', 0, 'jpg');
			expect(result).toBeNull();
		});

		it('should return null for negative itemId', () => {
			const result = buildPreviewUrl('https://example.com/bucket', -1, 'jpg');
			expect(result).toBeNull();
		});

		it('should handle different simfile IDs', () => {
			expect(buildPreviewUrl('https://example.com/bucket', 42, 'jpg')).toBe(
				'https://example.com/bucket/42/preview.jpg'
			);
			expect(buildPreviewUrl('https://example.com/bucket', 100, 'mp3')).toBe(
				'https://example.com/bucket/100/preview.mp3'
			);
		});
	});
});
