import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from 'svelte';

const authClientMock = vi.hoisted(() => ({
	signOut: vi.fn()
}));
const assignMock = vi.hoisted(() => vi.fn());
const gotoMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/auth/client', () => ({ authClient: authClientMock }));
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

import AppLayout from './+layout.svelte';

const noopChildren = (() => null) as unknown as Snippet;

describe('(app)/+layout.svelte', () => {
	const originalLocation = window.location;

	beforeEach(() => {
		vi.clearAllMocks();
		authClientMock.signOut.mockResolvedValue({ data: { success: true }, error: null });
		Object.defineProperty(window, 'location', {
			value: { assign: assignMock },
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

	it('renders without a Supabase client or auth subscription', () => {
		const { container } = render(AppLayout, { props: { children: noopChildren } });
		expect(container).toBeTruthy();
	});

	it('renders Drumery brand name in expanded sidebar', () => {
		render(AppLayout, { props: { children: noopChildren } });
		expect(screen.getByText('Drumery')).toBeInTheDocument();
	});

	it('renders navigation links', () => {
		render(AppLayout, { props: { children: noopChildren } });
		expect(screen.getByText('My Charts')).toBeInTheDocument();
		expect(screen.getByText('Editor')).toBeInTheDocument();
		expect(screen.getByText('Play Game')).toBeInTheDocument();
	});

	it('toggles sidebar collapse on button click', async () => {
		render(AppLayout, { props: { children: noopChildren } });

		expect(screen.getByText('Drumery')).toBeInTheDocument();
		await fireEvent.click(screen.getAllByRole('button')[0]);
		expect(screen.queryByText('Drumery')).not.toBeInTheDocument();
	});

	it('calls Better Auth signOut and full-navigates to /login', async () => {
		render(AppLayout, { props: { children: noopChildren } });

		await fireEvent.click(screen.getByText('Logout').closest('button')!);

		await vi.waitFor(() => {
			expect(authClientMock.signOut).toHaveBeenCalledOnce();
			expect(assignMock).toHaveBeenCalledWith('/login');
		});
	});

	it('navigates to /app/account when Profile is clicked', async () => {
		render(AppLayout, { props: { children: noopChildren } });

		await fireEvent.click(screen.getByText('Profile').closest('button')!);
		expect(gotoMock).toHaveBeenCalledWith('/app/account');
	});
});
