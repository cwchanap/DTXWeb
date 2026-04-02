import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from 'svelte';
import type { LayoutProps } from '../../../.svelte-kit/types/src/routes/(app)/$types';

const gotoMock = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

import AppLayout from './+layout.svelte';

const noopChildren = (() => null) as unknown as Snippet;

const makeData = () => {
	const mockSupabase = {
		auth: {
			signOut: vi.fn().mockResolvedValue({})
		}
	};
	return {
		data: {
			session: null,
			user: null,
			supabase: mockSupabase as unknown as LayoutProps['data']['supabase']
		} satisfies LayoutProps['data'],
		mockSupabase
	};
};

describe('(app)/+layout.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders without crashing', () => {
		const { data } = makeData();
		const { container } = render(AppLayout, { props: { data, children: noopChildren } });
		expect(container).toBeTruthy();
	});

	it('renders Drumery brand name in expanded sidebar', () => {
		const { data } = makeData();
		render(AppLayout, { props: { data, children: noopChildren } });
		expect(screen.getByText('Drumery')).toBeInTheDocument();
	});

	it('renders navigation links', () => {
		const { data } = makeData();
		render(AppLayout, { props: { data, children: noopChildren } });
		expect(screen.getByText('My Charts')).toBeInTheDocument();
		expect(screen.getByText('Editor')).toBeInTheDocument();
		expect(screen.getByText('Play Game')).toBeInTheDocument();
	});

	it('toggles sidebar collapse on button click', async () => {
		const { data } = makeData();
		render(AppLayout, { props: { data, children: noopChildren } });

		// Sidebar starts expanded — Drumery title visible
		expect(screen.getByText('Drumery')).toBeInTheDocument();

		// First button in sidebar is the collapse toggle
		const allButtons = screen.getAllByRole('button');
		await fireEvent.click(allButtons[0]);

		// After collapsing, Drumery title is hidden
		expect(screen.queryByText('Drumery')).not.toBeInTheDocument();
	});

	it('calls supabase.auth.signOut and navigates to /login on logout', async () => {
		const { data, mockSupabase } = makeData();
		render(AppLayout, { props: { data, children: noopChildren } });

		const logoutBtn = screen.getByText('Logout').closest('button')!;
		await fireEvent.click(logoutBtn);

		await vi.waitFor(() => {
			expect(mockSupabase.auth.signOut).toHaveBeenCalled();
			expect(gotoMock).toHaveBeenCalledWith('/login');
		});
	});

	it('calls navigateToProfile when Profile is clicked', async () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { data } = makeData();
		render(AppLayout, { props: { data, children: noopChildren } });

		const profileBtn = screen.getByText('Profile').closest('button')!;
		await fireEvent.click(profileBtn);

		expect(consoleSpy).toHaveBeenCalledWith('Profile clicked');
		consoleSpy.mockRestore();
	});
});
