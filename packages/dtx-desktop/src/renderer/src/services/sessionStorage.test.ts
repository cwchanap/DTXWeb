import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession,
	getCurrentSession,
	type StoredSession
} from './sessionStorage';
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

const user = {
	id: 'user-1',
	name: 'Test User',
	email: 'test@example.com',
	emailVerified: true,
	image: null,
	createdAt: '2026-08-20T00:00:00.000Z',
	updatedAt: '2026-08-20T00:00:00.000Z'
};

const session: StoredSession = {
	sessionToken: 'opaque-session-token',
	user
};

describe('sessionStorage', () => {
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
		it('stores one Better Auth-shaped session object under the neutral key', () => {
			storeSessionData(session);

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'auth_session',
				JSON.stringify(session)
			);
			expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
		});

		it('throws when localStorage.setItem throws', () => {
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('quota exceeded');
			});

			expect(() => storeSessionData(session)).toThrow('quota exceeded');
		});
	});

	describe('getStoredSessionData', () => {
		it('returns a valid neutral session object', () => {
			localStorageMock.getItem.mockImplementation((key: string) =>
				key === 'auth_session' ? JSON.stringify(session) : null
			);

			expect(getStoredSessionData()).toEqual(session);
			expect(localStorageMock.getItem).toHaveBeenCalledWith('auth_session');
		});

		it('removes obsolete Supabase-shaped values without migrating them', () => {
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'auth_access_token') return 'legacy-access';
				if (key === 'auth_refresh_token') return 'legacy-refresh';
				if (key === 'auth_user_data') return JSON.stringify({ id: 'legacy-user' });
				return null;
			});

			expect(getStoredSessionData()).toBeNull();
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_user_data');
			expect(localStorageMock.setItem).not.toHaveBeenCalled();
		});

		it('returns null for a malformed or incomplete neutral session', () => {
			localStorageMock.getItem.mockImplementation((key: string) =>
				key === 'auth_session' ? JSON.stringify({ sessionToken: '', user: {} }) : null
			);

			expect(getStoredSessionData()).toBeNull();
		});

		it('returns null when localStorage throws', () => {
			localStorageMock.getItem.mockImplementation(() => {
				throw new Error('storage error');
			});

			expect(getStoredSessionData()).toBeNull();
		});
	});

	describe('real browser storage cleanup', () => {
		const useRealLocalStorage = (): Storage => {
			if (!originalLocalStorageDescriptor)
				throw new Error('localStorage descriptor unavailable');
			Object.defineProperty(window, 'localStorage', originalLocalStorageDescriptor);
			return window.localStorage;
		};

		it('removes malformed neutral JSON from localStorage', () => {
			const realLocalStorage = useRealLocalStorage();
			realLocalStorage.clear();
			realLocalStorage.setItem('auth_session', '{not-json');

			expect(getStoredSessionData()).toBeNull();
			expect(realLocalStorage.getItem('auth_session')).toBeNull();
		});

		it('removes an empty malformed neutral value from localStorage', () => {
			const realLocalStorage = useRealLocalStorage();
			realLocalStorage.clear();
			realLocalStorage.setItem('auth_session', '');

			expect(getStoredSessionData()).toBeNull();
			expect(realLocalStorage.getItem('auth_session')).toBeNull();
		});

		it('removes structurally invalid neutral sessions from localStorage', () => {
			const realLocalStorage = useRealLocalStorage();
			realLocalStorage.clear();
			realLocalStorage.setItem(
				'auth_session',
				JSON.stringify({ sessionToken: '', user: { id: 'user-1' } })
			);

			expect(getStoredSessionData()).toBeNull();
			expect(realLocalStorage.getItem('auth_session')).toBeNull();
		});

		it('leaves truly absent neutral storage absent', () => {
			const realLocalStorage = useRealLocalStorage();
			realLocalStorage.clear();

			expect(getStoredSessionData()).toBeNull();
			expect(realLocalStorage.getItem('auth_session')).toBeNull();
		});

		it('keeps a valid session stored when native validation is not configured', async () => {
			const realLocalStorage = useRealLocalStorage();
			realLocalStorage.clear();
			realLocalStorage.setItem('auth_session', JSON.stringify(session));
			host.validateSession.mockResolvedValue('not-configured');

			expect(await validateSession()).toBe('not-configured');
			expect(realLocalStorage.getItem('auth_session')).toBe(JSON.stringify(session));
		});
	});

	describe('clearStoredSessionData', () => {
		it('removes the neutral session and all obsolete auth keys', () => {
			clearStoredSessionData();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_session');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_access_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_refresh_token');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_user_data');
		});

		it('does not throw when localStorage.removeItem throws', () => {
			localStorageMock.removeItem.mockImplementation(() => {
				throw new Error('storage error');
			});

			expect(() => clearStoredSessionData()).not.toThrow();
		});
	});

	describe('validateSession', () => {
		it('returns invalid when no session is stored', async () => {
			localStorageMock.getItem.mockReturnValue(null);

			expect(await validateSession()).toBe('invalid');
			expect(host.validateSession).not.toHaveBeenCalled();
		});

		it('validates the neutral session through the native host', async () => {
			localStorageMock.getItem.mockImplementation((key: string) =>
				key === 'auth_session' ? JSON.stringify(session) : null
			);
			host.validateSession.mockResolvedValue('valid');

			expect(await validateSession()).toBe('valid');
			expect(host.validateSession).toHaveBeenCalledWith(session);
		});

		it('preserves the not-configured tri-state result', async () => {
			localStorageMock.getItem.mockImplementation((key: string) =>
				key === 'auth_session' ? JSON.stringify(session) : null
			);
			host.validateSession.mockResolvedValue('not-configured');

			expect(await validateSession()).toBe('not-configured');
		});

		it('treats a native validation failure as invalid', async () => {
			localStorageMock.getItem.mockImplementation((key: string) =>
				key === 'auth_session' ? JSON.stringify(session) : null
			);
			host.validateSession.mockRejectedValue(new Error('IPC error'));

			expect(await validateSession()).toBe('invalid');
		});
	});

	describe('getCurrentSession', () => {
		it('gets the Better Auth-shaped session through the native host', async () => {
			host.getCurrentSession.mockResolvedValue(session);

			expect(await getCurrentSession()).toEqual(session);
			expect(host.getCurrentSession).toHaveBeenCalledWith();
		});

		it('returns null when native session lookup fails', async () => {
			host.getCurrentSession.mockRejectedValue(new Error('IPC error'));

			expect(await getCurrentSession()).toBeNull();
		});
	});
});
