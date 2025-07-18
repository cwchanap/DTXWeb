/**
 * Sound Library Service
 * Manages a local library of audio files for DTX charts
 */

export interface SoundLibraryFile {
	hash: string; // SHA-256 hash of file content
	fileName: string; // Original filename
	fileType: string; // MIME type
	fileData: string; // Base64 encoded file data
	size: number; // File size in bytes
	dateAdded: number; // Timestamp when added
}

export class SoundLibrary {
	private static readonly STORAGE_KEY = 'dtx_sound_library';
	private static readonly MAX_STORAGE_SIZE = 50 * 1024 * 1024; // 50MB limit

	/**
	 * Get all files in the sound library
	 */
	static getAll(): SoundLibraryFile[] {
		try {
			const data = localStorage.getItem(this.STORAGE_KEY);
			return data ? JSON.parse(data) : [];
		} catch (error) {
			console.error('Failed to load sound library:', error);
			return [];
		}
	}

	/**
	 * Add files to the sound library
	 */
	static async addFiles(
		files: File[]
	): Promise<{ added: number; skipped: number; errors: string[] }> {
		const library = this.getAll();
		const errors: string[] = [];
		let added = 0;
		let skipped = 0;

		for (const file of files) {
			try {
				// Check if file is audio
				if (!file.type.startsWith('audio/')) {
					errors.push(`${file.name}: Not an audio file`);
					continue;
				}

				// Generate hash
				const hash = await this.generateFileHash(file);

				// Check if file already exists
				if (library.find((f) => f.hash === hash)) {
					skipped++;
					continue;
				}

				// Check storage limit
				const totalSize = library.reduce((sum, f) => sum + f.size, 0) + file.size;
				if (totalSize > this.MAX_STORAGE_SIZE) {
					errors.push(
						`${file.name}: Would exceed storage limit (${Math.round(this.MAX_STORAGE_SIZE / 1024 / 1024)}MB)`
					);
					continue;
				}

				// Convert to base64
				const fileData = await this.fileToBase64(file);

				// Add to library
				const libraryFile: SoundLibraryFile = {
					hash,
					fileName: file.name,
					fileType: file.type,
					fileData,
					size: file.size,
					dateAdded: Date.now()
				};

				library.push(libraryFile);
				added++;
			} catch (error) {
				errors.push(
					`${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		}

		// Save updated library
		try {
			localStorage.setItem(this.STORAGE_KEY, JSON.stringify(library));
		} catch (error) {
			errors.push('Failed to save to localStorage');
		}

		return { added, skipped, errors };
	}

	/**
	 * Remove a file from the library by hash
	 */
	static removeFile(hash: string): boolean {
		try {
			const library = this.getAll();
			const filteredLibrary = library.filter((f) => f.hash !== hash);
			localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredLibrary));
			return filteredLibrary.length < library.length;
		} catch (error) {
			console.error('Failed to remove file from sound library:', error);
			return false;
		}
	}

	/**
	 * Get a file by hash
	 */
	static getByHash(hash: string): SoundLibraryFile | null {
		const library = this.getAll();
		return library.find((f) => f.hash === hash) || null;
	}

	/**
	 * Find files by filename (case-insensitive)
	 */
	static findByFileName(fileName: string): SoundLibraryFile[] {
		const library = this.getAll();
		const normalizedName = fileName.toLowerCase();
		return library.filter((f) => f.fileName.toLowerCase() === normalizedName);
	}

	/**
	 * Convert library file back to File object
	 */
	static toFile(libraryFile: SoundLibraryFile): File {
		// Convert base64 back to binary
		const binaryString = atob(libraryFile.fileData);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}

		return new File([bytes], libraryFile.fileName, {
			type: libraryFile.fileType
		});
	}

	/**
	 * Get total library size and file count
	 */
	static getStats(): { totalSize: number; fileCount: number; sizeFormatted: string } {
		const library = this.getAll();
		const totalSize = library.reduce((sum, f) => sum + f.size, 0);
		const sizeFormatted = this.formatFileSize(totalSize);
		return { totalSize, fileCount: library.length, sizeFormatted };
	}

	/**
	 * Clear entire library
	 */
	static clear(): void {
		localStorage.removeItem(this.STORAGE_KEY);
	}

	/**
	 * Generate SHA-256 hash of file content
	 */
	private static async generateFileHash(file: File): Promise<string> {
		const arrayBuffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Convert file to base64
	 */
	private static async fileToBase64(file: File): Promise<string> {
		const arrayBuffer = await file.arrayBuffer();
		const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
		return base64;
	}

	/**
	 * Format file size for display
	 */
	private static formatFileSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}
}
