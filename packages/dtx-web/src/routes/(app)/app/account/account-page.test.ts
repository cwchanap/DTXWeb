import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const pageMock = vi.hoisted(() => ({
	url: new URL('http://localhost/app/account')
}));

const authClientMock = vi.hoisted(() => ({
	listAccounts: vi.fn(),
	linkSocial: vi.fn()
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

vi.mock('$lib/auth/client', () => ({ authClient: authClientMock }));
vi.mock('@lucide/svelte');

import AccountPage from './+page.svelte';

const makeData = (
	user: App.PageData['user'] = { id: 'user-1', email: 'owner@example.com' }
): { data: App.PageData } => ({
	data: {
		session: null,
		user
	}
});

describe('/app/account page', () => {
	const originalLocation = window.location;

	beforeEach(() => {
		vi.clearAllMocks();
		pageMock.url = new URL('http://localhost/app/account');
		authClientMock.listAccounts.mockResolvedValue({ data: [], error: null });
		authClientMock.linkSocial.mockResolvedValue({ data: {}, error: null });
		Object.defineProperty(window, 'location', {
			value: { origin: 'http://localhost' },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(window, 'location', {
			value: originalLocation,
			writable: true,
			configurable: true
		});
	});

	it('loads and displays account email plus unconnected Google state', async () => {
		render(AccountPage, { props: makeData() });

		await vi.waitFor(() => {
			expect(authClientMock.listAccounts).toHaveBeenCalledOnce();
			expect(screen.getByText('owner@example.com')).toBeInTheDocument();
			expect(screen.getByText('Google is not connected')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Connect Google' })).toBeInTheDocument();
		});
	});

	it('shows a connected Google account from Better Auth account providers', async () => {
		authClientMock.listAccounts.mockResolvedValueOnce({
			data: [{ providerId: 'google', accountId: 'google-user-id' }],
			error: null
		});

		render(AccountPage, { props: makeData() });

		await vi.waitFor(() => {
			expect(screen.getByText('Google is connected')).toBeInTheDocument();
		});
		expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
	});

	it('starts explicit Google linking with success and error callback paths', async () => {
		render(AccountPage, { props: makeData() });

		const button = await screen.findByRole('button', { name: 'Connect Google' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(authClientMock.linkSocial).toHaveBeenCalledWith({
				provider: 'google',
				callbackURL: 'http://localhost/app/account?linked=google',
				errorCallbackURL: 'http://localhost/app/account'
			});
		});
	});

	it('shows sanitized explicit-link configuration errors', async () => {
		authClientMock.linkSocial.mockResolvedValueOnce({
			data: null,
			error: { message: 'LINKING_NOT_ALLOWED' }
		});
		render(AccountPage, { props: makeData() });

		await fireEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));

		await vi.waitFor(() => {
			expect(
				screen.getByText(
					'Google account linking is not enabled for this Drumery environment.'
				)
			).toBeInTheDocument();
		});
	});

	it('shows the explicit-link conflict copy for a Better Auth callback error', async () => {
		pageMock.url = new URL(
			'http://localhost/app/account?error=account_already_linked_to_different_user'
		);
		render(AccountPage, { props: makeData() });

		await vi.waitFor(() => {
			expect(
				screen.getByText(
					'That Google account is already connected to another Drumery account.'
				)
			).toBeInTheDocument();
		});
	});

	it('sanitizes a cancelled linking failure and resets loading', async () => {
		authClientMock.linkSocial.mockResolvedValueOnce({
			data: null,
			error: { message: 'access_denied' }
		});
		render(AccountPage, { props: makeData() });

		const button = await screen.findByRole('button', { name: 'Connect Google' });
		await fireEvent.click(button);

		await vi.waitFor(() => {
			expect(authClientMock.linkSocial).toHaveBeenCalledWith({
				provider: 'google',
				callbackURL: 'http://localhost/app/account?linked=google',
				errorCallbackURL: 'http://localhost/app/account'
			});
			expect(
				screen.getByText('Google authentication failed. Please try again.')
			).toBeInTheDocument();
			expect(button).not.toBeDisabled();
		});
	});

	it('shows a fallback when Better Auth account loading fails', async () => {
		authClientMock.listAccounts.mockResolvedValueOnce({
			data: null,
			error: { message: 'network failure' }
		});
		render(AccountPage, { props: makeData() });

		await vi.waitFor(() => {
			expect(
				screen.getByText('Unable to load linked account providers.')
			).toBeInTheDocument();
			expect(screen.getByText('Google is not connected')).toBeInTheDocument();
		});
	});

	it('shows callback success and clears it from the URL', async () => {
		pageMock.url = new URL('http://localhost/app/account?linked=google');
		render(AccountPage, { props: makeData() });

		await vi.waitFor(() => {
			expect(screen.getByText('Google account connected.')).toBeInTheDocument();
		});
	});
});
