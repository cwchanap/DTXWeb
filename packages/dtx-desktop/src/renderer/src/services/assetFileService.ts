/**
 * Service for loading asset files in dtx-desktop
 */
import { desktopHost } from './desktopHost';

export interface AssetFile {
	fileName: string;
	size: number;
	lastModified: string;
	key: string;
}

export type AssetFilesResult =
	| { success: true; data: AssetFile[] }
	| { success: false; error: string };

/**
 * Load asset files for a simfile from the API via main process
 * @param simfileId The ID of the simfile
 * @returns Promise that resolves to a discriminated result with files or error
 */
export async function loadAssetFiles(simfileId: string): Promise<AssetFilesResult> {
	if (!simfileId) {
		throw new Error('SimfileId is required');
	}

	return await desktopHost.loadAssetFiles(simfileId);
}
