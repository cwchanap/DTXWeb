<script lang="ts">
	import Versions from './components/Versions.svelte';
	import Login from './components/Login.svelte';
	import { authStore } from './stores/authStore';
	import { authService } from './services/authService';
	import { onMount, onDestroy } from 'svelte';
	import { Music, Info } from '@lucide/svelte';

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

<main
	class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8 text-slate-800 dark:from-slate-900 dark:to-slate-800 dark:text-slate-100"
>
	<div class="mx-auto max-w-3xl">
		<header class="mb-12 text-center">
			<div class="mb-4 flex justify-center">
				<div
					class="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10 dark:bg-blue-500/20"
				>
					<Music size={32} class="text-blue-600 dark:text-blue-400" />
				</div>
			</div>
			<h1
				class="mb-2 bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-3xl font-bold text-transparent"
			>
				Drumery Desktop
			</h1>
		</header>

		<div class="mb-10 overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-800">
			<Login />
		</div>

		{#if $authStore.isAuthenticated}
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
