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
import { googleDriveService } from './googleDriveService';
import { googleDriveStore } from '../stores/googleDriveStore';

// Get server URL from environment variable or fallback to default
const DEFAULT_SERVER_URL = 'http://localhost:5173';
const SERVER_URL = import.meta.env.VITE_DTX_SERVER_URL || DEFAULT_SERVER_URL;

// The loopback HTTP callback used when running under `tauri dev`. The Rust
// backend listens on DTX_DESKTOP_AUTH_CALLBACK_PORT (default 47931); the dev
// scripts set the matching port here via VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT.
const DEFAULT_AUTH_CALLBACK_PORT = '47931';
// The custom-scheme deep link used by a bundled (installed) desktop app.
const DEEP_LINK_AUTH_CALLBACK_URL = 'dtx://auth-callback';

/**
 * The callback the (prod/preprod) web should redirect back to after issuing a
 * magic link. The desktop is the source of truth: a bundled app is registered
 * for the `dtx://` deep-link scheme, while a `tauri dev` binary is unbundled so
 * macOS won't route deep links to it — that instance is instead reachable via
 * the Rust loopback HTTP server. Sending this to the web means the deployed
 * app needs no per-instance configuration and works for both dev and bundled.
 */
export const getDesktopAuthCallbackUrl = (): string => {
	if (import.meta.env.DEV) {
		const port =
			import.meta.env.VITE_DTX_DESKTOP_AUTH_CALLBACK_PORT || DEFAULT_AUTH_CALLBACK_PORT;
		return `http://127.0.0.1:${port}/auth-callback`;
	}
	return DEEP_LINK_AUTH_CALLBACK_URL;
};

export const getDesktopLoginUrl = (serverUrl = SERVER_URL): string => {
	const normalizedServerUrl = serverUrl.replace(/\/+$/, '');
	const desktopCallback = encodeURIComponent(getDesktopAuthCallbackUrl());
	return `${normalizedServerUrl}/login?redirect=desktop&desktop_callback=${desktopCallback}`;
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
			// Session validation already triggers native pending-binding
			// reconciliation best-effort. Refresh only the renderer-safe summary.
			void googleDriveService.refreshConnection();
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
		// Native logout intentionally retains installation-local Drive
		// credentials/settings for this user. The renderer still must hide any
		// old connection or upload state immediately.
		googleDriveStore.reset();
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
