import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const mockDesktopHost = vi.hoisted(() => ({
	onMagicLinkResult: vi.fn(),
	drainPendingAuthEvents: vi.fn()
}));

const mockAuthService = vi.hoisted(() => ({
	handleMagicLinkResult: vi.fn(),
	restoreSession: vi.fn()
}));

vi.mock('./services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

vi.mock('./services/authService', () => ({
	authService: mockAuthService
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
vi.mock('./components/Workspace.svelte', () => ({ default: vi.fn() }));
vi.mock('./components/NewSong.svelte', () => ({ default: vi.fn() }));
vi.mock('./components/DesktopEditor.svelte', () => ({ default: vi.fn() }));
vi.mock('./components/Navbar.svelte', () => ({ default: vi.fn() }));
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
		mockDesktopHost.drainPendingAuthEvents.mockResolvedValue(undefined);
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it('cleans up listener registrations that resolve after unmount', async () => {
		const magicLinkUnlisten = vi.fn();
		const magicLinkRegistration = createDeferred<() => void>();

		mockDesktopHost.onMagicLinkResult.mockReturnValue(magicLinkRegistration.promise);

		const { unmount } = render(App);

		expect(mockDesktopHost.onMagicLinkResult).toHaveBeenCalled();
		unmount();

		magicLinkRegistration.resolve(magicLinkUnlisten);
		await flushPromises();

		expect(magicLinkUnlisten).toHaveBeenCalledOnce();
		expect(mockDesktopHost.drainPendingAuthEvents).not.toHaveBeenCalled();
		expect(mockAuthService.restoreSession).not.toHaveBeenCalled();
	});

	it('drains pending auth events before restoring the session', async () => {
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());

		render(App);

		await waitFor(() => {
			expect(mockDesktopHost.drainPendingAuthEvents).toHaveBeenCalledOnce();
		});
		expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		expect(mockDesktopHost.onMagicLinkResult.mock.invocationCallOrder[0]).toBeLessThan(
			mockDesktopHost.drainPendingAuthEvents.mock.invocationCallOrder[0]
		);
		expect(mockDesktopHost.drainPendingAuthEvents.mock.invocationCallOrder[0]).toBeLessThan(
			mockAuthService.restoreSession.mock.invocationCallOrder[0]
		);
	});

	it('still restores the session when a bootstrap call fails', async () => {
		// A failing host registration must not abort onMount before restoreSession runs.
		mockDesktopHost.onMagicLinkResult.mockRejectedValue(new Error('IPC unavailable'));

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});
	});

	it('still restores the session when draining pending auth events fails', async () => {
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
		mockDesktopHost.drainPendingAuthEvents.mockRejectedValue(new Error('IPC unavailable'));

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});
	});

	it('fetches simfile data and triggers auto-linking when user becomes authenticated', async () => {
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
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
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
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
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
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
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
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
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
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
