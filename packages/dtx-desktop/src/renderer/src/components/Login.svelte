<script lang="ts">
	import { authStore } from '../stores/authStore';
	import { Loader, User, AlertCircle } from '@lucide/svelte';
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
		</div>
	{/if}
</div>
