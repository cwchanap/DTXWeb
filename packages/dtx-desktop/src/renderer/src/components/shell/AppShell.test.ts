import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({
	simFileService: { clearCache: vi.fn(), fetchUserSimFiles: vi.fn() }
}));

// Heavy children stubbed as no-op vi.fn() components (repo convention). TopToolbar and
// NavRail are intentionally NOT mocked so we assert real shell chrome. Routing is verified
// by checking which child component function Svelte invoked.
vi.mock('../Workspace.svelte', () => ({ default: vi.fn() }));
vi.mock('./DetailPane.svelte', () => ({ default: vi.fn() }));
vi.mock('../Templates.svelte', () => ({ default: vi.fn() }));
vi.mock('../Settings.svelte', () => ({ default: vi.fn() }));
vi.mock('../SimFileList.svelte', () => ({ default: vi.fn() }));
vi.mock('../NewSong.svelte', () => ({ default: vi.fn() }));
vi.mock('./CommandPalette.svelte', () => ({ default: vi.fn() }));

import AppShell from './AppShell.svelte';
import Workspace from '../Workspace.svelte';
import Templates from '../Templates.svelte';

describe('AppShell', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('renders toolbar, rail and library master content by default', () => {
		render(AppShell);
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Library/i })).toBeInTheDocument();
		expect(vi.mocked(Workspace)).toHaveBeenCalled();
		expect(vi.mocked(Templates)).not.toHaveBeenCalled();
	});

	it('renders Templates content when section is templates', () => {
		workspaceStore.setActiveSection('templates');
		render(AppShell);
		expect(vi.mocked(Templates)).toHaveBeenCalled();
		expect(vi.mocked(Workspace)).not.toHaveBeenCalled();
	});
});
