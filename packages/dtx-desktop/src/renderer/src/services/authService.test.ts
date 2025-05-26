import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from './authService';
import { authStore } from '../stores/authStore';

// Mock the authStore
vi.mock('../stores/authStore', () => ({
	authStore: {
		setLoading: vi.fn(),
		setError: vi.fn(),
		setUser: vi.fn(),
		logout: vi.fn()
	}
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
		const mockToken = 'header.mocked-token.signature';
		const mockUserData = {
			id: '123',
			email: 'test@example.com',
			name: 'Test User'
		};

		beforeEach(() => {
			(global.atob as any).mockReturnValue(JSON.stringify(mockUserData));
		});

		it('should process valid token and set user data', () => {
			// Act
			authService.handleAuthCallback(mockToken);

			// Assert
			expect(global.atob).toHaveBeenCalledWith('mocked-token');
			expect(authStore.setUser).toHaveBeenCalledWith(mockUserData);
			expect(window.localStorage.setItem).toHaveBeenCalledWith('auth_token', mockToken);
		});

		it('should handle empty token', () => {
			// Act
			authService.handleAuthCallback('');

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(window.localStorage.setItem).not.toHaveBeenCalled();
		});

		it('should handle null token', () => {
			// Act
			authService.handleAuthCallback(null as any);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle invalid token format', () => {
			// Arrange
			const invalidToken = 'invalid-token-without-dots';
			(global.atob as any).mockImplementation(() => {
				throw new Error('Invalid base64');
			});

			// Act
			authService.handleAuthCallback(invalidToken);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle JSON parsing errors', () => {
			// Arrange
			(global.atob as any).mockReturnValue('invalid-json');

			// Act
			authService.handleAuthCallback(mockToken);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should handle token with insufficient parts', () => {
			// Arrange
			const tokenWithOnePart = 'single-part-token';
			(global.atob as any).mockImplementation((input) => {
				if (input === undefined) {
					throw new Error('Cannot decode undefined');
				}
				return 'some-value';
			});

			// Act
			authService.handleAuthCallback(tokenWithOnePart);

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to process auth callback:',
				expect.any(Error)
			);
			expect(authStore.setError).toHaveBeenCalledWith('Authentication failed');
		});

		it('should not store token or set user on error', () => {
			// Arrange
			(global.atob as any).mockImplementation(() => {
				throw new Error('Decode failed');
			});

			// Act
			authService.handleAuthCallback(mockToken);

			// Assert
			expect(window.localStorage.setItem).not.toHaveBeenCalled();
			expect(authStore.setUser).not.toHaveBeenCalled();
		});
	});

	describe('restoreSession', () => {
		const mockToken = 'header.mocked-token.signature';
		const mockUserData = {
			id: '123',
			email: 'test@example.com',
			name: 'Test User'
		};

		it('should restore session from valid stored token', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue(mockToken);
			(global.atob as any).mockReturnValue(JSON.stringify(mockUserData));

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(window.localStorage.getItem).toHaveBeenCalledWith('auth_token');
			expect(global.atob).toHaveBeenCalledWith('mocked-token');
			expect(authStore.setUser).toHaveBeenCalledWith(mockUserData);
			expect(result).toBe(true);
		});

		it('should return false when no token is stored', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue(null);

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(window.localStorage.getItem).toHaveBeenCalledWith('auth_token');
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it('should handle invalid stored token gracefully', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue('invalid-token');
			(global.atob as any).mockImplementation(() => {
				throw new Error('Invalid base64');
			});

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to restore session:',
				expect.any(Error)
			);
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it('should handle JSON parsing errors during restoration', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue(mockToken);
			(global.atob as any).mockReturnValue('invalid-json');

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to restore session:',
				expect.any(Error)
			);
			expect(result).toBe(false);
		});

		it('should handle empty string token in localStorage', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue('');

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(authStore.setUser).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it('should handle token with insufficient parts during restoration', () => {
			// Arrange
			(window.localStorage.getItem as any).mockReturnValue('invalid-token');

			// Act
			const result = authService.restoreSession();

			// Assert
			expect(console.error).toHaveBeenCalledWith(
				'Failed to restore session:',
				expect.any(Error)
			);
			expect(result).toBe(false);
		});
	});

	describe('logout', () => {
		it('should clear localStorage and call store logout', () => {
			// Act
			authService.logout();

			// Assert
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('auth_token');
			expect(authStore.logout).toHaveBeenCalled();
		});
	});
});
