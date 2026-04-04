import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { authStore } from '../stores/authStore';

vi.mock('@lucide/svelte', () => ({
	Loader: vi.fn(),
	User: vi.fn(),
	AlertCircle: vi.fn()
}));

import Login from './Login.svelte';

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
});
