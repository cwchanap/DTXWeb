import type { DesktopAuthSession, DesktopAuthUser } from '$lib/lib/generated/native-api-contracts';
import { desktopHost } from './desktopHost';

export type StoredSession = DesktopAuthSession;

const SESSION_STORAGE_KEY = 'auth_session';
const LEGACY_STORAGE_KEYS = ['auth_access_token', 'auth_refresh_token', 'auth_user_data'] as const;

const isDesktopAuthUser = (value: unknown): value is DesktopAuthUser => {
	if (!value || typeof value !== 'object') return false;
	const user = value as Partial<DesktopAuthUser>;
	return typeof user.id === 'string' && user.id.trim().length > 0;
};

const isStoredSession = (value: unknown): value is StoredSession => {
	if (!value || typeof value !== 'object') return false;
	const session = value as Partial<StoredSession>;
	return (
		typeof session.sessionToken === 'string' &&
		session.sessionToken.trim().length > 0 &&
		isDesktopAuthUser(session.user)
	);
};

const removeLegacyStorage = (): void => {
	for (const key of LEGACY_STORAGE_KEYS) {
		try {
			localStorage.removeItem(key);
		} catch (error) {
			console.error(`Failed to remove obsolete auth storage key ${key}:`, error);
		}
	}
};

export const storeSessionData = (session: StoredSession): void => {
	try {
		localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
	} catch (error) {
		console.error('Failed to store session data:', error);
		throw error;
	}
};

export const getStoredSessionData = (): StoredSession | null => {
	try {
		const stored = localStorage.getItem(SESSION_STORAGE_KEY);
		const legacyValues = LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key));
		if (legacyValues.some((value) => value !== null)) {
			removeLegacyStorage();
		}

		if (stored === null) return null;

		let session: unknown;
		try {
			session = JSON.parse(stored);
		} catch (error) {
			console.error('Failed to parse stored session data:', error);
			localStorage.removeItem(SESSION_STORAGE_KEY);
			return null;
		}

		if (!isStoredSession(session)) {
			localStorage.removeItem(SESSION_STORAGE_KEY);
			return null;
		}

		return session;
	} catch (error) {
		console.error('Failed to get stored session data:', error);
		return null;
	}
};

export const clearStoredSessionData = (): void => {
	try {
		localStorage.removeItem(SESSION_STORAGE_KEY);
		removeLegacyStorage();
	} catch (error) {
		console.error('Failed to clear session data:', error);
	}
};

export type SessionValidationStatus = 'valid' | 'invalid' | 'not-configured';

export const validateSession = async (): Promise<SessionValidationStatus> => {
	try {
		const session = getStoredSessionData();
		if (!session) return 'invalid';
		return await desktopHost.validateSession<SessionValidationStatus>(session);
	} catch (error) {
		console.error('Failed to validate session:', error);
		return 'invalid';
	}
};

export const getCurrentSession = async (): Promise<StoredSession | null> => {
	try {
		return await desktopHost.getCurrentSession<StoredSession>();
	} catch (error) {
		console.error('Failed to get current session:', error);
		return null;
	}
};
