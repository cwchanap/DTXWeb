import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { preferencesStore } from '../../stores/preferencesStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({
	authService: {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));
vi.mock('../../services/preferencesService', () => ({
	loadPreferences: vi.fn().mockResolvedValue({ detailPaneWidth: 420, detailPaneVisible: true }),
	savePreferences: vi.fn().mockResolvedValue(undefined)
}));

import TopToolbar from './TopToolbar.svelte';
import { authService } from '../../services/authService';
import { simFileService } from '../../services/simFileService';
import { savePreferences } from '../../services/preferencesService';

describe('TopToolbar', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		preferencesStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('shows brand', () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
	});

	it('calls onOpenPalette when the search trigger is clicked', async () => {
		const onOpenPalette = vi.fn();
		render(TopToolbar, { onOpenPalette });
		await fireEvent.click(screen.getByRole('button', { name: /Open command palette/i }));
		expect(onOpenPalette).toHaveBeenCalled();
	});

	it('shows Login when unauthenticated and calls authService.login', async () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		const btn = screen.getByRole('button', { name: /Login to access cloud features/i });
		await fireEvent.click(btn);
		expect(authService.login).toHaveBeenCalled();
	});

	it('shows the details toggle in a list section and toggles + persists visibility', async () => {
		// In the app, AppShell calls preferencesStore.load() on mount before the
		// toolbar toggle is clickable. Mirror that so the loaded-gate is open.
		await preferencesStore.load();
		// default section after reset is 'library'
		render(TopToolbar, { onOpenPalette: vi.fn() });
		const toggle = screen.getByRole('button', { name: /Toggle details panel/i });
		expect(get(preferencesStore).detailPaneVisible).toBe(true);
		await fireEvent.click(toggle);
		expect(get(preferencesStore).detailPaneVisible).toBe(false);
		expect(savePreferences).toHaveBeenCalledWith({
			detailPaneWidth: 420,
			detailPaneVisible: false
		});
	});

	it('hides the details toggle outside list sections', () => {
		workspaceStore.setActiveSection('settings');
		render(TopToolbar, { onOpenPalette: vi.fn() });
		expect(screen.queryByRole('button', { name: /Toggle details panel/i })).toBeNull();
	});

	describe('authenticated', () => {
		beforeEach(() =>
			authStore.setUser({ id: 'u1', email: 'test@example.com', name: 'Test User' })
		);

		it('shows user name and email', () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			expect(screen.getByText('Test User')).toBeInTheDocument();
			expect(screen.getByText('test@example.com')).toBeInTheDocument();
		});
		it('falls back to "User" when the profile has no display name', () => {
			authStore.setUser({ id: 'u2', email: 'noname@example.com', name: '' });
			render(TopToolbar, { onOpenPalette: vi.fn() });
			expect(screen.getByText('User')).toBeInTheDocument();
		});
		it('calls logout', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
			expect(authService.logout).toHaveBeenCalled();
		});
		it('calls clearCache and removes song_templates', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }));
			expect(simFileService.clearCache).toHaveBeenCalled();
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('song_templates');
		});
	});
});
