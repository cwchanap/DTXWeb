/**
 * Desktop File Provider Implementation
 *
 * Uses the desktop host to load files from the user's filesystem.
 */

import type { IFileProvider } from '@dtx/common';
import { desktopHost } from './desktopHost';

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

	getWorkspaceRoot(): string {
		return this._workspaceRoot || '';
	}

	async getFile(simfileId: string | null, fileName: string): Promise<File | undefined> {
		try {
			const normalizedFileName = this.normalizeFileName(fileName);

			// Defense-in-depth: reject parent-directory traversal segments
			// before building the IPC path. The authoritative containment
			// check lives in the Rust read_file_path_inner (canonicalize +
			// starts_with(workspace_root)), which defeats `..`, symlinks, and
			// absolute paths; this renderer guard avoids sending the IPC call
			// at all and guards against any future code path that bypasses it.
			if (this.containsParentTraversal(normalizedFileName)) {
				return undefined;
			}

			const key = this.generateKey(simfileId, normalizedFileName);

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
				filePath = `${this._workspaceRoot}/${simfileId}/${normalizedFileName}`;
			} else {
				filePath = `${this._workspaceRoot}/${normalizedFileName}`;
			}

			// Ask host process to read the local file
			const result = await desktopHost.readFile(filePath);

			if (result.error) {
				return undefined;
			}

			// Convert file content to File object
			const content =
				result.content instanceof Uint8Array
					? this.copyToArrayBuffer(result.content)
					: result.content;
			const blob = new Blob([content], { type: this.getFileType(fileName) });
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
			const key = this.generateKey(simfileId, this.normalizeFileName(fileName));

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
			const key = this.generateKey(simfileId, this.normalizeFileName(fileName));
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

	private generateKey(simfileId: string | null, normalizedFileName: string): string {
		return `${simfileId || 'local'}:${normalizedFileName}`;
	}

	private normalizeFileName(fileName: string): string {
		return fileName.replaceAll('\\', '/');
	}

	/**
	 * Returns true if any path segment is a parent-directory reference (`..`).
	 * Used as defense-in-depth alongside the Rust-layer containment check.
	 */
	private containsParentTraversal(normalizedFileName: string): boolean {
		return normalizedFileName.split('/').some((segment) => segment === '..');
	}

	private copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
		const arrayBuffer = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(arrayBuffer).set(bytes);
		return arrayBuffer;
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
			case 'xa':
				return 'audio/xa';
			case 'dtx':
				return 'text/plain';
			case 'def':
				return 'text/plain';
			default:
				return 'application/octet-stream';
		}
	}
}
