import { vi } from 'vitest';
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
	lastModified: new Date('2024-01-15').toISOString(),
	...overrides
});

export const mockWorkspaceService = () => ({
	getWorkspaces: vi.fn(() => [makeWorkspace(), makeWorkspace({ name: 'Second Workspace' })]),
	getCurrentWorkspace: vi.fn(() => makeWorkspace()),
	setCurrentWorkspace: vi.fn(),
	deleteWorkspace: vi.fn(),
	parseDTXFile: vi.fn().mockResolvedValue({
		dtxFile: {
			parseNotes: vi.fn(() => []),
			parseBPMChanges: vi.fn(() => []),
			parseSoundChips: vi.fn(() => [])
		},
		simFile: { files: [] }
	}),
	switchDTXFile: vi.fn()
});

export const mockSoundLibrary = () => ({
	getAll: vi.fn(() => [
		{
			hash: 'abc123',
			fileName: 'kick.wav',
			size: 1024,
			fileType: 'audio/wav',
			dateAdded: Date.now()
		},
		{
			hash: 'def456',
			fileName: 'snare.wav',
			size: 2048,
			fileType: 'audio/wav',
			dateAdded: Date.now()
		}
	]),
	getStats: vi.fn(() => ({ fileCount: 2, sizeFormatted: '3.0 KB' })),
	addFiles: vi.fn().mockResolvedValue({ added: 2, skipped: 0, errors: [] }),
	removeFile: vi.fn(),
	clearAll: vi.fn(),
	findByFileName: vi.fn(() => []),
	toFile: vi.fn(() => null)
});

export const mockToastStore = () => ({
	success: vi.fn(),
	error: vi.fn()
});
