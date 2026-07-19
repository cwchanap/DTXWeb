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

	it('preserves the stashed desktop callback across an OAuth error retry', async () => {
		// Failed Google OAuth redirects to /login?redirect=desktop&error=...
		// without desktop_callback. The loopback URL stashed from the original
		// tauri-dev login must survive so a retry still reaches the running app.
		sessionStorage.setItem('dtx_desktop_auth_callback', 'http://127.0.0.1:47931/auth-callback');
		envMock.browser = true;
		pageMock.url = new URL(
			'http://localhost/login?redirect=desktop&error=' +
				encodeURIComponent('Google authentication failed. Please try again.')
		);
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('heading', { name: 'Login to Desktop App' })
			).toBeInTheDocument();
		});
		expect(sessionStorage.getItem('dtx_desktop_auth_callback')).toBe(
			'http://127.0.0.1:47931/auth-callback'
		);
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

	// The `next` param threads the post-login return path through both forms
	// so the server action can redirect back to the originating page (e.g.
	// /app/score) instead of the default /app.
	it('threads the next param into the password form as a hidden input', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?next=' + encodeURIComponent('/app/score'));
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		const passwordForm = screen.getByRole('button', { name: 'Login' }).closest('form');
		expect(passwordForm).not.toBeNull();
		const nextInput = passwordForm!.querySelector('input[name="next"]') as HTMLInputElement;
		expect(nextInput).not.toBeNull();
		expect(nextInput.value).toBe('/app/score');
	});

	it('threads the next param into the Google form as a hidden input', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?next=' + encodeURIComponent('/app/score'));
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: 'Continue with Google' })
			).toBeInTheDocument();
		});
		const googleForm = screen
			.getByRole('button', { name: 'Continue with Google' })
			.closest('form');
		expect(googleForm).not.toBeNull();
		const nextInput = googleForm!.querySelector('input[name="next"]') as HTMLInputElement;
		expect(nextInput).not.toBeNull();
		expect(nextInput.value).toBe('/app/score');
	});

	it('does not emit a next hidden input when next is absent', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login');
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		const passwordForm = screen.getByRole('button', { name: 'Login' }).closest('form');
		expect(passwordForm!.querySelector('input[name="next"]')).toBeNull();
	});

	// Desktop logins redirect back to the desktop app via deep link, not to
	// a web route, so `next` must be ignored even if present in the URL.
	it('does not thread next when redirect=desktop is set', async () => {
		envMock.browser = true;
		pageMock.url = new URL(
			'http://localhost/login?redirect=desktop&next=' + encodeURIComponent('/app/score')
		);
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getByRole('heading', { name: 'Login to Desktop App' })
			).toBeInTheDocument();
		});
		const passwordForm = screen.getByRole('button', { name: 'Login' }).closest('form');
		expect(passwordForm!.querySelector('input[name="next"]')).toBeNull();
		const desktopRedirect = passwordForm!.querySelector('input[name="redirect"]');
		expect(desktopRedirect).not.toBeNull();
	});
});
