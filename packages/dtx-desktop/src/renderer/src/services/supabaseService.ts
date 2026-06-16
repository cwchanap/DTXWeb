// Session management service for renderer process
// All Supabase operations are handled in the Rust backend

import { desktopHost } from './desktopHost';

type StoredSession = {
	access_token: string;
	refresh_token: string;
	user: unknown;
};

// Function to store session data locally
export const storeSessionData = (session: StoredSession): void => {
	try {
		// Store tokens in localStorage for session persistence
		localStorage.setItem('auth_access_token', session.access_token);
		localStorage.setItem('auth_refresh_token', session.refresh_token);
		localStorage.setItem('auth_user_data', JSON.stringify(session.user));

		console.log('Session data stored successfully');
	} catch (error) {
		console.error('Failed to store session data:', error);
		throw error;
	}
};

// Function to get stored session data
export const getStoredSessionData = (): {
	accessToken: string;
	refreshToken: string;
	userData: unknown;
} | null => {
	try {
		const accessToken = localStorage.getItem('auth_access_token');
		const refreshToken = localStorage.getItem('auth_refresh_token');
		const userDataStr = localStorage.getItem('auth_user_data');

		if (!accessToken || !refreshToken || !userDataStr) {
			return null;
		}

		const userData = JSON.parse(userDataStr);
		return { accessToken, refreshToken, userData };
	} catch (error) {
		console.error('Failed to get stored session data:', error);
		return null;
	}
};

// Function to clear stored session data
export const clearStoredSessionData = (): void => {
	try {
		localStorage.removeItem('auth_access_token');
		localStorage.removeItem('auth_refresh_token');
		localStorage.removeItem('auth_user_data');
		console.log('Session data cleared');
	} catch (error) {
		console.error('Failed to clear session data:', error);
	}
};

// Function to check if session is valid via the Rust backend
export type SessionValidationStatus = 'valid' | 'invalid' | 'not-configured';

export const validateSession = async (): Promise<SessionValidationStatus> => {
	try {
		const sessionData = getStoredSessionData();
		if (!sessionData) {
			return 'invalid';
		}

		// Ask the Rust backend to validate the session. It distinguishes
		// "not-configured" (Supabase env missing on a misconfigured build) from
		// a genuine "invalid" so the caller does not silently wipe a good
		// stored session when the build itself is the problem. The Rust command
		// returns `SessionValidationStatus` directly — serde serializes the enum
		// as the bare string "valid" | "invalid" | "not-configured" (kebab-case,
		// no struct wrapper), so the result IS the status string.
		return await desktopHost.validateSession<SessionValidationStatus>(sessionData);
	} catch (error) {
		console.error('Failed to validate session:', error);
		// A transport failure is not necessarily an invalid session, but we
		// preserve the historical behavior (treat as invalid -> caller clears)
		// rather than risk masking a real rejection by keeping the session.
		return 'invalid';
	}
};

// Function to get current session from Rust backend
export const getCurrentSession = async (): Promise<unknown> => {
	try {
		const session = await desktopHost.getCurrentSession();
		return session;
	} catch (error) {
		console.error('Failed to get current session:', error);
		return null;
	}
};
