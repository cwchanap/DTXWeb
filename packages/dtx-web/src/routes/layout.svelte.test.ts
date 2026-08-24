import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Snippet } from 'svelte';

vi.mock('../app.css', () => ({}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Toaster: vi.fn().mockReturnValue(null)
}));

vi.mock('@/lib/toaster', () => ({
	default: {}
}));

vi.mock('@dtx/common', () => ({
	setFileProvider: vi.fn()
}));

vi.mock('$lib/services/webFileProvider', () => ({
	WebFileProvider: vi.fn().mockImplementation(() => ({}))
}));

import RootLayout from './+layout.svelte';

const noopChildren = (() => null) as unknown as Snippet;

describe('+layout.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it('marks the document as hydrated for e2e runs and renders its children', async () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('VITE_E2E', 'true');

		render(RootLayout, { props: { children: noopChildren } });

		await vi.waitFor(() => {
			expect(document.documentElement.dataset.e2eHydrated).toBe('true');
		});
	});
});
