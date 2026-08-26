import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({
	authService: { login: vi.fn(), cancelLogin: vi.fn(), logout: vi.fn() }
}));
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
vi.mock('./CommandPalette.svelte', async () => {
	// A real compiled component (not a vi.fn()) so Svelte re-renders it when the
	// `open` prop flips, letting shell tests assert the palette stayed closed.
	const Mock = (await import('./CommandPaletteMock.svelte')).default;
	return { default: Mock };
});

import AppShell from './AppShell.svelte';
import Workspace from '../Workspace.svelte';
import Templates from '../Templates.svelte';
import { loadPreferences, savePreferences } from '../../services/preferencesService';
import { authService } from '../../services/authService';

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

	it('opens the device authorization surface from the toolbar login entry point', async () => {
		vi.mocked(authService.login).mockImplementation(() => {
			authStore.startLogin();
		});
		render(AppShell);

		await fireEvent.click(
			screen.getByRole('button', { name: /Login to access cloud features/i })
		);

		expect(authService.login).toHaveBeenCalledOnce();
		expect(screen.getByRole('dialog', { name: /sign in/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
	});

	it('renders Templates content when section is templates', () => {
		workspaceStore.setActiveSection('templates');
		render(AppShell);
		expect(vi.mocked(Templates)).toHaveBeenCalled();
		expect(vi.mocked(Workspace)).not.toHaveBeenCalled();
	});

	it('resets to the library section when a signed-in user signs out while on Cloud', async () => {
		// Cloud is auth-only: NavRail hides its button on logout, but without the
		// guard the active section would stay 'cloud' and keep rendering the cloud
		// list for a signed-out session.
		authStore.setUser({ id: 'u1', email: 'a@b.c' });
		workspaceStore.setActiveSection('cloud');
		render(AppShell);
		expect(get(workspaceStore).activeSection).toBe('cloud');

		authStore.logout();
		await tick();

		expect(get(workspaceStore).activeSection).toBe('library');
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

	it('the resize handle exposes a focus-visible ring for keyboard users', async () => {
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		expect(handle).toHaveClass('focus-visible:ring-2');
		expect(handle).toHaveClass('focus-visible:ring-cyan/40');
	});

	it('hides the detail pane when no song is selected and stored visibility is false', async () => {
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
		window.innerWidth = 1400;
		render(AppShell);
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: /Resize details panel/i })).toBeNull()
		);
	});

	it('auto-reveals the detail pane when a song is selected even if it was hidden', async () => {
		// Clicking a song in the library should pop the detail pane back open
		// when the user had previously hidden it, instead of leaving the
		// selection silently invisible.
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		const handle = await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => {
			expect(handle.parentElement?.style.width).toBe('420px');
			expect(get(preferencesStore).detailPaneVisible).toBe(true);
			expect(savePreferences).toHaveBeenCalledWith({
				detailPaneWidth: 420,
				detailPaneVisible: true
			});
		});
	});

	it('does not re-reveal the detail pane after the user hides it while a song stays selected', async () => {
		// Regression: the auto-reveal effect must fire only on a new selection,
		// not when detailPaneVisible changes. Otherwise hiding the pane while a
		// song stays selected would immediately flip it back open.
		vi.mocked(loadPreferences).mockResolvedValue({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
		window.innerWidth = 1400;
		selectAnySong();
		render(AppShell);
		await screen.findByRole('button', { name: /Resize details panel/i });
		await waitFor(() => expect(get(preferencesStore).detailPaneVisible).toBe(true));

		// User hides the pane while the same song stays selected.
		preferencesStore.setDetailVisible(false);
		await tick();

		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(screen.queryByRole('button', { name: /Resize details panel/i })).toBeNull();
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

	// Positive control for the closed-while-modal test below: confirms the
	// mocked CommandPalette actually renders when paletteOpen flips to true,
	// so the "stays closed" assertion is meaningful (not vacuously passing
	// because the mock never reflects prop updates).
	it('opens the command palette on Cmd/Ctrl+K when no auth modal is active', async () => {
		render(AppShell);
		expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull();
		await fireEvent.keyDown(window, { key: 'k', metaKey: true });
		expect(screen.getByRole('dialog', { name: /Command palette/i })).toBeInTheDocument();
	});

	it('does not open the command palette while the sign-in modal is active', async () => {
		// Regression: while the sign-in modal is up (e.g. during a
		// cancel-in-progress that is awaiting logoutSession()), Cmd/Ctrl+K and
		// the toolbar palette button must not open the palette. Otherwise the
		// palette's Login command can start a new device flow that races the
		// in-flight native logout.
		vi.mocked(authService.login).mockImplementation(() => {
			authStore.startLogin();
		});
		render(AppShell);
		await fireEvent.click(
			screen.getByRole('button', { name: /Login to access cloud features/i })
		);
		expect(screen.getByRole('dialog', { name: /sign in/i })).toBeInTheDocument();

		// The toolbar Login button must hide while the modal is up so a keyboard
		// user cannot Tab to it behind the overlay and start a rival device flow.
		expect(
			screen.queryByRole('button', { name: /Login to access cloud features/i })
		).toBeNull();

		// Cmd/Ctrl+K must not open the palette while the modal is up.
		await fireEvent.keyDown(window, { key: 'k', metaKey: true });
		expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull();

		// The toolbar callback path is gated too.
		await fireEvent.click(screen.getByRole('button', { name: /Open command palette/i }));
		expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull();
	});

	it('does not open the command palette while an auth transition is settling', async () => {
		// Regression: logout() flips the renderer to signed out (modal closed,
		// Login button re-enabled) while its destructive native logoutSession()
		// is still pending. While isLoading marks that transition, Cmd/Ctrl+K and
		// the toolbar palette button must not open the palette — its Login command
		// would start a device flow the in-flight native logout clobbers.
		authStore.setLoading(true);
		render(AppShell);

		await fireEvent.keyDown(window, { key: 'k', metaKey: true });
		expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /Open command palette/i }));
		expect(screen.queryByRole('dialog', { name: /Command palette/i })).toBeNull();
	});
});
