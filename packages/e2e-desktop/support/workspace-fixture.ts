import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixtureFolderName = 'FixtureSong';
export const fixtureSongTitle = 'Critical Workspace Song';
export const fixtureEscapeLinkName = 'outside-link';

export type WorkspaceFixture = {
	workspaceRoot: string;
	outsideRoot: string;
	songFolder: string;
	escapeLinkPath: string;
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

export const createWorkspaceFixture = ({
	parentPath,
	includeSong = true
}: {
	parentPath: string;
	includeSong?: boolean;
}): WorkspaceFixture => {
	mkdirSync(parentPath, { recursive: true });
	const fixtureParent = realpathSync(parentPath);
	const workspaceRoot = join(fixtureParent, 'workspace');
	const outsideRoot = join(fixtureParent, 'outside');
	mkdirSync(workspaceRoot);
	mkdirSync(outsideRoot);
	const songFolder = join(workspaceRoot, fixtureFolderName);
	const escapeLinkPath = join(workspaceRoot, fixtureEscapeLinkName);

	if (includeSong) {
		mkdirSync(songFolder);
		writeFileSync(
			join(songFolder, 'SET.def'),
			encodeUtf16Le(
				[`#TITLE ${fixtureSongTitle}`, '#L1LABEL BASIC', '#L1FILE basic.dtx'].join('\n')
			)
		);
		writeFileSync(
			join(songFolder, 'basic.dtx'),
			[
				`#TITLE:${fixtureSongTitle}`,
				'#ARTIST:Integration Test',
				'#BPM:120',
				'#DLEVEL:50'
			].join('\n')
		);
		writeFileSync(join(songFolder, 'preview.wav'), new Uint8Array([0, 1, 2, 127, 255]));
	}

	writeFileSync(join(outsideRoot, 'private.dtx'), '#TITLE:Outside Workspace');
	symlinkSync(outsideRoot, escapeLinkPath, process.platform === 'win32' ? 'junction' : 'dir');

	return {
		workspaceRoot: realpathSync(workspaceRoot),
		outsideRoot: realpathSync(outsideRoot),
		songFolder,
		escapeLinkPath
	};
};

const requiredEnvironmentPath = (
	name: 'DTX_E2E_WORKSPACE_ROOT' | 'DTX_E2E_OUTSIDE_ROOT'
): string => {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} must be set by the WDIO configuration`);
	}
	return value;
};

export const getPreseededWorkspaceFixture = (): WorkspaceFixture => {
	const workspaceRoot = requiredEnvironmentPath('DTX_E2E_WORKSPACE_ROOT');
	const outsideRoot = requiredEnvironmentPath('DTX_E2E_OUTSIDE_ROOT');

	return {
		workspaceRoot,
		outsideRoot,
		songFolder: join(workspaceRoot, fixtureFolderName),
		escapeLinkPath: join(workspaceRoot, fixtureEscapeLinkName)
	};
};
