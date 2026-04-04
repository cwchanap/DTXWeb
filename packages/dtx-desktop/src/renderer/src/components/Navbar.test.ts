import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../stores/authStore';

vi.mock('@lucide/svelte', () => ({
	Music: vi.fn(),
	LogOut: vi.fn(),
	User: vi.fn(),
	RefreshCw: vi.fn()
}));

vi.mock('../services/authService', () => ({
	authService: {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('../services/simFileService', () => ({
	simFileService: {
		clearCache: vi.fn()
	}
}));

import Navbar from './Navbar.svelte';
import { authService } from '../services/authService';
import { simFileService } from '../services/simFileService';

describe('Navbar', () => {
	beforeEach(() => {
		authStore.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe('unauthenticated state', () => {
		it('shows Login button when not authenticated', () => {
			render(Navbar);
			expect(
				screen.getByRole('button', { name: /Login to access cloud features/i })
			).toBeInTheDocument();
		});

		it('calls authService.login when Login button is clicked', async () => {
			render(Navbar);
			const loginBtn = screen.getByRole('button', {
				name: /Login to access cloud features/i
			});
			await fireEvent.click(loginBtn);
			expect(authService.login).toHaveBeenCalled();
		});

		it('shows app title', () => {
			render(Navbar);
			expect(screen.getByText('Drumery Desktop')).toBeInTheDocument();
		});
	});

	describe('authenticated state', () => {
		beforeEach(() => {
			authStore.setUser({ id: 'user-1', email: 'test@example.com', name: 'Test User' });
		});

		it('shows user name when authenticated', () => {
			render(Navbar);
			expect(screen.getByText('Test User')).toBeInTheDocument();
		});

		it('shows user email when authenticated', () => {
			render(Navbar);
			expect(screen.getByText('test@example.com')).toBeInTheDocument();
		});

		it('shows Logout button when authenticated', () => {
			render(Navbar);
			expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
		});

		it('shows Clear Cache button when authenticated', () => {
			render(Navbar);
			expect(screen.getByRole('button', { name: /Clear cache/i })).toBeInTheDocument();
		});

		it('calls authService.logout when Logout button is clicked', async () => {
			render(Navbar);
			const logoutBtn = screen.getByRole('button', { name: /Logout/i });
			await fireEvent.click(logoutBtn);
			expect(authService.logout).toHaveBeenCalled();
		});

		it('calls simFileService.clearCache when Clear Cache button is clicked', async () => {
			render(Navbar);
			const clearBtn = screen.getByRole('button', { name: /Clear cache/i });
			await fireEvent.click(clearBtn);
			expect(simFileService.clearCache).toHaveBeenCalled();
		});

		it('removes song_templates from localStorage when Clear Cache is clicked', async () => {
			render(Navbar);
			const clearBtn = screen.getByRole('button', { name: /Clear cache/i });
			await fireEvent.click(clearBtn);
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('song_templates');
		});

		it('shows User as fallback when name is not set', () => {
			authStore.reset();
			authStore.setUser({ id: 'user-2', email: 'noname@example.com' });
			render(Navbar);
			expect(screen.getByText('User')).toBeInTheDocument();
		});
	});
});
