import { browser } from '@wdio/globals';

export type PathExistsResult = {
	exists: boolean;
	error: string | null;
};

export type ReadFileResult = {
	kind: 'binary' | 'error' | 'text';
	error: string | null;
	content: number[] | string;
};

export type TreeNode = {
	name: string;
	path: string;
	isExpanded: boolean;
	isLoading: boolean;
	children: TreeNode[];
	hasChildren: boolean;
	containsDtxFiles: boolean;
	songTitle: string | null;
};

export type ListedFile = {
	fileName: string;
	size: number;
	lastModified: string;
	key: string;
};

export type ListFilesResult = {
	files: ListedFile[];
	error: string | null;
};

export const pathExists = async (
	workspaceRoot: string,
	...pathParts: string[]
): Promise<PathExistsResult> =>
	await browser.tauri.execute(
		({ core }, rootPath: string, parts: string[]) =>
			core.invoke<PathExistsResult>('path_exists', {
				basePath: rootPath,
				pathParts: parts,
				workspaceRoot: rootPath
			}),
		workspaceRoot,
		pathParts
	);

export const readFile = async (filePath: string, workspaceRoot: string): Promise<ReadFileResult> =>
	await browser.tauri.execute(
		({ core }, requestedPath: string, rootPath: string) =>
			core.invoke<ReadFileResult>('read_file', {
				filePath: requestedPath,
				workspaceRoot: rootPath
			}),
		filePath,
		workspaceRoot
	);

export const loadTree = async (workspaceRoot: string): Promise<TreeNode[]> =>
	await browser.tauri.execute(
		({ core }, rootPath: string) =>
			core.invoke<TreeNode[]>('load_tree_structure', {
				basePath: rootPath,
				pathParts: [],
				workspaceRoot: rootPath
			}),
		workspaceRoot
	);

export const listFiles = async (
	folderPath: string,
	workspaceRoot: string
): Promise<ListFilesResult> =>
	await browser.tauri.execute(
		({ core }, requestedPath: string, rootPath: string) =>
			core.invoke<ListFilesResult>('list_files', {
				dirPath: requestedPath,
				workspaceRoot: rootPath
			}),
		folderPath,
		workspaceRoot
	);
