import { join } from 'node:path';

import { browser, expect } from '@wdio/globals';

import {
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
		const alternateSeparatorFile = join(
			fixture.workspaceRoot,
			'FixtureSong',
			'..\\..\\outside',
			'private.dtx'
		);
		const symlinkFile = join(fixture.escapeLinkPath, 'private.dtx');

		for (const filePath of [outsideFile, traversalFile, alternateSeparatorFile, symlinkFile]) {
			const result = await readFile(filePath);
			expect(result.kind).toBe('error');
			expect(result.content).toBe('');
			expect(result.error).not.toBe('');
		}

		for (const basePath of [fixture.outsideRoot, fixture.escapeLinkPath]) {
			expect(await pathExists(basePath)).toMatchObject({ exists: false });

			const files = await listFiles(basePath);
			expect(files.files).toEqual([]);
			expect(files.error).not.toBeNull();

			await expect(loadTree(basePath)).rejects.toThrow();
			await expect(parseDtxFiles(basePath)).rejects.toThrow();
		}

		await expect(
			exportSongToZip({ songPath: fixture.outsideRoot, songTitle: 'Outside Workspace Song' })
		).rejects.toThrow();
	});
});
