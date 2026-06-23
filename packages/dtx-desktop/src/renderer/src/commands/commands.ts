import type { ShellSection } from '../stores/workspaceStore';

export type Command = {
	id: string;
	title: string;
	group: 'Navigation' | 'Workspace' | 'Account';
	run: () => void;
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
};
export type CommandContext = { isAuthenticated: boolean; handlers: CommandHandlers };

export const buildCommands = ({ isAuthenticated, handlers: h }: CommandContext): Command[] => {
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
