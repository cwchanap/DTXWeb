import { authStore, type User } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession
} from './supabaseService';

// Get server URL from environment variable or fallback to default
const DEFAULT_SERVER_URL = 'http://localhost:5173';
const SERVER_URL = import.meta.env.VITE_DTX_SERVER_URL || DEFAULT_SERVER_URL;
const WEB_APP_LOGIN_URL = `${SERVER_URL}/login?redirect=desktop`;

export const authService = {
	/**
	 * Initiates the login process by opening the web app login page in browser
	 */
	login: async (): Promise<void> => {
		try {
			authStore.setLoading(true);

			// Use Electron's ipcRenderer to send a request to the main process
			await window.electron.ipcRenderer.send('open-external-url', WEB_APP_LOGIN_URL);
		} catch (error) {
			console.error('Login failed:', error);
			authStore.setError('Failed to open login page');
		} finally {
			authStore.setLoading(false);
		}
	},

	/**
	 * Processes magic link result from main process
	 */
	handleMagicLinkResult: async (result: any): Promise<void> => {
		try {
			if (!result.success) {
				throw new Error(result.error || 'Magic link verification failed');
			}

			if (!result.session) {
				throw new Error('No session received from magic link verification');
			}

			// Store session data locally
			storeSessionData(result.session);

			// Extract user data from the session
			const userData: User = {
				id: result.user.id,
				email: result.user.email || '',
				name: result.user.user_metadata?.name || result.user.email || 'User'
			};

			// Update auth store
			authStore.setUser(userData);
		} catch (error) {
			console.error('Failed to process magic link result:', error);
			authStore.setError('Authentication failed');
		}
	},

	/**
	 * Processes login callback with auth tokens (legacy support)
	 */
	handleAuthCallback: async (tokens: {
		accessToken: string;
		refreshToken: string;
	}): Promise<void> => {
		try {
			if (!tokens.accessToken || !tokens.refreshToken) {
				throw new Error('No tokens provided');
			}

			// In a real app, you would validate the token here
			// For this example, we'll parse a simple token that contains user info
			const userData = JSON.parse(atob(tokens.accessToken.split('.')[1])) as User;

			// Store tokens locally
			const sessionData = {
				access_token: tokens.accessToken,
				refresh_token: tokens.refreshToken,
				user: userData
			};
			storeSessionData(sessionData);

			// Update auth store
			authStore.setUser(userData);
		} catch (error) {
			console.error('Failed to process auth callback:', error);
			authStore.setError('Authentication failed');
		}
	},

	/**
	 * Attempts to restore auth session from storage
	 */
	restoreSession: async (): Promise<boolean> => {
		try {
			const sessionData = getStoredSessionData();
			if (!sessionData) {
				return false;
			}

			// Validate session with main process
			const isValid = await validateSession();
			if (!isValid) {
				// Clear invalid session data
				clearStoredSessionData();
				return false;
			}

			// Extract user data from stored session
			const userData: User = {
				id: sessionData.userData.id,
				email: sessionData.userData.email || '',
				name:
					sessionData.userData.user_metadata?.name || sessionData.userData.email || 'User'
			};

			authStore.setUser(userData);
			return true;
		} catch (error) {
			console.error('Failed to restore session:', error);
			return false;
		}
	},

	/**
	 * Logs out the current user
	 */
	logout: async (): Promise<void> => {
		try {
			// Clear session in main process
			await window.electron.ipcRenderer.invoke('logout-session');

			// Clear local session data
			clearStoredSessionData();

			// Update auth store
			authStore.logout();
		} catch (error) {
			console.error('Failed to logout:', error);
			// Still clear local state even if main process logout fails
			clearStoredSessionData();
			authStore.logout();
		}
	}
};
