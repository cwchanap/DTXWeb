import { authStore, type User } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession
} from './supabaseService';
import { simFileService } from './simFileService';
import { simFileStore } from '../stores/simFileStore';
import { workspaceStore, type WorkspaceState, type TreeNode } from '../stores/workspaceStore';
import { linkageCacheService } from './linkageCacheService';
import type { Session } from '@supabase/supabase-js';
import { desktopHost } from './desktopHost';

// Get server URL from environment variable or fallback to default
const DEFAULT_SERVER_URL = 'http://localhost:5173';
const SERVER_URL = import.meta.env.VITE_DTX_SERVER_URL || DEFAULT_SERVER_URL;

export const getDesktopLoginUrl = (serverUrl = SERVER_URL): string => {
	const normalizedServerUrl = serverUrl.replace(/\/+$/, '');
	return `${normalizedServerUrl}/login?redirect=desktop`;
};

type StoredUserData = {
	id: string;
	email?: string | null;
	user_metadata?: { name?: string };
};

const isStoredUserData = (data: unknown): data is StoredUserData => {
	if (!data || typeof data !== 'object') return false;
	const candidate = data as StoredUserData;
	return typeof candidate.id === 'string';
};

type MagicLinkResult = {
	success: boolean;
	error?: string;
	session?: Session | null;
	// Optional: the Rust backend serializes `user` with `skip_serializing_if =
	// "Option::is_none"`, so a successful response may omit it. The handler
	// guards for its absence before reading user fields.
	user?: {
		id: string;
		email: string | null;
		user_metadata?: { name?: string };
	};
};

/**
 * Clears local-cloud file linkages while preserving workspace structure
 */
const clearCloudLinkages = (): void => {
	// Clear linkage cache from localStorage
	linkageCacheService.clearCache();

	// Get current workspace state to clear linkages from tree structure
	let currentState: WorkspaceState | null = null;
	const unsubscribe = workspaceStore.subscribe((state) => {
		currentState = state;
	});
	unsubscribe();

	if (currentState?.treeStructure?.length > 0) {
		// Recursively remove linkage information from all tree nodes
		const clearLinkagesFromNodes = (nodes: TreeNode[]): TreeNode[] => {
			return nodes.map((node) => ({
				...node,
				linkedSimFileId: null,
				linkedSimFile: null,
				children: node.children ? clearLinkagesFromNodes(node.children) : []
			}));
		};

		const clearedTreeStructure = clearLinkagesFromNodes(currentState.treeStructure);
		workspaceStore.setTreeStructure(clearedTreeStructure);
	}
};

export const authService = {
	/**
	 * Initiates the login process by opening the web app login page in browser
	 */
	login: async (): Promise<void> => {
		try {
			authStore.setLoading(true);

			// Ask the Rust backend to open the web login page
			await desktopHost.openExternalUrl(getDesktopLoginUrl());
		} catch (error) {
			console.error('Login failed:', error);
			authStore.setError('Failed to open login page');
		} finally {
			authStore.setLoading(false);
		}
	},

	/**
	 * Processes magic link result from Rust backend
	 */
	handleMagicLinkResult: async (result: MagicLinkResult): Promise<void> => {
		try {
			if (!result.success) {
				throw new Error(result.error || 'Magic link verification failed');
			}

			if (!result.session) {
				throw new Error('No session received from magic link verification');
			}

			if (!result.user) {
				throw new Error('No user data received from magic link verification');
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
	 * Attempts to restore auth session from storage
	 */
	restoreSession: async (): Promise<boolean> => {
		try {
			const sessionData = getStoredSessionData();
			if (!sessionData) {
				return false;
			}

			if (!isStoredUserData(sessionData.userData)) {
				clearStoredSessionData();
				return false;
			}

			// Validate session with the Rust backend
			const status = await validateSession();
			if (status === 'not-configured') {
				// Supabase isn't configured (dev/build misconfiguration). Don't
				// wipe the stored session — we couldn't actually validate it —
				// and surface the real reason instead of a misleading silent
				// logout that the user also can't recover from (login would fail
				// the same way).
				authStore.setError('Authentication is not configured on this build.');
				return false;
			}
			if (status !== 'valid') {
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
			// Clear session in host process
			await desktopHost.logoutSession();

			// Clear local session data
			clearStoredSessionData();

			// Clear cloud file cache data
			simFileService.clearCache();
			simFileStore.reset();

			// Clear local-cloud file linkages
			clearCloudLinkages();

			// Update auth store
			authStore.logout();
		} catch (error) {
			console.error('Failed to logout:', error);
			// Still clear local state even if Rust backend logout fails
			clearStoredSessionData();

			// Clear cloud file cache data even if logout fails
			simFileService.clearCache();
			simFileStore.reset();

			// Clear local-cloud file linkages even if logout fails
			clearCloudLinkages();

			authStore.logout();
		}
	}
};
