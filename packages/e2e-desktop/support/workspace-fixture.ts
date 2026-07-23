import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const fixtureFolderName = 'FixtureSong';
export const fixtureSongTitle = 'Critical Workspace Song';

export type WorkspaceFixture = {
	workspaceRoot: string;
	outsideRoot: string;
	songFolder: string;
	cleanup: () => Promise<void>;
};

const encodeUtf16Le = (value: string): Uint8Array => {
	const bytes = new Uint8Array(2 + value.length * 2);
	bytes[0] = 0xff;
	bytes[1] = 0xfe;

	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		bytes[2 + index * 2] = codeUnit & 0xff;
		bytes[3 + index * 2] = codeUnit >> 8;
	}

	return bytes;
};

export const createWorkspaceFixture = async ({
	includeSong = true
}: {
	includeSong?: boolean;
} = {}): Promise<WorkspaceFixture> => {
	const workspaceRoot = await realpath(
		await mkdtemp(join(tmpdir(), 'drumery-desktop-e2e-workspace-'))
	);
	const outsideRoot = await realpath(
		await mkdtemp(join(tmpdir(), 'drumery-desktop-e2e-outside-'))
	);
	const songFolder = join(workspaceRoot, fixtureFolderName);

	if (includeSong) {
		await mkdir(songFolder);
		await writeFile(
			join(songFolder, 'SET.def'),
			encodeUtf16Le(
				[`#TITLE ${fixtureSongTitle}`, '#L1LABEL BASIC', '#L1FILE basic.dtx'].join('\n')
			)
		);
		await writeFile(
			join(songFolder, 'basic.dtx'),
			[
				`#TITLE:${fixtureSongTitle}`,
				'#ARTIST:Integration Test',
				'#BPM:120',
				'#DLEVEL:50'
			].join('\n')
		);
		await writeFile(join(songFolder, 'preview.wav'), new Uint8Array([0, 1, 2, 127, 255]));
	}

	await writeFile(join(outsideRoot, 'private.dtx'), '#TITLE:Outside Workspace');

	return {
		workspaceRoot,
		outsideRoot,
		songFolder,
		cleanup: async () => {
			await rm(workspaceRoot, { recursive: true, force: true });
			await rm(outsideRoot, { recursive: true, force: true });
		}
	};
};
