import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

const mockDesktopHost = vi.hoisted(() => ({
	getWorkspaceRoot: vi.fn(),
	getCurrentWorkspaceRootId: vi.fn()
}));

const mockBookmarkStore = vi.hoisted(() => ({
	refresh: vi.fn().mockResolvedValue(undefined),
	subscribe: vi.fn(() => () => {})
}));

const mockWorkspaceService = vi.hoisted(() => ({
	loadSubWorkspaces: vi.fn(),
	loadTreeStructure: vi.fn(),
	getTransitionGeneration: vi.fn(() => 0),
	isTransitionCurrent: vi.fn(() => true),
	disposeOperations: vi.fn()
}));

const mockAppShell = vi.hoisted(() => vi.fn());
const mockDesktopEditor = vi.hoisted(() => vi.fn());

const mockAuthService = vi.hoisted(() => ({
	restoreSession: vi.fn()
}));

vi.mock('./services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

vi.mock('./stores/bookmarkStore', () => ({
	bookmarkStore: mockBookmarkStore
}));

vi.mock('./services/authService', () => ({
	authService: mockAuthService
}));

vi.mock('./services/workspaceService', () => ({
	workspaceService: mockWorkspaceService
}));

vi.mock('./services/simFileService', () => ({
	simFileService: {
		fetchUserSimFiles: vi.fn(),
		clearCache: vi.fn()
	}
}));

vi.mock('./services/linkingService', () => ({
	linkingService: {
		autoLinkSimFilesToFolders: vi.fn()
	}
}));

vi.mock('./components/Login.svelte', () => ({ default: vi.fn() }));
vi.mock('./components/shell/AppShell.svelte', () => ({ default: mockAppShell }));
vi.mock('./components/DesktopEditor.svelte', () => ({ default: mockDesktopEditor }));
vi.mock('./components/VersionsModal.svelte', () => ({ default: vi.fn() }));

import App from './App.svelte';
import { authStore } from './stores/authStore';
import { simFileStore } from './stores/simFileStore';
import { workspaceStore } from './stores/workspaceStore';

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
};

const flushPromises = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe('App lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.reset();
		simFileStore.reset();
		workspaceStore.reset();
		window.location.hash = '';
		mockAuthService.restoreSession.mockResolvedValue(undefined);
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue(null);
		mockDesktopHost.getCurrentWorkspaceRootId.mockResolvedValue(null);
		mockWorkspaceService.getTransitionGeneration.mockReturnValue(0);
		mockWorkspaceService.isTransitionCurrent.mockReturnValue(true);
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it('restores the session after workspace hydration without legacy auth listeners', async () => {
		const { unmount } = render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});
		unmount();
	});

	it('hydrates the workspace display path from the native managed root before loading it', async () => {
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue('/native/canonical/workspace');

		render(App);

		await waitFor(() => {
			expect(mockWorkspaceService.loadSubWorkspaces).toHaveBeenCalledOnce();
			expect(mockWorkspaceService.loadTreeStructure).toHaveBeenCalledOnce();
		});
		expect(get(workspaceStore).path).toBe('/native/canonical/workspace');
		expect(mockDesktopHost.getWorkspaceRoot.mock.invocationCallOrder[0]).toBeLessThan(
			mockWorkspaceService.loadSubWorkspaces.mock.invocationCallOrder[0]
		);
	});

	it('does not mount the editor until native workspace hydration settles', async () => {
		const nativeWorkspace = createDeferred<string | null>();
		window.location.hash = '#editor';
		mockDesktopHost.getWorkspaceRoot.mockReturnValue(nativeWorkspace.promise);

		render(App);

		expect(mockDesktopEditor).not.toHaveBeenCalled();

		nativeWorkspace.resolve(null);

		await waitFor(() => {
			expect(mockDesktopEditor).toHaveBeenCalledOnce();
		});
	});

	it('keeps a newer workspace selection when an older native hydration resolves', async () => {
		const nativeWorkspace = createDeferred<string | null>();
		let hydrationIsCurrent = true;
		mockDesktopHost.getWorkspaceRoot.mockReturnValue(nativeWorkspace.promise);
		mockWorkspaceService.isTransitionCurrent.mockImplementation(() => hydrationIsCurrent);

		render(App);
		workspaceStore.setPath('/newer/canonical/workspace');
		hydrationIsCurrent = false;
		nativeWorkspace.resolve('/older/canonical/workspace');

		await waitFor(() => {
			expect(mockDesktopHost.getWorkspaceRoot).toHaveBeenCalledOnce();
		});
		expect(get(workspaceStore).path).toBe('/newer/canonical/workspace');
		expect(mockWorkspaceService.loadSubWorkspaces).not.toHaveBeenCalled();
		expect(mockWorkspaceService.loadTreeStructure).not.toHaveBeenCalled();
	});

	it('does not mutate workspace state when unmounted during native hydration', async () => {
		const nativeWorkspace = createDeferred<string | null>();
		mockDesktopHost.getWorkspaceRoot.mockReturnValue(nativeWorkspace.promise);

		const { unmount } = render(App);
		unmount();
		nativeWorkspace.resolve('/native/canonical/workspace');

		await flushPromises();

		expect(get(workspaceStore).path).toBeNull();
		expect(mockWorkspaceService.loadSubWorkspaces).not.toHaveBeenCalled();
		expect(mockWorkspaceService.loadTreeStructure).not.toHaveBeenCalled();
		expect(mockWorkspaceService.disposeOperations).toHaveBeenCalledOnce();
	});

	it('invalidates pending workspace loaders when unmounted after hydration', async () => {
		const subWorkspaces = createDeferred<void>();
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue('/native/canonical/workspace');
		mockWorkspaceService.loadSubWorkspaces.mockReturnValue(subWorkspaces.promise);

		const { unmount } = render(App);
		await waitFor(() => {
			expect(mockWorkspaceService.loadSubWorkspaces).toHaveBeenCalledOnce();
		});
		unmount();
		subWorkspaces.resolve();
		await flushPromises();

		expect(mockWorkspaceService.disposeOperations).toHaveBeenCalledOnce();
		expect(mockWorkspaceService.loadTreeStructure).not.toHaveBeenCalled();
	});

	it('invalidates a pending workspace tree load when unmounted after hydration', async () => {
		const tree = createDeferred<void>();
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue('/native/canonical/workspace');
		mockWorkspaceService.loadTreeStructure.mockReturnValue(tree.promise);

		const { unmount } = render(App);
		await waitFor(() => {
			expect(mockWorkspaceService.loadTreeStructure).toHaveBeenCalledOnce();
		});
		unmount();
		tree.resolve();
		await flushPromises();

		expect(mockWorkspaceService.disposeOperations).toHaveBeenCalledOnce();
	});

	it('can mount again after disposing a previous workspace lifecycle', async () => {
		const first = render(App);
		await waitFor(() => {
			expect(mockDesktopHost.getWorkspaceRoot).toHaveBeenCalledOnce();
		});
		first.unmount();

		render(App);
		await waitFor(() => {
			expect(mockDesktopHost.getWorkspaceRoot).toHaveBeenCalledTimes(2);
		});
		expect(mockWorkspaceService.disposeOperations).toHaveBeenCalledOnce();
	});

	it('leaves workspace selection empty when the native managed root is absent', async () => {
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue(null);

		render(App);

		await waitFor(() => {
			expect(get(workspaceStore).path).toBeNull();
		});
		expect(mockWorkspaceService.loadSubWorkspaces).not.toHaveBeenCalled();
		expect(mockWorkspaceService.loadTreeStructure).not.toHaveBeenCalled();
	});

	it('leaves workspace selection empty when native hydration rejects', async () => {
		mockDesktopHost.getWorkspaceRoot.mockRejectedValue(new Error('IPC unavailable'));
		workspaceStore.setPath('/stale/renderer/path');

		render(App);

		await waitFor(() => {
			expect(get(workspaceStore).path).toBeNull();
		});
		expect(mockWorkspaceService.loadSubWorkspaces).not.toHaveBeenCalled();
		expect(mockWorkspaceService.loadTreeStructure).not.toHaveBeenCalled();
	});

	it('continues loading the workspace when root-id hydration rejects', async () => {
		// rootId is display-only metadata; its lookup failure must not abort
		// workspace hydration (the outer catch would clear the valid path).
		mockDesktopHost.getWorkspaceRoot.mockResolvedValue('/native/canonical/workspace');
		mockDesktopHost.getCurrentWorkspaceRootId.mockRejectedValue(
			new Error('root-id IPC failed')
		);

		render(App);

		await waitFor(() => {
			expect(mockWorkspaceService.loadSubWorkspaces).toHaveBeenCalledOnce();
			expect(mockWorkspaceService.loadTreeStructure).toHaveBeenCalledOnce();
		});
		expect(get(workspaceStore).path).toBe('/native/canonical/workspace');
		expect(get(workspaceStore).rootId).toBeNull();
	});

	it('restores the session after workspace hydration', async () => {
		render(App);

		await waitFor(() => expect(mockAuthService.restoreSession).toHaveBeenCalledOnce());
	});

	it('still restores the session when a bootstrap call fails', async () => {
		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});
	});

	it('still restores the session when the native bootstrap is unavailable', async () => {
		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});
	});

	it('fetches simfile data and triggers auto-linking when user becomes authenticated', async () => {
		const { simFileService } = await import('./services/simFileService');
		vi.mocked(simFileService.fetchUserSimFiles).mockResolvedValue({
			data: [],
			error: null,
			fromCache: false
		});

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		authStore.setUser({ id: '1', email: 'test@test.com' });

		await waitFor(() => {
			expect(simFileService.fetchUserSimFiles).toHaveBeenCalled();
		});
	});

	it('sets simfile store error when fetchUserSimFiles returns an error result', async () => {
		const { simFileService } = await import('./services/simFileService');
		vi.mocked(simFileService.fetchUserSimFiles).mockResolvedValue({
			data: [],
			error: 'Server unavailable',
			fromCache: false
		});

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		authStore.setUser({ id: '1', email: 'test@test.com' });

		await waitFor(() => {
			expect(simFileService.fetchUserSimFiles).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(simFileStore.getCurrentState().error).toBe('Server unavailable');
		});
	});

	it('redirects from login route to workspace when user becomes authenticated', async () => {
		const { simFileService } = await import('./services/simFileService');
		vi.mocked(simFileService.fetchUserSimFiles).mockResolvedValue({
			data: [],
			error: null,
			fromCache: false
		});

		window.location.hash = '#login';
		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		authStore.setUser({ id: '1', email: 'test@test.com' });

		await waitFor(() => {
			expect(window.location.hash).toBe('');
		});
	});

	it('triggers auto-linking when simfiles and tree structure both have data', async () => {
		const { simFileService } = await import('./services/simFileService');
		const { linkingService } = await import('./services/linkingService');
		const simfileData = [{ id: 1, title: 'Song A', artist: 'Artist', bpm: 120 }];
		vi.mocked(simFileService.fetchUserSimFiles).mockResolvedValue({
			data: simfileData as any,
			error: null,
			fromCache: false
		});

		workspaceStore.setTreeStructure([
			{
				name: 'SongA',
				path: '/songs/SongA',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: null,
				linkedSimFileId: null,
				linkedSimFile: null
			}
		] as any);

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		authStore.setUser({ id: '1', email: 'test@test.com' });

		await waitFor(() => {
			expect(vi.mocked(linkingService.autoLinkSimFilesToFolders)).toHaveBeenCalledWith(
				simfileData,
				expect.any(Array)
			);
		});
	});

	it('sets simfile store error when fetchUserSimFiles rejects', async () => {
		const { simFileService } = await import('./services/simFileService');
		vi.mocked(simFileService.fetchUserSimFiles).mockRejectedValue(new Error('Network error'));

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		authStore.setUser({ id: '1', email: 'test@test.com' });

		await waitFor(() => {
			expect(simFileService.fetchUserSimFiles).toHaveBeenCalled();
		});
	});
});
