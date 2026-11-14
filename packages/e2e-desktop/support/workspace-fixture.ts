import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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

export type CanonicalPathOptions = {
	realpath?: (path: string) => string;
};

/**
 * Canonical form of a fixture path as the Rust backend reports it.
 *
 * Rust strips Windows verbatim (`\\?\`) prefixes before returning canonical
 * paths over IPC, while still expanding symlinks and 8.3 short names such as
 * the GitHub runner's temp root (`C:\Users\RUNNER~1\...`). Node's
 * `realpathSync.native` resolves the same symlinks and short names without
 * adding a verbatim prefix.
 */
export const canonicalExpectedPath = (
	path: string,
	{ realpath = realpathSync.native }: CanonicalPathOptions = {}
): string => realpath(path);

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
	const fixtureParent = canonicalExpectedPath(parentPath);
	const workspaceRoot = join(fixtureParent, 'workspace');
	const outsideRoot = join(fixtureParent, 'outside');
	mkdirSync(workspaceRoot, { recursive: true });
	mkdirSync(outsideRoot, { recursive: true });
	const canonicalWorkspaceRoot = canonicalExpectedPath(workspaceRoot);
	const canonicalOutsideRoot = canonicalExpectedPath(outsideRoot);
	const songFolder = join(canonicalWorkspaceRoot, fixtureFolderName);
	const exportRoot = join(canonicalWorkspaceRoot, 'exports');
	const escapeLinkPath = join(canonicalWorkspaceRoot, fixtureEscapeLinkName);
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

	writeFileSync(join(canonicalOutsideRoot, 'private.dtx'), '#TITLE:Outside Workspace');
	try {
		symlinkSync(
			canonicalOutsideRoot,
			escapeLinkPath,
			process.platform === 'win32' ? 'junction' : 'dir'
		);
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
		if (!['EPERM', 'EOPNOTSUPP', 'ENOTSUP'].includes(code)) {
			throw error;
		}
		resolvedEscapeLinkPath = null;
		escapeLinkUnavailableReason = code;
	}

	return {
		workspaceRoot: canonicalWorkspaceRoot,
		outsideRoot: canonicalOutsideRoot,
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
	const rawWorkspaceRoot = requiredEnvironmentPath('DTX_E2E_WORKSPACE_ROOT');
	const rawOutsideRoot = requiredEnvironmentPath('DTX_E2E_OUTSIDE_ROOT');
	const canonicalWorkspaceRoot = existsSync(rawWorkspaceRoot)
		? canonicalExpectedPath(rawWorkspaceRoot)
		: rawWorkspaceRoot;
	const canonicalOutsideRoot = existsSync(rawOutsideRoot)
		? canonicalExpectedPath(rawOutsideRoot)
		: rawOutsideRoot;
	const escapeLinkPath = process.env.DTX_E2E_ESCAPE_LINK_PATH || null;
	const escapeLinkUnavailableReason =
		process.env.DTX_E2E_ESCAPE_LINK_UNAVAILABLE_REASON || undefined;

	return {
		workspaceRoot: canonicalWorkspaceRoot,
		outsideRoot: canonicalOutsideRoot,
		songFolder: join(canonicalWorkspaceRoot, fixtureFolderName),
		exportRoot: join(canonicalWorkspaceRoot, 'exports'),
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
