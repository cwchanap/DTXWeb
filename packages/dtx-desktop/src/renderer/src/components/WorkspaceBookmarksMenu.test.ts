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
import { bookmarkStore } from '../stores/bookmarkStore';

describe('WorkspaceBookmarksMenu', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		(bookmarkStore as any).setValue([]);
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

	describe('Bookmark this folder action', () => {
		it('shows "Bookmark this folder" when current path is not bookmarked', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(
				screen.getByRole('menuitem', { name: /bookmark this folder/i })
			).toBeInTheDocument();
		});

		it('calls bookmarkStore.add and closes dropdown on click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.add as any).mockReturnValue({ ok: true });

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			expect(bookmarkStore.add).toHaveBeenCalledWith('/foo/bar/MySongs');
			expect(screen.queryByRole('menu')).toBeNull();
		});

		it('shows "Bookmarked as <name>" indicator when current path is bookmarked', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ path: '/foo/bar/MySongs', name: 'My Faves' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			expect(screen.getByText(/bookmarked as my faves/i)).toBeInTheDocument();
			expect(screen.queryByRole('menuitem', { name: /bookmark this folder/i })).toBeNull();
		});

		it('shows an error message when add returns cap-exceeded', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.add as any).mockReturnValue({ ok: false, reason: 'cap-exceeded' });

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			expect(screen.getByText(/maximum of 20 bookmarks/i)).toBeInTheDocument();
		});
	});

	describe('Bookmark list', () => {
		it('renders no Bookmarks heading when list is empty', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(screen.queryByText(/^bookmarks$/i)).toBeNull();
		});

		it('renders each bookmark with name and path', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([
				{ path: '/a', name: 'Alpha' },
				{ path: '/b', name: 'Beta' }
			]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			expect(screen.getByText('Alpha')).toBeInTheDocument();
			expect(screen.getByText('/a')).toBeInTheDocument();
			expect(screen.getByText('Beta')).toBeInTheDocument();
			expect(screen.getByText('/b')).toBeInTheDocument();
		});

		it('clicking a non-active bookmark calls switchToBookmark and closes the dropdown', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([{ path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to alpha/i }));

			expect(workspaceService.switchToBookmark).toHaveBeenCalledWith({
				path: '/a',
				name: 'Alpha'
			});
			expect(screen.queryByRole('menu')).toBeNull();
		});

		it('marks the active bookmark and does not call switchToBookmark on click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([{ path: '/foo/bar/MySongs', name: 'Active' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const activeRow = screen.getByTestId('bookmark-row-/foo/bar/MySongs');
			expect(activeRow).toHaveAttribute('data-active', 'true');

			await fireEvent.click(activeRow);
			expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
		});
	});
});
