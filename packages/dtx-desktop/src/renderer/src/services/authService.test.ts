import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from './authService';
import { authStore } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession
} from './sessionStorage';
import { workspaceStore } from '../stores/workspaceStore';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		beginDeviceAuthorization: vi.fn(),
		openExternalUrl: vi.fn(),
		pollDeviceAuthorization: vi.fn(),
		cancelDeviceAuthorization: vi.fn(),
		logoutSession: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

vi.mock('../stores/authStore', () => ({
	authStore: {
		startLogin: vi.fn(),
		setDeviceAuthorization: vi.fn(),
		setLoading: vi.fn(),
		setError: vi.fn(),
		setUser: vi.fn(),
		logout: vi.fn(),
		closeLogin: vi.fn()
	}
}));

vi.mock('./sessionStorage', () => ({
	storeSessionData: vi.fn(),
	getStoredSessionData: vi.fn(),
	clearStoredSessionData: vi.fn(),
	validateSession: vi.fn()
}));

const mockWorkspaceSubscribeFn = vi.hoisted(() => vi.fn());
vi.mock('../stores/workspaceStore', () => ({
	workspaceStore: {
		subscribe: mockWorkspaceSubscribeFn.mockImplementation((callback: (state: any) => void) => {
			callback({ treeStructure: [], path: null });
			return vi.fn();
		}),
		setTreeStructure: vi.fn()
	}
}));

vi.mock('./linkageCacheService', () => ({
	linkageCacheService: { clearCache: vi.fn() }
}));

vi.mock('./simFileService', () => ({
	simFileService: { clearCache: vi.fn() }
}));

const mockGoogleDriveStore = vi.hoisted(() => ({ reset: vi.fn() }));
const mockGoogleDriveService = vi.hoisted(() => ({ refreshConnection: vi.fn() }));
vi.mock('../stores/googleDriveStore', () => ({ googleDriveStore: mockGoogleDriveStore }));
vi.mock('./googleDriveService', () => ({ googleDriveService: mockGoogleDriveService }));

vi.mock('../stores/simFileStore', () => ({
	simFileStore: { reset: vi.fn() }
}));

const user = {
	id: 'user-1',
	name: 'Desktop User',
	email: 'desktop@example.com',
	emailVerified: true,
	image: null,
	createdAt: '2026-08-20T00:00:00.000Z',
	updatedAt: '2026-08-20T00:00:00.000Z'
};

const session = { sessionToken: 'opaque-session-token', user };
const attempt = {
	userCode: 'ABCD-EFGH',
	verificationUri: 'https://dtx.example.com/app/desktop-auth',
	verificationUriComplete: 'https://dtx.example.com/app/desktop-auth?user_code=ABCD-EFGH',
	expiresAt: '2026-08-20T00:15:00.000Z'
};

describe('authService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		host.beginDeviceAuthorization.mockReset();
		host.openExternalUrl.mockReset();
		host.pollDeviceAuthorization.mockReset();
		host.cancelDeviceAuthorization.mockReset();
		host.logoutSession.mockReset();
		host.openExternalUrl.mockResolvedValue(undefined);
		host.cancelDeviceAuthorization.mockResolvedValue(true);
		host.logoutSession.mockResolvedValue(true);
		mockGoogleDriveStore.reset.mockReset();
		mockGoogleDriveService.refreshConnection.mockReset();
		mockGoogleDriveService.refreshConnection.mockResolvedValue(null);
		mockWorkspaceSubscribeFn.mockImplementation((callback: (state: any) => void) => {
			callback({ treeStructure: [], path: null });
			return vi.fn();
		});
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
		(window.localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
		(window.localStorage.removeItem as ReturnType<typeof vi.fn>).mockClear();
		(console.error as ReturnType<typeof vi.fn>).mockClear();
	});

	describe('login', () => {
		it('starts device authorization, opens the complete verification URL, polls, persists, and displays the user', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'approved', session });

			await authService.login();

			expect(host.beginDeviceAuthorization).toHaveBeenCalledOnce();
			expect(host.openExternalUrl).toHaveBeenCalledWith(attempt.verificationUriComplete);
			expect(host.pollDeviceAuthorization).toHaveBeenCalledOnce();
			expect(storeSessionData).toHaveBeenCalledWith(session);
			expect(authStore.setUser).toHaveBeenCalledWith({
				id: user.id,
				email: user.email,
				name: user.name
			});
			expect(authStore.setLoading).toHaveBeenNthCalledWith(1, true);
			expect(authStore.setLoading).toHaveBeenLastCalledWith(false);
		});

		it('surfaces a manual URI and code fallback when opening the browser fails', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.openExternalUrl.mockRejectedValue(new Error('browser unavailable'));
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'approved', session });

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith(
				expect.stringContaining(attempt.userCode)
			);
			expect(authStore.setError).toHaveBeenCalledWith(
				expect.stringContaining(attempt.verificationUri)
			);
			expect(console.error).toHaveBeenCalledWith(
				'Failed to open device authorization URL:',
				expect.any(Error)
			);
			expect(storeSessionData).toHaveBeenCalledWith(session);
		});

		it('retries polling after a pending response and handles the approved session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization
				.mockResolvedValueOnce({ status: 'pending', retryAfterMs: 0 })
				.mockResolvedValueOnce({ status: 'approved', session });

			await authService.login();

			expect(host.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
			expect(storeSessionData).toHaveBeenCalledWith(session);
		});

		it('waits for a pending retry delay before handling an approved session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization
				.mockResolvedValueOnce({ status: 'pending', retryAfterMs: 1 })
				.mockResolvedValueOnce({ status: 'approved', session });

			await authService.login();

			expect(host.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
			expect(storeSessionData).toHaveBeenCalledWith(session);
		});

		it('reports terminal denial and does not persist a session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'denied' });

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith('Authentication was denied.');
			expect(storeSessionData).not.toHaveBeenCalled();
		});

		it('reports an expired authentication code and does not persist a session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'expired' });

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith('The authentication code expired.');
			expect(storeSessionData).not.toHaveBeenCalled();
		});

		it('reports an invalid authentication grant and does not persist a session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'invalidGrant' });

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith(
				'The authentication code is no longer valid.'
			);
			expect(storeSessionData).not.toHaveBeenCalled();
		});

		it('continues polling after an unrecognized status', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization
				.mockResolvedValueOnce({ status: 'unknown-status' as never })
				.mockResolvedValueOnce({ status: 'approved', session });

			await authService.login();

			expect(host.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
			expect(storeSessionData).toHaveBeenCalledWith(session);
		});

		it('reports authentication failure for a malformed approved session', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({
				status: 'approved',
				session: { sessionToken: '', user: { id: '' } } as never
			});

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith(
				'Authentication failed: Native device authorization returned an invalid session'
			);
			expect(console.error).toHaveBeenCalledWith('Authentication failed:', expect.any(Error));
			expect(storeSessionData).not.toHaveBeenCalled();
		});

		it('reports authentication failure when device authorization cannot begin', async () => {
			host.beginDeviceAuthorization.mockRejectedValue(new Error('IPC gone'));

			await authService.login();

			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed: IPC gone');
			expect(console.error).toHaveBeenCalledWith('Authentication failed:', expect.any(Error));
		});

		it('reports a canceled sign-in when native cancellation fails', async () => {
			host.cancelDeviceAuthorization.mockRejectedValue(new Error('cancel failed'));

			await authService.cancelLogin();

			expect(authStore.setError).toHaveBeenCalledWith('Sign-in canceled.');
			expect(authStore.setLoading).toHaveBeenCalledWith(false);
			expect(authStore.closeLogin).toHaveBeenCalledOnce();
		});

		it('clears a native session whose poll resolved approved after cancellation began', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			let resolvePoll!: (value: unknown) => void;
			host.pollDeviceAuthorization.mockReturnValue(
				new Promise((resolve) => {
					resolvePoll = resolve;
				})
			);

			const pendingLogin = authService.login();
			await vi.waitFor(() => expect(host.pollDeviceAuthorization).toHaveBeenCalledOnce());
			await authService.cancelLogin();
			resolvePoll({ status: 'approved', session });
			await pendingLogin;

			expect(storeSessionData).not.toHaveBeenCalled();
			expect(authStore.setUser).not.toHaveBeenCalled();
			// The canceled flow must not leave an installed native session behind.
			expect(host.logoutSession).toHaveBeenCalledOnce();
			expect(host.logoutSession.mock.invocationCallOrder[0]).toBeGreaterThan(
				host.cancelDeviceAuthorization.mock.invocationCallOrder[0]
			);
		});

		it('cancels a pending flow and allows a later retry', async () => {
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			let resolvePoll!: (value: unknown) => void;
			host.pollDeviceAuthorization.mockReturnValue(
				new Promise((resolve) => {
					resolvePoll = resolve;
				})
			);

			const pendingLogin = authService.login();
			await vi.waitFor(() => expect(host.pollDeviceAuthorization).toHaveBeenCalledOnce());
			await authService.cancelLogin();
			resolvePoll({ status: 'pending', retryAfterMs: 0 });
			await pendingLogin;

			expect(host.cancelDeviceAuthorization).toHaveBeenCalledOnce();
			expect(authStore.setLoading).toHaveBeenLastCalledWith(false);
			expect(authStore.closeLogin).toHaveBeenCalledOnce();

			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'approved', session });
			await authService.login();
			expect(storeSessionData).toHaveBeenCalledWith(session);
		});

		it('leaves a newer login intact when stale cancellations resolve after it', async () => {
			// Two cancellations whose native cancel calls stay pending so they
			// observe a newer generation when they resume.
			let resolveCancel1!: (value: boolean) => void;
			let resolveCancel2!: (value: boolean) => void;
			host.cancelDeviceAuthorization
				.mockReturnValueOnce(
					new Promise<boolean>((resolve) => {
						resolveCancel1 = resolve;
					})
				)
				.mockReturnValueOnce(
					new Promise<boolean>((resolve) => {
						resolveCancel2 = resolve;
					})
				);
			host.beginDeviceAuthorization.mockResolvedValue(attempt);
			host.pollDeviceAuthorization.mockResolvedValue({ status: 'approved', session });

			const cancel1 = authService.cancelLogin();
			const cancel2 = authService.cancelLogin();
			// A new login starts and completes while both cancellations are in flight.
			await authService.login();

			resolveCancel1(true);
			resolveCancel2(true);
			await cancel1;
			await cancel2;

			// The newer session was installed and surfaced.
			expect(storeSessionData).toHaveBeenCalledWith(session);
			expect(authStore.setUser).toHaveBeenCalledWith({
				id: user.id,
				email: user.email,
				name: user.name
			});
			// Stale cancellations did not log out the newer native session.
			expect(host.logoutSession).not.toHaveBeenCalled();
			// Stale cancellations did not close or reset the newer login surface.
			expect(authStore.closeLogin).not.toHaveBeenCalled();
			expect(authStore.setError).not.toHaveBeenCalledWith('Sign-in canceled.');
			// Each cancel claims the loading surface (setLoading(true)) before
			// bailing, plus the newer login's own setLoading(true)/setLoading(false).
			expect(authStore.setLoading).toHaveBeenCalledTimes(4);
		});

		it('marks the login surface non-retryable before native logout cleanup', async () => {
			// Block logoutSession so cancel cleanup stays in flight, simulating the
			// window where a retry could start after the first generation check.
			let resolveLogout!: (value: boolean) => void;
			host.logoutSession.mockReturnValue(
				new Promise<boolean>((resolve) => {
					resolveLogout = resolve;
				})
			);

			const cancel = authService.cancelLogin();
			await vi.waitFor(() => expect(host.logoutSession).toHaveBeenCalledOnce());

			// The loading surface must already be claimed before native logout runs,
			// so "Try again" is hidden and a retry cannot launch during the await.
			expect(authStore.setLoading).toHaveBeenCalledWith(true);
			expect(authStore.setLoading.mock.invocationCallOrder[0]).toBeLessThan(
				host.logoutSession.mock.invocationCallOrder[0]
			);

			resolveLogout(true);
			await cancel;

			// Cleanup restores the non-loading state only after native logout finishes.
			expect(authStore.setLoading).toHaveBeenLastCalledWith(false);
		});
	});

	describe('restoreSession', () => {
		it('restores a valid neutral Better Auth session', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue(session);
			(validateSession as ReturnType<typeof vi.fn>).mockResolvedValue('valid');

			expect(await authService.restoreSession()).toBe(true);
			expect(validateSession).toHaveBeenCalledOnce();
			expect(authStore.setUser).toHaveBeenCalledWith({
				id: user.id,
				email: user.email,
				name: user.name
			});
			expect(mockGoogleDriveService.refreshConnection).toHaveBeenCalledOnce();
		});

		it('clears invalid sessions and leaves the auth store signed out', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue(session);
			(validateSession as ReturnType<typeof vi.fn>).mockResolvedValue('invalid');

			expect(await authService.restoreSession()).toBe(false);
			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(authStore.setUser).not.toHaveBeenCalled();
		});

		it('preserves stored session data and reports configuration errors', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue(session);
			(validateSession as ReturnType<typeof vi.fn>).mockResolvedValue('not-configured');

			expect(await authService.restoreSession()).toBe(false);
			expect(clearStoredSessionData).not.toHaveBeenCalled();
			expect(authStore.setError).toHaveBeenCalledWith(
				'Authentication is not configured on this build.'
			);
		});

		it('clears malformed stored session data before validation', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue({
				sessionToken: '',
				user: { email: user.email }
			});

			expect(await authService.restoreSession()).toBe(false);
			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(validateSession).not.toHaveBeenCalled();
		});

		it('returns false when session validation rejects', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue(session);
			(validateSession as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('validation failed')
			);

			expect(await authService.restoreSession()).toBe(false);
		});

		it('returns false when there is no stored session', async () => {
			(getStoredSessionData as ReturnType<typeof vi.fn>).mockReturnValue(null);

			expect(await authService.restoreSession()).toBe(false);
			expect(authStore.setUser).not.toHaveBeenCalled();
		});
	});

	describe('logout', () => {
		it('clears renderer persistence before awaiting remote native revocation', async () => {
			let resolveLogout!: (value: boolean) => void;
			host.logoutSession.mockReturnValue(
				new Promise<boolean>((resolve) => {
					resolveLogout = resolve;
				})
			);

			const logout = authService.logout();
			await vi.waitFor(() => expect(host.logoutSession).toHaveBeenCalledOnce());
			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(mockGoogleDriveStore.reset).toHaveBeenCalledOnce();

			resolveLogout(true);
			await logout;
		});

		it('clears the native session, neutral storage, cache, and Drive state', async () => {
			await authService.logout();

			expect(authStore.logout).toHaveBeenCalledOnce();
			expect(host.logoutSession).toHaveBeenCalledOnce();
			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(mockGoogleDriveStore.reset).toHaveBeenCalledOnce();
		});

		it('clears renderer state even when native logout fails', async () => {
			host.logoutSession.mockRejectedValue(new Error('IPC error'));

			await authService.logout();

			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(authStore.logout).toHaveBeenCalledOnce();
		});

		it('runs native logout and renderer cleanup when canceling a pending flow fails', async () => {
			host.cancelDeviceAuthorization.mockRejectedValue(new Error('no pending flow'));
			host.logoutSession.mockRejectedValue(new Error('logout unavailable'));

			await authService.logout();

			expect(host.cancelDeviceAuthorization).toHaveBeenCalledOnce();
			expect(host.logoutSession).toHaveBeenCalledOnce();
			expect(clearStoredSessionData).toHaveBeenCalledOnce();
			expect(host.logoutSession.mock.invocationCallOrder[0]).toBeGreaterThan(
				host.cancelDeviceAuthorization.mock.invocationCallOrder[0]
			);
			expect(clearStoredSessionData.mock.invocationCallOrder[0]).toBeLessThan(
				host.cancelDeviceAuthorization.mock.invocationCallOrder[0]
			);
		});

		it('removes cloud linkages from the workspace tree', async () => {
			const treeNode = {
				name: 'song-folder',
				path: '/workspace/song',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				linkedSimFileId: 'sim-123',
				linkedSimFile: { id: 'sim-123' }
			};
			mockWorkspaceSubscribeFn.mockImplementationOnce((callback: (state: any) => void) => {
				callback({ treeStructure: [treeNode], path: '/workspace' });
				return vi.fn();
			});

			await authService.logout();

			expect(workspaceStore.setTreeStructure).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ linkedSimFileId: null, linkedSimFile: null })
				])
			);
		});
	});
});
