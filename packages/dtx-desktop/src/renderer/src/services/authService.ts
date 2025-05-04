import { authStore, type User } from '../stores/authStore';

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
	 * Processes login callback with auth token
	 */
	handleAuthCallback: (token: string): void => {
		try {
			if (!token) {
				throw new Error('No token provided');
			}

			// In a real app, you would validate the token here
			// For this example, we'll parse a simple token that contains user info
			const userData = JSON.parse(atob(token.split('.')[1])) as User;

			authStore.setUser(userData);

			// Store token securely - in a real app, use a secure storage method
			localStorage.setItem('auth_token', token);
		} catch (error) {
			console.error('Failed to process auth callback:', error);
			authStore.setError('Authentication failed');
		}
	},

	/**
	 * Attempts to restore auth session from storage
	 */
	restoreSession: (): boolean => {
		try {
			const token = localStorage.getItem('auth_token');

			if (!token) {
				return false;
			}

			// In a real app, verify the token's validity here
			const userData = JSON.parse(atob(token.split('.')[1])) as User;
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
	logout: (): void => {
		localStorage.removeItem('auth_token');
		authStore.logout();
	}
};
