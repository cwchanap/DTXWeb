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

const pageMock = vi.hoisted(() => ({ url: new URL('http://localhost/app?redirect=desktop') }));

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({ url: pageMock.url, params: {} });
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
		sessionStorage.clear();
		pageMock.url = new URL('http://localhost/app?redirect=desktop');
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
		sessionStorage.clear();
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
		expect(
			screen.getByText(
				'Keep this tab open while Drumery prepares a secure sign-in link for the desktop app.'
			)
		).toBeInTheDocument();
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

	it('appends magic_link with & when callback URL already has query parameters', async () => {
		publicEnvMock.env.PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL =
			'http://127.0.0.1:47931/auth-callback?source=web';
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?source=web&magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(generateMagicLink).toHaveBeenCalledOnce();
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('reads the desktop callback from the URL param (already-authenticated server-redirect flow)', async () => {
		pageMock.url = new URL(
			'http://localhost/app?redirect=desktop&desktop_callback=' +
				encodeURIComponent('http://127.0.0.1:47931/auth-callback')
		);
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
		// The URL param is not single-use (sessionStorage is), but sessionStorage
		// must remain untouched — the URL param takes precedence.
		expect(sessionStorage.getItem('dtx_desktop_auth_callback')).toBeNull();
	});

	it('URL-param callback takes precedence over a stale sessionStorage value', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'dtx://auth-callback');
		pageMock.url = new URL(
			'http://localhost/app?redirect=desktop&desktop_callback=' +
				encodeURIComponent('http://127.0.0.1:47931/auth-callback')
		);
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('rejects an invalid URL-param callback and falls back to sessionStorage', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'http://127.0.0.1:47931/auth-callback');
		pageMock.url = new URL(
			'http://localhost/app?redirect=desktop&desktop_callback=' +
				encodeURIComponent('https://evil.example.com/steal')
		);
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('prefers the desktop-supplied loopback callback from sessionStorage over the default', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'http://127.0.0.1:47931/auth-callback');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://127.0.0.1:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
		// Single-use: the bridged value is cleared after being read.
		expect(sessionStorage.getItem('dtx_desktop_auth_callback')).toBeNull();
	});

	it('accepts a dtx:// deep-link callback supplied via sessionStorage', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'dtx://auth-callback');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('accepts a dtx-dev: deep-link callback supplied via sessionStorage', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'dtx-dev://auth-callback');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx-dev://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('rejects a deep-link callback with the wrong hostname and falls back to the default', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'dtx://evil-host');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('falls back to the default when sessionStorage throws (e.g. disabled by browser)', async () => {
		const originalGetItem = sessionStorage.getItem;
		Object.defineProperty(sessionStorage, 'getItem', {
			configurable: true,
			value: vi.fn(() => {
				throw new Error('SecurityError');
			})
		});
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});

		Object.defineProperty(sessionStorage, 'getItem', {
			configurable: true,
			value: originalGetItem
		});
	});

	it('takes the sessionStorage callback in preference to the configured env callback', async () => {
		publicEnvMock.env.PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL = 'dtx://auth-callback';
		sessionStorage.setItem('dtx_desktop_auth_callback', 'http://localhost:47931/auth-callback');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `http://localhost:47931/auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('rejects a non-loopback http callback and falls back to the default', async () => {
		sessionStorage.setItem(
			'dtx_desktop_auth_callback',
			'http://evil.example.com/auth-callback'
		);
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('rejects a disallowed scheme (external https) and falls back to the default', async () => {
		sessionStorage.setItem('dtx_desktop_auth_callback', 'https://evil.example.com/steal');
		vi.mocked(generateMagicLink).mockResolvedValue({
			magicLinkUrl: 'https://example.com/magic'
		});

		render(AppPage);

		const expectedHref = `dtx://auth-callback?magic_link=${encodeURIComponent('https://example.com/magic')}`;
		await vi.waitFor(() => {
			expect(window.location.href).toBe(expectedHref);
		});
	});

	it('shows error state when generateMagicLink throws', async () => {
		vi.mocked(generateMagicLink).mockRejectedValue(new Error('magic-link failed: 401'));

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
		expect(
			screen.getByText('Please try signing in again from the Drumery desktop app.')
		).toBeInTheDocument();
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
