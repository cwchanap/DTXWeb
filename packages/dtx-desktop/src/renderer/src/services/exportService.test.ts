import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
import { settingsStore } from '../stores/settingsStore';

vi.mock('./desktopHost', () => ({
	desktopHost: { exportSongToZip: vi.fn() }
}));

import { desktopHost } from './desktopHost';
import { exportSelectedSong } from './exportService';

const makeSong = (path: string, name = 'Song'): TreeNode => ({
	name,
	path,
	isExpanded: false,
	isLoading: false,
	children: [],
	hasChildren: false
});

describe('exportSelectedSong', () => {
	beforeEach(() => {
		workspaceStore.reset();
		vi.mocked(desktopHost.exportSongToZip).mockReset();
		settingsStore.set({ exportDirectory: '/out' });
	});

	it('returns success:false and does not call the host when no song is selected', async () => {
		const result = await exportSelectedSong();
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
		expect(desktopHost.exportSongToZip).not.toHaveBeenCalled();
	});

	it('exports the selected song via desktopHost with the right params', async () => {
		vi.mocked(desktopHost.exportSongToZip).mockResolvedValue({
			success: true,
			zipPath: '/out/foo.zip',
			filesCount: 3
		});
		workspaceStore.selectSong(makeSong('/songs/foo', 'Foo'));

		const result = await exportSelectedSong();

		expect(desktopHost.exportSongToZip).toHaveBeenCalledWith({
			songPath: '/songs/foo',
			songTitle: 'Foo',
			exportDirectory: '/out',
			workspaceRoot: ''
		});
		expect(result).toEqual({ success: true, zipPath: '/out/foo.zip', filesCount: 3 });
	});

	it('returns a structured error when the host throws', async () => {
		vi.mocked(desktopHost.exportSongToZip).mockRejectedValue(new Error('disk full'));
		workspaceStore.selectSong(makeSong('/songs/foo'));

		const result = await exportSelectedSong();

		expect(result.success).toBe(false);
		expect(result.error).toBe('disk full');
	});
});
