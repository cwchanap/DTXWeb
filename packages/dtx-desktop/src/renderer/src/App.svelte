<script lang="ts">
	import Login from './components/Login.svelte';
	import Workspace from './components/Workspace.svelte';
	import NewSong from './components/NewSong.svelte';
	import Editor from './components/Editor.svelte';
	import Navbar from './components/Navbar.svelte';
	import VersionsModal from './components/VersionsModal.svelte';
	import { authStore } from './stores/authStore';
	import { authService } from './services/authService';
	import { simFileService } from './services/simFileService';
	import { simFileStore } from './stores/simFileStore';
	import { workspaceStore } from './stores/workspaceStore';
	import { linkingService } from './services/linkingService';
	import { onMount, onDestroy } from 'svelte';

	// Routing state
	let currentRoute = $state('workspace');
	let routeParams = $state<{ simfileID?: string }>({});

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
			routeParams = { simfileID: params[0] || undefined };
		} else {
			currentRoute = 'workspace';
			routeParams = {};
		}
	}

	// Try to restore the session on app start
	onMount(async () => {
		// Set up routing
		handleRouteChange();
		window.addEventListener('hashchange', handleRouteChange);

		// Set up the magic link result handler (new approach)
		window.electron.ipcRenderer.on('magic-link-result', async (_event, result) => {
			await authService.handleMagicLinkResult(result);
		});

		// Set up the legacy protocol handler callback
		window.electron.ipcRenderer.on('auth-callback', async (_event, tokens) => {
			await authService.handleAuthCallback(tokens);
		});

		// Try to restore session
		await authService.restoreSession();
	});

	// Reactive statement to fetch simFile data when user becomes authenticated
	$: if ($authStore.isAuthenticated && $authStore.user) {
		fetchSimFileData();
	}

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
	function triggerAutoLinking(remoteSimFiles: any[]) {
		// Get current workspace state
		let currentWorkspaceState: any = null;
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
		window.electron.ipcRenderer.removeAllListeners('auth-callback');
		window.removeEventListener('hashchange', handleRouteChange);
	});
</script>

<Navbar />

<main
	class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 px-8 pt-16 pb-8 text-slate-800 dark:from-slate-900 dark:to-slate-800 dark:text-slate-100"
>
	<div class="mx-auto w-full">
		{#if !$authStore.isAuthenticated}
			<div
				class="mx-auto mb-10 max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800"
			>
				<Login />
			</div>
		{:else}
			<div class="mb-10">
				{#if currentRoute === 'editor'}
					<Editor simfileID={routeParams.simfileID} />
				{:else if $workspaceStore.showNewSong}
					<NewSong />
				{:else}
					<Workspace />
				{/if}
			</div>
		{/if}

		<!-- Add the versions modal component -->
		{#if $authStore.isAuthenticated}
			<VersionsModal />
		{/if}
	</div>
</main>
