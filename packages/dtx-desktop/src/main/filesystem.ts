import fs from 'fs';
import { SimFile } from '@dtx/common/node';

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
				const fullPath = `${dirPath}/${dir.name}`;

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
								const setDefPath = `${fullPath}/${setDefFile.name}`;
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
