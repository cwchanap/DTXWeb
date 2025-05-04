<script lang="ts">
	import { authStore } from '../stores/authStore';
	import { authService } from '../services/authService';
	import { Loader, LogOut, LogIn, User, AlertCircle } from '@lucide/svelte';

	const handleLogin = async () => {
		await authService.login();
	};

	const handleLogout = () => {
		authService.logout();
	};
</script>

<div class="flex flex-col items-center p-8">
	{#if $authStore.isLoading}
		<div class="flex flex-col items-center py-12">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<Loader size={40} class="animate-spin text-blue-500" />
			</div>
			<p class="mt-4 text-slate-600 dark:text-slate-400">
				Connecting to authentication service...
			</p>
		</div>
	{:else if $authStore.isAuthenticated}
		<div class="flex flex-col items-center py-8">
			<div
				class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900"
			>
				<User size={40} class="text-blue-500 dark:text-blue-300" />
			</div>
			<div class="mb-6 text-center">
				<h3 class="mb-1 text-xl font-semibold">
					Welcome, {$authStore.user?.name || 'User'}
				</h3>
				<p class="text-sm text-slate-600 dark:text-slate-400">{$authStore.user?.email}</p>
			</div>
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-6
				py-2.5 font-medium text-white shadow-md transition
				duration-150 ease-in-out hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				on:click={handleLogout}
				tabindex="0"
				aria-label="Logout"
			>
				<LogOut size={20} />
				Sign Out
			</button>
		</div>
	{:else}
		<div class="flex w-full max-w-md flex-col items-center py-8">
			<div
				class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900"
			>
				<User size={40} class="text-blue-500 dark:text-blue-300" />
			</div>
			<h3 class="mb-4 text-center text-xl font-semibold">Sign in to your account</h3>

			{#if $authStore.error}
				<div
					class="mb-4 w-full rounded border-l-4 border-red-500 bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-400"
				>
					<div class="flex items-center">
						<AlertCircle size={20} class="mr-2 flex-shrink-0" />
						<p>{$authStore.error}</p>
					</div>
				</div>
			{/if}

			<div
				class="mb-6 w-full rounded-lg bg-slate-50 px-4 py-5 shadow-inner dark:bg-slate-700/30"
			>
				<p class="mb-3 text-center text-slate-600 dark:text-slate-400">
					Sign in with your Drumery web account to sync your data
				</p>
				<p class="text-center text-xs text-slate-500 dark:text-slate-500">
					You'll be redirected to the web login page
				</p>
			</div>

			<button
				class="flex h-12 w-64 items-center justify-center gap-2 rounded-lg
				bg-gradient-to-r from-blue-500 to-indigo-600 font-medium text-white shadow-md transition
				duration-150 ease-in-out hover:from-blue-600 hover:to-indigo-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				on:click={handleLogin}
				tabindex="0"
				aria-label="Login"
			>
				<LogIn size={20} />
				Sign in with Web Account
			</button>
		</div>
	{/if}
</div>
