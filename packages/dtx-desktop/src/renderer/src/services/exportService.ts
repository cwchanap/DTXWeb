import { get } from 'svelte/store';
import { workspaceStore } from '../stores/workspaceStore';
import { settingsStore } from '../stores/settingsStore';
import { desktopHost } from './desktopHost';

export interface ExportResult {
	success: boolean;
	zipPath?: string;
	filesCount?: number;
	error?: string;
}

/**
 * Export the currently-selected local song to a ZIP via the Rust backend.
 * Reuses existing store data (no new services) per the command-palette spec §7.
 * Returns a structured result so callers decide how to surface success/error.
 * Returns `{ success: false }` when no local song is selected (no-op).
 */
export const exportSelectedSong = async (): Promise<ExportResult> => {
	const { selectedSong } = get(workspaceStore);
	if (!selectedSong?.path) {
		return { success: false, error: 'No song selected' };
	}
	try {
		const result = await desktopHost.exportSongToZip<ExportResult>({
			songPath: selectedSong.path,
			songTitle: selectedSong.name || 'song',
			exportDirectory: get(settingsStore).exportDirectory
		});
		return result;
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to export song'
		};
	}
};
