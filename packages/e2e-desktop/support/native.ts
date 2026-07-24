import { browser } from '@wdio/globals';

import type {
	ListFilesResult as GeneratedListFilesResult,
	ListedFile as GeneratedListedFile,
	PathExistsResult as GeneratedPathExistsResult,
	ReadFileResultWire,
	TreeNode as GeneratedTreeNode
} from './generated/native-types';

export type PathExistsResult = GeneratedPathExistsResult;
export type ReadFileResult = ReadFileResultWire;
export type TreeNode = GeneratedTreeNode;
export type ListedFile = GeneratedListedFile;
export type ListFilesResult = GeneratedListFilesResult;

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
