/**
 * Service for loading asset files in dtx-desktop
 */

export interface AssetFile {
	fileName: string;
	size: number;
	lastModified: string;
	key: string;
}

/**
 * Load asset files for a simfile from the API via main process
 * @param simfileId The ID of the simfile
 * @returns Promise that resolves to an array of asset files
 */
export async function loadAssetFiles(simfileId: string): Promise<AssetFile[]> {
	if (!simfileId) {
		throw new Error('SimfileId is required');
	}

	return await window.electron.ipcRenderer.invoke('load-asset-files', simfileId);
}
