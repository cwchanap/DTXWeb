import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const publicEnvMock = vi.hoisted(() => ({
	env: {
		PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL: ''
	}
}));

// Test the browser-side redirect logic with browser: true
vi.mock('$app/environment', () => ({
	browser: true
}));

vi.mock('$env/dynamic/public', () => publicEnvMock);

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({
				url: new URL('http://localhost/app?redirect=desktop'),
				params: {}
			});
			return () => {};
		}
	}
}));

vi.mock('@lucide/svelte');

vi.mock('$lib/api', () => ({
	generateMagicLink: vi.fn()
}));

import { generateMagicLink } from '$lib/api';
import AppPage from './+page.svelte';

describe('App Home Page – desktop redirect flow', () => {
	const originalLocation = window.location;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		publicEnvMock.env.PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL = '';
		Object.defineProperty(window, 'location', {
			value: { href: '' },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		vi.runAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		Object.defineProperty(window, 'location', {
			value: originalLocation,
			writable: true,
			configurable: true
		});
	});

	it('shows redirecting spinner when redirect=desktop is in URL and fetch succeeds', async () => {
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		// Initially shows redirecting state (isRedirecting = true before fetch)
		await vi.waitFor(() => {
			expect(screen.getByText('Redirecting to desktop app...')).toBeInTheDocument();
		});
	});

	it('calls generateMagicLink and sets window.location.href on success', async () => {
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(generateMagicLink).toHaveBeenCalledOnce();
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('uses the configured desktop auth callback URL when provided', async () => {
		publicEnvMock.env.PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL =
			'http://127.0.0.1:47931/auth-callback';
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(generateMagicLink).toHaveBeenCalledOnce();
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('shows error state when generateMagicLink throws', async () => {
		vi.mocked(generateMagicLink).mockRejectedValue(new Error('magic-link failed: 401'));

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});

	it('shows error state when generateMagicLink throws network error', async () => {
		vi.mocked(generateMagicLink).mockRejectedValue(new Error('Network error'));

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});

	it('shows error when magicLinkUrl is missing from response', async () => {
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: null as unknown as string
		});

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});
});
