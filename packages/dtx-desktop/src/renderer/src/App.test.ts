import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const mockDesktopHost = vi.hoisted(() => ({
	onMagicLinkResult: vi.fn(),
	onAuthCallback: vi.fn(),
	drainPendingAuthEvents: vi.fn(),
	migrateElectronData: vi.fn()
}));

const mockAuthService = vi.hoisted(() => ({
	handleMagicLinkResult: vi.fn(),
	handleAuthCallback: vi.fn(),
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
		mockDesktopHost.migrateElectronData.mockResolvedValue({
			migrated: false,
			importedKeys: [],
			warnings: [],
			localStorage: {}
		});
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it('cleans up listener registrations that resolve after unmount', async () => {
		const magicLinkUnlisten = vi.fn();
		const authCallbackUnlisten = vi.fn();
		const magicLinkRegistration = createDeferred<() => void>();
		const authCallbackRegistration = createDeferred<() => void>();

		mockDesktopHost.onMagicLinkResult.mockReturnValue(magicLinkRegistration.promise);
		mockDesktopHost.onAuthCallback.mockReturnValue(authCallbackRegistration.promise);

		const { unmount } = render(App);

		expect(mockDesktopHost.onMagicLinkResult).toHaveBeenCalled();
		unmount();

		magicLinkRegistration.resolve(magicLinkUnlisten);
		await flushPromises();
		expect(mockDesktopHost.onAuthCallback).toHaveBeenCalled();

		authCallbackRegistration.resolve(authCallbackUnlisten);
		await flushPromises();

		expect(magicLinkUnlisten).toHaveBeenCalledOnce();
		expect(authCallbackUnlisten).toHaveBeenCalledOnce();
		expect(mockDesktopHost.drainPendingAuthEvents).not.toHaveBeenCalled();
		expect(mockDesktopHost.migrateElectronData).not.toHaveBeenCalled();
		expect(mockAuthService.restoreSession).not.toHaveBeenCalled();
	});

	it('drains pending auth events and migrates data before restoring the session', async () => {
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
		mockDesktopHost.onAuthCallback.mockResolvedValue(vi.fn());

		render(App);

		await waitFor(() => {
			expect(mockDesktopHost.drainPendingAuthEvents).toHaveBeenCalledOnce();
		});
		expect(mockDesktopHost.migrateElectronData).toHaveBeenCalledOnce();
		expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		expect(mockDesktopHost.onAuthCallback.mock.invocationCallOrder[0]).toBeLessThan(
			mockDesktopHost.drainPendingAuthEvents.mock.invocationCallOrder[0]
		);
		expect(mockDesktopHost.drainPendingAuthEvents.mock.invocationCallOrder[0]).toBeLessThan(
			mockDesktopHost.migrateElectronData.mock.invocationCallOrder[0]
		);
		expect(mockDesktopHost.migrateElectronData.mock.invocationCallOrder[0]).toBeLessThan(
			mockAuthService.restoreSession.mock.invocationCallOrder[0]
		);
	});

	it('applies migrated localStorage keys without overwriting existing keys', async () => {
		mockDesktopHost.onMagicLinkResult.mockResolvedValue(vi.fn());
		mockDesktopHost.onAuthCallback.mockResolvedValue(vi.fn());
		mockDesktopHost.migrateElectronData.mockResolvedValue({
			migrated: true,
			importedKeys: ['auth_access_token', 'app_settings'],
			warnings: [],
			localStorage: {
				auth_access_token: 'access',
				app_settings: { exportDirectory: '/exports' }
			}
		});
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
			(key: string) => (key === 'app_settings' ? '{"exportDirectory":"/existing"}' : null)
		);

		render(App);

		await waitFor(() => {
			expect(mockAuthService.restoreSession).toHaveBeenCalledOnce();
		});

		expect(window.localStorage.setItem).toHaveBeenCalledWith('auth_access_token', 'access');
		expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
			'app_settings',
			'{"exportDirectory":"/exports"}'
		);
		expect(
			(window.localStorage.setItem as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		).toBeLessThan(mockAuthService.restoreSession.mock.invocationCallOrder[0]);
	});
});
