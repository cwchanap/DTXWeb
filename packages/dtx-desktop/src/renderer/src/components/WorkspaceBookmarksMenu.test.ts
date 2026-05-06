import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

vi.mock('../stores/workspaceStore', () => {
	let state = { path: null as string | null };
	const listeners: Array<(s: typeof state) => void> = [];
	return {
		workspaceStore: {
			subscribe: vi.fn((cb: (s: typeof state) => void) => {
				cb(state);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setState: (next: Partial<typeof state>) => {
				state = { ...state, ...next };
				listeners.forEach((cb) => cb(state));
			}
		}
	};
});

vi.mock('../stores/bookmarkStore', () => {
	let value: Array<{ path: string; name: string }> = [];
	const listeners: Array<(v: typeof value) => void> = [];
	return {
		bookmarkStore: {
			subscribe: vi.fn((cb: (v: typeof value) => void) => {
				cb(value);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setValue: (next: typeof value) => {
				value = next;
				listeners.forEach((cb) => cb(value));
			},
			add: vi.fn(),
			remove: vi.fn(),
			rename: vi.fn()
		},
		basename: (p: string) => p.split('/').pop() ?? p
	};
});

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		switchToBookmark: vi.fn(),
		selectWorkspace: vi.fn()
	}
}));

import WorkspaceBookmarksMenu from './WorkspaceBookmarksMenu.svelte';
import { workspaceStore } from '../stores/workspaceStore';

describe('WorkspaceBookmarksMenu', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		(workspaceStore as any).setState({ path: '/foo/bar/MySongs' });
	});

	it('renders the basename of the current path on the trigger', () => {
		render(WorkspaceBookmarksMenu);
		expect(screen.getByRole('button', { name: /workspace menu/i })).toHaveTextContent(
			'MySongs'
		);
	});

	it('does not render the dropdown initially', () => {
		render(WorkspaceBookmarksMenu);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('opens the dropdown on trigger click and closes on Escape', async () => {
		render(WorkspaceBookmarksMenu);
		const trigger = screen.getByRole('button', { name: /workspace menu/i });

		await fireEvent.click(trigger);
		expect(screen.getByRole('menu')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('shows the full current path inside the dropdown', async () => {
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		expect(screen.getByText('/foo/bar/MySongs')).toBeInTheDocument();
	});
});
