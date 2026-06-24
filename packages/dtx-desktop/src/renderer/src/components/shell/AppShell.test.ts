import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({
	simFileService: { clearCache: vi.fn(), fetchUserSimFiles: vi.fn() }
}));
vi.mock('../../services/preferencesService', () => ({
	loadPreferences: vi.fn().mockResolvedValue({ detailPaneWidth: 420, detailPaneVisible: true }),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

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
import { loadPreferences, savePreferences } from '../../services/preferencesService';

const selectAnySong = () =>
	workspaceStore.selectSong({
		name: 'S',
		path: '/s',
		children: [],
		isExpanded: false,
		isLoading: false,
		hasChildren: false,
		containsDtxFiles: true
	});

describe('AppShell', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		preferencesStore.reset();
		vi.clearAllMocks();
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: true
		});
		window.innerWidth = 1024;
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

	it('auto-collapses the master pane in medium mode when a song is selected', () => {
		// default window.innerWidth = 1024 → medium: the two-pane layout collapses so the
		// selected song's detail shows full-screen instead of squeezing both panes.
		selectAnySong();
		render(AppShell);
		expect(screen.getByTestId('master-pane')).toHaveClass('hidden');
		// the resize handle only exists in wide mode
		expect(screen.queryByRole('button', { name: /Resize details panel/i })).toBeNull();
	});

	it('keeps the master pane visible in medium mode when nothing is selected', () => {
		render(AppShell);
		expect(screen.getByTestId('master-pane')).not.toHaveClass('hidden');
	});

	it('renders the detail pane at the stored width with a resize handle in wide mode', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 480,
			detailPaneVisible: true
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => expect(handle.parentElement?.style.width).toBe('480px'));
	});

	it('hides the detail pane (and handle) when stored visibility is false', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: /Resize details panel/i })).toBeNull()
		);
	});

	it('ArrowLeft on the handle widens the pane and persists', async () => {
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => expect(handle.parentElement?.style.width).toBe('420px'));
		await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
		expect(get(preferencesStore).detailPaneWidth).toBe(440);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 440,
			detailPaneVisible: true
		});
	});
});
