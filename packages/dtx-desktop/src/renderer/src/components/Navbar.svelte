<script lang="ts">
	import { authStore } from '../stores/authStore';
	import { authService } from '../services/authService';
	import { Music, LogOut, User } from '@lucide/svelte';

	const handleLogout = async () => {
		await authService.logout();
	};
</script>

<nav class="fixed top-0 right-0 left-0 z-10 bg-white shadow-md dark:bg-slate-800">
	<div class="mx-auto max-w-7xl px-4 py-2">
		<div class="flex items-center justify-between">
			<!-- Logo and App Name -->
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 dark:bg-blue-500/20"
				>
					<Music size={20} class="text-blue-600 dark:text-blue-400" />
				</div>
				<h1
					class="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-xl font-bold text-transparent"
				>
					Drumery Desktop
				</h1>
			</div>

			<!-- User Info / Login Button -->
			{#if $authStore.isAuthenticated}
				<div class="flex items-center gap-3">
					<div class="text-right">
						<p class="text-sm font-medium">{$authStore.user?.name || 'User'}</p>
						<p class="text-xs text-slate-500 dark:text-slate-400">
							{$authStore.user?.email}
						</p>
					</div>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900"
					>
						<User size={16} class="text-blue-500 dark:text-blue-300" />
					</div>
					<button
						class="flex items-center gap-1 rounded-lg bg-red-100 px-2 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
						onclick={handleLogout}
						tabindex="0"
						aria-label="Logout"
					>
						<LogOut size={14} />
						<span>Logout</span>
					</button>
				</div>
			{/if}
		</div>
	</div>
</nav>
