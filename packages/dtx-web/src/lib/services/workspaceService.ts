import { DTXFile, SimFile, decodeFileWithEncodingDetection } from '@dtx/common';
import { SoundLibrary } from './soundLibrary';

export interface WorkspaceFile {
	name: string;
	path: string;
	file?: File; // Store large files directly here
	isLarge?: boolean; // Flag to indicate if file is too large for localStorage
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
	private static readonly LARGE_FILE_THRESHOLD = 2 * 1024 * 1024; // 2MB threshold
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
			const relativePath = file.webkitRelativePath || file.name;

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

				const result = await decodeFileWithEncodingDetection(
					file,
					validateDtxContent,
					['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'], // DTX files typically use shift-jis first
					'shift-jis' // DTX fallback is shift-jis
				);

				dtxFiles.push({
					name: file.name,
					content: result.content,
					path: relativePath
				});
			} else if (this.isAudioFile(file)) {
				// Handle audio files - check if large before storing
				const isLarge = file.size > WorkspaceService.LARGE_FILE_THRESHOLD;

				// Store large files in session memory with unique key
				if (isLarge) {
					const fileKey = `${folderName}/${file.name}`;
					WorkspaceService.sessionLargeFiles.set(fileKey, file);
				}

				const workspaceFile: WorkspaceFile = {
					name: file.name,
					path: relativePath,
					isLarge
				};

				audioFiles.push(workspaceFile);

				// Auto-import audio files to sound library
				const result = await SoundLibrary.addFiles([file]);
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
			currentDTX: sortedDtxFiles.length > 0 ? sortedDtxFiles[0].name : null,
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
		dtxFileName: string
	): Promise<{ dtxFile: DTXFile; simFile: SimFile } | null> {
		const dtxEntry = workspace.dtxFiles.find((f) => f.name === dtxFileName);
		if (!dtxEntry) return null;

		try {
			const dtxFile = new DTXFile();

			// Parse DTX content (encoding already detected during import)
			await dtxFile.parseFromText(dtxEntry.content);

			// Parse sound chips from DTX
			const soundChips = dtxFile.parseSoundChips();

			// Create SimFile with audio files from both sound library and workspace
			const simFile = new SimFile();

			// Combine files from sound library (small files) and workspace (large files)
			const allFiles: File[] = [];

			// Get small files from sound library
			const soundLibraryFiles = SoundLibrary.getAll();
			const workspaceFileNames = workspace.audioFiles.map((af) => af.name);

			// Add small files from sound library (exclude large files which have empty fileData)
			const largeFileNames = workspace.audioFiles
				.filter((af) => af.isLarge)
				.map((af) => af.name);
			const libraryFiles = soundLibraryFiles
				.filter(
					(sf) =>
						workspaceFileNames.includes(sf.fileName) &&
						sf.fileData &&
						sf.fileData.length > 0 &&
						!largeFileNames.includes(sf.fileName)
				) // Exclude large files completely
				.map((sf) => SoundLibrary.toFile(sf));
			allFiles.push(...libraryFiles);

			// Add large files from session memory

			const largeFiles = workspace.audioFiles
				.filter((af) => af.isLarge)
				.map((af) => {
					const fileKey = `${workspace.name}/${af.name}`;
					const file = WorkspaceService.sessionLargeFiles.get(fileKey);
					return file;
				})
				.filter((file): file is File => file !== undefined);
			allFiles.push(...largeFiles);

			simFile.files = allFiles;
			simFile.meta = dtxFile.meta;

			// Match sound chips with their corresponding files
			// This ensures soundChip.file is properly assigned for audio loading
			for (const soundChip of soundChips) {
				const matchingFile = allFiles.find(
					(file) => file.name.toLowerCase() === soundChip.fileName.toLowerCase()
				);
				if (matchingFile) {
					soundChip.file = matchingFile;
				}
			}

			// Store all files in FileManager for the FileProvider
			// Use null as simfileId for local workspace files
			const { setFile: setFileInManager } = await import('@dtx/common/services/fileManager');
			for (const file of allFiles) {
				const key = `local:${file.name}`;
				setFileInManager(key, file);
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
	switchDTXFile(workspace: Workspace, dtxFileName: string): void {
		if (workspace.dtxFiles.some((f) => f.name === dtxFileName)) {
			workspace.currentDTX = dtxFileName;
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
					isLarge: af.isLarge
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
	setCurrentWorkspace(workspace: Workspace): void {
		try {
			localStorage.setItem('last_workspace', workspace.name);
			window.location.hash = `workspace:${workspace.name}`;
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
	 * Get a large file from session memory
	 */
	static getLargeFile(workspaceName: string, fileName: string): File | undefined {
		const fileKey = `${workspaceName}/${fileName}`;
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
