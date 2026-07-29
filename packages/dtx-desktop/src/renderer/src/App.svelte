<script lang="ts">
	import Login from './components/Login.svelte';
	import AppShell from './components/shell/AppShell.svelte';
	import DesktopEditor from './components/DesktopEditor.svelte';
	import VersionsModal from './components/VersionsModal.svelte';
	import Toaster from './components/shell/Toaster.svelte';
	import { authStore } from './stores/authStore';
	import { authService } from './services/authService';
	import { simFileService } from './services/simFileService';
	import { simFileStore } from './stores/simFileStore';
	import { workspaceStore, type WorkspaceState } from './stores/workspaceStore';
	import { bookmarkStore } from './stores/bookmarkStore';
	import { linkingService } from './services/linkingService';
	import { workspaceService } from './services/workspaceService';
	import { desktopHost } from './services/desktopHost';
	import { storeSessionData } from './services/supabaseService';
	import { onMount, onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
	import type { Session } from '@supabase/supabase-js';
	import type { SimfileWithDtx } from '@dtx/common';

	type MagicLinkResult = {
		success: boolean;
		error?: string;
		session?: Session | null;
		user?: {
			id: string;
			email: string | null;
			user_metadata?: { name?: string };
		};
	};

	// Supabase session value emitted by the Rust backend after a token refresh
	// rotates the access/refresh tokens. Shape mirrors `StoredSession` in
	// supabaseService so it can be persisted directly.
	type RefreshedSession = {
		access_token: string;
		refresh_token: string;
		user: unknown;
	};

	// Routing state
	let currentRoute = $state('workspace');
	let routeParams = $state<{ simFileId?: string }>({});
	let workspaceHydrationSettled = $state(false);
	const hostUnlisteners: Array<() => void> = [];
	let destroyed = false;

	const registerHostUnlistener = (unlisten: () => void) => {
		if (destroyed) {
			unlisten();
			return;
		}

		hostUnlisteners.push(unlisten);
	};

	// Function to handle route changes
	function handleRouteChange() {
		const hash = window.location.hash.slice(1); // Remove the # character
		if (!hash) {
			currentRoute = 'workspace';
			routeParams = {};
			return;
		}

		const [route, ...params] = hash.split('/');

		if (route === 'editor') {
			currentRoute = 'editor';
			routeParams = { simFileId: params[0] || undefined };
		} else if (route === 'login') {
			currentRoute = 'login';
			routeParams = {};
		} else {
			currentRoute = 'workspace';
			routeParams = {};
		}
	}

	// Try to restore the session on app start
	onMount(async () => {
		destroyed = false;
		// Set up routing
		handleRouteChange();
		window.addEventListener('hashchange', handleRouteChange);

		const hydrationTransition = workspaceService.getTransitionGeneration();
		try {
			const nativeWorkspace = await desktopHost.getWorkspaceRoot();
			if (destroyed || !workspaceService.isTransitionCurrent(hydrationTransition)) return;

			workspaceStore.hydratePath(nativeWorkspace);
			if (nativeWorkspace) {
				workspaceStore.hydrateRootId(await desktopHost.getCurrentWorkspaceRootId());
				if (destroyed || !workspaceService.isTransitionCurrent(hydrationTransition)) return;
				await workspaceService.loadSubWorkspaces();
				if (destroyed || !workspaceService.isTransitionCurrent(hydrationTransition)) return;
				await workspaceService.loadTreeStructure();
			}
		} catch (error) {
			console.error('Failed to hydrate native workspace:', error);
			if (!destroyed && workspaceService.isTransitionCurrent(hydrationTransition)) {
				workspaceStore.hydratePath(null);
			}
		} finally {
			if (!destroyed) {
				workspaceHydrationSettled = true;
				// Hydrate the bookmark cache from the native trust pool. This is
				// display-only metadata; the authoritative bookmark set lives in
				// native and is refreshed after every mutation.
				void bookmarkStore.refresh();
			}
		}

		if (destroyed) return;

		// Set up the magic link result handler (new approach)
		try {
			const unlistenMagicLinkResult = await desktopHost.onMagicLinkResult<MagicLinkResult>(
				async (result) => {
					await authService.handleMagicLinkResult(result);
				}
			);
			registerHostUnlistener(unlistenMagicLinkResult);
		} catch (error) {
			console.error('Failed to register magic link result handler:', error);
		}

		// Persist rotated tokens whenever the Rust backend refreshes the
		// session (proactive near-expiry refresh during long sessions, or the
		// startup validation refresh). Without this, localStorage keeps the
		// now-revoked refresh token and the next launch logs the user out.
		if (destroyed) return;
		try {
			const unlistenSessionRefreshed = await desktopHost.onSessionRefreshed<RefreshedSession>(
				(session) => {
					try {
						storeSessionData(session);
					} catch (error) {
						console.error('Failed to persist refreshed session:', error);
					}
				}
			);
			registerHostUnlistener(unlistenSessionRefreshed);
		} catch (error) {
			console.error('Failed to register session refreshed handler:', error);
		}

		if (destroyed) return;
		try {
			await desktopHost.drainPendingAuthEvents();
		} catch (error) {
			console.error('Failed to drain pending auth events:', error);
		}

		// Try to restore session
		if (destroyed) return;
		await authService.restoreSession();
	});

	// Effect to fetch simFile data when user becomes authenticated
	$effect(() => {
		if ($authStore.isAuthenticated && $authStore.user) {
			fetchSimFileData();
			// If user was on login page, redirect to workspace
			if (currentRoute === 'login') {
				window.location.hash = '';
			}
		}
	});

	// Function to fetch simFile data
	async function fetchSimFileData() {
		try {
			simFileStore.setLoading(true);
			const result = await simFileService.fetchUserSimFiles();

			if (result.error) {
				simFileStore.setError(result.error);
			} else {
				simFileStore.setUserSimFiles(result.data, result.fromCache);
				console.log(
					`Loaded ${result.data.length} simFiles ${result.fromCache ? 'from cache' : 'from server'}`
				);

				// Trigger automatic linking after simFiles are loaded
				triggerAutoLinking(result.data);
			}
		} catch (error) {
			console.error('Failed to fetch simFile data:', error);
			simFileStore.setError(
				error instanceof Error ? error.message : 'Failed to load simFiles'
			);
		}
	}

	// Function to trigger automatic linking between remote simFiles and local folders
	function triggerAutoLinking(remoteSimFiles: SimfileWithDtx[]) {
		// Get current workspace state
		let currentWorkspaceState: WorkspaceState | null = null;
		const unsubscribe = workspaceStore.subscribe((state) => {
			currentWorkspaceState = state;
		});
		unsubscribe();

		// Only proceed if we have both remote simFiles and local tree structure
		if (remoteSimFiles.length > 0 && currentWorkspaceState?.treeStructure?.length > 0) {
			console.log('Triggering automatic linking...');
			linkingService.autoLinkSimFilesToFolders(
				remoteSimFiles,
				currentWorkspaceState.treeStructure
			);
		} else {
			console.log('Skipping auto-linking: insufficient data', {
				remoteSimFiles: remoteSimFiles.length,
				localFolders: currentWorkspaceState?.treeStructure?.length || 0
			});
		}
	}

	// Clean up listeners when component is destroyed
	onDestroy(() => {
		destroyed = true;
		workspaceService.disposeOperations();
		for (const unlisten of hostUnlisteners.splice(0)) {
			unlisten();
		}
		window.removeEventListener('hashchange', handleRouteChange);
	});
</script>

{#if workspaceHydrationSettled}
	{#if currentRoute === 'login'}
		<div class="bg-base flex min-h-screen items-center justify-center p-8">
			<div
				class="border-hairline bg-surface-1 w-full max-w-3xl overflow-hidden rounded-2xl border"
			>
				<Login />
			</div>
		</div>
	{:else if currentRoute === 'editor'}
		<DesktopEditor simFileId={routeParams.simFileId} />
	{:else}
		<AppShell />
	{/if}
{:else}
	<div class="bg-base flex min-h-screen items-center justify-center" role="status">
		{$_('app.loadingWorkspace')}
	</div>
{/if}

{#if $authStore.isAuthenticated}
	<VersionsModal />
{/if}

<!-- Global ephemeral notifications (preference-save/export failures, etc.) -->
<Toaster />
