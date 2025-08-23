import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('fs', () => ({
	default: {
		promises: {
			readdir: vi.fn(),
			readFile: vi.fn(),
			stat: vi.fn()
		}
	}
}));

vi.mock('electron', () => ({
	dialog: { showOpenDialog: vi.fn() }
}));

vi.mock('@dtx/common/server', async (importOriginal) => {
	const actual = (await importOriginal()) as object;
	return {
		...actual,
		decodeFileWithEncodingDetection: vi
			.fn()
			.mockResolvedValue({ content: '#TITLE:Hello\n#ARTIST:World', encoding: 'utf-8' }),
		// Minimal SimFile mock for parseHeader(title)
		SimFile: vi.fn().mockImplementation(() => ({
			title: 'Mock Song',
			parseHeader: vi.fn().mockResolvedValue(undefined)
		}))
	};
});

import fs from 'fs';
import path from 'path';
import { loadTreeStructure, readFile, type ReadFileResult } from './filesystem';
import { decodeFileWithEncodingDetection } from '@dtx/common/server';

describe('filesystem utilities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('loadTreeStructure', () => {
		it('includes folders with .dtx files and reads SET.def title', async () => {
			// Top-level has one directory
			(fs.promises.readdir as unknown as Mock)
				.mockResolvedValueOnce([{ name: 'DTXFiles.Songs', isDirectory: () => true }])
				// Sub-entries for that directory
				.mockResolvedValueOnce([
					{ name: 'set.def', isFile: () => true, isDirectory: () => false },
					{ name: 'song1.dtx', isFile: () => true, isDirectory: () => false }
				]);

			(fs.promises.readFile as unknown as Mock).mockResolvedValue(Buffer.from('SET.DEF'));

			const nodes = await loadTreeStructure('/music');
			expect(nodes).toHaveLength(1);
			expect(nodes[0].name).toBe('DTXFiles.Songs');
			expect(nodes[0].containsDtxFiles).toBe(true);
			expect(nodes[0].songTitle).toBe('Mock Song');
			// When containsDtxFiles is true, hasChildren should be false
			expect(nodes[0].hasChildren).toBe(false);
		});

		it('keeps DTXFiles.* folders even without .dtx files', async () => {
			(fs.promises.readdir as unknown as Mock)
				.mockResolvedValueOnce([{ name: 'DTXFiles.Empty', isDirectory: () => true }])
				.mockResolvedValueOnce([
					{ name: 'notes.txt', isFile: () => true, isDirectory: () => false }
				]);

			const nodes = await loadTreeStructure('/music');
			expect(nodes).toHaveLength(1);
			expect(nodes[0].name).toBe('DTXFiles.Empty');
			expect(nodes[0].containsDtxFiles).toBe(false);
		});

		it('handles subdirectory read errors gracefully', async () => {
			(fs.promises.readdir as unknown as Mock)
				.mockResolvedValueOnce([{ name: 'DTXFiles.Bad', isDirectory: () => true }])
				.mockRejectedValueOnce(new Error('permission denied'));

			const nodes = await loadTreeStructure('/music');
			expect(nodes).toHaveLength(1);
			expect(nodes[0].name).toBe('DTXFiles.Bad');
			expect(nodes[0].containsDtxFiles).toBe(false);
			expect(nodes[0].songTitle).toBeNull();
		});
	});

	describe('readFile', () => {
		const base = process.platform === 'win32' ? 'C:/allowed' : '/allowed';

		it('rejects paths outside workspace root', async () => {
			const filePath = path.join(base, '..', 'other', 'file.dtx');
			const res = await readFile(filePath, base);
			expect(res).toEqual({ error: 'Invalid file path', content: '' });
		});

		it('rejects disallowed file types', async () => {
			const filePath = path.join(base, 'note.txt');
			const res = await readFile(filePath, base);
			expect(res).toEqual({ error: 'File type not allowed', content: '' });
		});

		it('returns error for files exceeding size limit', async () => {
			const filePath = path.join(base, 'large.dtx');
			(fs.promises.stat as unknown as Mock).mockResolvedValue({ size: 2 * 1024 * 1024 });
			const res = await readFile(filePath, base);
			expect(res.error).toBe('File too large');
		});

		it('reads .dtx as text with encoding detection', async () => {
			const filePath = path.join(base, 'chart.dtx');
			(fs.promises.stat as unknown as Mock).mockResolvedValue({ size: 10 });
			(fs.promises.readFile as unknown as Mock).mockResolvedValue(Buffer.from('mock'));

			const res = (await readFile(filePath, base)) as Extract<
				ReadFileResult,
				{ isText: true }
			>;
			expect(res.error).toBeNull();
			expect(res.isText).toBe(true);
			expect(res.content).toContain('#TITLE');
			expect(decodeFileWithEncodingDetection).toHaveBeenCalled();
		});

		it('reads audio files as binary buffer', async () => {
			const filePath = path.join(base, 'preview.mp3');
			(fs.promises.stat as unknown as Mock).mockResolvedValue({ size: 1024 });
			const buf = Buffer.from('mp3data');
			(fs.promises.readFile as unknown as Mock).mockResolvedValue(buf);

			const res = (await readFile(filePath, base)) as Extract<
				ReadFileResult,
				{ isText: false }
			>;
			expect(res.error).toBeNull();
			expect(res.isText).toBe(false);
			expect(res.content).toBe(buf);
		});
	});
});
