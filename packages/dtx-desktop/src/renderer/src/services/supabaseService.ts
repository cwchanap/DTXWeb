// Session management service for renderer process
// All Supabase operations are handled in the main process

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

// Function to check if session is valid via main process
export const validateSession = async (): Promise<boolean> => {
	try {
		const sessionData = getStoredSessionData();
		if (!sessionData) {
			return false;
		}

		// Ask main process to validate the session
		const isValid = await window.electron.ipcRenderer.invoke('validate-session', sessionData);
		return isValid;
	} catch (error) {
		console.error('Failed to validate session:', error);
		return false;
	}
};

// Function to get current session from main process
export const getCurrentSession = async (): Promise<unknown> => {
	try {
		const session = await window.electron.ipcRenderer.invoke('get-current-session');
		return session;
	} catch (error) {
		console.error('Failed to get current session:', error);
		return null;
	}
};
