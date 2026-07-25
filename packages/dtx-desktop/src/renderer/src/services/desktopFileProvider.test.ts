import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopFileProvider } from './desktopFileProvider';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		readFile: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

describe('DesktopFileProvider', () => {
	let provider: DesktopFileProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new DesktopFileProvider();
	});

	describe('constructor', () => {
		it('initializes with no workspace root by default', () => {
			expect(provider.workspaceRoot).toBeNull();
		});

		it('initializes with provided workspace root', () => {
			const p = new DesktopFileProvider('/my/workspace');
			expect(p.workspaceRoot).toBe('/my/workspace');
		});

		it('initializes with null when empty string provided', () => {
			const p = new DesktopFileProvider('');
			expect(p.workspaceRoot).toBeNull();
		});
	});

	describe('setWorkspaceRoot', () => {
		it('sets the workspace root', () => {
			provider.setWorkspaceRoot('/new/workspace');
			expect(provider.workspaceRoot).toBe('/new/workspace');
		});

		it('clears file cache when workspace changes', async () => {
			provider.setWorkspaceRoot('/workspace');
			const mockFile = new File(['content'], 'test.dtx');
			await provider.setFile('sim1', 'test.dtx', mockFile);

			const keysBefore = await provider.getFileKeys('sim1');
			expect(keysBefore).toHaveLength(1);

			provider.setWorkspaceRoot('/new/workspace');
			const keysAfter = await provider.getFileKeys('sim1');
			expect(keysAfter).toHaveLength(0);
		});
	});

	describe('getWorkspaceRoot', () => {
		it('returns empty string when no workspace root set', () => {
			expect(provider.getWorkspaceRoot()).toBe('');
		});

		it('returns the workspace root when set', () => {
			provider.setWorkspaceRoot('/my/workspace');
			expect(provider.getWorkspaceRoot()).toBe('/my/workspace');
		});
	});

	describe('getFile', () => {
		it('returns undefined when no workspace root is set', async () => {
			const file = await provider.getFile('sim1', 'test.dtx');
			expect(file).toBeUndefined();
		});

		it('calls host with correct file path for simfile-specific files', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: 'file content'
			});

			await provider.getFile('sim1', 'test.dtx');

			expect(host.readFile).toHaveBeenCalledWith('/workspace/sim1/test.dtx');
		});

		it('calls host with workspace root path for local files (null simfileId)', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: 'file content'
			});

			await provider.getFile(null, 'test.dtx');

			expect(host.readFile).toHaveBeenCalledWith('/workspace/test.dtx');
		});

		it('normalizes DTX backslash sample paths before reading from the local filesystem', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			await provider.getFile(null, 'sound\\kick.wav');

			expect(host.readFile).toHaveBeenCalledWith('/workspace/sound/kick.wav');
		});

		it('returns undefined when host returns error', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: 'File not found',
				content: ''
			});

			const file = await provider.getFile('sim1', 'test.dtx');
			expect(file).toBeUndefined();
		});

		it('returns File object on success', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: 'dtx content'
			});

			const file = await provider.getFile('sim1', 'chart.dtx');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('chart.dtx');
		});

		it('caches files after first fetch', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: 'dtx content'
			});

			await provider.getFile('sim1', 'chart.dtx');
			await provider.getFile('sim1', 'chart.dtx');

			expect(host.readFile).toHaveBeenCalledTimes(1);
		});

		it('dedupes cache entries for backslash and forward-slash variants of the same file', async () => {
			// generateKey must normalize fileName so that 'foo\\bar.wav' and
			// 'foo/bar.wav' share a single cache entry instead of duplicating.
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: 'audio content'
			});

			await provider.getFile('sim1', 'sound\\kick.wav');
			await provider.getFile('sim1', 'sound/kick.wav');

			expect(host.readFile).toHaveBeenCalledTimes(1);
		});

		it('returns undefined when host throws an error', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockRejectedValue(new Error('IPC error'));

			const file = await provider.getFile('sim1', 'test.dtx');
			expect(file).toBeUndefined();
		});

		it('rejects parent-directory traversal without calling the host', async () => {
			// Defense-in-depth: the renderer must not send `..` segments to the
			// Rust IPC layer, even though read_file_path_inner canonicalizes
			// and enforces workspace containment authoritatively.
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({ error: null, content: 'secret' });

			const file = await provider.getFile('sim1', '../escape.dtx');
			expect(file).toBeUndefined();
			expect(host.readFile).not.toHaveBeenCalled();
		});

		it('rejects backslash-encoded parent-directory traversal', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({ error: null, content: 'secret' });

			const file = await provider.getFile(null, '..\\..\\etc\\passwd');
			expect(file).toBeUndefined();
			expect(host.readFile).not.toHaveBeenCalled();
		});

		it('rejects nested parent-directory traversal segments', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({ error: null, content: 'secret' });

			const file = await provider.getFile('sim1', 'songs/../etc/passwd');
			expect(file).toBeUndefined();
			expect(host.readFile).not.toHaveBeenCalled();
		});

		it('returns File for audio files with binary content', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'audio.wav');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('audio.wav');
		});

		it('returns File for ogg audio files', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'audio.ogg');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('audio.ogg');
		});

		it('returns File for xa audio files', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'audio.xa');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('audio.xa');
		});

		it('returns File for mp3 audio files', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'audio.mp3');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('audio.mp3');
		});

		it('returns File for def files', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'set.def');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('set.def');
		});

		it('returns File for unknown extensions', async () => {
			provider.setWorkspaceRoot('/workspace');
			host.readFile.mockResolvedValue({
				error: null,
				content: new Uint8Array([1, 2, 3])
			});

			const file = await provider.getFile('sim1', 'file.bin');
			expect(file).toBeInstanceOf(File);
			expect(file?.name).toBe('file.bin');
		});
	});

	describe('setFile', () => {
		it('stores file in cache', async () => {
			const mockFile = new File(['content'], 'test.dtx');
			const result = await provider.setFile('sim1', 'test.dtx', mockFile);

			expect(result).toBe(true);
			const keys = await provider.getFileKeys('sim1');
			expect(keys).toContain('test.dtx');
		});

		it('overwrites existing cached file', async () => {
			const file1 = new File(['content1'], 'test.dtx');
			const file2 = new File(['content2'], 'test.dtx');

			await provider.setFile('sim1', 'test.dtx', file1);
			await provider.setFile('sim1', 'test.dtx', file2);

			const retrieved = await provider.getFile('sim1', 'test.dtx');
			// getFile from cache should return the second file (same reference)
			expect(retrieved).toBeInstanceOf(File);
			expect(retrieved?.name).toBe(file2.name);
			expect(retrieved).toBe(file2);
		});

		it('stores local file with null simfileId', async () => {
			const mockFile = new File(['content'], 'local.dtx');
			const result = await provider.setFile(null, 'local.dtx', mockFile);

			expect(result).toBe(true);
			const keys = await provider.getFileKeys(null);
			expect(keys).toContain('local.dtx');
		});
	});

	describe('removeFile', () => {
		it('removes a cached file', async () => {
			const mockFile = new File(['content'], 'test.dtx');
			await provider.setFile('sim1', 'test.dtx', mockFile);

			const result = await provider.removeFile('sim1', 'test.dtx');
			expect(result).toBe(true);

			const keys = await provider.getFileKeys('sim1');
			expect(keys).not.toContain('test.dtx');
		});

		it('returns false when file does not exist in cache', async () => {
			const result = await provider.removeFile('sim1', 'nonexistent.dtx');
			expect(result).toBe(false);
		});

		it('removes local file with null simfileId', async () => {
			const mockFile = new File(['content'], 'local.dtx');
			await provider.setFile(null, 'local.dtx', mockFile);

			const result = await provider.removeFile(null, 'local.dtx');
			expect(result).toBe(true);
		});
	});

	describe('clearFiles', () => {
		it('clears all files when called without argument', async () => {
			await provider.setFile('sim1', 'file1.dtx', new File([''], 'file1.dtx'));
			await provider.setFile('sim2', 'file2.dtx', new File([''], 'file2.dtx'));

			const result = await provider.clearFiles();
			expect(result).toBe(true);

			const allKeys = await provider.getFileKeys();
			expect(allKeys).toHaveLength(0);
		});

		it('clears files for specific simfileId only', async () => {
			await provider.setFile('sim1', 'file1.dtx', new File([''], 'file1.dtx'));
			await provider.setFile('sim2', 'file2.dtx', new File([''], 'file2.dtx'));

			await provider.clearFiles('sim1');

			const sim1Keys = await provider.getFileKeys('sim1');
			expect(sim1Keys).toHaveLength(0);

			const sim2Keys = await provider.getFileKeys('sim2');
			expect(sim2Keys).toContain('file2.dtx');
		});

		it('clears local files when null passed', async () => {
			await provider.setFile(null, 'local.dtx', new File([''], 'local.dtx'));
			await provider.setFile('sim1', 'sim.dtx', new File([''], 'sim.dtx'));

			await provider.clearFiles(null);

			const localKeys = await provider.getFileKeys(null);
			expect(localKeys).toHaveLength(0);

			const simKeys = await provider.getFileKeys('sim1');
			expect(simKeys).toContain('sim.dtx');
		});
	});

	describe('getFileKeys', () => {
		it('returns all keys when called without argument', async () => {
			await provider.setFile('sim1', 'file1.dtx', new File([''], 'file1.dtx'));
			await provider.setFile('sim2', 'file2.dtx', new File([''], 'file2.dtx'));

			const keys = await provider.getFileKeys();
			expect(keys).toHaveLength(2);
		});

		it('returns only filenames for specific simfileId', async () => {
			await provider.setFile('sim1', 'file1.dtx', new File([''], 'file1.dtx'));
			await provider.setFile('sim1', 'file2.wav', new File([''], 'file2.wav'));
			await provider.setFile('sim2', 'other.dtx', new File([''], 'other.dtx'));

			const keys = await provider.getFileKeys('sim1');
			expect(keys).toHaveLength(2);
			expect(keys).toContain('file1.dtx');
			expect(keys).toContain('file2.wav');
			expect(keys).not.toContain('other.dtx');
		});

		it('returns empty array for simfileId with no files', async () => {
			const keys = await provider.getFileKeys('nonexistent');
			expect(keys).toHaveLength(0);
		});
	});
});
