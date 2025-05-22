<script lang="ts">
	import Versions from './components/Versions.svelte';
	import Login from './components/Login.svelte';
	import Workspace from './components/Workspace.svelte';
	import Navbar from './components/Navbar.svelte';
	import { authStore } from './stores/authStore';
	import { authService } from './services/authService';
	import { onMount, onDestroy } from 'svelte';
	import { Info } from '@lucide/svelte';

	// Try to restore the session on app start
	onMount(() => {
		// Set up the protocol handler callback
		window.electron.ipcRenderer.on('auth-callback', (_event, token) => {
			authService.handleAuthCallback(token);
		});

		// Try to restore session
		authService.restoreSession();
	});

	// Clean up listener when component is destroyed
	onDestroy(() => {
		window.electron.ipcRenderer.removeAllListeners('auth-callback');
	});
</script>

<Navbar />

<main
	class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 px-8 pt-16 pb-8 text-slate-800 dark:from-slate-900 dark:to-slate-800 dark:text-slate-100"
>
	<div class="mx-auto max-w-3xl">
		{#if !$authStore.isAuthenticated}
			<div class="mb-10 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800">
				<Login />
			</div>
		{:else}
			<div class="mb-10">
				<Workspace />
			</div>

			<div class="rounded-xl bg-white p-6 shadow-md dark:bg-slate-800">
				<div
					class="mb-4 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700"
				>
					<Info size={20} class="text-slate-500" />
					<h2 class="text-xl font-semibold">Application Info</h2>
				</div>
				<Versions />
			</div>
		{/if}
	</div>
</main>
