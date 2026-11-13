import { get } from 'svelte/store';

import { googleDriveStore } from '../stores/googleDriveStore';
import { googleDriveService } from './googleDriveService';

/**
 * HPA-316 temporary Windows diagnostic — remove after CI diagnosis.
 *
 * Wraps `googleDriveService.refreshConnection` so the ORIGINAL boot-time
 * refresh (fired by authService.restoreSession) is observed directly instead
 * of being inferred post-hoc from transport traffic. The snapshot records the
 * refresh lifecycle — pending / resolved / rejected — plus whether the
 * resolved connection was applied to the store, using only booleans, counts,
 * and timestamps. No payloads, no error text, no session data.
 *
 * Imported only when `import.meta.env.VITE_WDIO === 'true'` (e2e builds,
 * see main.ts), and installed before `mount(App)`, so the wrapper exists
 * before any boot invoke — the install race of page-injected diagnostics
 * cannot occur. The wrapper forwards the original result or rejection
 * unchanged.
 */
export type DriveRefreshDiagnosticsSnapshot = {
	/** Any refresh call was captured. */
	observed: boolean;
	/** The latest call has not settled yet. */
	pending: boolean;
	/** The latest call fulfilled. */
	resolved: boolean;
	/** The latest call rejected (the real service resolves null on failure). */
	rejected: boolean;
	/** The latest fulfillment value was a non-null connection object. */
	withConnection: boolean;
	/** That connection had `connected === true`. */
	connected: boolean;
	/** `googleDriveStore.connection?.connected === true` at settlement. */
	storeConnected: boolean;
	/** `googleDriveStore.error !== null` at settlement. */
	storeHasError: boolean;
	/** Total refresh calls captured (snapshot state tracks the latest). */
	calls: number;
	startedAtMs: number | null;
	settledAtMs: number | null;
};

type RefreshFn = () => Promise<{ connected?: unknown } | null>;
type WindowWithDiag = { __dtxDriveRefreshDiag?: () => DriveRefreshDiagnosticsSnapshot };

const state: DriveRefreshDiagnosticsSnapshot = {
	observed: false,
	pending: false,
	resolved: false,
	rejected: false,
	withConnection: false,
	connected: false,
	storeConnected: false,
	storeHasError: false,
	calls: 0,
	startedAtMs: null,
	settledAtMs: null
};

const readStoreFlags = (): { storeConnected: boolean; storeHasError: boolean } => {
	try {
		const storeState = get(googleDriveStore);
		return {
			storeConnected: storeState?.connection?.connected === true,
			storeHasError: storeState?.error != null
		};
	} catch {
		return { storeConnected: false, storeHasError: false };
	}
};

const exposeSnapshot = (): void => {
	(window as unknown as WindowWithDiag).__dtxDriveRefreshDiag =
		(): DriveRefreshDiagnosticsSnapshot => ({
			...state
		});
};

export const installDriveRefreshDiagnostics = (): boolean => {
	const service = googleDriveService as { refreshConnection: RefreshFn };
	const original = service.refreshConnection;
	if (typeof original !== 'function') return false;
	if ((window as unknown as WindowWithDiag).__dtxDriveRefreshDiag) return false;

	service.refreshConnection = async (): Promise<{ connected?: unknown } | null> => {
		state.calls += 1;
		state.observed = true;
		state.pending = true;
		state.resolved = false;
		state.rejected = false;
		state.withConnection = false;
		state.connected = false;
		state.startedAtMs = Date.now();
		state.settledAtMs = null;
		try {
			const connection = await original();
			state.resolved = true;
			state.withConnection = connection != null;
			state.connected = connection?.connected === true;
			return connection;
		} catch (error) {
			state.rejected = true;
			throw error;
		} finally {
			state.pending = false;
			state.settledAtMs = Date.now();
			Object.assign(state, readStoreFlags());
		}
	};

	exposeSnapshot();
	return true;
};
