import { join } from 'node:path';
import { lstat } from 'node:fs/promises';

import { browser, expect } from '@wdio/globals';

import {
	createSong,
	exportSongToZip,
	getWorkspaceRoot,
	listFiles,
	loadTree,
	parseDtxFiles,
	pathExists,
	readFile
} from '../support/native';
import {
	fixtureFolderName,
	fixtureSongTitle,
	getPreseededWorkspaceFixture,
	type WorkspaceFixture
} from '../support/workspace-fixture';

const outsideWorkspaceError = 'Path is outside the workspace';
const rejectedCreateFolderName = 'Must Not Create Outside Workspace';

const expectOutsideWorkspaceRead = async (filePath: string): Promise<void> => {
	expect(await readFile(filePath)).toEqual({
		kind: 'error',
		content: '',
		error: outsideWorkspaceError
	});
};

const pathDoesNotExist = async (path: string): Promise<boolean> => {
	try {
		await lstat(path);
		return false;
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
		if (code === 'ENOENT') return true;
		throw error;
	}
};

describe('Desktop native filesystem boundary', () => {
	let fixture: WorkspaceFixture;

	before(() => {
		fixture = getPreseededWorkspaceFixture();
	});

	it('discovers SET.def metadata and exposes stable file metadata', async () => {
		const tree = await loadTree(fixture.workspaceRoot);
		expect(tree).toHaveLength(1);
		expect(tree[0]).toMatchObject({
			name: fixtureFolderName,
			path: fixture.songFolder,
			containsDtxFiles: true,
			songTitle: fixtureSongTitle
		});

		const result = await listFiles(fixture.songFolder);
		expect(result.error).toBeNull();
		expect(result.files.map((file) => file.fileName).sort()).toEqual([
			'SET.def',
			'basic.dtx',
			'preview.wav'
		]);
		for (const file of result.files) {
			expect(file.lastModified).not.toBe('');
			expect(file.key).toBe(join(fixture.songFolder, file.fileName));
		}
	});

	it('returns text and binary files using the renderer wire contract', async () => {
		const dtx = await readFile(join(fixture.songFolder, 'basic.dtx'));
		expect(dtx).toMatchObject({ kind: 'text', error: null });
		expect(dtx.content).toContain(`#TITLE:${fixtureSongTitle}`);

		const wav = await readFile(join(fixture.songFolder, 'preview.wav'));
		expect(wav).toEqual({
			kind: 'binary',
			error: null,
			content: [0, 1, 2, 127, 255]
		});
	});

	it('parses and exports an in-root fixture through real IPC', async () => {
		const parsed = await parseDtxFiles(fixture.songFolder);
		expect(parsed).toMatchObject({ bpm: 120, artist: 'Integration Test' });

		const exported = await exportSongToZip({
			songPath: fixture.songFolder,
			songTitle: 'Fixture Export',
			exportDirectory: fixture.exportRoot
		});
		expect(exported).toEqual({
			success: true,
			zipPath: join(fixture.exportRoot, 'Fixture Export.zip'),
			filesCount: 3
		});
		expect(await pathExists(fixture.exportRoot, 'Fixture Export.zip')).toEqual({
			exists: true,
			error: null
		});
	});

	it('keeps the Rust-owned workspace root after renderer storage is spoofed', async () => {
		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);

		await browser.execute(() => {
			localStorage.setItem('workspace_path', JSON.stringify('/'));
		});
		await browser.refresh();

		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
	});

	it('rejects every native filesystem escape from the Rust-owned workspace root', async () => {
		const outsideFile = join(fixture.outsideRoot, 'private.dtx');
		const traversalFile = join(fixture.workspaceRoot, '..', 'outside', 'private.dtx');

		for (const filePath of [outsideFile, traversalFile]) {
			await expectOutsideWorkspaceRead(filePath);
		}

		expect(await pathExists(fixture.outsideRoot)).toEqual({
			exists: false,
			error: outsideWorkspaceError
		});

		expect(await listFiles(fixture.outsideRoot)).toEqual({
			files: [],
			error: outsideWorkspaceError
		});

		await expect(loadTree(fixture.outsideRoot)).rejects.toThrow(outsideWorkspaceError);
		await expect(parseDtxFiles(fixture.outsideRoot)).rejects.toThrow(outsideWorkspaceError);

		await expect(
			exportSongToZip({ songPath: fixture.outsideRoot, songTitle: 'Outside Workspace Song' })
		).rejects.toThrow(outsideWorkspaceError);
	});

	it('rejects alternate-separator traversal on Windows', async function () {
		// The WDIO runner and the native Tauri process share an OS. Backslashes
		// become traversal separators only on Windows; elsewhere they are literal
		// filename characters and would exercise a missing-file path instead.
		if (process.platform !== 'win32') {
			return this.skip();
		}

		await expectOutsideWorkspaceRead(
			join(fixture.workspaceRoot, 'FixtureSong', '..\\..\\outside', 'private.dtx')
		);
	});

	it('rejects symlink escapes from every native filesystem command', async function () {
		if (!fixture.escapeLinkPath) {
			expect(fixture.escapeLinkUnavailableReason).toMatch(/^(EPERM|EOPNOTSUPP|ENOTSUP)$/);
			return this.skip();
		}

		const symlinkFile = join(fixture.escapeLinkPath, 'private.dtx');
		await expectOutsideWorkspaceRead(symlinkFile);
		expect(await pathExists(fixture.escapeLinkPath)).toEqual({
			exists: false,
			error: outsideWorkspaceError
		});
		expect(await listFiles(fixture.escapeLinkPath)).toEqual({
			files: [],
			error: outsideWorkspaceError
		});
		await expect(loadTree(fixture.escapeLinkPath)).rejects.toThrow(outsideWorkspaceError);
		await expect(parseDtxFiles(fixture.escapeLinkPath)).rejects.toThrow(outsideWorkspaceError);
		await expect(
			exportSongToZip({ songPath: fixture.escapeLinkPath, songTitle: 'Symlink Escape' })
		).rejects.toThrow(outsideWorkspaceError);
	});

	it('does not let forged legacy workspaceRoot fields redirect native authority', async () => {
		const outsideFile = join(fixture.outsideRoot, 'private.dtx');
		const forgedRead = await browser.tauri.execute<
			Awaited<ReturnType<typeof readFile>>,
			[string, string]
		>(
			({ core }, filePath: string, forgedWorkspaceRoot: string) =>
				core.invoke('read_file', {
					filePath,
					workspaceRoot: forgedWorkspaceRoot
				}) as unknown as Awaited<ReturnType<typeof readFile>>,
			outsideFile,
			fixture.outsideRoot
		);
		expect(forgedRead).toEqual({
			kind: 'error',
			content: '',
			error: outsideWorkspaceError
		});

		const forgedExists = await browser.tauri.execute<
			Awaited<ReturnType<typeof pathExists>>,
			[string, string]
		>(
			({ core }, basePath: string, forgedWorkspaceRoot: string) =>
				core.invoke('path_exists', {
					basePath,
					pathParts: [],
					workspaceRoot: forgedWorkspaceRoot
				}) as unknown as Awaited<ReturnType<typeof pathExists>>,
			fixture.outsideRoot,
			fixture.outsideRoot
		);
		expect(forgedExists).toEqual({ exists: false, error: outsideWorkspaceError });
		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
	});

	it('rejects out-of-root create targets without creating anything', async () => {
		const outsideCreateTarget = join(fixture.outsideRoot, rejectedCreateFolderName);
		const forgedCreateFolderName = `${rejectedCreateFolderName} Forged`;
		const forgedCreateTarget = join(fixture.outsideRoot, forgedCreateFolderName);
		await expect(
			createSong({
				selectedPath: fixture.outsideRoot,
				sanitizedFolderName: rejectedCreateFolderName,
				sanitizedSongName: rejectedCreateFolderName
			})
		).rejects.toThrow(outsideWorkspaceError);

		expect(await pathDoesNotExist(outsideCreateTarget)).toBe(true);
		await expect(
			browser.tauri.execute<
				unknown,
				[
					{
						selectedPath: string;
						sanitizedFolderName: string;
						sanitizedSongName: string;
					},
					string
				]
			>(
				({ core }, options, forgedWorkspaceRoot: string) =>
					core.invoke('create_song', {
						options,
						workspaceRoot: forgedWorkspaceRoot
					}) as unknown,
				{
					selectedPath: fixture.outsideRoot,
					sanitizedFolderName: forgedCreateFolderName,
					sanitizedSongName: forgedCreateFolderName
				},
				fixture.outsideRoot
			)
		).rejects.toThrow(outsideWorkspaceError);

		expect(await pathDoesNotExist(forgedCreateTarget)).toBe(true);
		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
	});

	it('rejects symlink create targets without creating outside directories', async function () {
		if (!fixture.escapeLinkPath) {
			expect(fixture.escapeLinkUnavailableReason).toMatch(/^(EPERM|EOPNOTSUPP|ENOTSUP)$/);
			return this.skip();
		}

		const symlinkCreateFolderName = `${rejectedCreateFolderName} Symlink`;
		await expect(
			createSong({
				selectedPath: fixture.escapeLinkPath,
				sanitizedFolderName: symlinkCreateFolderName,
				sanitizedSongName: symlinkCreateFolderName
			})
		).rejects.toThrow(outsideWorkspaceError);

		expect(await pathDoesNotExist(join(fixture.outsideRoot, symlinkCreateFolderName))).toBe(
			true
		);
		expect(await getWorkspaceRoot()).toBe(fixture.workspaceRoot);
	});
});
