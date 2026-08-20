import { authStore, type User } from '../stores/authStore';
import {
	storeSessionData,
	getStoredSessionData,
	clearStoredSessionData,
	validateSession,
	type SessionValidationStatus
} from './sessionStorage';
import type { DesktopAuthSession, DesktopAuthUser } from '$lib/lib/generated/native-api-contracts';
import { simFileService } from './simFileService';
import { simFileStore } from '../stores/simFileStore';
import { workspaceStore, type WorkspaceState, type TreeNode } from '../stores/workspaceStore';
import { linkageCacheService } from './linkageCacheService';
import { desktopHost, type DeviceAuthorizationPoll } from './desktopHost';
import { googleDriveService } from './googleDriveService';
import { googleDriveStore } from '../stores/googleDriveStore';

const toRendererUser = (user: DesktopAuthUser): User => ({
	id: user.id,
	email: user.email || '',
	name: user.name || user.email || 'User'
});

const isDesktopAuthUser = (value: unknown): value is DesktopAuthUser => {
	if (!value || typeof value !== 'object') return false;
	const user = value as Partial<DesktopAuthUser>;
	return typeof user.id === 'string' && user.id.trim().length > 0;
};

const isDesktopAuthSession = (value: unknown): value is DesktopAuthSession => {
	if (!value || typeof value !== 'object') return false;
	const session = value as Partial<DesktopAuthSession>;
	return (
		typeof session.sessionToken === 'string' &&
		session.sessionToken.trim().length > 0 &&
		isDesktopAuthUser(session.user)
	);
};

const delay = async (milliseconds: number): Promise<void> => {
	if (milliseconds <= 0) return;
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const manualAuthorizationMessage = (verificationUri: string, userCode: string): string =>
	`Open ${verificationUri} and enter code ${userCode} to finish signing in.`;

/**
 * Clears local-cloud file linkages while preserving workspace structure.
 */
const clearCloudLinkages = (): void => {
	linkageCacheService.clearCache();

	let currentState: WorkspaceState | null = null;
	const unsubscribe = workspaceStore.subscribe((state) => {
		currentState = state;
	});
	unsubscribe();

	if (currentState?.treeStructure?.length > 0) {
		const clearLinkagesFromNodes = (nodes: TreeNode[]): TreeNode[] =>
			nodes.map((node) => ({
				...node,
				linkedSimFileId: null,
				linkedSimFile: null,
				children: node.children ? clearLinkagesFromNodes(node.children) : []
			}));

		workspaceStore.setTreeStructure(clearLinkagesFromNodes(currentState.treeStructure));
	}
};

let authFlowGeneration = 0;

const handleTerminalPoll = (poll: DeviceAuthorizationPoll): boolean => {
	switch (poll.status) {
		case 'denied':
			authStore.setError('Authentication was denied.');
			return true;
		case 'expired':
			authStore.setError('The authentication code expired.');
			return true;
		case 'invalidGrant':
			authStore.setError('The authentication code is no longer valid.');
			return true;
		default:
			return false;
	}
};

export const authService = {
	login: async (): Promise<void> => {
		const generation = ++authFlowGeneration;
		authStore.setLoading(true);

		try {
			const attempt = await desktopHost.beginDeviceAuthorization();
			if (generation !== authFlowGeneration) return;

			try {
				await desktopHost.openExternalUrl(attempt.verificationUriComplete);
			} catch (error) {
				console.error('Failed to open device authorization URL:', error);
				authStore.setError(
					manualAuthorizationMessage(attempt.verificationUri, attempt.userCode)
				);
				// Login.svelte displays errors only outside its loading state. Keep the
				// poll alive while exposing the manual handoff to the user.
				authStore.setLoading(false);
			}

			while (generation === authFlowGeneration) {
				const poll = await desktopHost.pollDeviceAuthorization();
				if (generation !== authFlowGeneration) return;

				if (poll.status === 'pending') {
					await delay(poll.retryAfterMs);
					continue;
				}

				if (poll.status === 'approved') {
					if (!isDesktopAuthSession(poll.session)) {
						throw new Error('Native device authorization returned an invalid session');
					}
					storeSessionData(poll.session);
					googleDriveStore.reset();
					authStore.setUser(toRendererUser(poll.session.user));
					void googleDriveService.refreshConnection();
					return;
				}

				if (handleTerminalPoll(poll)) return;
			}
		} catch (error) {
			if (generation === authFlowGeneration) {
				console.error('Authentication failed:', error);
				authStore.setError('Authentication failed');
			}
		} finally {
			if (generation === authFlowGeneration) authStore.setLoading(false);
		}
	},

	cancelLogin: async (): Promise<void> => {
		++authFlowGeneration;
		try {
			await desktopHost.cancelDeviceAuthorization();
		} catch (error) {
			console.error('Failed to cancel authentication:', error);
		} finally {
			authStore.setLoading(false);
		}
	},

	restoreSession: async (): Promise<boolean> => {
		try {
			const session = getStoredSessionData();
			if (!session || !isDesktopAuthSession(session)) {
				if (session) clearStoredSessionData();
				return false;
			}

			const status: SessionValidationStatus = await validateSession();
			if (status === 'not-configured') {
				authStore.setError('Authentication is not configured on this build.');
				return false;
			}
			if (status !== 'valid') {
				clearStoredSessionData();
				return false;
			}

			authStore.setUser(toRendererUser(session.user));
			void googleDriveService.refreshConnection();
			return true;
		} catch (error) {
			console.error('Failed to restore session:', error);
			return false;
		}
	},

	logout: async (): Promise<void> => {
		authFlowGeneration++;
		authStore.logout();
		googleDriveStore.reset();
		try {
			await desktopHost.cancelDeviceAuthorization();
			await desktopHost.logoutSession();
		} catch (error) {
			console.error('Failed to logout:', error);
		} finally {
			clearStoredSessionData();
			simFileService.clearCache();
			simFileStore.reset();
			clearCloudLinkages();
		}
	}
};
