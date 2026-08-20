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
	});

	it('renders without an auth client or subscription', () => {
		const { container } = render(RootLayout, {
			props: { children: noopChildren }
		});

		expect(container).toBeTruthy();
	});
});
