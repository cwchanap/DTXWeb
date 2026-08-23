import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { envMock, pageMock, authClientMock, assignMock } = vi.hoisted(() => ({
	envMock: { browser: false },
	pageMock: { url: new URL('http://localhost/login') },
	authClientMock: {
		signIn: {
			email: vi.fn(),
			social: vi.fn()
		}
	},
	assignMock: vi.fn()
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
vi.mock('$lib/auth/client', () => ({ authClient: authClientMock }));

import LoginPage from './+page.svelte';

describe('Login Page', () => {
	const originalLocation = window.location;

	beforeEach(() => {
		envMock.browser = false;
		pageMock.url = new URL('http://localhost/login');
		vi.clearAllMocks();
		authClientMock.signIn.email.mockResolvedValue({ data: {}, error: null });
		authClientMock.signIn.social.mockResolvedValue({ data: {}, error: null });
		Object.defineProperty(window, 'location', {
			value: { origin: 'http://localhost', assign: assignMock },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		Object.defineProperty(window, 'location', {
			value: originalLocation,
			writable: true,
			configurable: true
		});
	});

	it('shows loading spinner while the browser auth page is not mounted', () => {
		render(LoginPage);
		expect(screen.getByText('Checking login status...')).toBeInTheDocument();
	});

	it('renders the login form in the browser', async () => {
		envMock.browser = true;
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
		expect(screen.getByLabelText('Email')).toBeInTheDocument();
		expect(screen.getByLabelText('Password')).toBeInTheDocument();
	});

	it('preserves the existing-account-only Google sign-in copy', async () => {
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

	it('signs in with email and redirects to a safe next app path', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?next=%2Fapp%2Fscore');
		render(LoginPage);

		const email = await screen.findByLabelText('Email');
		const password = screen.getByLabelText('Password');
		await fireEvent.input(email, { target: { value: 'owner@example.com' } });
		await fireEvent.input(password, { target: { value: 'correct-password' } });
		await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);

		await waitFor(() => {
			expect(authClientMock.signIn.email).toHaveBeenCalledWith({
				email: 'owner@example.com',
				password: 'correct-password'
			});
			expect(assignMock).toHaveBeenCalledWith('/app/score');
		});
	});

	it('defaults successful email sign-in to /app when next is absent', async () => {
		envMock.browser = true;
		render(LoginPage);

		await screen.findByLabelText('Email');
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'owner@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'correct-password' }
		});
		await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);

		await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/app'));
	});

	it('rejects an external next value before email sign-in navigation', async () => {
		envMock.browser = true;
		pageMock.url = new URL(
			'http://localhost/login?next=' + encodeURIComponent('https://evil.example/path')
		);
		render(LoginPage);

		await screen.findByLabelText('Email');
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'owner@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'correct-password' }
		});
		await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);

		await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/app/account'));
	});

	it('shows a password sign-in error without navigating', async () => {
		envMock.browser = true;
		authClientMock.signIn.email.mockResolvedValueOnce({
			data: null,
			error: { message: 'Invalid email or password' }
		});
		render(LoginPage);

		await screen.findByLabelText('Email');
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'owner@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'wrong-password' }
		});
		await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);

		await waitFor(() => {
			expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
			expect(assignMock).not.toHaveBeenCalled();
		});
	});

	it('shows a raw password sign-in exception', async () => {
		envMock.browser = true;
		authClientMock.signIn.email.mockRejectedValue(new Error('credentials rejected'));
		render(LoginPage);

		await screen.findByLabelText('Email');
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'owner@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'wrong-password' }
		});
		await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('credentials rejected');
		});
	});

	it('sanitizes a thrown Google sign-in exception', async () => {
		envMock.browser = true;
		authClientMock.signIn.social.mockRejectedValue(new Error('google offline'));
		render(LoginPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'Google authentication failed. Please try again.'
			);
		});
	});

	it('starts Google sign-in with a safe callback and error callback', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?next=%2Fapp%2Fscore');
		render(LoginPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

		await waitFor(() => {
			expect(authClientMock.signIn.social).toHaveBeenCalledWith({
				provider: 'google',
				callbackURL: 'http://localhost/app/score',
				errorCallbackURL: 'http://localhost/login?next=%2Fapp%2Fscore'
			});
		});
	});

	it('sanitizes a cancelled Google sign-in failure', async () => {
		envMock.browser = true;
		authClientMock.signIn.social.mockResolvedValueOnce({
			data: null,
			error: { message: 'access_denied' }
		});
		render(LoginPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

		await waitFor(() => {
			expect(authClientMock.signIn.social).toHaveBeenCalledWith({
				provider: 'google',
				callbackURL: 'http://localhost/app',
				errorCallbackURL: 'http://localhost/login'
			});
			expect(
				screen.getByText('Google authentication failed. Please try again.')
			).toBeInTheDocument();
		});
	});

	it('sanitizes Better Auth callback errors without exposing raw provider text', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?error=signup+disabled');
		render(LoginPage);

		await waitFor(() => {
			expect(
				screen.getAllByText(
					'Google sign-in is only available for existing linked accounts.'
				)
			).not.toHaveLength(0);
		});
		expect(screen.queryByText('signup disabled')).not.toBeInTheDocument();
	});

	it('treats ordinary query parameters as a login request', async () => {
		envMock.browser = true;
		pageMock.url = new URL('http://localhost/login?tab=overview');
		render(LoginPage);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
		});
	});
});
