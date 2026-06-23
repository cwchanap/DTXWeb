<script lang="ts">
	import { authStore } from '../stores/authStore';
	import { Loader, User, AlertCircle } from '@lucide/svelte';
</script>

<div class="flex flex-col items-center p-8">
	{#if $authStore.isLoading}
		<div class="flex flex-col items-center py-12">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<Loader size={40} class="text-magenta animate-spin" />
			</div>
			<p class="text-dim mt-4">Connecting to authentication service...</p>
		</div>
	{:else}
		<div class="flex w-full max-w-md flex-col items-center py-8">
			<div class="bg-surface-2 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
				<User size={40} class="text-cyan" />
			</div>
			<h3 class="font-display text-hi mb-4 text-center text-xl font-semibold">
				Sign in to your account
			</h3>

			{#if $authStore.error}
				<div class="border-red/40 bg-red/10 mb-4 w-full rounded border-l-4 p-4">
					<div class="text-red flex items-center">
						<AlertCircle size={20} class="mr-2 flex-shrink-0" />
						<p>{$authStore.error}</p>
					</div>
				</div>
			{/if}

			<div class="bg-surface-2 mb-6 w-full rounded-lg px-4 py-5 shadow-inner">
				<p class="text-dim mb-3 text-center">
					Sign in with your Drumery web account to sync your data
				</p>
				<p class="text-faint text-center text-xs">
					You'll be redirected to the web login page
				</p>
			</div>
		</div>
	{/if}
</div>
