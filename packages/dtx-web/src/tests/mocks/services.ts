import type { Workspace } from '$lib/services/workspaceService';

export const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	name: 'Test Workspace',
	path: '/workspace/test',
	currentDTX: 'basic.dtx',
	dtxFiles: [
		{ name: 'basic.dtx', content: 'DTX content', path: '/workspace/test/basic.dtx' },
		{ name: 'advanced.dtx', content: 'DTX content', path: '/workspace/test/advanced.dtx' }
	],
	audioFiles: [{ name: 'kick.wav', path: '/workspace/test/kick.wav', isLarge: false }],
	lastModified: new Date('2024-01-15').getTime(),
	...overrides
});
