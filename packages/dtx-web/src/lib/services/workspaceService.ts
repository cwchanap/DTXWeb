import { DTXFile, SimFile, decodeFileWithEncodingDetection } from '@dtx/common';
import { SoundLibrary } from './soundLibrary';
import { resolveChipPath, toWorkspacePath, workspacePathKey } from './workspacePaths';

export interface WorkspaceFile {
	name: string;
	path: string;
	file?: File; // Store large files directly here
	isLarge?: boolean; // Flag to indicate if file is too large for localStorage
	hash?: string;
	libraryStorageFailed?: boolean; // Sound library storage or hashing failed during import — unlike legacy hashless records, this file must not fall back to name matching
}

export interface WorkspaceDTX {
	name: string;
	content: string;
	path: string;
	parsed?: DTXFile;
	simFile?: SimFile;
}

export interface Workspace {
	name: string;
	path: string;
	dtxFiles: WorkspaceDTX[];
	audioFiles: WorkspaceFile[];
	currentDTX: string | null;
	lastModified: number;
}

export class WorkspaceService {
	private static readonly STORAGE_KEY = 'dtx_workspaces';
	private static sessionLargeFiles: Map<string, File> = new Map(); // Store large files in memory

	/**
	 * Import a folder containing DTX and audio files
	 */
	async importFolder(files: FileList): Promise<Workspace> {
		const dtxFiles: WorkspaceDTX[] = [];
		const audioFiles: WorkspaceFile[] = [];

		// Get folder name from first file's path
		const firstFile = files[0];
		const pathParts = firstFile.webkitRelativePath?.split('/') || [firstFile.name];
		const baseFolderName = pathParts.length > 1 ? pathParts[0] : 'Imported Folder';

		// Generate unique workspace name if there's a conflict
		const folderName = this.generateUniqueWorkspaceName(baseFolderName);

		for (const file of Array.from(files)) {
			const fileName = file.name.toLowerCase();
			const relativePath = toWorkspacePath(file.webkitRelativePath, file.name);

			if (fileName.endsWith('.dtx')) {
				// Handle DTX files with proper encoding detection
				const validateDtxContent = (content: string): boolean => {
					return (
						content.includes('#TITLE:') ||
						content.includes('#ARTIST:') ||
						content.includes('#BPM:') ||
						content.includes('#WAV') ||
						content.length > 0
					);
				};

				// A UTF-8 BOM is an explicit declaration (written by workspace export).
				// Honor it before detection, since Shift-JIS decoding accepts any bytes
				// and would otherwise garble UTF-8 Japanese text.
				const hasUtf8Bom = await WorkspaceService.hasUtf8Bom(file);
				const result = await decodeFileWithEncodingDetection(
					file,
					validateDtxContent,
					hasUtf8Bom ? ['utf-8'] : ['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'], // DTX files typically use shift-jis first
					hasUtf8Bom ? 'utf-8' : 'shift-jis' // DTX fallback is shift-jis
				);

				dtxFiles.push({
					name: file.name,
					content: result.content,
					path: relativePath
				});
			} else if (this.isAudioFile(file)) {
				// Handle audio files - check if large before storing
				const isLarge = SoundLibrary.isLargeFile(file.size);

				// Store large files in session memory with unique key
				if (isLarge) {
					const fileKey = `${folderName}/${relativePath}`;
					WorkspaceService.sessionLargeFiles.set(fileKey, file);
				}

				const workspaceFile: WorkspaceFile = {
					name: file.name,
					path: relativePath,
					isLarge
				};

				audioFiles.push(workspaceFile);

				// Auto-import audio files to sound library
				const addResult = await SoundLibrary.addFiles([file]);

				// Pin the content hash only when the bytes are actually stored, so a
				// workspace that cannot be exported is not reported as fully imported.
				if (!isLarge && addResult.errors.length === 0) {
					try {
						workspaceFile.hash = await SoundLibrary.generateFileHash(file);
					} catch (error) {
						// Keep the record without a hash so one unreadable file does
						// not abort the import; audio-inclusive export stays blocked.
						console.error(`Failed to hash audio file ${file.name}:`, error);
						workspaceFile.libraryStorageFailed = true;
					}
				} else if (addResult.errors.length > 0) {
					console.error(
						`Failed to store audio file ${file.name} in the sound library:`,
						addResult.errors
					);
					workspaceFile.libraryStorageFailed = true;
				}
			}
		}

		// Sort DTX files by name to prioritize higher difficulties (following SET.def L1-L5 system)
		const sortedDtxFiles = dtxFiles.sort((a, b) => {
			// Extract difficulty indicators from filename based on SET.def L1-L5 levels
			const getDifficultyOrder = (name: string): number => {
				const lowerName = name.toLowerCase();
				// Level 5 (highest): REAL
				if (lowerName.includes('real')) return 5;
				// Level 4: MASTER
				if (lowerName.includes('master') || lowerName.includes('mas')) return 4;
				// Level 3: EXTREME
				if (lowerName.includes('extreme') || lowerName.includes('ext')) return 3;
				// Level 2: ADVANCED
				if (lowerName.includes('advanced') || lowerName.includes('adv')) return 2;
				// Level 1 (lowest): BASIC
				if (lowerName.includes('basic') || lowerName.includes('bas')) return 1;
				return 0; // Unknown difficulty - sort alphabetically
			};

			const diffA = getDifficultyOrder(a.name);
			const diffB = getDifficultyOrder(b.name);

			// If both have difficulty indicators, sort by difficulty (highest first)
			if (diffA > 0 && diffB > 0) {
				return diffB - diffA;
			}

			// If only one has difficulty indicator, prioritize it
			if (diffA > 0) return -1;
			if (diffB > 0) return 1;

			// Both unknown - sort alphabetically
			return a.name.localeCompare(b.name);
		});

		const workspace: Workspace = {
			name: folderName,
			path: folderName,
			dtxFiles: sortedDtxFiles,
			audioFiles,
			currentDTX: sortedDtxFiles.length > 0 ? sortedDtxFiles[0].path : null,
			lastModified: Date.now()
		};

		// Store workspace
		this.saveWorkspace(workspace);

		return workspace;
	}

	/**
	 * Parse a DTX file in the workspace
	 */
	async parseDTXFile(
		workspace: Workspace,
		dtxPath: string
	): Promise<{ dtxFile: DTXFile; simFile: SimFile } | null> {
		const dtxEntry = workspace.dtxFiles.find((f) => f.path === dtxPath);
		if (!dtxEntry) return null;

		try {
			const dtxFile = new DTXFile();

			// Parse DTX content (encoding already detected during import)
			await dtxFile.parseFromText(dtxEntry.content);

			// Parse sound chips from DTX
			const soundChips = dtxFile.parseSoundChips();

			const simFile = new SimFile([]);
			simFile.title = dtxFile.title;

			const audioByKey = new Map<string, WorkspaceFile[]>();
			for (const af of workspace.audioFiles) {
				const key = workspacePathKey(af.path);
				const bucket = audioByKey.get(key) ?? [];
				bucket.push(af);
				audioByKey.set(key, bucket);
			}

			const soundLibraryFiles = SoundLibrary.getAll();
			const libraryByHash = new Map(soundLibraryFiles.map((sf) => [sf.hash, sf]));

			// Resolve each audio file once per parse: chips that share a sample
			// (or content-deduplicated hashes) reuse the same decoded File.
			const convertedByHash = new Map<string, File | null>();
			const resolvedByPath = new Map<string, File | null>();
			const resolveAudioFile = (audioFile: WorkspaceFile): File | null => {
				if (resolvedByPath.has(audioFile.path)) {
					return resolvedByPath.get(audioFile.path)!;
				}

				let file: File | null = null;
				if (audioFile.isLarge) {
					file = WorkspaceService.getLargeFile(workspace.name, audioFile.path) ?? null;
				} else {
					let converted: File | null = null;
					if (audioFile.hash) {
						if (!convertedByHash.has(audioFile.hash)) {
							const record = libraryByHash.get(audioFile.hash);
							convertedByHash.set(
								audioFile.hash,
								record ? SoundLibrary.toFile(record) : null
							);
						}
						converted = convertedByHash.get(audioFile.hash) ?? null;
					} else if (!audioFile.libraryStorageFailed) {
						// Legacy records imported before content hashing have no
						// pinned bytes; keep the old same-named fallback.
						const record = SoundLibrary.findByFileName(audioFile.name)[0];
						converted = record ? SoundLibrary.toFile(record) : null;
					}
					if (converted) {
						// Content-deduplicated records may carry another workspace's file name
						file =
							converted.name === audioFile.name
								? converted
								: new File([converted], audioFile.name, { type: converted.type });
					}
				}

				resolvedByPath.set(audioFile.path, file);
				return file;
			};

			// Store all files in FileManager for the FileProvider
			// Use null as simfileId for local workspace files
			const {
				setFile: setFileInManager,
				getKeys: getManagerKeys,
				removeFile: removeFileInManager
			} = await import('@dtx/common/services/fileManager');
			// Drop entries left by a previous parse so a file missing from this
			// workspace cannot resolve through a stale local:<filename> entry.
			// Keys are lowercased to match SoundChip.fileName, which the parser
			// lowercases.
			for (const key of getManagerKeys()) {
				if (key.startsWith('local:')) removeFileInManager(key);
			}

			for (const soundChip of soundChips) {
				if (!soundChip.fileName) continue;
				const audioFile = resolveChipPath(
					dtxEntry.path,
					soundChip.fileName,
					audioByKey,
					dtxFile.pathWav
				);
				const file = audioFile ? resolveAudioFile(audioFile) : null;
				if (!file) {
					console.warn(
						`Unresolved sound chip "${soundChip.fileName}" in ${dtxEntry.path}: no workspace audio file resolved; the chip stays silent.`
					);
					continue;
				}
				setFileInManager(`local:${soundChip.fileName.toLowerCase()}`, file);
			}

			// Update the workspace entry
			dtxEntry.parsed = dtxFile;
			dtxEntry.simFile = simFile;

			this.saveWorkspace(workspace);

			return { dtxFile, simFile };
		} catch (error) {
			console.error('Failed to parse DTX file:', error);
			return null;
		}
	}

	/**
	 * Switch to a different DTX file in the workspace
	 */
	switchDTXFile(workspace: Workspace, dtxPath: string): void {
		const dtxEntry = workspace.dtxFiles.find((f) => f.path === dtxPath);
		if (dtxEntry) {
			workspace.currentDTX = dtxEntry.path;
			workspace.lastModified = Date.now();
			this.saveWorkspace(workspace);
		}
	}

	/**
	 * Get all workspaces from localStorage
	 */
	getWorkspaces(): Workspace[] {
		try {
			const stored = localStorage.getItem(WorkspaceService.STORAGE_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch (error) {
			console.error('Failed to load workspaces:', error);
			return [];
		}
	}

	/**
	 * Get a specific workspace by name
	 */
	getWorkspace(name: string): Workspace | null {
		const workspaces = this.getWorkspaces();
		return workspaces.find((w) => w.name === name) || null;
	}

	/**
	 * Save a workspace to localStorage (without large file objects)
	 */
	saveWorkspace(workspace: Workspace): void {
		try {
			const workspaces = this.getWorkspaces();
			const existingIndex = workspaces.findIndex((w) => w.name === workspace.name);

			// Create a serializable copy without File objects
			const serializableWorkspace = {
				...workspace,
				audioFiles: workspace.audioFiles.map((af) => ({
					name: af.name,
					path: af.path,
					isLarge: af.isLarge,
					hash: af.hash,
					libraryStorageFailed: af.libraryStorageFailed
					// Don't store the File object
				}))
			};

			if (existingIndex >= 0) {
				workspaces[existingIndex] = serializableWorkspace;
			} else {
				workspaces.push(serializableWorkspace);
			}

			localStorage.setItem(WorkspaceService.STORAGE_KEY, JSON.stringify(workspaces));
		} catch (error) {
			console.error('Failed to save workspace:', error);
		}
	}

	/**
	 * Delete a workspace
	 */
	deleteWorkspace(name: string): void {
		try {
			const workspaces = this.getWorkspaces();
			const filtered = workspaces.filter((w) => w.name !== name);
			localStorage.setItem(WorkspaceService.STORAGE_KEY, JSON.stringify(filtered));
		} catch (error) {
			console.error('Failed to delete workspace:', error);
		}
	}

	/**
	 * Get current workspace from URL or localStorage
	 */
	getCurrentWorkspace(): Workspace | null {
		// Try to get from URL hash
		const urlHash = window.location.hash.replace('#', '');
		if (urlHash && urlHash.startsWith('workspace:')) {
			const workspaceName = urlHash.replace('workspace:', '');
			return this.getWorkspace(workspaceName);
		}

		// Try to get last used workspace
		try {
			const lastWorkspace = localStorage.getItem('last_workspace');
			return lastWorkspace ? this.getWorkspace(lastWorkspace) : null;
		} catch (error) {
			return null;
		}
	}

	/**
	 * Set current workspace
	 */
	setCurrentWorkspace(workspace: Workspace | null): void {
		try {
			if (workspace) {
				localStorage.setItem('last_workspace', workspace.name);
				window.location.hash = `workspace:${workspace.name}`;
			} else {
				localStorage.removeItem('last_workspace');
				window.location.hash = '';
			}
		} catch (error) {
			console.error('Failed to set current workspace:', error);
		}
	}

	private isAudioFile(file: File): boolean {
		const audioExtensions = ['.wav', '.mp3', '.ogg', '.m4a', '.xa'];
		const fileName = file.name.toLowerCase();
		return (
			audioExtensions.some((ext) => fileName.endsWith(ext)) || file.type.startsWith('audio/')
		);
	}

	private formatFileSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}

	/**
	 * Generate a unique workspace name to avoid conflicts
	 */
	private generateUniqueWorkspaceName(baseName: string): string {
		const existingWorkspaces = this.getWorkspaces();
		const existingNames = new Set(existingWorkspaces.map((w) => w.name));

		if (!existingNames.has(baseName)) {
			return baseName;
		}

		// Find a unique name by appending a number
		let counter = 1;
		let uniqueName = `${baseName} (${counter})`;

		while (existingNames.has(uniqueName)) {
			counter++;
			uniqueName = `${baseName} (${counter})`;
		}

		return uniqueName;
	}

	/**
	 * Whether the file starts with a UTF-8 byte order mark (EF BB BF)
	 */
	private static async hasUtf8Bom(file: File): Promise<boolean> {
		const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
		return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
	}

	/**
	 * Shift-JIS byte sequences keyed by character, built once by decoding every
	 * valid byte sequence with the platform's own Shift-JIS decoder. Browsers can
	 * decode Shift-JIS but not encode it, and this avoids a dependency. Where a
	 * character has several byte sequences the first (lowest) one wins.
	 */
	private static shiftJisEncodeMap: Map<string, number[]> | null = null;

	private static getShiftJisEncodeMap(): Map<string, number[]> {
		if (WorkspaceService.shiftJisEncodeMap) {
			return WorkspaceService.shiftJisEncodeMap;
		}

		const decoder = new TextDecoder('shift-jis');
		const map = new Map<string, number[]>();
		const add = (bytes: number[]) => {
			const chars = Array.from(decoder.decode(new Uint8Array(bytes)));
			if (chars.length !== 1 || chars[0] === '\uFFFD' || map.has(chars[0])) {
				return;
			}
			map.set(chars[0], bytes);
		};

		for (let byte = 0x00; byte <= 0x7f; byte++) add([byte]);
		for (let byte = 0xa1; byte <= 0xdf; byte++) add([byte]);
		for (let lead = 0x81; lead <= 0xfc; lead++) {
			if (lead > 0x9f && lead < 0xe0) continue;
			for (let trail = 0x40; trail <= 0xfc; trail++) {
				if (trail === 0x7f) continue;
				add([lead, trail]);
			}
		}

		WorkspaceService.shiftJisEncodeMap = map;
		return map;
	}

	/**
	 * Encode stored DTX text for a ZIP entry. DTXmania reads charts as Shift-JIS,
	 * so text is written as Shift-JIS bytes. Text containing characters Shift-JIS
	 * cannot represent falls back to UTF-8 with a BOM, which import detects, rather
	 * than silently replacing characters. Empty charts stay zero-byte.
	 */
	static toExportContent(content: string): string | Uint8Array {
		if (content.length === 0) {
			return content;
		}

		const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
		const encodeMap = WorkspaceService.getShiftJisEncodeMap();
		const bytes: number[] = [];
		for (const char of text) {
			const encoded = encodeMap.get(char);
			if (!encoded) {
				return `\uFEFF${text}`;
			}
			bytes.push(...encoded);
		}
		return new Uint8Array(bytes);
	}

	/**
	 * Get a large file from session memory
	 */
	static getLargeFile(workspaceName: string, filePath: string): File | undefined {
		const fileKey = `${workspaceName}/${filePath}`;
		return WorkspaceService.sessionLargeFiles.get(fileKey);
	}

	/**
	 * Clear session large files for a specific workspace or all if no workspace specified
	 */
	static clearSessionFiles(workspaceName?: string): void {
		if (!workspaceName) {
			WorkspaceService.sessionLargeFiles.clear();
			return;
		}

		// Clear only files for the specified workspace
		const keysToDelete: string[] = [];
		for (const [key] of WorkspaceService.sessionLargeFiles) {
			if (key.startsWith(`${workspaceName}/`)) {
				keysToDelete.push(key);
			}
		}

		keysToDelete.forEach((key) => WorkspaceService.sessionLargeFiles.delete(key));
	}
}

export const workspaceService = new WorkspaceService();
