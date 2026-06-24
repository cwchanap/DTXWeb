import { describe, it, expect, vi } from 'vitest';
import { buildCommands } from './commands';

const handlers = {
	goToSection: vi.fn(),
	newSong: vi.fn(),
	selectWorkspace: vi.fn(),
	refreshWorkspace: vi.fn(),
	clearWorkspace: vi.fn(),
	clearCache: vi.fn(),
	login: vi.fn(),
	logout: vi.fn(),
	exportSelected: vi.fn()
};

describe('buildCommands', () => {
	it('includes Login (not Logout) when unauthenticated', () => {
		const ids = buildCommands({ isAuthenticated: false, hasSelectedSong: false, handlers }).map(
			(c) => c.id
		);
		expect(ids).toContain('account.login');
		expect(ids).not.toContain('account.logout');
		expect(ids).not.toContain('nav.cloud');
	});
	it('includes Logout and Cloud nav when authenticated', () => {
		const ids = buildCommands({ isAuthenticated: true, hasSelectedSong: false, handlers }).map(
			(c) => c.id
		);
		expect(ids).toContain('account.logout');
		expect(ids).toContain('nav.cloud');
	});
	it('includes "Export Selected Song" only when a song is selected', () => {
		const without = buildCommands({
			isAuthenticated: true,
			hasSelectedSong: false,
			handlers
		}).map((c) => c.id);
		const withSong = buildCommands({
			isAuthenticated: true,
			hasSelectedSong: true,
			handlers
		}).map((c) => c.id);
		expect(without).not.toContain('workspace.exportSelected');
		expect(withSong).toContain('workspace.exportSelected');
	});
	it('run() invokes the matching handler', () => {
		const cmds = buildCommands({ isAuthenticated: true, hasSelectedSong: true, handlers });
		cmds.find((c) => c.id === 'workspace.newSong')!.run();
		expect(handlers.newSong).toHaveBeenCalled();
	});
	it('exportSelected.run() invokes the export handler', () => {
		const cmds = buildCommands({ isAuthenticated: true, hasSelectedSong: true, handlers });
		cmds.find((c) => c.id === 'workspace.exportSelected')!.run();
		expect(handlers.exportSelected).toHaveBeenCalled();
	});
});
