import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Snippet } from 'svelte';
import type { LayoutProps } from '../../.svelte-kit/types/src/routes/$types';

vi.mock('../app.css', () => ({}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Toaster: vi.fn().mockReturnValue(null)
}));

vi.mock('@/lib/toaster', () => ({
	default: {}
}));

vi.mock('$app/navigation', () => ({
	invalidate: vi.fn()
}));

vi.mock('@dtx/common', () => ({
	setFileProvider: vi.fn()
}));

vi.mock('$lib/services/webFileProvider', () => ({
	WebFileProvider: vi.fn().mockImplementation(() => ({}))
}));

import RootLayout from './+layout.svelte';
import { invalidate } from '$app/navigation';

const noopChildren = (() => null) as unknown as Snippet;

const makeData = (sessionExpiresAt?: number) => {
	const mockSubscription = { unsubscribe: vi.fn() };
	const authStateCallback = { fn: null as ((event: string, session: unknown) => void) | null };
	const mockSupabase = {
		auth: {
			onAuthStateChange: vi.fn().mockImplementation((fn: (e: string, s: unknown) => void) => {
				authStateCallback.fn = fn;
				return { data: { subscription: mockSubscription } };
			})
		}
	};
	return {
		data: {
			session: sessionExpiresAt
				? ({ expires_at: sessionExpiresAt } as unknown as LayoutProps['data']['session'])
				: null,
			supabase: mockSupabase as unknown as LayoutProps['data']['supabase'],
			user: null
		} satisfies LayoutProps['data'],
		mockSubscription,
		authStateCallback,
		mockSupabase
	};
};

describe('+layout.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders without crashing', () => {
		const { data } = makeData();
		const { container } = render(RootLayout, { props: { data, children: noopChildren } });
		expect(container).toBeTruthy();
	});

	it('sets up auth state change listener on mount', async () => {
		const { data, mockSupabase } = makeData();
		render(RootLayout, { props: { data, children: noopChildren } });
		expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalled();
	});

	it('calls invalidate when session expires_at changes', async () => {
		const { data, authStateCallback } = makeData(1000);
		render(RootLayout, { props: { data, children: noopChildren } });

		// Simulate auth state change with different expires_at
		authStateCallback.fn?.('SIGNED_IN', { expires_at: 9999 });
		expect(invalidate).toHaveBeenCalledWith('supabase:auth');
	});

	it('does not invalidate when session expires_at is unchanged', async () => {
		const { data, authStateCallback } = makeData(1000);
		render(RootLayout, { props: { data, children: noopChildren } });

		authStateCallback.fn?.('TOKEN_REFRESHED', { expires_at: 1000 });
		expect(invalidate).not.toHaveBeenCalled();
	});
});
