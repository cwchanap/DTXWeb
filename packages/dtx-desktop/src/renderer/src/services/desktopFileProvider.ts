/**
 * Desktop File Provider Implementation
 *
 * Uses Electron IPC to load files from the user's filesystem
 * This implementation loads files via the main process
 */

import type { IFileProvider } from '@dtx/common/services/fileProvider';

export class DesktopFileProvider implements IFileProvider {
	private fileCache = new Map<string, File>();
	private _workspaceRoot: string | null = null;

	get workspaceRoot() {
		return this._workspaceRoot;
	}

	constructor(workspaceRoot?: string) {
		this._workspaceRoot = workspaceRoot || null;
	}

	setWorkspaceRoot(workspaceRoot: string): void {
		this._workspaceRoot = workspaceRoot;
		// Clear cache when workspace changes
		this.fileCache.clear();
	}

	async getFile(simfileId: string | null, fileName: string): Promise<File | undefined> {
		try {
			const key = this.generateKey(simfileId, fileName);

			// Check cache first
			if (this.fileCache.has(key)) {
				return this.fileCache.get(key);
			}

			// Build file path relative to workspace root
			if (!this._workspaceRoot) {
				return undefined;
			}

			// For simfile-specific files, look in the simfile directory
			// For local files (simfileId is null), look in the workspace root
			let filePath: string;
			if (simfileId) {
				filePath = `${this._workspaceRoot}/${simfileId}/${fileName}`;
			} else {
				filePath = `${this._workspaceRoot}/${fileName}`;
			}

			// Use IPC to read file from main process
			const result = await window.electron.ipcRenderer.invoke(
				'read-file',
				filePath,
				this._workspaceRoot
			);

			if (result.error) {
				return undefined;
			}

			// Convert file content to File object
			const blob = new Blob([result.content], { type: this.getFileType(fileName) });
			const file = new File([blob], fileName);

			// Cache the file
			this.fileCache.set(key, file);

			return file;
		} catch (error) {
			console.error('Failed to get file:', error);
			return undefined;
		}
	}

	async setFile(simfileId: string | null, fileName: string, file: File): Promise<boolean> {
		try {
			const key = this.generateKey(simfileId, fileName);

			// For desktop app, we just cache the file in memory
			// Actual file writing to disk would require additional IPC handlers
			this.fileCache.set(key, file);

			return true;
		} catch (error) {
			console.error('Failed to set file:', error);
			return false;
		}
	}

	async removeFile(simfileId: string | null, fileName: string): Promise<boolean> {
		try {
			const key = this.generateKey(simfileId, fileName);
			return this.fileCache.delete(key);
		} catch (error) {
			console.error('Failed to remove file:', error);
			return false;
		}
	}

	async clearFiles(simfileId?: string | null): Promise<boolean> {
		try {
			if (simfileId === undefined) {
				// Clear all files
				this.fileCache.clear();
			} else {
				// Clear files for specific simfile
				const prefix = `${simfileId || 'local'}:`;
				const keysToRemove = Array.from(this.fileCache.keys()).filter((key) =>
					key.startsWith(prefix)
				);
				keysToRemove.forEach((key) => this.fileCache.delete(key));
			}
			return true;
		} catch (error) {
			console.error('Failed to clear files:', error);
			return false;
		}
	}

	async getFileKeys(simfileId?: string | null): Promise<string[]> {
		const allKeys = Array.from(this.fileCache.keys());

		if (simfileId === undefined) {
			return allKeys;
		}

		const prefix = `${simfileId || 'local'}:`;
		return allKeys
			.filter((key) => key.startsWith(prefix))
			.map((key) => key.substring(prefix.length)); // Return just the filename part
	}

	private generateKey(simfileId: string | null, fileName: string): string {
		return `${simfileId || 'local'}:${fileName}`;
	}

	private getFileType(fileName: string): string {
		const ext = fileName.toLowerCase().split('.').pop();
		switch (ext) {
			case 'wav':
				return 'audio/wav';
			case 'mp3':
				return 'audio/mpeg';
			case 'ogg':
				return 'audio/ogg';
			case 'dtx':
				return 'text/plain';
			case 'def':
				return 'text/plain';
			default:
				return 'application/octet-stream';
		}
	}
}
