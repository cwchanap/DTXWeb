/**
 * Web File Provider Implementation
 *
 * Uses the existing FileManager for browser-based file storage
 * This implementation stores files in browser memory
 */

import type { IFileProvider } from '@dtx/common/services/fileProvider';
import * as FileManager from '@dtx/common/services/fileManager';

export class WebFileProvider implements IFileProvider {
	getFile(simfileId: string | null, fileName: string): File | undefined {
		const key = FileManager.generateKey(simfileId, fileName);
		return FileManager.getFile(key);
	}

	async setFile(simfileId: string | null, fileName: string, file: File): Promise<boolean> {
		try {
			const key = FileManager.generateKey(simfileId, fileName);
			FileManager.setFile(key, file);
			return true;
		} catch (error) {
			console.error('Failed to set file:', error);
			return false;
		}
	}

	async removeFile(simfileId: string | null, fileName: string): Promise<boolean> {
		const key = FileManager.generateKey(simfileId, fileName);
		return FileManager.removeFile(key);
	}

	async clearFiles(simfileId?: string | null): Promise<boolean> {
		try {
			if (simfileId === undefined) {
				// Clear all files
				FileManager.clear();
			} else {
				// Clear files for specific simfile
				const allKeys = FileManager.getKeys();
				const prefix = `${simfileId || 'local'}:`;
				const keysToRemove = allKeys.filter((key) => key.startsWith(prefix));
				keysToRemove.forEach((key) => {
					const fileName = key.substring(prefix.length);
					const fullKey = FileManager.generateKey(simfileId, fileName);
					FileManager.removeFile(fullKey);
				});
			}
			return true;
		} catch (error) {
			console.error('Failed to clear files:', error);
			return false;
		}
	}

	async getFileKeys(simfileId?: string | null): Promise<string[]> {
		const allKeys = FileManager.getKeys();

		if (simfileId === undefined) {
			return allKeys;
		}

		const prefix = `${simfileId || 'local'}:`;
		return allKeys
			.filter((key) => key.startsWith(prefix))
			.map((key) => key.substring(prefix.length)); // Return just the filename part
	}
}
