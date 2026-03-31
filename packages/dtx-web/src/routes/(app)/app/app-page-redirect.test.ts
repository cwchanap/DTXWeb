import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// Test the browser-side redirect logic with browser: true
vi.mock('$app/environment', () => ({
	browser: true
}));

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

import AppPage from './+page.svelte';

describe('App Home Page – desktop redirect flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('shows redirecting spinner when redirect=desktop is in URL and fetch succeeds', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ magicLinkUrl: 'https://example.com/magic' })
			})
		);
		// Mock window.location.href setter
		const locationMock = { href: '' };
		Object.defineProperty(window, 'location', { value: locationMock, writable: true });

		render(AppPage);

		// Initially shows redirecting state (isRedirecting = true before fetch)
		await vi.waitFor(() => {
			expect(screen.getByText('Redirecting to desktop app...')).toBeInTheDocument();
		});
	});

	it('shows error state when fetch response is not ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: vi.fn().mockResolvedValue({ error: 'Unauthorized' })
			})
		);

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});

	it('shows error state when fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});

	it('shows error when magicLinkUrl is missing from response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ magicLinkUrl: null })
			})
		);

		render(AppPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Redirection Failed')).toBeInTheDocument();
		});
	});
});
