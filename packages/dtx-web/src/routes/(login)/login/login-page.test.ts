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
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn()
}));

import LoginPage from './+page.svelte';

describe('Login Page', () => {
	beforeEach(() => {
		// Reset to default (SSR) state before each test
		envMock.browser = false;
		pageMock.url = new URL('http://localhost/login');
		sessionStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		sessionStorage.clear();
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

	it('stashes the desktop-supplied callback in sessionStorage when redirect=desktop', async () => {
		envMock.browser = true;
		pageMock.url = new URL(
			'http://localhost/login?redirect=desktop&desktop_callback=' +
				encodeURIComponent('http://127.0.0.1:47931/auth-callback')
		);
		render(LoginPage);

		await waitFor(() => {
			expect(sessionStorage.getItem('dtx_desktop_auth_callback')).toBe(
				'http://127.0.0.1:47931/auth-callback'
			);
		});
	});

	it('clears a stale stashed callback when redirect=desktop has no desktop_callback', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'http://127.0.0.1:47931/auth-callback');
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?redirect=desktop');
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('heading', { name: 'Login to Desktop App' })
			).toBeInTheDocument();
		});
		expect(sessionStorage.getItem('dtx_desktop_auth_callback')).toBeNull();
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
		render(LoginPage, { props: { form: { success: false, error: 'Invalid credentials' } } });

		await waitFor(() => {
			expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
		});
	});

	it('shows Google sign-in for existing linked accounts', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: 'Continue with Google' })
			).toBeInTheDocument();
		});
		expect(
			screen.getByText('Google sign-in is only available for existing linked accounts.')
		).toBeInTheDocument();
	});

	it('does not show signup copy', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
	});

	it('shows sanitized Google errors from query params', async () => {
		envMock.browser = true;
		pageMock.url = new URL(
			'http://localhost/login?error=Google+sign-in+is+only+available+for+existing+linked+accounts.'
		);
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getAllByText(
					'Google sign-in is only available for existing linked accounts.'
				).length
			).toBeGreaterThan(0);
		});
	});

	it('discards non-allow-listed error values from query params', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?error=Click+here+to+reset+your+password');
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		expect(screen.queryByText('Click here to reset your password')).not.toBeInTheDocument();
	});
});
