import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from './authService';
import { authStore } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession
} from './supabaseService';

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

describe('AuthService', () => {
	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks();

		// Reset localStorage mock
		(window.localStorage.getItem as any).mockReturnValue(null);
		(window.localStorage.setItem as any).mockClear();
		(window.localStorage.removeItem as any).mockClear();

		// Reset electron IPC mock
		(window.electron.ipcRenderer.send as any).mockClear();
		(window.electron.ipcRenderer.invoke as any).mockClear();

		// Reset console mocks
		(console.error as any).mockClear();

		// Reset atob mock
		(global.atob as any).mockClear();
	});

	describe('login', () => {
		it('should set loading state and send IPC message to open login URL', async () => {
			// Act
			await authService.login();

			// Assert
			expect(authStore.setLoading).toHaveBeenCalledWith(true);
			expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
				'open-external-url',
				'http://localhost:5173/login?redirect=desktop'
			);
			expect(authStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should handle IPC send errors gracefully', async () => {
			// Arrange
			const error = new Error('IPC failed');
			(window.electron.ipcRenderer.send as any).mockRejectedValue(error);

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
			expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
				'open-external-url',
				'http://localhost:5173/login?redirect=desktop'
			);
		});
	});

	describe('handleAuthCallback', () => {
		const mockAccessToken = 'header.mocked-access-token.signature';
		const mockRefreshToken = 'header.mocked-refresh-token.signature';
		const mockTokens = { accessToken: mockAccessToken, refreshToken: mockRefreshToken };
		const mockUserData = {
			id: '123',
			email: 'test@example.com',
			name: 'Test User'
		};

		beforeEach(() => {
			(global.atob as any).mockReturnValue(JSON.stringify(mockUserData));
		});

		it('should process valid tokens and set user data', async () => {
			// Act
			await authService.handleAuthCallback(mockTokens);

			// Assert
			expect(global.atob).toHaveBeenCalledWith('mocked-access-token');
			expect(storeSessionData).toHaveBeenCalledWith({
				access_token: mockAccessToken,
				refresh_token: mockRefreshToken,
				user: mockUserData
			});
			expect(authStore.setUser).toHaveBeenCalledWith(mockUserData);
		});

		it('should handle missing access token', async () => {
			// Act
			await authService.handleAuthCallback({
				accessToken: '',
				refreshToken: mockRefreshToken
			});

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(window.localStorage.setItem).not.toHaveBeenCalled();
		});

		it('should handle missing refresh token', async () => {
			// Act
			await authService.handleAuthCallback({
				accessToken: mockAccessToken,
				refreshToken: ''
			});

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle invalid token format', async () => {
			// Arrange
			const invalidTokens = {
				accessToken: 'invalid-token-without-dots',
				refreshToken: mockRefreshToken
			};
			(global.atob as any).mockImplementation(() => {
				throw new Error('Invalid base64');
			});

			// Act
			await authService.handleAuthCallback(invalidTokens);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle JSON parsing errors', async () => {
			// Arrange
			(global.atob as any).mockReturnValue('invalid-json');

			// Act
			await authService.handleAuthCallback(mockTokens);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle token with insufficient parts', async () => {
			// Arrange
			const tokensWithOnePart = {
				accessToken: 'single-part-token',
				refreshToken: mockRefreshToken
			};
			(global.atob as any).mockImplementation((input) => {
				if (input === undefined) {
					throw new Error('Cannot decode undefined');
				}
				return 'some-value';
			});

			// Act
			await authService.handleAuthCallback(tokensWithOnePart);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should not store tokens or set user on error', async () => {
			// Arrange
			(global.atob as any).mockImplementation(() => {
				throw new Error('Decode failed');
			});

			// Act
			await authService.handleAuthCallback(mockTokens);

			// Assert
			expect(window.localStorage.setItem).not.toHaveBeenCalled();
			expect(authStore.setUser).not.toHaveBeenCalled();
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

	describe('logout', () => {
		it('should clear session and call store logout', async () => {
			// Arrange
			(window.electron.ipcRenderer.invoke as any).mockResolvedValue(true);

			// Act
			await authService.logout();

			// Assert
			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('logout-session');
			expect(clearStoredSessionData).toHaveBeenCalled();
			expect(authStore.logout).toHaveBeenCalled();
		});
	});
});
