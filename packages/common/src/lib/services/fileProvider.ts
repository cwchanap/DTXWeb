/**
 * Abstract File Provider Interface
 *
 * This interface abstracts file operations to support different implementations:
 * - dtx-web: Files stored in browser memory via FileManager
 * - dtx-desktop: Files cached in Electron main process, accessed via IPC
 */

export interface IFileProvider {
	/**
	 * Get a file by its identifier
	 * @param simfileId - The simfile ID (null for local files)
	 * @param fileName - The filename
	 * @returns Promise resolving to File object or undefined if not found
	 */
	getFile(simfileId: string | null, fileName: string): Promise<File | undefined>;

	/**
	 * Store a file
	 * @param simfileId - The simfile ID (null for local files)
	 * @param fileName - The filename
	 * @param file - The File object to store
	 * @returns Promise resolving to success boolean
	 */
	setFile(simfileId: string | null, fileName: string, file: File): Promise<boolean>;

	/**
	 * Remove a file
	 * @param simfileId - The simfile ID (null for local files)
	 * @param fileName - The filename
	 * @returns Promise resolving to success boolean
	 */
	removeFile(simfileId: string | null, fileName: string): Promise<boolean>;

	/**
	 * Clear all files for a simfile (or all local files if simfileId is null)
	 * @param simfileId - The simfile ID (null for all local files)
	 * @returns Promise resolving to success boolean
	 */
	clearFiles(simfileId?: string | null): Promise<boolean>;

	/**
	 * Get all file identifiers
	 * @param simfileId - Optional simfile ID to filter by
	 * @returns Promise resolving to array of file identifiers
	 */
	getFileKeys(simfileId?: string | null): Promise<string[]>;
}

/**
 * Default file provider instance - will be set by each platform
 */
let fileProviderInstance: IFileProvider | null = null;

/**
 * Set the file provider implementation
 * This should be called once during app initialization by each platform
 */
export function setFileProvider(provider: IFileProvider): void {
	fileProviderInstance = provider;
}

/**
 * Get the current file provider instance
 * Throws error if no provider has been set
 */
export function getFileProvider(): IFileProvider {
	if (!fileProviderInstance) {
		throw new Error(
			'No file provider has been set. Call setFileProvider() during app initialization.'
		);
	}
	return fileProviderInstance;
}

/**
 * Convenience functions that delegate to the current provider
 * These maintain the same API as the original FileManager for easy migration
 */
export async function getFile(
	simfileId: string | null,
	fileName: string
): Promise<File | undefined> {
	return getFileProvider().getFile(simfileId, fileName);
}

export async function setFile(
	simfileId: string | null,
	fileName: string,
	file: File
): Promise<boolean> {
	return getFileProvider().setFile(simfileId, fileName, file);
}

export async function removeFile(simfileId: string | null, fileName: string): Promise<boolean> {
	return getFileProvider().removeFile(simfileId, fileName);
}

export async function clearFiles(simfileId?: string | null): Promise<boolean> {
	return getFileProvider().clearFiles(simfileId);
}

export async function getFileKeys(simfileId?: string | null): Promise<string[]> {
	return getFileProvider().getFileKeys(simfileId);
}

/**
 * Generate a unique key for a sound chip file (for backward compatibility)
 * @deprecated Use the provider methods directly instead
 */
export function generateKey(simfileId: string | null, fileName: string): string {
	return `${simfileId || 'local'}:${fileName}`;
}
