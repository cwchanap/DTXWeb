/**
 * File Manager Service
 * Manages File objects outside of Svelte stores to avoid serialization issues
 */

export class FileManager {
	private static files: Map<string, File> = new Map();

	/**
	 * Store a file with a unique key
	 */
	static setFile(key: string, file: File): void {
		this.files.set(key, file);
	}

	/**
	 * Get a file by key
	 */
	static getFile(key: string): File | undefined {
		const file = this.files.get(key);
		return file;
	}

	/**
	 * Remove a file by key
	 */
	static removeFile(key: string): boolean {
		return this.files.delete(key);
	}

	/**
	 * Clear all files
	 */
	static clear(): void {
		this.files.clear();
	}

	/**
	 * Generate a unique key for a sound chip file
	 */
	static generateKey(simfileId: string | null, fileName: string): string {
		return `${simfileId || 'local'}:${fileName}`;
	}

	/**
	 * Get all stored file keys
	 */
	static getKeys(): string[] {
		return Array.from(this.files.keys());
	}
}
