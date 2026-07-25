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
export type DtxParseResult = {
	bpm: number | null;
	artist: string | null;
	levels: Array<{ label: string; level: number }>;
	parseFailures?: number;
};
export type CreateSongResult = {
	success: boolean;
	songFolderPath: string;
};
export type ExportSongResult = {
	success: boolean;
	zipPath?: string;
	filesCount?: number;
	error?: string;
};

export const pathExists = async (
	basePath: string,
	...pathParts: string[]
): Promise<PathExistsResult> =>
	await browser.tauri.execute<PathExistsResult, [string, string[]]>(
		({ core }, requestedBasePath: string, parts: string[]) =>
			core.invoke('path_exists', {
				basePath: requestedBasePath,
				pathParts: parts
			}) as unknown as PathExistsResult,
		basePath,
		pathParts
	);

export const getWorkspaceRoot = async (): Promise<string | null> =>
	await browser.tauri.execute<string | null, []>(
		({ core }) => core.invoke('get_workspace_root') as unknown as string | null
	);

export const readFile = async (filePath: string): Promise<ReadFileResult> =>
	await browser.tauri.execute<ReadFileResult, [string]>(
		({ core }, requestedPath: string) =>
			core.invoke('read_file', {
				filePath: requestedPath
			}) as unknown as ReadFileResult,
		filePath
	);

export const loadTree = async (basePath: string): Promise<TreeNode[]> =>
	await browser.tauri.execute<TreeNode[], [string]>(
		({ core }, requestedBasePath: string) =>
			core.invoke('load_tree_structure', {
				basePath: requestedBasePath,
				pathParts: []
			}) as unknown as TreeNode[],
		basePath
	);

export const listFiles = async (folderPath: string): Promise<ListFilesResult> =>
	await browser.tauri.execute<ListFilesResult, [string]>(
		({ core }, requestedPath: string) =>
			core.invoke('list_files', {
				dirPath: requestedPath
			}) as unknown as ListFilesResult,
		folderPath
	);

export const parseDtxFiles = async (folderPath: string): Promise<DtxParseResult> =>
	await browser.tauri.execute<DtxParseResult, [string]>(
		({ core }, requestedPath: string) =>
			core.invoke('parse_dtx_files', {
				folderPath: requestedPath
			}) as unknown as DtxParseResult,
		folderPath
	);

export const createSong = async ({
	selectedPath,
	sanitizedFolderName,
	sanitizedSongName,
	templateFolderPath
}: {
	selectedPath: string;
	sanitizedFolderName: string;
	sanitizedSongName: string;
	templateFolderPath?: string;
}): Promise<CreateSongResult> =>
	await browser.tauri.execute<
		CreateSongResult,
		[
			{
				selectedPath: string;
				sanitizedFolderName: string;
				sanitizedSongName: string;
				templateFolderPath?: string;
			}
		]
	>(
		({ core }, options) =>
			core.invoke('create_song', { options }) as unknown as CreateSongResult,
		{ selectedPath, sanitizedFolderName, sanitizedSongName, templateFolderPath }
	);

export const exportSongToZip = async ({
	songPath,
	songTitle,
	exportDirectory
}: {
	songPath: string;
	songTitle?: string;
	exportDirectory?: string;
}): Promise<ExportSongResult> =>
	await browser.tauri.execute<ExportSongResult, [string, string | undefined, string | undefined]>(
		(
			{ core },
			requestedSongPath: string,
			requestedSongTitle?: string,
			requestedExportDirectory?: string
		) =>
			core.invoke('export_song_to_zip', {
				songPath: requestedSongPath,
				songTitle: requestedSongTitle,
				exportDirectory: requestedExportDirectory
			}) as unknown as ExportSongResult,
		songPath,
		songTitle,
		exportDirectory
	);
