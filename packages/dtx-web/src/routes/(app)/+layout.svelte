<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { supabase } = $derived(data);

	let isSidebarCollapsed = $state(false);
	let sidebarAnimated = $state(false);

	const toggleSidebar = () => {
		isSidebarCollapsed = !isSidebarCollapsed;
	};

	const logout = async () => {
		await supabase.auth.signOut();
		goto('/login');
	};

	const navigateToProfile = () => {
		console.log('Profile clicked');
		// Navigate to profile page
	};

	onMount(() => {
		sidebarAnimated = true;
	});
</script>

<div class="relative flex min-h-screen overflow-hidden">
	<!-- Background gradient overlay -->
	<div
		class="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900"
	></div>

	<!-- Animated background elements -->
	<div class="pointer-events-none absolute inset-0 opacity-10">
		<div
			class="absolute top-20 left-10 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute right-20 bottom-40 h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
	</div>

	<!-- Sidebar -->
	<aside
		class={`music-sidebar relative z-10 text-white transition-all duration-300 ${isSidebarCollapsed ? 'collapsed-sidebar' : 'expanded-sidebar'}`}
	>
		<div class="p-6">
			<div class="mb-8 flex items-center justify-between">
				{#if !isSidebarCollapsed}
					<div class="flex items-center space-x-3">
						<h2
							class="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-xl font-bold text-transparent"
						>
							Drumery
						</h2>
						<div class="music-bars scale-75">
							<div class="music-bar" style="height: 6px;"></div>
							<div class="music-bar" style="height: 12px;"></div>
							<div class="music-bar" style="height: 8px;"></div>
							<div class="music-bar" style="height: 16px;"></div>
							<div class="music-bar" style="height: 4px;"></div>
						</div>
					</div>
				{/if}
				<button
					onclick={toggleSidebar}
					class="rounded-lg p-2 text-purple-300 transition-colors hover:bg-purple-600/20 hover:text-purple-200"
				>
					{#if isSidebarCollapsed}
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							></path>
						</svg>
					{:else}
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							></path>
						</svg>
					{/if}
				</button>
			</div>

			{#if !isSidebarCollapsed}
				<nav class="space-y-3">
					<a
						href="/app/chart"
						class="group flex items-center rounded-lg px-4 py-3 text-slate-300 transition-all duration-200 hover:bg-purple-600/20 hover:text-purple-300"
					>
						<svg
							class="mr-3 h-5 w-5 transition-transform group-hover:scale-110"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
							></path>
						</svg>
						My Charts
					</a>
					<a
						href="/app/score"
						class="group flex items-center rounded-lg px-4 py-3 text-slate-300 transition-all duration-200 hover:bg-cyan-600/20 hover:text-cyan-300"
					>
						<svg
							class="mr-3 h-5 w-5 transition-transform group-hover:scale-110"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						Scores
					</a>
					<a
						href="/editor"
						class="group flex items-center rounded-lg px-4 py-3 text-slate-300 transition-all duration-200 hover:bg-amber-600/20 hover:text-amber-300"
					>
						<svg
							class="mr-3 h-5 w-5 transition-transform group-hover:scale-110"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							></path>
						</svg>
						Editor
					</a>
					<a
						href="/game"
						class="group flex items-center rounded-lg px-4 py-3 text-slate-300 transition-all duration-200 hover:bg-pink-600/20 hover:text-pink-300"
					>
						<svg
							class="mr-3 h-5 w-5 transition-transform group-hover:scale-110"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.5a2.5 2.5 0 010 5H9m6 0a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						Play Game
					</a>
				</nav>
			{:else}
				<nav class="space-y-3">
					<a
						href="/app/chart"
						class="flex justify-center rounded-lg p-3 text-slate-300 transition-all duration-200 hover:bg-purple-600/20 hover:text-purple-300"
						title="My Charts"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
							></path>
						</svg>
					</a>
					<a
						href="/app/score"
						class="flex justify-center rounded-lg p-3 text-slate-300 transition-all duration-200 hover:bg-cyan-600/20 hover:text-cyan-300"
						title="Scores"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
					</a>
					<a
						href="/editor"
						class="flex justify-center rounded-lg p-3 text-slate-300 transition-all duration-200 hover:bg-amber-600/20 hover:text-amber-300"
						title="Editor"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							></path>
						</svg>
					</a>
					<a
						href="/game"
						class="flex justify-center rounded-lg p-3 text-slate-300 transition-all duration-200 hover:bg-pink-600/20 hover:text-pink-300"
						title="Play Game"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.5a2.5 2.5 0 010 5H9m6 0a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
					</a>
				</nav>
			{/if}
		</div>
	</aside>

	<!-- Main Content -->
	<div class="relative z-10 flex flex-1 flex-col">
		<!-- Top Navigation Bar -->
		<header class="music-nav border-b border-purple-500/20">
			<div class="flex items-center justify-between px-6 py-4">
				<div class="flex items-center space-x-4">
					<h1
						class="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-2xl font-bold text-transparent"
					>
						Dashboard
					</h1>
				</div>
				<nav class="flex items-center space-x-6">
					<button
						onclick={navigateToProfile}
						class="flex items-center space-x-2 rounded-lg px-4 py-2 text-slate-300 transition-all duration-200 hover:bg-purple-600/20 hover:text-purple-300"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
							></path>
						</svg>
						<span>Profile</span>
					</button>
					<button
						onclick={logout}
						class="flex items-center space-x-2 rounded-lg px-4 py-2 text-slate-300 transition-all duration-200 hover:bg-red-600/20 hover:text-red-300"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							></path>
						</svg>
						<span>Logout</span>
					</button>
				</nav>
			</div>
		</header>

		<!-- Main Page Content -->
		<main class="flex-1 bg-gradient-to-br from-slate-900/50 to-purple-900/10 p-6">
			{@render children?.()}
		</main>
	</div>
</div>

<style>
	.collapsed-sidebar {
		width: 5rem;
	}
	.expanded-sidebar {
		width: 18rem;
	}
</style>
