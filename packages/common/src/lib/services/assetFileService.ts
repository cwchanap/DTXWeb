/**
 * Service for loading asset files in dtx-web
 */

export interface AssetFile {
	fileName: string;
	size: number;
	lastModified: string;
	key: string;
}

/**
 * Load asset files for a simfile from the API
 * @param simfileId The ID of the simfile
 * @returns Promise that resolves to an array of asset files
 */
export async function loadAssetFiles(simfileId: string): Promise<AssetFile[]> {
	if (!simfileId) {
		throw new Error('SimfileId is required');
	}

	// Use relative URL which works with SvelteKit's proxy to the main web app
	const url = `/api/simFile/listFiles/${simfileId}`;

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Error fetching files: ${response.statusText}`);
	}

	const data = await response.json();
	return data.files;
}
