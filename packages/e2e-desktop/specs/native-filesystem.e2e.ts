import { join } from 'node:path';

import { expect } from '@wdio/globals';

import { listFiles, loadTree, readFile } from '../support/native';
import {
	createWorkspaceFixture,
	fixtureFolderName,
	fixtureSongTitle,
	type WorkspaceFixture
} from '../support/workspace-fixture';

describe('Desktop native filesystem boundary', () => {
	let fixture: WorkspaceFixture;

	before(async () => {
		fixture = await createWorkspaceFixture();
	});

	after(async () => {
		await fixture?.cleanup();
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

		const result = await listFiles(fixture.songFolder, fixture.workspaceRoot);
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
		const dtx = await readFile(join(fixture.songFolder, 'basic.dtx'), fixture.workspaceRoot);
		expect(dtx).toMatchObject({ kind: 'text', error: null });
		expect(dtx.content).toContain(`#TITLE:${fixtureSongTitle}`);

		const wav = await readFile(join(fixture.songFolder, 'preview.wav'), fixture.workspaceRoot);
		expect(wav).toEqual({
			kind: 'binary',
			error: null,
			content: [0, 1, 2, 127, 255]
		});
	});

	// NOTE: this verifies containment only against the *caller-supplied* root.
	// `read_file` accepts `workspaceRoot` as a renderer IPC arg, so a
	// compromised webview could pass a different root and escape containment.
	// The trusted-root migration is tracked in HPA-314.
	it('rejects reads outside the caller-supplied workspace root', async () => {
		const result = await readFile(
			join(fixture.outsideRoot, 'private.dtx'),
			fixture.workspaceRoot
		);

		expect(result.kind).toBe('error');
		expect(result.content).toBe('');
		expect(result.error).toBe('Invalid file path');
	});
});
