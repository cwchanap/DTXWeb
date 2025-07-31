import fs from 'fs';
import path from 'path';
import { dialog } from 'electron';
import { SimFile, decodeFileWithEncodingDetection } from '@dtx/common/server';

export interface TreeNode {
	name: string;
	path: string;
	isExpanded: boolean;
	isLoading: boolean;
	children: TreeNode[];
	hasChildren: boolean;
	containsDtxFiles: boolean;
	songTitle: string | null;
}

export async function loadTreeStructure(dirPath: string): Promise<TreeNode[]> {
	try {
		console.log('Loading tree structure for:', dirPath);
		const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

		// Filter only directories and create tree nodes
		const allDirectories = entries.filter((entry) => entry.isDirectory());

		const treeNodes = await Promise.all(
			allDirectories.map(async (dir) => {
				const fullPath = path.join(dirPath, dir.name);

				// Check if directory has subdirectories
				let hasChildren = false;
				let containsDtxFiles = false;
				let songTitle: string | null = null;

				try {
					const subEntries = await fs.promises.readdir(fullPath, {
						withFileTypes: true
					});

					// Check for subdirectories
					hasChildren = subEntries.some((entry) => entry.isDirectory());

					// Check for .dtx files
					containsDtxFiles = subEntries.some(
						(entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dtx')
					);

					// If folder contains .dtx files, check for SET.def and read song title
					if (containsDtxFiles) {
						const setDefFile = subEntries.find(
							(entry) => entry.isFile() && entry.name.toLowerCase() === 'set.def'
						);

						if (setDefFile) {
							try {
								const setDefPath = path.join(fullPath, setDefFile.name);
								// Read as buffer to preserve original encoding
								const setDefBuffer = await fs.promises.readFile(setDefPath);

								// Create a File object from the buffer to use with SimFile
								const file = new File([setDefBuffer], 'set.def');
								const simFile = new SimFile([file]);
								await simFile.parseHeader(file);
								songTitle = simFile.title || null;
								console.log('Song title:', songTitle);
							} catch (error) {
								console.warn('Could not read SET.def file:', error);
							}
						}
					}
				} catch (error) {
					console.warn('Could not check subdirectories for:', fullPath);
				}

				return {
					name: dir.name,
					path: fullPath,
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: containsDtxFiles ? false : hasChildren, // Don't show children for folders with .dtx files
					containsDtxFiles,
					songTitle
				};
			})
		);

		// Filter nodes: show DTXFiles folders and folders containing .dtx files
		const filteredNodes = treeNodes.filter(
			(node) => node.name.startsWith('DTXFiles.') || node.containsDtxFiles
		);

		return filteredNodes;
	} catch (error) {
		console.error('Error loading tree structure:', error);
		return [];
	}
}

export async function selectDirectory() {
	const result = await dialog.showOpenDialog({
		properties: ['openDirectory']
	});
	return result;
}

export interface ReadFileResult {
	error: string | null;
	content: string;
}

export async function readFile(
	filePath: string,
	workspaceRoot: string | null = null
): Promise<ReadFileResult> {
	try {
		// Resolve the file path to prevent path traversal attacks
		const resolvedPath = path.resolve(filePath);

		// Security check: ensure the resolved path is within the allowed directory
		// If workspaceRoot is not provided, derive it from the file path (parent directory)
		let allowedRoot: string;
		if (workspaceRoot) {
			allowedRoot = path.resolve(workspaceRoot);
		} else {
			// For backward compatibility, derive workspace root from file path
			allowedRoot = path.dirname(resolvedPath);
		}

		// Use path.relative to check if resolvedPath is within allowedRoot
		const relativePath = path.relative(allowedRoot, resolvedPath);
		if (relativePath.startsWith('..') || relativePath === '..') {
			console.warn(
				'Path traversal attempt detected:',
				filePath,
				'resolved to:',
				resolvedPath,
				'not within:',
				allowedRoot
			);
			return { error: 'Invalid file path', content: '' };
		}

		// Whitelist of allowed extensions
		const allowedExtensions = ['.dtx', '.def'];
		const ext = path.extname(resolvedPath).toLowerCase();
		if (!allowedExtensions.includes(ext)) {
			return { error: 'File type not allowed', content: '' };
		}

		// File size limit (e.g., 1MB)
		const MAX_SIZE = 1024 * 1024; // 1MB
		const stats = await fs.promises.stat(resolvedPath);
		if (stats.size > MAX_SIZE) {
			console.warn('File too large:', stats.size);
			return { error: 'File too large', content: '' };
		}

		// Read file as buffer first
		const fileBuffer = await fs.promises.readFile(resolvedPath);

		// Create a File object for encoding detection
		const fileName = path.basename(resolvedPath);
		const tempFile = new File([fileBuffer], fileName);

		// Content validation callback for .def files and general text files
		const validateFileContent = (content: string): boolean => {
			// For .def files, check for common DTX definition content
			if (ext === '.def') {
				return (
					content.includes('#TITLE:') ||
					content.includes('#ARTIST:') ||
					content.includes('#BPM:') ||
					content.includes('[') ||
					content.length > 0
				);
			}
			// For .dtx files, check for DTX-specific content
			return (
				content.includes('#TITLE:') ||
				content.includes('#ARTIST:') ||
				content.includes('#BPM:') ||
				content.includes('#WAV') ||
				content.length > 0
			);
		};

		// Use encoding detection to handle UTF-16LE .def files and other encodings
		const content = await decodeFileWithEncodingDetection(
			tempFile,
			validateFileContent,
			['utf-16le', 'utf-16be', 'utf-8', 'shift-jis'], // Try UTF-16LE first for .def files
			'utf-8' // Fallback to UTF-8
		);

		return { error: null, content };
	} catch (error) {
		console.error('Error reading file:', error);
		return {
			error: error instanceof Error ? error.message : 'Unknown error',
			content: ''
		};
	}
}
