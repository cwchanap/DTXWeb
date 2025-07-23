/**
 * File Manager Service
 * Manages File objects outside of Svelte stores to avoid serialization issues
 */

// Module-level Map to store files
const files: Map<string, File> = new Map();

/**
 * Store a file with a unique key
 */
export function setFile(key: string, file: File): void {
	files.set(key, file);
}

/**
 * Get a file by key
 */
export function getFile(key: string): File | undefined {
	return files.get(key);
}

/**
 * Remove a file by key
 */
export function removeFile(key: string): boolean {
	return files.delete(key);
}

/**
 * Clear all files
 */
export function clear(): void {
	files.clear();
}

/**
 * Generate a unique key for a sound chip file
 */
export function generateKey(simfileId: string | null, fileName: string): string {
	return `${simfileId || 'local'}:${fileName}`;
}

/**
 * Get all stored file keys
 */
export function getKeys(): string[] {
	return Array.from(files.keys());
}
