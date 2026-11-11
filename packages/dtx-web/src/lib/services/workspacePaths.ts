export const toWorkspacePath = (
	webkitRelativePath: string | undefined,
	fileName: string
): string => {
	const segments = (webkitRelativePath ?? '').split('/');
	return segments.length > 1 ? segments.slice(1).join('/') : fileName;
};

export const workspacePathKey = (path: string): string => path.normalize('NFC').toLowerCase();

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
