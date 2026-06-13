import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession,
	getCurrentSession
} from './supabaseService';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		validateSession: vi.fn(),
		getCurrentSession: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

describe('supabaseService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, 'localStorage', {
			value: localStorageMock,
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		if (originalLocalStorageDescriptor) {
			Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
		}
	});

	describe('storeSessionData', () => {
		it('should store access_token, refresh_token, and user in localStorage', () => {
			const session = {
				access_token: 'acc123',
				refresh_token: 'ref456',
				user: { id: 'user-1', email: 'test@example.com' }
			};

			storeSessionData(session);

			expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_access_token', 'acc123');
			expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_refresh_token', 'ref456');
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'auth_user_data',
				JSON.stringify(session.user)
			);
		});

		it('should throw when localStorage.setItem throws', () => {
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('quota exceeded');
			});

			expect(() =>
				storeSessionData({ access_token: 'a', refresh_token: 'b', user: {} })
			).toThrow('quota exceeded');
		});
	});

	describe('getStoredSessionData', () => {
		it('should return session data when all keys exist', () => {
			const userData = { id: 'user-1' };
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'acc123';
				if (key === 'auth_refresh_token') return 'ref456';
				if (key === 'auth_user_data') return JSON.stringify(userData);
				return null;
			});

			const result = getStoredSessionData();

			expect(result).toEqual({
				accessToken: 'acc123',
				refreshToken: 'ref456',
				userData
			});
		});

		it('should return null when access_token is missing', () => {
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return null;
				if (key === 'auth_refresh_token') return 'ref456';
				if (key === 'auth_user_data') return JSON.stringify({ id: 'u1' });
				return null;
			});

			expect(getStoredSessionData()).toBeNull();
		});

		it('should return null when refresh_token is missing', () => {
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'acc123';
				if (key === 'auth_refresh_token') return null;
				if (key === 'auth_user_data') return JSON.stringify({ id: 'u1' });
				return null;
			});

			expect(getStoredSessionData()).toBeNull();
		});

		it('should return null when user_data is missing', () => {
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'acc123';
				if (key === 'auth_refresh_token') return 'ref456';
				if (key === 'auth_user_data') return null;
				return null;
			});

			expect(getStoredSessionData()).toBeNull();
		});

		it('should return null when localStorage throws', () => {
			localStorageMock.getItem.mockImplementation(() => {
				throw new Error('storage error');
			});

			expect(getStoredSessionData()).toBeNull();
		});
	});

	describe('clearStoredSessionData', () => {
		it('should remove all three auth keys from localStorage', () => {
			clearStoredSessionData();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_user_data');
		});

		it('should not throw when localStorage.removeItem throws', () => {
			localStorageMock.removeItem.mockImplementation(() => {
				throw new Error('storage error');
			});

			expect(() => clearStoredSessionData()).not.toThrow();
		});
	});

	describe('validateSession', () => {
		it('should return false when no session data is stored', async () => {
			localStorageMock.getItem.mockReturnValue(null);

			const result = await validateSession();

			expect(result).toBe(false);
		});

		it('should validate session through desktop host and return true when valid', async () => {
			const userData = { id: 'user-1' };
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'acc123';
				if (key === 'auth_refresh_token') return 'ref456';
				if (key === 'auth_user_data') return JSON.stringify(userData);
				return null;
			});
			host.validateSession.mockResolvedValue(true);

			const result = await validateSession();

			expect(host.validateSession).toHaveBeenCalledWith(
				expect.objectContaining({ accessToken: 'acc123', refreshToken: 'ref456' })
			);
			expect(result).toBe(true);
		});

		it('should return false when host validation throws', async () => {
			const userData = { id: 'user-1' };
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'acc123';
				if (key === 'auth_refresh_token') return 'ref456';
				if (key === 'auth_user_data') return JSON.stringify(userData);
				return null;
			});
			host.validateSession.mockRejectedValue(new Error('IPC error'));

			const result = await validateSession();

			expect(result).toBe(false);
		});
	});

	describe('getCurrentSession', () => {
		it('should get current session through desktop host', async () => {
			const mockSession = { access_token: 'tok', user: { id: 'u1' } };
			host.getCurrentSession.mockResolvedValue(mockSession);

			const result = await getCurrentSession();

			expect(host.getCurrentSession).toHaveBeenCalledWith();
			expect(result).toEqual(mockSession);
		});

		it('should return null when host getCurrentSession throws', async () => {
			host.getCurrentSession.mockRejectedValue(new Error('IPC error'));

			const result = await getCurrentSession();

			expect(result).toBeNull();
		});
	});
});
