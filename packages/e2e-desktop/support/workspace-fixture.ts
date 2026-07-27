import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixtureFolderName = 'FixtureSong';
export const fixtureSongTitle = 'Critical Workspace Song';
export const fixtureEscapeLinkName = 'outside-link';

export type WorkspaceFixture = {
	workspaceRoot: string;
	outsideRoot: string;
	songFolder: string;
	exportRoot: string;
	escapeLinkPath: string | null;
	escapeLinkUnavailableReason?: string;
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
	mkdirSync(workspaceRoot, { recursive: true });
	mkdirSync(outsideRoot, { recursive: true });
	const songFolder = join(workspaceRoot, fixtureFolderName);
	const exportRoot = join(workspaceRoot, 'exports');
	const escapeLinkPath = join(workspaceRoot, fixtureEscapeLinkName);
	let resolvedEscapeLinkPath: string | null = escapeLinkPath;
	let escapeLinkUnavailableReason: string | undefined;
	mkdirSync(exportRoot, { recursive: true });

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
	try {
		symlinkSync(outsideRoot, escapeLinkPath, process.platform === 'win32' ? 'junction' : 'dir');
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
		if (!['EPERM', 'EOPNOTSUPP', 'ENOTSUP'].includes(code)) {
			throw error;
		}
		resolvedEscapeLinkPath = null;
		escapeLinkUnavailableReason = code;
	}

	return {
		workspaceRoot: realpathSync(workspaceRoot),
		outsideRoot: realpathSync(outsideRoot),
		songFolder,
		exportRoot,
		escapeLinkPath: resolvedEscapeLinkPath,
		escapeLinkUnavailableReason
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
	const escapeLinkPath = process.env.DTX_E2E_ESCAPE_LINK_PATH || null;
	const escapeLinkUnavailableReason =
		process.env.DTX_E2E_ESCAPE_LINK_UNAVAILABLE_REASON || undefined;

	return {
		workspaceRoot,
		outsideRoot,
		songFolder: join(workspaceRoot, fixtureFolderName),
		exportRoot: join(workspaceRoot, 'exports'),
		escapeLinkPath,
		escapeLinkUnavailableReason
	};
};

export const getOrCreatePreseededWorkspaceFixture = ({
	parentPath
}: {
	parentPath: string;
}): WorkspaceFixture => {
	if (process.env.DTX_E2E_WORKSPACE_ROOT || process.env.DTX_E2E_OUTSIDE_ROOT) {
		return getPreseededWorkspaceFixture();
	}

	const fixture = createWorkspaceFixture({ parentPath });
	process.env.DTX_E2E_WORKSPACE_ROOT = fixture.workspaceRoot;
	process.env.DTX_E2E_OUTSIDE_ROOT = fixture.outsideRoot;
	process.env.DTX_E2E_ESCAPE_LINK_PATH = fixture.escapeLinkPath ?? '';
	process.env.DTX_E2E_ESCAPE_LINK_UNAVAILABLE_REASON = fixture.escapeLinkUnavailableReason ?? '';
	return fixture;
};
