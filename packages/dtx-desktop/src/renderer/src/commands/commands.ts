import type { ShellSection } from '../stores/workspaceStore';

export type Command = {
	id: string;
	title: string;
	group: 'Navigation' | 'Workspace' | 'Account';
	// A command may be async (e.g. export). Callers should `await run()` so the
	// handler's own error handling completes before the palette closes.
	run: () => void | Promise<void>;
};
export type CommandHandlers = {
	goToSection: (s: ShellSection) => void;
	newSong: () => void;
	selectWorkspace: () => void;
	refreshWorkspace: () => void;
	clearWorkspace: () => void;
	clearCache: () => void;
	login: () => void;
	logout: () => void;
	exportSelected: () => void | Promise<void>;
};
export type CommandContext = {
	isAuthenticated: boolean;
	hasSelectedSong: boolean;
	handlers: CommandHandlers;
};

export const buildCommands = ({
	isAuthenticated,
	hasSelectedSong,
	handlers: h
}: CommandContext): Command[] => {
	const cmds: Command[] = [
		{
			id: 'nav.library',
			title: 'Go to Library',
			group: 'Navigation',
			run: () => h.goToSection('library')
		},
		{
			id: 'nav.templates',
			title: 'Go to Templates',
			group: 'Navigation',
			run: () => h.goToSection('templates')
		},
		{
			id: 'nav.settings',
			title: 'Open Settings',
			group: 'Navigation',
			run: () => h.goToSection('settings')
		},
		{ id: 'workspace.newSong', title: 'New Song', group: 'Workspace', run: h.newSong },
		{
			id: 'workspace.select',
			title: 'Select Workspace Folder',
			group: 'Workspace',
			run: h.selectWorkspace
		},
		{
			id: 'workspace.refresh',
			title: 'Refresh Workspace',
			group: 'Workspace',
			run: h.refreshWorkspace
		},
		{
			id: 'workspace.clear',
			title: 'Clear Workspace',
			group: 'Workspace',
			run: h.clearWorkspace
		}
	];
	if (hasSelectedSong) {
		cmds.push({
			id: 'workspace.exportSelected',
			title: 'Export Selected Song',
			group: 'Workspace',
			run: h.exportSelected
		});
	}
	if (isAuthenticated) {
		cmds.splice(1, 0, {
			id: 'nav.cloud',
			title: 'Go to Cloud',
			group: 'Navigation',
			run: () => h.goToSection('cloud')
		});
		cmds.push({
			id: 'account.clearCache',
			title: 'Clear Cache',
			group: 'Account',
			run: h.clearCache
		});
		cmds.push({ id: 'account.logout', title: 'Logout', group: 'Account', run: h.logout });
	} else {
		cmds.push({ id: 'account.login', title: 'Login', group: 'Account', run: h.login });
	}
	return cmds;
};
