import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService, getDesktopLoginUrl } from './authService';
import { authStore } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession
} from './supabaseService';
import { workspaceStore } from '../stores/workspaceStore';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		openExternalUrl: vi.fn(),
		logoutSession: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

// Mock the authStore
vi.mock('../stores/authStore', () => ({
	authStore: {
		setLoading: vi.fn(),
		setError: vi.fn(),
		setUser: vi.fn(),
		logout: vi.fn()
	}
}));

// Mock the supabaseService
vi.mock('./supabaseService', () => ({
	storeSessionData: vi.fn(),
	getStoredSessionData: vi.fn(),
	clearStoredSessionData: vi.fn(),
	validateSession: vi.fn(),
	getCurrentSession: vi.fn()
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

vi.mock('../stores/simFileStore', () => ({
	simFileStore: { reset: vi.fn() }
}));

describe('AuthService', () => {
	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks();
		host.openExternalUrl.mockReset();
		host.logoutSession.mockReset();

		// Reset localStorage mock
		(window.localStorage.getItem as any).mockReturnValue(null);
		(window.localStorage.setItem as any).mockClear();
		(window.localStorage.removeItem as any).mockClear();

		// Reset console mocks
		(console.error as any).mockClear();
	});

	describe('login', () => {
		it('builds the desktop login URL from a local web server URL', () => {
			expect(getDesktopLoginUrl('http://localhost:5173')).toBe(
				'http://localhost:5173/login?redirect=desktop'
			);
		});

		it('builds the desktop login URL from a production server URL without duplicating slashes', () => {
			expect(getDesktopLoginUrl('https://dtx.hapadona.com/')).toBe(
				'https://dtx.hapadona.com/login?redirect=desktop'
			);
		});

		it('should set loading state and open login URL through desktop host', async () => {
			// Act
			await authService.login();

			// Assert
			expect(authStore.setLoading).toHaveBeenCalledWith(true);
			expect(host.openExternalUrl).toHaveBeenCalledWith(
				'http://localhost:5173/login?redirect=desktop'
			);
			expect(authStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should handle host open errors gracefully', async () => {
			// Arrange
			const error = new Error('IPC failed');
			host.openExternalUrl.mockRejectedValue(error);

			// Act
			await authService.login();

			// Assert
			expect(authStore.setLoading).toHaveBeenCalledWith(true);
			expect(console.error).toHaveBeenCalledWith('Login failed:', error);
			expect(authStore.setError).toHaveBeenCalledWith('Failed to open login page');
			expect(authStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should use default server URL when environment variable is not set', async () => {
			// Act
			await authService.login();

			// Assert
			expect(host.openExternalUrl).toHaveBeenCalledWith(
				'http://localhost:5173/login?redirect=desktop'
			);
		});
	});

	describe('restoreSession', () => {
		const mockAccessToken = 'header.mocked-access-token.signature';
		const mockRefreshToken = 'header.mocked-refresh-token.signature';
		const mockUserData = {
			id: '123',
			email: 'test@example.com',
			name: 'Test User'
		};

		it('should restore session from valid stored tokens', async () => {
			// Arrange
			(getStoredSessionData as any).mockReturnValue({
				accessToken: mockAccessToken,
				refreshToken: mockRefreshToken,
				userData: mockUserData
			});
			(validateSession as any).mockResolvedValue(true);

			// Act
			const result = await authService.restoreSession();

			// Assert
			expect(getStoredSessionData).toHaveBeenCalled();
			expect(validateSession).toHaveBeenCalled();
			expect(authStore.setUser).toHaveBeenCalledWith({
				id: '123',
				email: 'test@example.com',
				name: 'test@example.com' // Falls back to email since user_metadata.name is not set
			});
			expect(result).toBe(true);
		});

		it('should return false when no session data is stored', async () => {
			// Arrange
			(getStoredSessionData as any).mockReturnValue(null);

			// Act
			const result = await authService.restoreSession();

			// Assert
			expect(getStoredSessionData).toHaveBeenCalled();
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it('should return false when session validation fails', async () => {
			// Arrange
			(getStoredSessionData as any).mockReturnValue({
				accessToken: mockAccessToken,
				refreshToken: mockRefreshToken,
				userData: mockUserData
			});
			(validateSession as any).mockResolvedValue(false);

			// Act
			const result = await authService.restoreSession();

			// Assert
			expect(getStoredSessionData).toHaveBeenCalled();
			expect(validateSession).toHaveBeenCalled();
			expect(clearStoredSessionData).toHaveBeenCalled();
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it('should handle errors during session restoration', async () => {
			// Arrange
			(getStoredSessionData as any).mockImplementation(() => {
				throw new Error('Storage error');
			});

			// Act
			const result = await authService.restoreSession();

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to restore session:',
				expect.any(Error)
			);
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});
	});

	describe('handleMagicLinkResult', () => {
		it('should store session and set user when magic link succeeds', async () => {
			const mockSession = { access_token: 'abc', refresh_token: 'xyz' };
			const result = {
				success: true,
				session: mockSession,
				user: {
					id: 'user-1',
					email: 'test@example.com',
					user_metadata: { name: 'Test User' }
				}
			};

			await authService.handleMagicLinkResult(result as any);

			expect(storeSessionData).toHaveBeenCalledWith(mockSession);
			expect(authStore.setUser).toHaveBeenCalledWith({
				id: 'user-1',
				email: 'test@example.com',
				name: 'Test User'
			});
		});

		it('should fall back to email as name when user_metadata has no name', async () => {
			const result = {
				success: true,
				session: { access_token: 'abc', refresh_token: 'xyz' },
				user: { id: 'user-1', email: 'foo@bar.com', user_metadata: {} }
			};

			await authService.handleMagicLinkResult(result as any);

			expect(authStore.setUser).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'foo@bar.com' })
			);
		});

		it('should set error when result.success is false', async () => {
			const result = {
				success: false,
				error: 'Token expired',
				user: { id: '', email: null }
			};

			await authService.handleMagicLinkResult(result as any);

			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
			expect(authStore.setUser).not.toHaveBeenCalled();
		});

		it('should set error when session is missing from successful result', async () => {
			const result = {
				success: true,
				session: null,
				user: { id: 'user-1', email: 'test@example.com' }
			};

			await authService.handleMagicLinkResult(result as any);

			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});
	});

	describe('logout', () => {
		it('should clear session and call store logout', async () => {
			// Arrange
			host.logoutSession.mockResolvedValue(true);

			// Act
			await authService.logout();

			// Assert
			expect(host.logoutSession).toHaveBeenCalledWith();
			expect(clearStoredSessionData).toHaveBeenCalled();
			expect(authStore.logout).toHaveBeenCalled();
		});

		it('should still clear local state when host logout throws', async () => {
			host.logoutSession.mockRejectedValue(new Error('IPC error'));

			await authService.logout();

			expect(clearStoredSessionData).toHaveBeenCalled();
			expect(authStore.logout).toHaveBeenCalled();
		});

		it('should clear linkages from tree nodes when treeStructure is non-empty', async () => {
			host.logoutSession.mockResolvedValue(true);

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

	describe('restoreSession - invalid userData', () => {
		it('should clear stored data and return false when userData has no id field', async () => {
			(getStoredSessionData as any).mockReturnValue({
				accessToken: 'tok',
				refreshToken: 'ref',
				userData: { email: 'no-id@test.com' } // missing `id` field
			});

			const result = await authService.restoreSession();

			expect(clearStoredSessionData).toHaveBeenCalled();
			expect(result).toBe(false);
		});
	});
});
