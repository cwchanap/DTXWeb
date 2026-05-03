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
	private static readonly LARGE_FILE_THRESHOLD = 2 * 1024 * 1024; // 2MB threshold for large files
	private static memoryFiles: Map<string, SoundLibraryFile> = new Map(); // In-memory storage for large files

	/**
	 * Get all files in the sound library (both localStorage and memory)
	 */
	static getAll(): SoundLibraryFile[] {
		try {
			const data = localStorage.getItem(SoundLibrary.STORAGE_KEY);
			const storedFiles: SoundLibraryFile[] = data ? JSON.parse(data) : [];
			const memoryFiles = Array.from(SoundLibrary.memoryFiles.values());
			const allFiles = [...storedFiles, ...memoryFiles];
			return allFiles;
		} catch (error) {
			console.error('Failed to load sound library:', error);
			return Array.from(SoundLibrary.memoryFiles.values()); // Return at least memory files if localStorage fails
		}
	}

	/**
	 * Add files to the sound library
	 */
	static async addFiles(
		files: File[]
	): Promise<{ added: number; skipped: number; errors: string[] }> {
		// Get existing localStorage files only (not memory files) for quota calculation
		const storedData = localStorage.getItem(SoundLibrary.STORAGE_KEY);
		const library: SoundLibraryFile[] = storedData ? JSON.parse(storedData) : [];
		const errors: string[] = [];
		let added = 0;
		let skipped = 0;

		for (const file of files) {
			try {
				// Check if file is audio file by MIME type or extension
				const audioExtensions = ['.wav', '.mp3', '.ogg', '.m4a', '.xa'];
				const fileName = file.name.toLowerCase();
				const isAudioFile =
					file.type.startsWith('audio/') ||
					audioExtensions.some((ext) => fileName.endsWith(ext));
				if (!isAudioFile) {
					errors.push(`${file.name}: Not an audio file`);
					continue;
				}

				// Generate hash
				const hash = await SoundLibrary.generateFileHash(file);

				// Check if file already exists (in both localStorage and memory)
				const existingFile =
					library.find((f) => f.hash === hash) || SoundLibrary.memoryFiles.get(hash);
				if (existingFile) {
					skipped++;
					continue;
				}

				// Determine if file is large and should be stored in memory
				const isLargeFile = file.size > SoundLibrary.LARGE_FILE_THRESHOLD;

				if (isLargeFile) {
					// Store large files only in memory (no base64 conversion needed for memory storage)
					const libraryFile: SoundLibraryFile = {
						hash,
						fileName: file.name,
						fileType: file.type,
						fileData: '', // Empty for large files - we'll store the File object directly in workspace
						size: file.size,
						dateAdded: Date.now()
					};

					SoundLibrary.memoryFiles.set(hash, libraryFile);
					added++;
				} else {
					// Check localStorage storage limit for normal files
					const totalSize = library.reduce((sum, f) => sum + f.size, 0) + file.size;
					if (totalSize > SoundLibrary.MAX_STORAGE_SIZE) {
						errors.push(
							`${file.name}: Would exceed storage limit (${Math.round(SoundLibrary.MAX_STORAGE_SIZE / 1024 / 1024)}MB)`
						);
						continue;
					}

					// Convert to base64 for localStorage
					const fileData = await SoundLibrary.fileToBase64(file);

					// Add to library array for localStorage
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
				}
			} catch (error) {
				errors.push(
					`${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		}

		// Save updated library to localStorage (only normal-sized files)
		if (library.length > 0) {
			try {
				localStorage.setItem(SoundLibrary.STORAGE_KEY, JSON.stringify(library));
			} catch (error) {
				if (error instanceof Error && error.name === 'QuotaExceededError') {
					// Try to free up space by removing 50% of oldest files
					const success = SoundLibrary.freeUpStorageSpace(library, 0.5);
					if (success) {
						try {
							localStorage.setItem(SoundLibrary.STORAGE_KEY, JSON.stringify(library));
						} catch (retryError) {
							// If still fails after cleanup, surface the error to user
							errors.push(
								'Storage quota exceeded - unable to store files even after cleanup. Please free up browser storage space.'
							);
						}
					} else {
						errors.push(
							'Storage quota exceeded - no files available to remove for cleanup'
						);
					}
				} else {
					errors.push(
						`Failed to save to localStorage: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		}

		return { added, skipped, errors };
	}

	/**
	 * Remove a file from the library by hash
	 */
	static removeFile(hash: string): boolean {
		try {
			// Only read localStorage entries to avoid persisting memory-only
			// entries (which have fileData: '') back to localStorage.
			const data = localStorage.getItem(SoundLibrary.STORAGE_KEY);
			const storedFiles: SoundLibraryFile[] = data ? JSON.parse(data) : [];
			const filteredFiles = storedFiles.filter((f) => f.hash !== hash);
			localStorage.setItem(SoundLibrary.STORAGE_KEY, JSON.stringify(filteredFiles));

			// Also remove from memory if present
			const hadMemoryFile = SoundLibrary.memoryFiles.has(hash);
			SoundLibrary.memoryFiles.delete(hash);

			return storedFiles.length !== filteredFiles.length || hadMemoryFile;
		} catch (error) {
			console.error('Failed to remove file from sound library:', error);
			return false;
		}
	}

	/**
	 * Get a file by hash (check both localStorage and memory)
	 */
	static getByHash(hash: string): SoundLibraryFile | null {
		// First check memory files
		const memoryFile = SoundLibrary.memoryFiles.get(hash);
		if (memoryFile) {
			return memoryFile;
		}

		// Then check localStorage files
		const library = SoundLibrary.getAll();
		return library.find((f) => f.hash === hash) || null;
	}

	/**
	 * Find files by filename (case-insensitive, check both localStorage and memory)
	 */
	static findByFileName(fileName: string): SoundLibraryFile[] {
		const library = SoundLibrary.getAll(); // This already includes both localStorage and memory files
		const normalizedName = fileName.toLowerCase();
		return library.filter((f) => f.fileName.toLowerCase() === normalizedName);
	}

	/**
	 * Convert library file back to File object.
	 * Returns null for entries with no file data (e.g. large in-memory-only files).
	 */
	static toFile(libraryFile: SoundLibraryFile): File | null {
		if (!libraryFile.fileData) {
			return null;
		}

		try {
			// Convert base64 back to binary
			const binaryString = atob(libraryFile.fileData);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			return new File([bytes], libraryFile.fileName, {
				type: libraryFile.fileType
			});
		} catch (error) {
			console.error(`Failed to decode file data for ${libraryFile.fileName}:`, error);
			return null;
		}
	}

	/**
	 * Get total library size and file count
	 */
	static getStats(): { totalSize: number; fileCount: number; sizeFormatted: string } {
		const library = SoundLibrary.getAll();
		const totalSize = library.reduce((sum, f) => sum + f.size, 0);
		const sizeFormatted = SoundLibrary.formatFileSize(totalSize);
		return { totalSize, fileCount: library.length, sizeFormatted };
	}

	/**
	 * Clear entire library (both localStorage and memory)
	 */
	static clear(): void {
		localStorage.removeItem(SoundLibrary.STORAGE_KEY);
		SoundLibrary.memoryFiles.clear();
	}

	/**
	 * Clear only memory files (for session cleanup)
	 */
	static clearMemoryFiles(): void {
		SoundLibrary.memoryFiles.clear();
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
	 * Free up storage space by removing oldest files
	 */
	private static freeUpStorageSpace(
		library: SoundLibraryFile[],
		removalPercentage = 0.25
	): boolean {
		// Sort by dateAdded (oldest first)
		const sortedFiles = [...library].sort((a, b) => a.dateAdded - b.dateAdded);

		// Remove oldest files until we free up the specified percentage
		const targetRemoval = Math.ceil(library.length * removalPercentage);
		const filesToRemove = sortedFiles.slice(0, Math.max(1, targetRemoval));

		// Remove the files from the library array
		filesToRemove.forEach((fileToRemove) => {
			const index = library.findIndex((f) => f.hash === fileToRemove.hash);
			if (index >= 0) {
				library.splice(index, 1);
			}
		});

		return filesToRemove.length > 0;
	}

	/**
	 * Convert file to base64
	 */
	private static async fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// Remove the data URL prefix (data:type;base64,)
				const base64 = result.split(',')[1];
				resolve(base64);
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
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
