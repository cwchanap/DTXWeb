import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');

import NavRail from './NavRail.svelte';

describe('NavRail', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('shows Library, Templates and Settings when unauthenticated', () => {
		render(NavRail);
		expect(screen.getByRole('button', { name: /Library/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Templates/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Cloud/i })).not.toBeInTheDocument();
	});

	it('shows Cloud when authenticated', () => {
		authStore.setUser({ id: 'u1', email: 'a@b.c', name: 'A' });
		render(NavRail);
		expect(screen.getByRole('button', { name: /Cloud/i })).toBeInTheDocument();
	});

	it('switches active section on click', async () => {
		render(NavRail);
		await fireEvent.click(screen.getByRole('button', { name: /Templates/i }));
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('templates');
	});
});
