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
	await browser.tauri.execute<PathExistsResult, [string, string[]]>(
		({ core }, rootPath: string, parts: string[]) =>
			core.invoke('path_exists', {
				basePath: rootPath,
				pathParts: parts,
				workspaceRoot: rootPath
			}) as unknown as PathExistsResult,
		workspaceRoot,
		pathParts
	);

export const readFile = async (filePath: string, workspaceRoot: string): Promise<ReadFileResult> =>
	await browser.tauri.execute<ReadFileResult, [string, string]>(
		({ core }, requestedPath: string, rootPath: string) =>
			core.invoke('read_file', {
				filePath: requestedPath,
				workspaceRoot: rootPath
			}) as unknown as ReadFileResult,
		filePath,
		workspaceRoot
	);

export const loadTree = async (workspaceRoot: string): Promise<TreeNode[]> =>
	await browser.tauri.execute<TreeNode[], [string]>(
		({ core }, rootPath: string) =>
			core.invoke('load_tree_structure', {
				basePath: rootPath,
				pathParts: [],
				workspaceRoot: rootPath
			}) as unknown as TreeNode[],
		workspaceRoot
	);

export const listFiles = async (
	folderPath: string,
	workspaceRoot: string
): Promise<ListFilesResult> =>
	await browser.tauri.execute<ListFilesResult, [string, string]>(
		({ core }, requestedPath: string, rootPath: string) =>
			core.invoke('list_files', {
				dirPath: requestedPath,
				workspaceRoot: rootPath
			}) as unknown as ListFilesResult,
		folderPath,
		workspaceRoot
	);
