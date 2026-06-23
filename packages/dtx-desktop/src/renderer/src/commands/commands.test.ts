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
	logout: vi.fn()
};

describe('buildCommands', () => {
	it('includes Login (not Logout) when unauthenticated', () => {
		const ids = buildCommands({ isAuthenticated: false, handlers }).map((c) => c.id);
		expect(ids).toContain('account.login');
		expect(ids).not.toContain('account.logout');
		expect(ids).not.toContain('nav.cloud');
	});
	it('includes Logout and Cloud nav when authenticated', () => {
		const ids = buildCommands({ isAuthenticated: true, handlers }).map((c) => c.id);
		expect(ids).toContain('account.logout');
		expect(ids).toContain('nav.cloud');
	});
	it('run() invokes the matching handler', () => {
		const cmds = buildCommands({ isAuthenticated: true, handlers });
		cmds.find((c) => c.id === 'workspace.newSong')!.run();
		expect(handlers.newSong).toHaveBeenCalled();
	});
});
