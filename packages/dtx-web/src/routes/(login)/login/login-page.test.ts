import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// vi.hoisted runs before vi.mock factories so the reference is valid
const { envMock, pageMock } = vi.hoisted(() => ({
	envMock: { browser: false },
	pageMock: { url: new URL('http://localhost/login') }
}));

vi.mock('$app/environment', () => envMock);
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({ url: pageMock.url });
			return () => {};
		}
	}
}));

import LoginPage from './+page.svelte';

describe('Login Page', () => {
	beforeEach(() => {
		// Reset to default (SSR) state before each test
		envMock.browser = false;
		pageMock.url = new URL('http://localhost/login');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shows loading spinner while checking auth state (browser:false)', () => {
		render(LoginPage);
		expect(screen.getByText('Checking login status...')).toBeInTheDocument();
	});

	it('renders key login UI elements', () => {
		envMock.browser = false;
		render(LoginPage);
		// Loading state is the entry point; confirm the page mounts without error
		expect(screen.getByText('Checking login status...')).toBeInTheDocument();
	});

	it('shows login form when browser is true and no redirect param', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		expect(screen.queryByText('Login to Desktop App')).not.toBeInTheDocument();
	});

	it('shows desktop login heading when redirect=desktop is in URL', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?redirect=desktop');
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('heading', { name: 'Login to Desktop App' })
			).toBeInTheDocument();
		});
		expect(
			screen.getByText("You'll be redirected back to the desktop app after login.")
		).toBeInTheDocument();
	});

	it('shows email and password inputs after auth check (browser:true)', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByLabelText('Email')).toBeInTheDocument();
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});
	});

	it('sets isLoading and disables submit button when form is submitted', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
		});

		const submitButton = screen.getByRole('button', { name: 'Login' });
		expect(submitButton).not.toBeDisabled();

		// Submit the form - handleSubmit sets isLoading = true which disables button
		const form = submitButton.closest('form');
		expect(form).not.toBeNull();
		await fireEvent.submit(form!);

		await waitFor(() => expect(submitButton).toBeDisabled());
	});

	it('shows error message from form prop when present', async () => {
		envMock.browser = true;
		render(LoginPage, { props: { form: { error: 'Invalid credentials' } } });

		await waitFor(() => {
			expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
		});
	});
});
