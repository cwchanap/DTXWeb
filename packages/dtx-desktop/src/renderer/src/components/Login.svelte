<script lang="ts">
	import { authStore } from '../stores/authStore';
	import { authService } from '../services/authService';
	import { Loader, User, AlertCircle } from '@lucide/svelte';

	const handleLogin = (): void => {
		void authService.login();
	};

	const handleCancel = (): void => {
		void authService.cancelLogin();
	};
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

			<div class="bg-surface-2 mb-6 w-full rounded-lg px-4 py-5 shadow-inner">
				<p class="text-dim mb-3 text-center">
					Sign in with your Drumery web account to sync your data
				</p>
				<p class="text-faint text-center text-xs">
					You'll be redirected to the web login page
				</p>
			</div>

			{#if !$authStore.isLoginVisible}
				<button
					class="bg-magenta rounded-lg px-4 py-2 text-sm font-semibold text-[#16001a]"
					onclick={handleLogin}
				>
					Start sign in
				</button>
			{/if}
		</div>
	{/if}

	{#if $authStore.error}
		<div class="border-red/40 bg-red/10 mb-4 w-full max-w-md rounded border-l-4 p-4">
			<div class="text-red flex items-center">
				<AlertCircle size={20} class="mr-2 flex-shrink-0" />
				<p>{$authStore.error}</p>
			</div>
		</div>
	{/if}

	{#if $authStore.deviceAuthorization}
		<section class="bg-surface-2 mb-4 w-full max-w-md rounded-lg p-4" aria-live="polite">
			<h4 class="text-hi mb-2 text-sm font-semibold">Finish signing in</h4>
			<p class="text-dim mb-2 text-sm">Enter this code in your browser:</p>
			<code class="text-cyan mb-3 block text-center text-lg font-semibold tracking-widest">
				{$authStore.deviceAuthorization.userCode}
			</code>
			<a
				class="text-cyan hover:text-hi block text-center text-xs break-all underline"
				aria-label="Open verification page"
				href={$authStore.deviceAuthorization.verificationUri}
				target="_blank"
				rel="noreferrer"
			>
				{$authStore.deviceAuthorization.verificationUri}
			</a>
			{#if $authStore.isLoading}
				<p class="text-faint mt-3 text-center text-xs" role="status">
					Waiting for approval…
				</p>
			{/if}
		</section>
	{/if}

	{#if $authStore.isLoginVisible}
		<div class="flex gap-2">
			{#if $authStore.isLoading}
				<button
					class="bg-surface-2 text-dim rounded-lg px-4 py-2 text-sm"
					onclick={handleCancel}
					aria-label="Cancel sign in"
				>
					Cancel sign in
				</button>
			{:else}
				<button
					class="bg-magenta rounded-lg px-4 py-2 text-sm font-semibold text-[#16001a]"
					onclick={handleLogin}
				>
					Try again
				</button>
			{/if}
		</div>
	{/if}
</div>
