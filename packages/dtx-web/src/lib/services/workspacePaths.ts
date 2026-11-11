import { normalizeAudioReference } from '@dtx/common';

export const toWorkspacePath = (
	webkitRelativePath: string | undefined,
	fileName: string
): string => {
	const segments = (webkitRelativePath ?? '').split('/');
	return segments.length > 1 ? segments.slice(1).join('/') : fileName;
};

export const workspacePathKey = (path: string): string => path.normalize('NFC').toLowerCase();

export const resolveChipPath = <T extends { path: string }>(
	dtxRelativePath: string,
	chipRef: string,
	audioKeys: ReadonlyMap<string, T[]>,
	wavPath?: string
): T | null => {
	const refPath = normalizeAudioReference(chipRef);
	if (refPath === null) return null;
	const slash = dtxRelativePath.lastIndexOf('/');
	const dir = slash === -1 ? '' : dtxRelativePath.slice(0, slash + 1);

	let base = dir;
	if (wavPath) {
		// #PATH_WAV is relative to the chart's directory and may use Windows
		// separators, a leading `.\`, or `..` to reach a sibling folder.
		const segments = `${dir}${wavPath.replaceAll('\\', '/')}`.split('/');
		const resolved: string[] = [];
		for (const segment of segments) {
			if (!segment || segment === '.') continue;
			if (segment === '..') {
				if (resolved.length === 0) return null;
				resolved.pop();
				continue;
			}
			resolved.push(segment);
		}
		base = resolved.length > 0 ? `${resolved.join('/')}/` : '';
	}

	const candidates = audioKeys.get(workspacePathKey(`${base}${refPath}`));
	if (!candidates || candidates.length !== 1) return null;
	return candidates[0];
};

export const zipCollisionKey = (path: string): string =>
	path
		.split('/')
		.map((segment) =>
			segment
				.normalize('NFC')
				.toLowerCase()
				.replace(/^ +/, '')
				.replace(/[ .]+$/, '')
		)
		.join('/');
