import type { Workspace } from '$lib/services/workspaceService';

const defaultKickFile = {
	name: 'kick.wav',
	path: 'kick.wav',
	isLarge: false,
	hash: 'mock-hash-kick'
};

export const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	name: 'Test Workspace',
	path: '/workspace/test',
	currentDTX: 'basic.dtx',
	dtxFiles: [
		{ name: 'basic.dtx', content: 'DTX content', path: 'basic.dtx' },
		{ name: 'advanced.dtx', content: 'DTX content', path: 'advanced.dtx' }
	],
	audioFiles: [{ ...defaultKickFile }],
	lastModified: new Date('2024-01-15').getTime(),
	...overrides
});
