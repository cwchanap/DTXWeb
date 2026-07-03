import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const pageMock = vi.hoisted(() => ({
	url: new URL('http://localhost/app/account')
}));

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

vi.mock('@lucide/svelte');

import AccountPage from './+page.svelte';

const makeData = (identities: Array<Record<string, unknown>> = []) => {
	const mockSupabase = {
		auth: {
			getUserIdentities: vi.fn().mockResolvedValue({
				data: { identities },
				error: null
			}),
			linkIdentity: vi.fn().mockResolvedValue({
				data: { provider: 'google', url: 'https://supabase.example/link-google' },
				error: null
			})
		}
	};

	return {
		data: {
			session: null,
			user: { email: 'owner@example.com' },
			supabase: mockSupabase
		} as any,
		mockSupabase
	};
};

describe('/app/account page', () => {
	const originalLocation = window.location;

	beforeEach(() => {
		vi.clearAllMocks();
		pageMock.url = new URL('http://localhost/app/account');
		Object.defineProperty(window, 'location', {
			value: { href: '', origin: 'http://localhost' },
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

	it('loads and displays account email plus unconnected Google state', async () => {
		const { data, mockSupabase } = makeData();

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(mockSupabase.auth.getUserIdentities).toHaveBeenCalledOnce();
			expect(screen.getByText('owner@example.com')).toBeInTheDocument();
			expect(screen.getByText('Google is not connected')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
		});
	});

	it('shows connected Google identity email', async () => {
		const { data } = makeData([
			{
				provider: 'google',
				identity_data: { email: 'google@example.com' }
			}
		]);

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(screen.getByText('Google is connected')).toBeInTheDocument();
			expect(screen.getByText('google@example.com')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
	});

	it('starts Google identity linking and redirects to Supabase URL', async () => {
		const { data, mockSupabase } = makeData();

		render(AccountPage, { props: { data } });

		const button = await screen.findByRole('button', { name: 'Connect Google' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(mockSupabase.auth.linkIdentity).toHaveBeenCalledWith({
				provider: 'google',
				options: {
					redirectTo: 'http://localhost/auth/callback?link=google&next=%2Fapp%2Faccount',
					scopes: 'openid email profile',
					skipBrowserRedirect: true
				}
			});
			expect(window.location.href).toBe('https://supabase.example/link-google');
		});
	});

	it('shows sanitized linking errors', async () => {
		const { data, mockSupabase } = makeData();
		mockSupabase.auth.linkIdentity.mockResolvedValueOnce({
			data: { provider: 'google', url: null },
			error: new Error('manual_linking_disabled')
		});

		render(AccountPage, { props: { data } });

		const button = await screen.findByRole('button', { name: 'Connect Google' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(
				screen.getByText(
					'Google account linking is not enabled for this Drumery environment.'
				)
			).toBeInTheDocument();
		});
	});

	it('surfaces error and resets loading when linkIdentity rejects', async () => {
		const { data, mockSupabase } = makeData();
		mockSupabase.auth.linkIdentity.mockRejectedValueOnce(new Error('network failure'));

		render(AccountPage, { props: { data } });

		const button = await screen.findByRole('button', { name: 'Connect Google' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(
				screen.getByText('Google authentication failed. Please try again.')
			).toBeInTheDocument();
			expect(button).not.toBeDisabled();
		});
	});

	it('shows callback success and error messages from query params', async () => {
		pageMock.url = new URL('http://localhost/app/account?linked=google&auth_error=ignored');
		const { data } = makeData();

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(screen.getByText('Google account connected.')).toBeInTheDocument();
		});
	});

	it('keeps callback error visible after providers load', async () => {
		pageMock.url = new URL(
			'http://localhost/app/account?auth_error=Google+authentication+failed.+Please+try+again.'
		);
		const { data } = makeData();

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(screen.getByText('Google is not connected')).toBeInTheDocument();
		});
		expect(
			screen.getByText('Google authentication failed. Please try again.')
		).toBeInTheDocument();
	});

	it('discards non-allow-listed auth_error values from query params', async () => {
		pageMock.url = new URL(
			'http://localhost/app/account?auth_error=Click+here+to+reset+your+password'
		);
		const { data } = makeData();

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(screen.getByText('Google is not connected')).toBeInTheDocument();
		});
		expect(screen.queryByText('Click here to reset your password')).not.toBeInTheDocument();
	});

	it('shows fallback message when loadIdentities fails', async () => {
		const { data, mockSupabase } = makeData();
		mockSupabase.auth.getUserIdentities.mockResolvedValueOnce({
			data: null,
			error: new Error('network failure')
		});

		render(AccountPage, { props: { data } });

		await vi.waitFor(() => {
			expect(
				screen.getByText('Unable to load linked account providers.')
			).toBeInTheDocument();
		});
		expect(screen.getByText('Google is not connected')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
	});
});
