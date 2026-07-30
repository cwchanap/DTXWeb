import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

vi.mock('../stores/workspaceStore', () => {
	let state = { path: null as string | null, rootId: null as string | null };
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
			},
			hydrateRootId: (rootId: string | null) => {
				state = { ...state, rootId };
				listeners.forEach((cb) => cb(state));
			}
		}
	};
});

vi.mock('../stores/bookmarkStore', () => {
	let value: Array<{ id: string; path: string; name: string }> = [];
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
			addCurrent: vi.fn().mockResolvedValue({
				id: 'bm-default',
				path: '/foo/bar/MySongs',
				name: 'MySongs'
			}),
			remove: vi.fn().mockResolvedValue(undefined),
			rename: vi.fn().mockResolvedValue(undefined),
			refresh: vi.fn().mockResolvedValue(undefined)
		},
		basename: (p: string) => p.split('/').pop() ?? p
	};
});

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		switchToBookmark: vi.fn().mockResolvedValue({ ok: true }),
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
		(workspaceStore as any).setState({ path: '/foo/bar/MySongs', rootId: null });
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

		it('calls bookmarkStore.addCurrent and closes dropdown on click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.addCurrent as any).mockResolvedValue({
				id: 'bm-1',
				path: '/foo/bar/MySongs',
				name: 'MySongs'
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			expect(bookmarkStore.addCurrent).toHaveBeenCalled();
			expect(screen.queryByRole('menu')).toBeNull();
		});

		it('shows "Bookmarked as <name>" indicator when current root is bookmarked', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([
				{ id: 'bm-1', path: '/foo/bar/MySongs', name: 'My Faves' }
			]);
			(workspaceStore as any).setState({ path: '/foo/bar/MySongs', rootId: 'bm-1' });

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			expect(screen.getByText(/bookmarked as my faves/i)).toBeInTheDocument();
			expect(screen.queryByRole('menuitem', { name: /bookmark this folder/i })).toBeNull();
		});

		it('shows an error message when addCurrent rejects with cap-exceeded', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.addCurrent as any).mockRejectedValue(
				new Error('Maximum of 20 bookmarks reached')
			);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			await vi.waitFor(() => {
				expect(screen.getByText(/maximum of 20 bookmarks/i)).toBeInTheDocument();
			});
		});

		it('shows a generic error message when addCurrent rejects with a non-cap error', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.addCurrent as any).mockRejectedValue(
				new Error('Native persistence failed')
			);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			await vi.waitFor(() => {
				expect(screen.getByText('Native persistence failed')).toBeInTheDocument();
			});
			// Must NOT show the cap-exceeded message for a non-cap error.
			expect(screen.queryByText(/maximum of 20 bookmarks/i)).toBeNull();
		});

		it('shows a fallback error message when addCurrent rejects with a non-Error value', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore.addCurrent as any).mockRejectedValue('not an error object');

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			await vi.waitFor(() => {
				expect(screen.getByText('Could not bookmark this folder')).toBeInTheDocument();
			});
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
				{ id: 'a', path: '/a', name: 'Alpha' },
				{ id: 'b', path: '/b', name: 'Beta' }
			]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			expect(screen.getByText('Alpha')).toBeInTheDocument();
			expect(screen.getByText('/a')).toBeInTheDocument();
			expect(screen.getByText('Beta')).toBeInTheDocument();
			expect(screen.getByText('/b')).toBeInTheDocument();
		});

		it('explains that clicking a bookmark switches to that workspace', async () => {
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			expect(screen.getByText(/click a bookmark to switch/i)).toBeInTheDocument();
		});

		it('clicking a non-active bookmark calls switchToBookmark and closes the dropdown', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to alpha/i }));

			expect(workspaceService.switchToBookmark).toHaveBeenCalledWith({
				id: 'a',
				path: '/a',
				name: 'Alpha'
			});
			expect(screen.queryByRole('menu')).toBeNull();
		});

		it('marks the active bookmark and does not call switchToBookmark on click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'bm-active', path: '/foo/bar/MySongs', name: 'Active' }
			]);
			(workspaceStore as any).setState({ path: '/foo/bar/MySongs', rootId: 'bm-active' });

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const activeRow = screen.getByTestId('bookmark-row-bm-active');
			expect(activeRow).toHaveAttribute('data-active', 'true');

			await fireEvent.click(activeRow);
			expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
		});
	});

	describe('Trash remove', () => {
		it('clicking trash calls bookmarkStore.remove with the bookmark id', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));

			expect(bookmarkStore.remove).toHaveBeenCalledWith('a');
		});

		it('clicking trash does not trigger switch on the row', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));

			expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
		});
	});

	describe('Browse for folder', () => {
		it('clicking "Browse for folder…" calls selectWorkspace and closes the dropdown', async () => {
			const { workspaceService } = await import('../services/workspaceService');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /browse for folder/i }));

			expect(workspaceService.selectWorkspace).toHaveBeenCalledTimes(1);
			expect(screen.queryByRole('menu')).toBeNull();
		});
	});

	describe('Keyboard navigation', () => {
		beforeEach(async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([
				{ id: 'a', path: '/a', name: 'Alpha' },
				{ id: 'b', path: '/b', name: 'Beta' }
			]);
		});

		it('ArrowDown moves focus to the next menuitem', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const items = screen.getAllByRole('menuitem');
			items[0].focus();

			await fireEvent.keyDown(window, { key: 'ArrowDown' });
			expect(document.activeElement).toBe(items[1]);
		});

		it('ArrowUp from first menuitem wraps to last', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const items = screen.getAllByRole('menuitem');
			items[0].focus();

			await fireEvent.keyDown(window, { key: 'ArrowUp' });
			expect(document.activeElement).toBe(items[items.length - 1]);
		});
	});

	describe('Focus return on close', () => {
		it('returns focus to the trigger when Escape closes the dropdown', async () => {
			render(WorkspaceBookmarksMenu);
			const trigger = screen.getByRole('button', { name: /workspace menu/i });

			await fireEvent.click(trigger);
			// Some other element gets focus inside the dropdown
			(document.activeElement as HTMLElement)?.blur();

			await fireEvent.keyDown(window, { key: 'Escape' });

			// queueMicrotask requires a flush; await a microtask
			await Promise.resolve();
			expect(document.activeElement).toBe(trigger);
		});
	});

	describe('Click outside to close', () => {
		it('closes the dropdown when clicking outside the menu', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(screen.getByRole('menu')).toBeInTheDocument();

			await fireEvent.mouseDown(document.body);
			expect(screen.queryByRole('menu')).toBeNull();
		});

		it('does not close when clicking inside the menu', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			const menu = screen.getByRole('menu');

			await fireEvent.mouseDown(menu);
			expect(screen.getByRole('menu')).toBeInTheDocument();
		});

		it('does not return focus to trigger on outside click', async () => {
			render(WorkspaceBookmarksMenu);
			const trigger = screen.getByRole('button', { name: /workspace menu/i });

			await fireEvent.click(trigger);
			expect(screen.getByRole('menu')).toBeInTheDocument();

			await fireEvent.mouseDown(document.body);
			await Promise.resolve();

			expect(document.activeElement).not.toBe(trigger);
		});

		it('commits pending rename before closing on outside click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'OutsideSaved' } });
			await fireEvent.mouseDown(document.body);

			expect(bookmarkStore.rename).toHaveBeenCalledWith('a', 'OutsideSaved');
		});

		it('keeps the menu open with an error when a pending rename fails on outside click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
			(bookmarkStore.rename as any).mockRejectedValue(new Error('Native persistence failed'));

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'NewName' } });
			await fireEvent.mouseDown(document.body);

			await vi.waitFor(() => {
				expect(screen.getByText('Native persistence failed')).toBeInTheDocument();
			});
			// The menu must stay open so the user can see the error.
			expect(screen.getByRole('menu')).toBeInTheDocument();
		});

		it('keeps the menu open with an error when a pending rename fails on trigger click', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
			(bookmarkStore.rename as any).mockRejectedValue(new Error('Native persistence failed'));

			render(WorkspaceBookmarksMenu);
			const trigger = screen.getByRole('button', { name: /workspace menu/i });
			await fireEvent.click(trigger);
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'NewName' } });
			await fireEvent.click(trigger);

			await vi.waitFor(() => {
				expect(screen.getByText('Native persistence failed')).toBeInTheDocument();
			});
			expect(screen.getByRole('menu')).toBeInTheDocument();
		});
	});

	describe('Child action button keyboard handling', () => {
		beforeEach(async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
		});

		it('pressing Enter on the Remove button does not trigger switchToBookmark', async () => {
			const { workspaceService } = await import('../services/workspaceService');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const removeBtn = screen.getByRole('button', { name: /remove alpha/i });
			await fireEvent.keyDown(removeBtn, { key: 'Enter' });

			expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
		});

		it('pressing Space on the Rename button does not trigger switchToBookmark', async () => {
			const { workspaceService } = await import('../services/workspaceService');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const renameBtn = screen.getByRole('button', { name: /rename alpha/i });
			await fireEvent.keyDown(renameBtn, { key: ' ' });

			expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
		});

		it('pressing Enter on the row itself does trigger switchToBookmark', async () => {
			const { workspaceService } = await import('../services/workspaceService');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

			const row = screen.getByTestId('bookmark-row-a');
			await fireEvent.keyDown(row, { key: 'Enter' });

			expect(workspaceService.switchToBookmark).toHaveBeenCalledWith({
				id: 'a',
				path: '/a',
				name: 'Alpha'
			});
		});
	});

	describe('Inline rename', () => {
		beforeEach(async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
		});

		it('clicking pencil swaps name for an input with current value', async () => {
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			expect(input).toHaveValue('Alpha');
		});

		it('Enter saves the new name via bookmarkStore.rename with the id', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'Renamed' } });
			await fireEvent.keyDown(input, { key: 'Enter' });

			expect(bookmarkStore.rename).toHaveBeenCalledWith('a', 'Renamed');
		});

		it('Escape cancels the rename without calling rename and keeps the menu open', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'Discard' } });
			await fireEvent.keyDown(input, { key: 'Escape' });

			expect(bookmarkStore.rename).not.toHaveBeenCalled();
			expect(screen.queryByRole('textbox', { name: /rename alpha/i })).toBeNull();
			expect(screen.getByRole('menu')).toBeInTheDocument();
		});

		it('blur saves the current input value', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'BlurSaved' } });
			await fireEvent.blur(input);

			expect(bookmarkStore.rename).toHaveBeenCalledWith('a', 'BlurSaved');
		});
	});

	describe('Stale bookmark error handling', () => {
		it('shows scoped error with remove option when switchToBookmark returns notAccessible failure', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'stale-id', path: '/stale/path', name: 'Stale' }
			]);
			(workspaceService.switchToBookmark as any).mockResolvedValue({
				ok: false,
				error: 'The bookmarked folder is missing or not accessible. Remove it and re-add the folder.',
				path: '/stale/path'
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to stale/i }));

			// Menu re-opens to show the scoped error
			expect(
				screen.getByText(/workspace path no longer exists|bookmarked folder is missing/i)
			).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();
		});

		it('removes the stale bookmark and clears the error when clicking remove', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'stale-id', path: '/stale/path', name: 'Stale' }
			]);
			(workspaceService.switchToBookmark as any).mockResolvedValue({
				ok: false,
				error: 'The bookmarked folder is missing or not accessible. Remove it and re-add the folder.',
				path: '/stale/path'
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to stale/i }));
			await fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));

			expect(bookmarkStore.remove).toHaveBeenCalledWith('stale-id');
			expect(
				screen.queryByText(/workspace path no longer exists|bookmarked folder is missing/i)
			).toBeNull();
		});

		it('preserves the switch error and surfaces a mutation error when stale bookmark removal rejects', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'stale-id', path: '/stale/path', name: 'Stale' }
			]);
			(workspaceService.switchToBookmark as any).mockResolvedValue({
				ok: false,
				error: 'The bookmarked folder is missing or not accessible. Remove it and re-add the folder.',
				path: '/stale/path'
			});
			(bookmarkStore.remove as any).mockRejectedValue(new Error('Permission denied'));

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to stale/i }));
			await fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));

			expect(bookmarkStore.remove).toHaveBeenCalledWith('stale-id');
			// The original switch error must remain visible so the user still
			// knows the bookmark is stale and can retry removal.
			await vi.waitFor(() => {
				expect(screen.getByText('Permission denied')).toBeInTheDocument();
			});
			expect(screen.getByText(/bookmarked folder is missing/i)).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();
		});

		it('shows error without remove option for non-path-specific failures', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'valid-id', path: '/valid/path', name: 'Valid' }
			]);
			(workspaceService.switchToBookmark as any).mockResolvedValue({
				ok: false,
				error: 'A workspace switch is already in progress'
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to valid/i }));

			expect(
				screen.getByText(/a workspace switch is already in progress/i)
			).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /remove bookmark/i })).toBeNull();
		});

		it('does not remove bookmark for load errors without path', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const { workspaceService } = await import('../services/workspaceService');
			(bookmarkStore as any).setValue([
				{ id: 'valid-id', path: '/valid/path', name: 'Valid' }
			]);
			(workspaceService.switchToBookmark as any).mockResolvedValue({
				ok: false,
				error: 'Failed to load workspace tree'
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('menuitem', { name: /switch to valid/i }));

			expect(screen.getByText(/failed to load workspace tree/i)).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /remove bookmark/i })).toBeNull();
		});
	});

	describe('rootId hydration after mutations', () => {
		it('after bookmarking, reopening the menu shows the bookmarked state', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			const ref = { id: 'bm-new', path: '/foo/bar/MySongs', name: 'MySongs' };
			(bookmarkStore.addCurrent as any).mockImplementation(async () => {
				(bookmarkStore as any).setValue([ref]);
				return ref;
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(
				screen.getByRole('menuitem', { name: /bookmark this folder/i })
			).toBeInTheDocument();

			await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

			// Reopen the menu — rootId should now be hydrated from the ref.
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(screen.getByText(/bookmarked as mysongs/i)).toBeInTheDocument();
			expect(screen.queryByRole('menuitem', { name: /bookmark this folder/i })).toBeNull();
		});

		it('after removing the active bookmark, the menu shows Bookmark this folder', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([
				{ id: 'bm-active', path: '/foo/bar/MySongs', name: 'Active' }
			]);
			(workspaceStore as any).setState({ path: '/foo/bar/MySongs', rootId: 'bm-active' });
			(bookmarkStore.remove as any).mockImplementation(async () => {
				(bookmarkStore as any).setValue([]);
			});

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			expect(screen.getByText(/bookmarked as active/i)).toBeInTheDocument();

			await fireEvent.click(screen.getByRole('button', { name: /remove active/i }));

			await vi.waitFor(() => {
				expect(
					screen.getByRole('menuitem', { name: /bookmark this folder/i })
				).toBeInTheDocument();
			});
			expect(screen.queryByText(/bookmarked as active/i)).toBeNull();
		});
	});

	describe('rename and remove error handling', () => {
		it('surfaces a mutation error when rename rejects', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
			(bookmarkStore.rename as any).mockRejectedValue(new Error('Native persistence failed'));

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

			const input = screen.getByRole('textbox', { name: /rename alpha/i });
			await fireEvent.input(input, { target: { value: 'Renamed' } });
			await fireEvent.keyDown(input, { key: 'Enter' });

			await vi.waitFor(() => {
				expect(screen.getByText('Native persistence failed')).toBeInTheDocument();
			});
		});

		it('surfaces a mutation error when remove rejects', async () => {
			const { bookmarkStore } = await import('../stores/bookmarkStore');
			(bookmarkStore as any).setValue([{ id: 'a', path: '/a', name: 'Alpha' }]);
			(bookmarkStore.remove as any).mockRejectedValue(new Error('Permission denied'));

			render(WorkspaceBookmarksMenu);
			await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
			await fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));

			await vi.waitFor(() => {
				expect(screen.getByText('Permission denied')).toBeInTheDocument();
			});
		});
	});
});
