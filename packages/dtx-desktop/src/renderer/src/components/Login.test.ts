import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { authStore } from '../stores/authStore';

vi.mock('../services/authService', () => ({
	authService: {
		login: vi.fn(),
		cancelLogin: vi.fn()
	}
}));

vi.mock('@lucide/svelte');

import Login from './Login.svelte';
import { authService } from '../services/authService';

describe('Login', () => {
	beforeEach(() => {
		authStore.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('shows loading state when isLoading is true', () => {
		authStore.setLoading(true);
		render(Login);
		expect(screen.getByText(/Connecting to authentication service/)).toBeInTheDocument();
	});

	it('shows login form when not loading', () => {
		render(Login);
		expect(screen.getByText(/Sign in to your account/)).toBeInTheDocument();
	});

	it('shows error message when error is set', () => {
		authStore.setError('Authentication failed');
		render(Login);
		expect(screen.getByText('Authentication failed')).toBeInTheDocument();
	});

	it('does not show error when no error is set', () => {
		render(Login);
		expect(screen.queryByText('Authentication failed')).not.toBeInTheDocument();
	});

	it('shows sync description text', () => {
		render(Login);
		expect(screen.getByText(/Sign in with your Drumery web account/)).toBeInTheDocument();
	});

	it('shows redirect description when not loading', () => {
		render(Login);
		expect(screen.getByText(/You'll be redirected to the web login page/)).toBeInTheDocument();
	});

	it('does not show sign in form when loading', () => {
		authStore.setLoading(true);
		render(Login);
		expect(screen.queryByText(/Sign in to your account/)).not.toBeInTheDocument();
	});

	it('shows device authorization details and reachable cancel/retry controls', async () => {
		authStore.startLogin();
		authStore.setDeviceAuthorization({
			verificationUri: 'https://dtx.example.com/device',
			userCode: 'ABCD-EFGH'
		});
		authStore.setError(
			'Open https://dtx.example.com/device and enter code ABCD-EFGH to finish signing in.'
		);
		authStore.setLoading(true);
		render(Login);

		expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument();
		expect(screen.getByText(/Open https:\/\/dtx\.example\.com\/device/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /open verification page/i })).toHaveAttribute(
			'href',
			'https://dtx.example.com/device'
		);
		expect(screen.getByRole('button', { name: /cancel sign in/i })).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /cancel sign in/i }));
		expect(authService.cancelLogin).toHaveBeenCalledOnce();

		authStore.setLoading(false);
		authStore.setError('Sign-in canceled.');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		expect(authService.login).toHaveBeenCalledOnce();
	});
});
