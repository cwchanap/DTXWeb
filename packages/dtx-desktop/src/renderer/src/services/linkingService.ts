import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
import type { SimfileModel } from '@dtx/common';

export const linkingService = {
	/**
	 * Automatically links remote simFiles to local folders based on song title matching
	 * @param remoteSimFiles Array of remote simFiles from the API
	 * @param localFolders Array of local folder TreeNodes with song titles
	 */
	autoLinkSimFilesToFolders: (remoteSimFiles: SimfileModel[], localFolders: TreeNode[]): void => {
		console.log('Starting automatic linking process...');
		console.log(
			`Remote simFiles: ${remoteSimFiles.length}, Local folders: ${localFolders.length}`
		);

		// Get folders that contain DTX files and have song titles
		const foldersWithSongs = linkingService.getFoldersWithSongs(localFolders);
		console.log(`Folders with songs: ${foldersWithSongs.length}`);

		let linkCount = 0;

		// Try to find the best matching remote simFile for each local folder
		foldersWithSongs.forEach((folder) => {
			// Skip if folder is already linked
			if (folder.linkedSimFileId) {
				console.log(
					`Folder "${folder.name}" is already linked to simFile ID ${folder.linkedSimFileId}`
				);
				return;
			}

			const matchingSimFile = linkingService.findMatchingSimFile(folder, remoteSimFiles);
			if (matchingSimFile) {
				console.log(
					`Linking folder "${folder.name}" to simFile "${matchingSimFile.title}"`
				);
				workspaceStore.linkSimFileToFolder(folder.path, matchingSimFile);
				linkCount++;
			}
		});

		console.log(`Successfully linked ${linkCount} simFiles to local folders`);
	},

	/**
	 * Recursively extracts all folders that contain DTX files and have song titles
	 * @param nodes Array of TreeNodes to search
	 * @returns Array of TreeNodes that contain DTX files and have song titles
	 */
	getFoldersWithSongs: (nodes: TreeNode[]): TreeNode[] => {
		const result: TreeNode[] = [];

		const traverse = (nodeList: TreeNode[]) => {
			nodeList.forEach((node) => {
				// Add folders that contain DTX files and have song titles
				if (node.containsDtxFiles && node.songTitle) {
					result.push(node);
				}

				// Recursively check children
				if (node.children && node.children.length > 0) {
					traverse(node.children);
				}
			});
		};

		traverse(nodes);
		return result;
	},

	/**
	 * Finds a local folder that matches the given remote simFile by song title
	 * @param simFile Remote simFile to match
	 * @param localFolders Array of local folders with song titles
	 * @returns Matching TreeNode or null if no match found
	 */
	findMatchingFolder: (simFile: SimfileModel, localFolders: TreeNode[]): TreeNode | null => {
		if (!simFile.title) {
			return null;
		}

		// Normalize the simFile title for comparison
		const normalizedSimFileTitle = linkingService.normalizeTitle(simFile.title);

		// Try to find exact match first
		let match = localFolders.find((folder) => {
			if (!folder.songTitle) return false;
			const normalizedFolderTitle = linkingService.normalizeTitle(folder.songTitle);
			return normalizedFolderTitle === normalizedSimFileTitle;
		});

		// console.log('Exact match:', match, simFile.title, normalizedSimFileTitle);

		// If no exact match, try fuzzy matching
		if (!match) {
			match = localFolders.find((folder) => {
				if (!folder.songTitle) return false;
				return linkingService.isFuzzyMatch(simFile.title, folder.songTitle);
			});
		}

		return match || null;
	},

	/**
	 * Finds a remote simFile that matches the given local folder by song title
	 * @param folder Local folder to match
	 * @param remoteSimFiles Array of remote simFiles
	 * @returns Matching SimfileModel or null if no match found
	 */
	findMatchingSimFile: (
		folder: TreeNode,
		remoteSimFiles: SimfileModel[]
	): SimfileModel | null => {
		if (!folder.songTitle) {
			return null;
		}

		// Normalize the folder title for comparison
		const normalizedFolderTitle = linkingService.normalizeTitle(folder.songTitle);

		// Try to find exact match first
		let match = remoteSimFiles.find((simFile) => {
			if (!simFile.title) return false;
			const normalizedSimFileTitle = linkingService.normalizeTitle(simFile.title);
			return normalizedSimFileTitle === normalizedFolderTitle;
		});

		// If no exact match, try fuzzy matching and find the best match
		if (!match) {
			let bestMatch: SimfileModel | null = null;
			let bestSimilarity = 0;

			remoteSimFiles.forEach((simFile) => {
				if (!simFile.title) return;

				if (linkingService.isFuzzyMatch(folder.songTitle!, simFile.title)) {
					const similarity = linkingService.calculateSimilarity(
						linkingService.normalizeTitle(folder.songTitle!),
						linkingService.normalizeTitle(simFile.title)
					);

					if (similarity > bestSimilarity) {
						bestSimilarity = similarity;
						bestMatch = simFile;
					}
				}
			});

			match = bestMatch;
		}

		return match || null;
	},

	/**
	 * Normalizes a title for comparison by removing special characters, extra spaces, and converting to lowercase
	 * Preserves Japanese characters (hiragana, katakana, kanji) and ASCII alphanumeric characters
	 * @param title Title to normalize
	 * @returns Normalized title
	 */
	normalizeTitle: (title: string): string => {
		return title
			.toLowerCase()
			.replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '') // Remove special characters but keep Japanese
			.replace(/\s+/g, ' ') // Replace multiple spaces with single space
			.trim();
	},

	/**
	 * Performs fuzzy matching between two titles
	 * @param title1 First title
	 * @param title2 Second title
	 * @returns True if titles are considered a fuzzy match
	 */
	isFuzzyMatch: (title1: string, title2: string): boolean => {
		const normalized1 = linkingService.normalizeTitle(title1);
		const normalized2 = linkingService.normalizeTitle(title2);

		// Check if one title contains the other
		if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
			return true;
		}

		// Check similarity using Levenshtein distance
		const similarity = linkingService.calculateSimilarity(normalized1, normalized2);
		// console.log('Similarity:', similarity, normalized1, normalized2);
		return similarity > 0.95; // 80% similarity threshold
	},

	/**
	 * Calculates similarity between two strings using Levenshtein distance
	 * @param str1 First string
	 * @param str2 Second string
	 * @returns Similarity ratio between 0 and 1
	 */
	calculateSimilarity: (str1: string, str2: string): number => {
		const maxLength = Math.max(str1.length, str2.length);
		if (maxLength === 0) return 1;

		const distance = linkingService.levenshteinDistance(str1, str2);
		return (maxLength - distance) / maxLength;
	},

	/**
	 * Calculates Levenshtein distance between two strings
	 * @param str1 First string
	 * @param str2 Second string
	 * @returns Levenshtein distance
	 */
	levenshteinDistance: (str1: string, str2: string): number => {
		const matrix = Array(str2.length + 1)
			.fill(null)
			.map(() => Array(str1.length + 1).fill(null));

		for (let i = 0; i <= str1.length; i++) {
			matrix[0][i] = i;
		}

		for (let j = 0; j <= str2.length; j++) {
			matrix[j][0] = j;
		}

		for (let j = 1; j <= str2.length; j++) {
			for (let i = 1; i <= str1.length; i++) {
				const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
				matrix[j][i] = Math.min(
					matrix[j][i - 1] + 1, // deletion
					matrix[j - 1][i] + 1, // insertion
					matrix[j - 1][i - 1] + indicator // substitution
				);
			}
		}

		return matrix[str2.length][str1.length];
	},

	/**
	 * Manually links a simFile to a folder
	 * @param simFile SimFile to link
	 * @param folderPath Path of the folder to link to
	 */
	linkSimFileToFolder: (simFile: SimfileModel, folderPath: string): void => {
		console.log(`Manually linking simFile "${simFile.title}" to folder "${folderPath}"`);
		workspaceStore.linkSimFileToFolder(folderPath, simFile);
	},

	/**
	 * Unlinks a simFile from a folder
	 * @param folderPath Path of the folder to unlink from
	 */
	unlinkSimFileFromFolder: (folderPath: string): void => {
		console.log(`Unlinking simFile from folder "${folderPath}"`);
		workspaceStore.unlinkSimFileFromFolder(folderPath);
	},

	/**
	 * Links simFiles to a specific set of newly loaded nodes (more efficient for partial updates)
	 * @param remoteSimFiles Array of remote simFiles from the API
	 * @param newNodes Array of newly loaded TreeNodes
	 */
	linkSimFilesToNewNodes: (remoteSimFiles: SimfileModel[], newNodes: TreeNode[]): void => {
		console.log('Linking simFiles to newly loaded nodes...');
		console.log(`Remote simFiles: ${remoteSimFiles.length}, New nodes: ${newNodes.length}`);

		// Get folders that contain DTX files and have song titles from the new nodes
		const newFoldersWithSongs = linkingService.getFoldersWithSongs(newNodes);
		console.log(`New folders with songs: ${newFoldersWithSongs.length}`);

		let linkCount = 0;

		// Try to find the best matching remote simFile for each newly loaded folder
		newFoldersWithSongs.forEach((folder) => {
			// Skip if folder is already linked
			if (folder.linkedSimFileId) {
				console.log(
					`Newly loaded folder "${folder.name}" is already linked to simFile ID ${folder.linkedSimFileId}`
				);
				return;
			}

			const matchingSimFile = linkingService.findMatchingSimFile(folder, remoteSimFiles);
			if (matchingSimFile) {
				console.log(
					`Linking newly loaded folder "${folder.name}" to simFile "${matchingSimFile.title}"`
				);
				workspaceStore.linkSimFileToFolder(folder.path, matchingSimFile);
				linkCount++;
			}
		});

		console.log(`Successfully linked ${linkCount} simFiles to newly loaded folders`);
	}
};
