import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({
	authService: {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));

import TopToolbar from './TopToolbar.svelte';
import { authService } from '../../services/authService';
import { simFileService } from '../../services/simFileService';

describe('TopToolbar', () => {
	beforeEach(() => {
		authStore.reset();
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

	describe('authenticated', () => {
		beforeEach(() =>
			authStore.setUser({ id: 'u1', email: 'test@example.com', name: 'Test User' })
		);

		it('shows user name and email', () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			expect(screen.getByText('Test User')).toBeInTheDocument();
			expect(screen.getByText('test@example.com')).toBeInTheDocument();
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
